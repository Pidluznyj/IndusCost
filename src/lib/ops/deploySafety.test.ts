/**
 * Biblioteca de segurança dos executores de deploy (infra/deploy/induscost-deploy-safety.sh) — parte SEM banco.
 *
 * Roda a biblioteca real num bash com systemctl/pgrep/psql/pg_restore SIMULADOS (systemd e cron em diretórios
 * temporários; nada toca serviços, cron ou PostgreSQL). Cobre: janela de manutenção seletiva (só cron/timers do
 * IndusCost, estado anterior preservado, recuperação), classificador de compatibilidade de schema, URL das
 * migrations, gate de testes isolado e o verificador de executores. Banco, backup/restore reais e o executor
 * completo: deploySafety.pg17.integration.test.ts e deployExecutor.pg17.e2e.test.ts.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { isolatedHostEnv } from "./deployTestIsolation";

const LIB = join(process.cwd(), "infra/deploy/induscost-deploy-safety.sh");
const HOOK_SRC = join(process.cwd(), "infra/deploy/hooks/servidor01-checks.sh");
const EXECUTOR = join(process.cwd(), "infra/deploy/induscost-deploy-executor.sh");
const CHECKER = join(process.cwd(), "scripts/ops/checkDeployExecutorSafety.sh");

function findBash(): string | null {
  if (process.platform !== "win32") return "bash";
  for (const candidate of ["C:\\Program Files\\Git\\bin\\bash.exe", "C:\\Program Files (x86)\\Git\\bin\\bash.exe"]) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}
const BASH = findBash();
const SKIP = BASH ? false : "bash não encontrado neste sistema.";
const toPosix = (p: string) =>
  process.platform === "win32" ? p.replace(/\\/g, "/").replace(/^([A-Za-z]):/, (_m, d: string) => `/${d.toLowerCase()}`) : p;

const STUBS: Record<string, string> = {
  systemctl: `#!/usr/bin/env bash
S="$STUB_SYSTEMD"; echo "systemctl $*" >> "$S/calls"
case "$1" in
  is-active) [[ "$2" == --quiet ]] && { u="$3"; q=1; } || { u="$2"; q=0; }
    st="$(cat "$S/$u" 2>/dev/null || echo inactive)"; [[ $q == 0 ]] && echo "$st"; [[ "$st" == active ]]; exit $? ;;
  stop) echo inactive > "$S/$2" ;;
  start) [[ "$2" == "\${STUB_START_FAIL:-none}" ]] && exit 1; echo active > "$S/$2" ;;
  list-units) t=""; pat=""; for a in "\${@:2}"; do case "$a" in --type=*) t="\${a#--type=}" ;; -*) ;; *) pat="$a" ;; esac; done
    for f in "$S"/*."$t"; do [[ -f "$f" ]] || continue; b="$(basename "$f")"; [[ -z "$pat" || "$b" == $pat ]] && echo "$b loaded $(cat "$f") x x"; done ;;
  show) u="\${@: -1}"; if [[ -f "$S/$u.show" ]]; then cat "$S/$u.show"; else echo "WorkingDirectory=\${STUB_UNIT_DIR:-/opt/induscost}"; fi ;;
esac
exit 0
`,
  pgrep: `#!/usr/bin/env bash
f="$STUB_SYSTEMD/pgrep-count"; n=$(( $(cat "$f" 2>/dev/null || echo 0) + 1 )); echo "$n" > "$f"
if [[ "$n" -le "\${STUB_PGREP_BUSY:-0}" ]]; then echo "4242 \${STUB_PGREP_CMD:-tsx scripts/nomusAccountsReceivableSync.ts apply}"; exit 0; fi
exit 1
`,
  psql: `#!/usr/bin/env bash
sql="\${*: -1}"; echo "psql $sql" >> "$STUB_SYSTEMD/calls"
if [[ -n "\${STUB_PSQL_AUTH_FAIL:-}" ]]; then
  echo 'psql: error: connection to server on socket "/var/run/postgresql/.s.PGSQL.5432" failed: FATAL:  Peer authentication failed for user "postgres"' >&2
  exit 2
fi
case "$sql" in
  *pg_db_role_setting*) echo 0 ;;
  *pg_stat_activity*) [[ -n "\${STUB_SESSIONS:-}" ]] && printf '%s\\n' "$STUB_SESSIONS" ;;
  *concat_ws*) : ;;
  *"count(*) FROM pg_database"*) echo 1 ;;
esac
exit 0
`,
  pg_restore: `#!/usr/bin/env bash
if [[ "$1" == "-l" ]]; then
  # Como o pg_restore real: arquivo inexistente não abre (determinístico, independente do cenário).
  [[ -f "$2" ]] || { echo "pg_restore: error: could not open input file \\"$2\\": No such file or directory" >&2; exit 1; }
  [[ "\${STUB_UNREADABLE:-0}" == 1 ]] && { echo "pg_restore: error: could not open input file: Permission denied" >&2; exit 1; }
  for i in $(seq 1 "\${STUB_TABLES:-3}"); do echo "$i; 2615 1 TABLE public t$i owner"; done
fi
exit 0
`,
};

// Terceira camada: todo outro cliente PostgreSQL que a biblioteca pudesse chamar existe no PATH dos cenários como um
// simulado que recusa e registra a tentativa — nenhum cenário simulado alcança um binário real, nem com autenticação
// válida (root, peer/trust, .pgpass).
for (const tool of ["pg_dump", "pg_dumpall", "createdb", "dropdb", "pg_ctl", "pg_isready", "vacuumdb", "reindexdb", "pg_basebackup"]) {
  STUBS[tool] = `#!/usr/bin/env bash
echo "BLOQUEADO ${tool} $*" >> "$STUB_SYSTEMD/calls"
echo "${tool}: bloqueado em teste simulado (nenhum cliente PostgreSQL real pode ser chamado)" >&2
exit 97
`;
}

const work = mkdtempSync(join(tmpdir(), "deploy-safety-test-"));
const stubs = join(work, "bin");
mkdirSync(stubs);
for (const [name, body] of Object.entries(STUBS)) {
  writeFileSync(join(stubs, name), body);
  chmodSync(join(stubs, name), 0o755);
}
after(() => rmSync(work, { recursive: true, force: true }));

let seq = 0;
/** Um "servidor": systemd/cron/estado próprios; timers induscost-* em estados variados. */
function host(units: Record<string, string> = {}, cronFiles: Record<string, string> = {}) {
  seq += 1;
  const base = join(work, `h${seq}`);
  const sysd = join(base, "systemd");
  const cron = join(base, "cron.d");
  for (const d of [sysd, cron]) mkdirSync(d, { recursive: true });
  for (const [u, st] of Object.entries(units)) writeFileSync(join(sysd, u), st);
  for (const [f, c] of Object.entries(cronFiles)) writeFileSync(join(cron, f), c);
  writeFileSync(join(sysd, "calls"), "");
  const run = (script: string, env: Record<string, string> = {}) => {
    const full = [
      // Segunda camada (a primeira é isolatedHostEnv): nada do cluster real sobrevive dentro do bash; a biblioteca
      // fala só com os simulados do PATH e, se algo escapar, com um socket inexistente deste sandbox.
      `unset $(compgen -e | grep -E '^(IDS_|PG)')`,
      `export PATH="${toPosix(stubs)}:$PATH"`,
      `export IDS_PG_BIN="" IDS_PG_HOST="${toPosix(join(base, "sem-cluster"))}" IDS_PG_PORT=1 IDS_PG_ADMIN_ROLE=ids_teste_simulado IDS_PG_MAINT_DB=postgres`,
      // libpq sem atalhos do host: nem .pgpass, nem serviço, nem espera longa.
      `export PGPASSFILE=/nonexistent/pgpass PGSERVICEFILE=/nonexistent/pg_service.conf PGSYSCONFDIR=/nonexistent PGCONNECT_TIMEOUT=1`,
      `export IDS_PG="" IDS_PG_USER="" IDS_SYSTEMCTL="${toPosix(join(stubs, "systemctl"))}"`,
      `export IDS_STATE_DIR="${toPosix(join(base, "state"))}" IDS_MAINT_FLAG="${toPosix(join(base, "flag"))}" IDS_CRON_DIR="${toPosix(cron)}"`,
      `export IDS_CRON_SCAN_FILES="${toPosix(join(base, "crontab"))}" IDS_CRON_SPOOL_DIRS="${toPosix(join(base, "spool"))}" IDS_CRON_RELOAD_WAIT=0 IDS_STATS_SETTLE_SECONDS=0 IDS_WRITER_POLL_SECONDS=0`,
      `export STUB_SYSTEMD="${toPosix(sysd)}"`,
      `source "${toPosix(LIB)}"`,
      script,
    ].join("\n");
    const r = spawnSync(BASH!, ["-c", full], { env: { ...isolatedHostEnv(), ...env }, encoding: "utf8" });
    return `${r.stdout}\n${r.stderr}`;
  };
  const calls = () => readFileSync(join(sysd, "calls"), "utf8");
  const state = (u: string) => readFileSync(join(sysd, u), "utf8").trim();
  return { base, cron, run, calls, state };
}

const TIMERS = {
  "induscost-legal-djen.timer": "active",
  "induscost-legal-domicilio.timer": "active",
  "induscost-legal-datajud.timer": "inactive",
  "induscost-legal-tribunal.timer": "failed",
  "induscost.service": "inactive",
};
const CRONS = {
  "induscost-production": "17 */2 * * * root cd /opt/induscost && npm run sync:nomus:accounts-receivable:apply\n",
  "induscost-nomus-purchase-orders": "37 * * * * root /opt/induscost/scripts/runNomusPurchaseOrdersSync.sh apply incremental\n",
  "outro-sistema": "0 3 * * * root /usr/bin/backup-geral\n",
  "certbot": "0 */12 * * * root certbot renew\n",
};

describe("biblioteca de segurança do deploy (sem banco)", { skip: SKIP }, () => {
  it("D1. nenhum dropdb, --clean, DROP DATABASE nem --no-owner/--no-acl na biblioteca e no executor", () => {
    for (const file of [LIB, EXECUTOR]) {
      const src = readFileSync(file, "utf8")
        .split("\n")
        .filter((line) => !line.trim().startsWith("#"))
        .join("\n");
      assert.doesNotMatch(src, /\bdropdb\b/, file);
      assert.doesNotMatch(src, /--clean/, file);
      assert.doesNotMatch(src, /DROP\s+DATABASE/i, file);
      assert.doesNotMatch(src, /--no-owner|--no-acl/, file);
    }
  });

  it("D2. SQL da biblioteca só com ASCII (psql do Windows/consoles não UTF-8 corrompem acentos)", () => {
    const offending = readFileSync(LIB, "utf8")
      .split("\n")
      .filter((l) => /ids_psql(_tx)? [^"]*"[^"]*[^\x00-\x7F]/.test(l));
    assert.deepEqual(offending, []);
  });

  it("D3. backup ilegível pelo postgres aborta (31); inexistente aborta (31); existente sem tabelas aborta (32); válido passa", () => {
    const h = host();
    const dump = toPosix(join(h.base, "d"));
    assert.match(h.run(`echo x > "${dump}"; ids_assert_backup_readable "${dump}"; echo RC=$?`, { STUB_UNREADABLE: "1" }), /Permission denied[\s\S]*RC=31/);
    // Arquivo que não existe é ilegível (31), como no pg_restore real — não "sem tabelas". A versão anterior deste
    // teste usava um caminho inexistente para o caso 32 e só passava porque o simulado ignorava o arquivo.
    assert.match(h.run(`ids_assert_backup_readable "${toPosix(join(h.base, "inexistente"))}"; echo RC=$?`), /could not open input file[\s\S]*RC=31/);
    assert.match(h.run(`echo x > "${dump}"; ids_assert_backup_readable "${dump}"; echo RC=$?`, { STUB_TABLES: "0" }), /backup sem tabelas[\s\S]*RC=32/);
    assert.match(h.run(`echo x > "${dump}"; ids_assert_backup_readable "${dump}"; echo RC=$?`), /backup legível[\s\S]*RC=0/);
  });

  it("M1. janela seletiva: só cron induscost* sai (com hash) e só timers ATIVOS param; encerramento devolve tudo exatamente", () => {
    const h = host(TIMERS, CRONS);
    const out = h.run(`ids_maintenance_begin teste_bi; echo RC=$?; cat "$IDS_STATE_DIR/maintenance.state"`);
    assert.match(out, /RC=0/, out);
    assert.deepEqual(readdirSync(h.cron).sort(), ["certbot", "outro-sistema"]);
    assert.match(out, /^timer induscost-legal-djen\.timer active stopped$/m);
    assert.match(out, /^timer induscost-legal-datajud\.timer inactive untouched$/m);
    assert.match(out, /^timer induscost-legal-tribunal\.timer failed untouched$/m);
    assert.match(out, /^readonly teste_bi$/m);
    assert.doesNotMatch(h.calls(), /systemctl stop cron/, "cron.service inteiro nunca é parado");
    assert.ok(existsSync(join(h.base, "flag")), "sinalizador de manutenção para os runners");
    const end = h.run(`ids_maintenance_end; echo RC=$?`);
    assert.match(end, /RC=0/, end);
    for (const [f, c] of Object.entries(CRONS)) assert.equal(readFileSync(join(h.cron, f), "utf8"), c, f);
    assert.equal(h.state("induscost-legal-djen.timer"), "active");
    assert.equal(h.state("induscost-legal-domicilio.timer"), "active");
    assert.equal(h.state("induscost-legal-datajud.timer"), "inactive", "inativo não é religado");
    assert.equal(h.state("induscost-legal-tribunal.timer"), "failed", "com falha não é religado");
    const starts = h.calls().split("\n").filter((l) => l.startsWith("systemctl start")).map((l) => l.split(" ")[2]);
    assert.deepEqual(starts, ["induscost-legal-domicilio.timer", "induscost-legal-djen.timer"], "ordem inversa da pausa");
    assert.match(h.calls(), /RESET default_transaction_read_only/);
    assert.ok(!existsSync(join(h.base, "state", "maintenance.state")));
    assert.ok(!existsSync(join(h.base, "flag")));
  });

  it("M2. agendamento do IndusCost fora de /etc/cron.d/induscost* (crontab, spool, outro arquivo): recusa (47) antes de mudar algo", () => {
    for (const [where, setup] of [
      ["crontab", (b: string) => writeFileSync(join(b, "crontab"), "# comentário /opt/induscost\n5 * * * * root /opt/induscost/scripts/runNomusProposalsHourlySync.sh apply\n")],
      ["spool", (b: string) => { mkdirSync(join(b, "spool"), { recursive: true }); writeFileSync(join(b, "spool", "root"), "*/10 * * * * cd /opt/induscost && npm run sync:nomus:nfes:apply\n"); }],
      ["cron.d", (b: string) => writeFileSync(join(b, "cron.d", "relatorios"), "0 6 * * * root /opt/induscost/scripts/goalSnapshotsDailyV1.ts\n")],
    ] as const) {
      const h = host(TIMERS, CRONS);
      setup(h.base);
      const out = h.run(`ids_maintenance_begin teste_bi; echo RC=$?`);
      assert.match(out, /RC=47/, `${where}: ${out}`);
      assert.match(out, /\/opt\/induscost/);
      assert.ok(!existsSync(join(h.base, "state", "maintenance.state")), where);
      assert.equal(readdirSync(h.cron).length, 4 + (where === "cron.d" ? 1 : 0), where);
      assert.doesNotMatch(h.calls(), /systemctl stop/, where);
    }
  });

  it("M3. rotina Nomus já iniciada: espera terminar; serviço induscost-* em execução também; prazo estourado (40) lista a rotina", () => {
    const h = host(TIMERS, CRONS);
    assert.match(h.run(`IDS_WRITER_WAIT_SECONDS=10 IDS_WRITER_POLL_SECONDS=1 ids_maintenance_begin teste_bi; echo RC=$?`, { STUB_PGREP_BUSY: "2" }), /RC=0/);
    const h2 = host({ ...TIMERS, "induscost-legal-djen.service": "activating" }, CRONS);
    const out = h2.run(`IDS_WRITER_WAIT_SECONDS=0 ids_maintenance_begin teste_bi; echo RC=$?; cat "$IDS_STATE_DIR/maintenance.state"`);
    assert.match(out, /RC=40/);
    assert.match(out, /unit induscost-legal-djen\.service activating/);
    assert.match(out, /^cron .*induscost-production/m, "o que já foi pausado fica registrado para o encerramento");
    assert.match(h2.run(`ids_maintenance_end; echo RC=$?`), /RC=0/);
    assert.equal(readdirSync(h2.cron).length, 4);
  });

  it("M4. sessão no banco depois da pausa (41) lista a sessão; retomada que falha (42) mantém o estado; recover --resume conclui", () => {
    const h = host(TIMERS, CRONS);
    const out = h.run(`ids_maintenance_begin teste_bi; echo RC=$?`, { STUB_SESSIONS: "777|bi|metabase|10.0.0.5|client backend" });
    assert.match(out, /RC=41/);
    assert.match(out, /777\|bi\|metabase/);
    const failing = h.run(`ids_maintenance_end; echo RC=$?`, { STUB_START_FAIL: "induscost-legal-djen.timer" });
    assert.match(failing, /RC=42/);
    assert.ok(existsSync(join(h.base, "state", "maintenance.state")));
    const status = h.run(`ids_maintenance_recover; echo RC=$?`);
    assert.match(status, /RC=46/);
    assert.match(status, /timer induscost-legal-djen\.timer active stopped/);
    assert.match(h.run(`ids_maintenance_recover --resume; echo RC=$?`), /RC=0/);
    assert.equal(h.state("induscost-legal-djen.timer"), "active");
    assert.ok(!existsSync(join(h.base, "state", "maintenance.state")));
  });

  it("M5. arquivo de cron recriado com outro conteúdo durante a janela: não é sobrescrito (42); original preservado", () => {
    const h = host(TIMERS, CRONS);
    assert.match(h.run(`ids_maintenance_begin teste_bi; echo RC=$?`), /RC=0/);
    writeFileSync(join(h.cron, "induscost-production"), "# editado à mão durante o deploy\n");
    const out = h.run(`ids_maintenance_end; echo RC=$?`);
    assert.match(out, /RC=42/);
    assert.equal(readFileSync(join(h.cron, "induscost-production"), "utf8"), "# editado à mão durante o deploy\n");
    assert.equal(readFileSync(join(h.base, "state", "cron-parked", "induscost-production"), "utf8"), CRONS["induscost-production"]);
  });

  it("M6. janela anterior não encerrada: nova janela recusa (46) sem tocar em nada", () => {
    const h = host(TIMERS, CRONS);
    assert.match(h.run(`ids_maintenance_begin teste_bi; echo RC=$?`), /RC=0/);
    const before = h.calls();
    assert.match(h.run(`ids_maintenance_begin teste_bi; echo RC=$?`), /RC=46/);
    assert.equal(h.calls(), before);
  });

  it("S1. UNIT_GLOB que casa unidade protegida (induscost-db-backup.timer, PostgreSQL 12) ou que não executa no APP: recusa (52) antes de tocar em qualquer coisa", () => {
    const h = host({ ...TIMERS, "induscost-db-backup.timer": "active" }, CRONS);
    writeFileSync(join(h.base, "systemd", "induscost-db-backup.timer.show"), "Unit=induscost-db-backup.service\n");
    writeFileSync(join(h.base, "systemd", "induscost-db-backup.service.show"), "ExecStart={ path=/usr/bin/pg_dump ; argv[]=/usr/bin/pg_dump -p 5432 teste_bi }\nWorkingDirectory=/var/lib/postgresql\n");
    const out = h.run(`IDS_PROTECTED_UNITS="induscost-db-backup.timer induscost-db-backup.service" ids_maintenance_begin teste_bi; echo RC=$?`);
    assert.match(out, /RC=52/, out);
    assert.match(out, /unidade protegida induscost-db-backup\.timer/);
    assert.doesNotMatch(h.calls(), /systemctl stop/);
    assert.ok(!existsSync(join(h.base, "state", "maintenance.state")));
    assert.equal(readdirSync(h.cron).length, 4);
    // Sem a lista de protegidas, a mesma unidade é recusada por não executar no caminho da aplicação.
    const out2 = h.run(`ids_maintenance_begin teste_bi; echo RC=$?`);
    assert.match(out2, /RC=52/, out2);
    assert.match(out2, /induscost-db-backup\.timer, que não executa em \/opt\/induscost/);
    assert.doesNotMatch(h.calls(), /systemctl stop/);
    assert.ok(!existsSync(join(h.base, "state", "maintenance.state")));
  });

  it("S2. CRON_GLOB que casa arquivo sem o caminho da aplicação (ex.: backup do PostgreSQL 12): recusa (52); arquivo intocado", () => {
    const h = host(TIMERS, { ...CRONS, "induscost-db-backup": "30 22 * * * postgres /usr/lib/postgresql/12/bin/pg_dump teste_bi\n" });
    const out = h.run(`ids_maintenance_begin teste_bi; echo RC=$?`);
    assert.match(out, /RC=52/, out);
    assert.match(out, /induscost-db-backup, que não executa \/opt\/induscost/);
    assert.equal(readdirSync(h.cron).length, 5);
    assert.ok(!existsSync(join(h.base, "state", "maintenance.state")));
    assert.doesNotMatch(h.calls(), /systemctl stop/);
  });

  it("S3. dois ambientes no mesmo host: /opt/induscost (legado) não casa /opt/induscost-homolog; crons do legado ficam; linha do homolog na crontab do root recusa (47) sem citar o legado", () => {
    const h = host({ "induscost-homolog.service": "active" }, { "induscost-homolog": "*/15 * * * * root cd /opt/induscost-homolog/app && npm run sync:x\n", "induscost-nomus-purchase-orders": "37 * * * * root /opt/induscost/scripts/runNomusPurchaseOrdersSync.sh apply\n" });
    mkdirSync(join(h.base, "spool"), { recursive: true });
    writeFileSync(join(h.base, "spool", "root"), "17 */2 * * * cd /opt/induscost && npm run sync:nomus:accounts-receivable:apply\n");
    const env = `IDS_APP_MARK_PATTERN=/opt/induscost-homolog IDS_CRON_GLOB='induscost-homolog*' IDS_UNIT_GLOB='induscost-homolog-*' IDS_APP_SERVICE=induscost-homolog.service`;
    const out = h.run(`${env} ids_maintenance_begin teste_bi_homolog; echo RC=$?`);
    assert.match(out, /RC=0/, out);
    assert.deepEqual(readdirSync(h.cron).sort(), ["induscost-nomus-purchase-orders"], "só o cron do homolog saiu; o do legado ficou");
    assert.match(h.run(`${env} ids_maintenance_end; echo RC=$?`), /RC=0/);
    assert.deepEqual(readdirSync(h.cron).sort(), ["induscost-homolog", "induscost-nomus-purchase-orders"]);
    writeFileSync(join(h.base, "spool", "root"), "17 */2 * * * cd /opt/induscost && npm run sync:nomus:accounts-receivable:apply\n0 * * * * /opt/induscost-homolog/app/scripts/x.sh\n");
    const out2 = h.run(`${env} ids_maintenance_begin teste_bi_homolog; echo RC=$?`);
    assert.match(out2, /RC=47/, out2);
    assert.match(out2, /induscost-homolog\/app\/scripts\/x\.sh/);
    assert.doesNotMatch(out2, /accounts-receivable/);
    assert.deepEqual(readdirSync(h.cron).sort(), ["induscost-homolog", "induscost-nomus-purchase-orders"], "nada pausado");
  });

  it("S4. rotina em execução só conta se for desta instalação: caminho na linha de comando ou cwd dentro do APP; outra instalação é ignorada; sem cwd legível espera", () => {
    const h = host();
    const run = (mark: string, cmd: string, procDir: string) =>
      h.run(`rm -f "$STUB_SYSTEMD/pgrep-count"; IDS_WRITER_WAIT_SECONDS=0 IDS_WRITER_POLL_SECONDS=0 IDS_APP_MARK_PATTERN="${mark}" IDS_PROC_DIR="${procDir}" ids_maintenance_begin teste_bi; echo RC=$?; ids_maintenance_end >/dev/null`, { STUB_PGREP_BUSY: "1", STUB_PGREP_CMD: cmd });
    // /proc simulado (readlink -f devolve o próprio caminho; no servidor devolve o cwd real do processo).
    const fakeRoot = toPosix(join(h.base, "fs"));
    const procHomolog = `${fakeRoot}/opt/induscost-homolog/app/proc`;
    const procLegacy = `${fakeRoot}/opt/induscost/proc`;
    mkdirSync(join(h.base, "fs", "opt", "induscost-homolog", "app", "proc", "4242", "cwd"), { recursive: true });
    mkdirSync(join(h.base, "fs", "opt", "induscost", "proc", "4242", "cwd"), { recursive: true });
    const legacyCmd = "/opt/induscost/scripts/runNomusPurchaseOrdersSync.sh apply";
    assert.match(run("/opt/induscost-homolog", legacyCmd, procLegacy), /RC=0/, "rotina do legado (linha de comando e cwd fora do APP): ignorada");
    assert.match(run("/opt/induscost", legacyCmd, procLegacy), /RC=40/, "linha de comando com o caminho desta instalação: espera (prazo 0 → 40)");
    assert.match(run("/opt/induscost", "cd /opt/induscost-homolog/app && npm run sync", procLegacy), /RC=0/, "/opt/induscost não casa /opt/induscost-homolog");
    const cmd = "tsx scripts/nomusAccountsReceivableSync.ts apply";
    assert.match(run(`${fakeRoot}/opt/induscost-homolog`, cmd, procHomolog), /RC=40/, "sem caminho na linha de comando, cwd dentro do APP: espera");
    assert.match(run(`${fakeRoot}/opt/induscost-homolog`, cmd, procLegacy), /RC=0/, "cwd em outra instalação: ignorada");
    assert.match(run(`${fakeRoot}/opt/induscost-homolog`, cmd, `${fakeRoot}/inexistente`), /RC=40/, "sem cwd legível: conservador, espera");
  });

  // Contratos do arquivo de ambiente REAL da homologação (globs e unidades protegidas confirmados em 29/10/2026).
  const HOMOLOG_ENV = readFileSync(join(process.cwd(), "infra/deploy/environments/homologacao.env"), "utf8");
  const envValue = (k: string) => {
    const m = new RegExp(`^${k}=('([^']*)'|(\\S*))`, "m").exec(HOMOLOG_ENV);
    assert.ok(m, `${k} ausente em homologacao.env`);
    return m[2] ?? m[3]!;
  };
  const homologEnv = () =>
    `IDS_APP_MARK_PATTERN='${envValue("APP_MARK_PATTERN")}' IDS_CRON_GLOB='${envValue("CRON_GLOB")}' IDS_UNIT_GLOB='${envValue("UNIT_GLOB")}' IDS_APP_SERVICE='${envValue("SERVICE")}' IDS_PROTECTED_UNITS='${envValue("PROTECTED_UNITS")}'`;
  // O que existe no servidor-01 além da homologação: backup do PostgreSQL 12, os dois clusters, crons do legado.
  const SERVIDOR01_UNITS = {
    "induscost-homolog.service": "active",
    "induscost-db-backup.timer": "active",
    "induscost-db-backup.service": "inactive",
    "postgresql@12-main.service": "active",
    "postgresql-17.service": "active",
    "nginx.service": "active",
  };
  const SERVIDOR01_CRONS = {
    "induscost-nomus-purchase-orders": "37 * * * * root /opt/induscost/scripts/runNomusPurchaseOrdersSync.sh apply incremental\n",
    "induscost-db-backup": "30 22 * * * postgres /usr/lib/postgresql/12/bin/pg_dump teste_bi\n",
  };

  it("S5. homologação sem agendamentos próprios: os globs reais casam 0 cron e 0 unidade; janela abre só com a trava (0), diz isso explicitamente e não toca backup, PostgreSQL nem legado", () => {
    assert.equal(envValue("CRON_GLOB"), "induscost-homolog*");
    assert.equal(envValue("UNIT_GLOB"), "induscost-homolog-*");
    const h = host(SERVIDOR01_UNITS, SERVIDOR01_CRONS);
    const out = h.run(`${homologEnv()} ids_maintenance_begin teste_bi_homolog; echo RC=$?`);
    assert.match(out, /RC=0/, out);
    assert.match(out, /nenhum agendamento desta instalação: 0 arquivo\(s\) .*induscost-homolog\* e 0 unidade\(s\) induscost-homolog-\*\.timer\/\.service — a janela só trava o banco/);
    assert.match(out, /escopo da janela conferido: .*\(0\) e unidades induscost-homolog-\* \(0\)/);
    assert.doesNotMatch(h.calls(), /systemctl (stop|start)/);
    assert.deepEqual(readdirSync(h.cron).sort(), ["induscost-db-backup", "induscost-nomus-purchase-orders"]);
    assert.match(h.run(`${homologEnv()} ids_maintenance_end; echo RC=$?`), /RC=0/);
    for (const [u, st] of Object.entries(SERVIDOR01_UNITS)) assert.equal(h.state(u), st, u);
    assert.doesNotMatch(h.calls(), /systemctl (stop|start)/);
  });

  it("S6. contrato estático e padrões protegidos: glob amplo recusa (52) o backup do PG12 mesmo sem a unidade carregada; *postgres*/*pg17* protegem unidades carregadas; padrão não expande contra o cwd; a lista real passa com os globs da homologação", () => {
    const empty = host();
    const a = empty.run(`IDS_UNIT_GLOB='induscost-*' IDS_PROTECTED_UNITS='induscost-db-backup.timer' ids_assert_isolation_scope; echo RC=$?`);
    assert.match(a, /RC=52/, a);
    assert.match(a, /casaria a unidade protegida induscost-db-backup\.timer \(mesmo sem estar carregada agora\)/);
    const b = empty.run(`IDS_UNIT_GLOB='induscost-db-*' IDS_PROTECTED_UNITS='induscost-db-backup' ids_assert_glob_contract; echo RC=$?`);
    assert.match(b, /RC=52/, "nome protegido sem sufixo também conferido");

    const pg = host({ "postgresql@12-main.service": "active", "induscost-pg17.service": "active" });
    const c = pg.run(`IDS_UNIT_GLOB='*' IDS_PROTECTED_UNITS="${envValue("PROTECTED_UNITS")}" ids_assert_isolation_scope; echo RC=$?`);
    assert.match(c, /RC=52/, c);
    assert.match(c, /casa a unidade protegida postgresql@12-main\.service/);
    assert.match(c, /casa a unidade protegida induscost-pg17\.service/);
    // Arquivos do cwd que casariam o padrão: com expansão de caminho, *postgres* viraria "xpostgresx" e nada protegeria.
    const cwd = join(pg.base, "cwd");
    mkdirSync(cwd);
    writeFileSync(join(cwd, "xpostgresx"), "");
    const d = pg.run(`cd "${toPosix(cwd)}" && IDS_UNIT_GLOB='*' IDS_PROTECTED_UNITS='*postgres*' ids_assert_isolation_scope; echo RC=$?`);
    assert.match(d, /RC=52/, d);
    assert.match(d, /casa a unidade protegida postgresql@12-main\.service/);
    assert.match(pg.run(`IDS_PROTECTED_UNITS='*postgres*' ids_is_protected_unit nginx.service; echo RC=$?`), /RC=1/);
    // Lista em várias linhas (aspas simples no arquivo de ambiente): nenhuma entrada é descartada.
    assert.match(pg.run(`IDS_PROTECTED_UNITS=$'induscost-x.timer\\n*pg17*' ids_is_protected_unit induscost-pg17.service; echo RC=$?`), /RC=0/);

    const real = host(SERVIDOR01_UNITS, SERVIDOR01_CRONS);
    const e = real.run(`${homologEnv()} ids_assert_isolation_scope; echo RC=$?`);
    assert.match(e, /RC=0/, e);
    assert.doesNotMatch(e, /ERRO/);
    assert.doesNotMatch(real.calls(), /systemctl (stop|start)/);
  });

  it("S7. homologação ganha um agendamento próprio: cron e timer induscost-homolog-* que executam no APP são pausados e devolvidos; timer do glob que executa fora do APP recusa (52) sem tocar nada", () => {
    const units = { ...SERVIDOR01_UNITS, "induscost-homolog-sync.timer": "active" };
    const crons = { ...SERVIDOR01_CRONS, "induscost-homolog-nomus": "*/5 * * * * root cd /opt/induscost-homolog/app && npm run sync:x\n" };
    const h = host(units, crons);
    writeFileSync(join(h.base, "systemd", "induscost-homolog-sync.timer.show"), "Unit=induscost-homolog-sync.service\n");
    writeFileSync(join(h.base, "systemd", "induscost-homolog-sync.service.show"), "WorkingDirectory=/opt/induscost-homolog/app\n");
    const out = h.run(`${homologEnv()} ids_maintenance_begin teste_bi_homolog; echo RC=$?`);
    assert.match(out, /RC=0/, out);
    assert.match(out, /cron pausado: .*induscost-homolog-nomus/);
    assert.match(out, /timer pausado: induscost-homolog-sync\.timer/);
    assert.doesNotMatch(h.calls(), /systemctl stop (induscost-db-backup|postgresql|nginx)/);
    assert.match(h.run(`${homologEnv()} ids_maintenance_end; echo RC=$?`), /RC=0/);
    assert.equal(h.state("induscost-homolog-sync.timer"), "active");
    assert.ok(readdirSync(h.cron).includes("induscost-homolog-nomus"));

    const bad = host(units, SERVIDOR01_CRONS);
    writeFileSync(join(bad.base, "systemd", "induscost-homolog-sync.timer.show"), "Unit=induscost-homolog-sync.service\n");
    writeFileSync(join(bad.base, "systemd", "induscost-homolog-sync.service.show"), "WorkingDirectory=/opt/induscost\n");
    const r = bad.run(`${homologEnv()} ids_maintenance_begin teste_bi_homolog; echo RC=$?`);
    assert.match(r, /RC=52/, r);
    assert.match(r, /induscost-homolog-sync\.timer, que não executa em \/opt\/induscost-homolog/);
    assert.doesNotMatch(bad.calls(), /systemctl stop/);
    assert.ok(!existsSync(join(bad.base, "state", "maintenance.state")));
  });

  const classify = (before: string[], now: string[]) => {
    const h = host();
    writeFileSync(join(h.base, "before.txt"), `${before.join("\n")}\n`);
    writeFileSync(join(h.base, "now.txt"), `${now.join("\n")}\n`);
    return h.run(`ids_compat_classify "${toPosix(join(h.base, "before.txt"))}" "${toPosix(join(h.base, "now.txt"))}"`).trim().split("\n").filter(Boolean);
  };
  const BASE = [
    "table|public.Item|owner=app|acl=",
    "column|public.Item|id|integer|notnull=t|default=nextval('\"Item_id_seq\"'::regclass)|identity=|generated=",
    "column|public.Item|name|text|notnull=t|default=|identity=|generated=",
    "enum|public.Status|A,B",
    "migration|20261001120000_init|finished=t|rolledback=f",
  ];

  it("C1. compatível: tabela nova (colunas/índices/constraints dela), coluna opcional, com padrão ou identidade, índice comum, migration aplicada", () => {
    const out = classify(BASE, [
      ...BASE,
      "table|public.Tag|owner=app|acl=",
      "column|public.Tag|id|integer|notnull=t|default=|identity=a|generated=",
      "constraint|public.Tag|Tag_pkey|p|PRIMARY KEY (id)",
      "index|public.Tag|Tag_pkey|unique=t|CREATE UNIQUE INDEX ...",
      "column|public.Item|color|text|notnull=f|default=|identity=|generated=",
      "column|public.Item|qty|integer|notnull=t|default=0|identity=|generated=",
      "column|public.Item|code|bigint|notnull=t|default=|identity=d|generated=",
      "index|public.Item|Item_name_idx|unique=f|CREATE INDEX ...",
      "migration|20261101120000_add|finished=t|rolledback=f",
    ]);
    assert.ok(out.every((l) => l.startsWith("OK|")), out.join("\n"));
  });

  it("C2. incompatível: remoção/alteração, coluna obrigatória sem padrão, índice único, constraint ou trigger em tabela existente", () => {
    const out = classify(BASE, [
      "table|public.Item|owner=app|acl=",
      "column|public.Item|id|integer|notnull=t|default=nextval('\"Item_id_seq\"'::regclass)|identity=|generated=",
      "column|public.Item|name|varchar(10)|notnull=t|default=|identity=|generated=",
      "column|public.Item|sku|text|notnull=t|default=|identity=|generated=",
      "index|public.Item|Item_sku_key|unique=t|CREATE UNIQUE INDEX ...",
      "constraint|public.Item|qty_chk|c|CHECK (true)",
      "trigger|public.Item|t1|CREATE TRIGGER ...",
      "enum|public.Status|A,B",
      "migration|20261001120000_init|finished=t|rolledback=f",
    ]);
    const bad = out.filter((l) => l.startsWith("INCOMPATIVEL|")).join("\n");
    for (const why of ["removido ou alterado: column|public.Item|name|text", "coluna nova obrigatória sem valor padrão: public.Item.sku", "índice único em tabela existente: Item_sku_key", "constraint em tabela existente: public.Item.qty_chk", "trigger em tabela existente: public.Item.t1"]) {
      assert.ok(bad.includes(why), `${why}\n${bad}`);
    }
  });

  it("C3. FK de tabela nova: restritiva → conferir se vazia; CASCADE/SET NULL → compatível", () => {
    const out = classify(BASE, [
      ...BASE,
      "table|public.Tag|owner=app|acl=",
      "constraint|public.Tag|Tag_item_fkey|f|FOREIGN KEY (item_id) REFERENCES \"Item\"(id) ON UPDATE CASCADE ON DELETE RESTRICT",
      "constraint|public.Tag|Tag_x_fkey|f|FOREIGN KEY (x) REFERENCES \"Item\"(id) ON DELETE CASCADE",
    ]);
    assert.ok(out.includes("CHECK-EMPTY|public.Tag|Tag_item_fkey"), out.join("\n"));
    assert.ok(out.includes("OK|constraint de tabela nova: public.Tag.Tag_x_fkey"), out.join("\n"));
  });

  it("C4. enum: rótulos novos (fim ou meio) → conferir uso; rótulo removido ou reordenado → incompatível", () => {
    const withEnum = (labels: string) => BASE.map((l) => (l.startsWith("enum|") ? `enum|public.Status|${labels}` : l));
    assert.ok(classify(BASE, withEnum("A,B,C")).includes("CHECK-ENUM|public.Status|C"));
    assert.ok(classify(BASE, withEnum("A,X,B")).includes("CHECK-ENUM|public.Status|X"));
    assert.ok(classify(BASE, withEnum("A")).some((l) => l.startsWith("INCOMPATIVEL|enum com rótulo removido")));
    assert.ok(classify(BASE, withEnum("B,A")).some((l) => l.startsWith("INCOMPATIVEL|enum com rótulo removido ou reordenado")));
  });

  it("C5. migration com falha registrada é sinalizada (FAILED)", () => {
    assert.ok(classify(BASE, [...BASE, "migration|20261101120000_x|finished=f|rolledback=f"]).includes("FAILED|20261101120000_x"));
  });

  it("U1. URL das migrations: exceção da trava + identificação; recusa URL que já define options/application_name", () => {
    const h = host();
    assert.match(h.run(`ids_migrate_database_url 'postgresql://u:p@h/db?schema=public'`), /^postgresql:\/\/u:p@h\/db\?schema=public&options=-c%20default_transaction_read_only%3Doff&application_name=ids-deploy-migrate$/m);
    assert.match(h.run(`ids_migrate_database_url 'postgresql://u:p@h/db'`), /^postgresql:\/\/u:p@h\/db\?options=-c%20default_transaction_read_only%3Doff&application_name=ids-deploy-migrate$/m);
    assert.match(h.run(`ids_migrate_database_url 'postgresql://u:p@h/db?options=x'; echo RC=$?`), /RC=1/);
  });

  it("G1. gate de testes sem .env, banco inalcançável, credenciais vazias e locks temporários", () => {
    const h = host();
    const out = h.run(`IDS_TEST_RUNNER=env IDS_TEST_RUNNER_ARGS="" ids_run_test_gate; echo RC=$?`, { DATABASE_URL: "postgresql://prod:segredo@db.producao/teste_bi", NOMUS_TOKEN: "TOKEN-REAL" });
    assert.match(out, /RC=0/);
    assert.match(out, /^DATABASE_URL=postgresql:\/\/offline:offline@127\.0\.0\.1:1\/induscost_test_gate_offline$/m);
    assert.match(out, /^NOMUS_TOKEN=$/m);
    assert.match(out, /^DOTENV_CONFIG_PATH=.*\.env\.inexistente$/m);
    assert.match(out, /^NOMUS_ACCOUNTS_RECEIVABLE_CANONICAL_LOCK_FILE=.*induscost-test-gate-locks\..*ar\.canonical\.lock$/m);
    assert.doesNotMatch(out, /segredo|TOKEN-REAL/);
  });

  it("G2. toda chave do .env do servidor chega vazia aos testes; gate devolve o código dos testes", () => {
    const h = host();
    const envFile = join(h.base, "server.env");
    writeFileSync(envFile, "DATABASE_URL=postgresql://prod:x@db/teste_bi\nexport SMTP_PASSWORD=senha-real\nDATAJUD_API_KEY = chave\n# COMENTARIO=1\n");
    const out = h.run(`IDS_ENV_FILE="${toPosix(envFile)}" IDS_TEST_RUNNER=env IDS_TEST_RUNNER_ARGS="" ids_run_test_gate; echo RC=$?`, { SMTP_PASSWORD: "senha-real" });
    assert.match(out, /^SMTP_PASSWORD=$/m);
    assert.match(out, /^DATAJUD_API_KEY=$/m);
    assert.doesNotMatch(out, /senha-real|prod:x/);
    assert.doesNotMatch(out, /^COMENTARIO=/m);
    assert.match(h.run(`IDS_TEST_RUNNER=false IDS_TEST_RUNNER_ARGS="" ids_run_test_gate; echo RC=$?`), /RC=1/);
  });

  // --- Incidente de 29/10/2026: o gate de produção rodou os testes com a configuração do cluster REAL exportada pelo
  // executor; a biblioteca carregada pelos testes chamou o psql/pg_restore do servidor (peer auth como postgres,
  // RC=48 no lugar dos códigos esperados). Exatamente o que o executor exporta antes do gate, por ambiente:
  const EXECUTOR_EXPORTS = {
    producao: `export IDS_PG="runuser -u postgres --" IDS_PG_USER=postgres IDS_PG_BIN=/usr/lib/postgresql/17/bin IDS_PG_HOST=/var/run/postgresql IDS_PG_PORT=5432 IDS_PG_ADMIN_ROLE=postgres IDS_PG_EXPECT_MAJOR=17 IDS_PG_MAINT_DB=postgres IDS_PROTECTED_DATABASES="" IDS_PROTECTED_UNITS="" IDS_APP_SERVICE=induscost.service IDS_APP_MARK_PATTERN=/opt/induscost IDS_CRON_GLOB='induscost*' IDS_UNIT_GLOB='induscost-*' IDS_STATE_DIR=/var/lib/induscost/deploy-safety/producao IDS_MAINT_FLAG=/run/induscost/deploy-maintenance-producao IDS_EXECUTOR_NAME=deploy-induscost-producao IDS_LOCK_FD=9 PGHOST=/var/run/postgresql PGUSER=postgres PGPORT=5432 PGDATABASE=teste_bi PGPASSWORD=segredo-do-cluster`,
    homologacao: `export IDS_PG="runuser -u pg17homolog --" IDS_PG_USER=pg17homolog IDS_PG_BIN=/opt/postgresql-17/bin IDS_PG_HOST=/run/induscost-pg17 IDS_PG_PORT=5433 IDS_PG_ADMIN_ROLE=pg17homolog IDS_PG_EXPECT_MAJOR=17 IDS_PG_MAINT_DB=postgres IDS_PROTECTED_DATABASES='teste_bi_homolog_prev teste_bi_cloud_standby teste_bi' IDS_PROTECTED_UNITS='induscost-db-backup.timer *postgres*' IDS_APP_SERVICE=induscost-homolog.service IDS_APP_MARK_PATTERN=/opt/induscost-homolog IDS_CRON_GLOB='induscost-homolog*' IDS_UNIT_GLOB='induscost-homolog-*' IDS_STATE_DIR=/var/lib/induscost/deploy-safety/homologacao IDS_EXECUTOR_NAME=deploy-induscost-homologacao PGHOST=/run/induscost-pg17 PGPORT=5433 PGUSER=pg17homolog`,
  };

  it("G3. gate nunca repassa IDS_*/PG* do deploy em curso (produção e homologação, usuário do SO ≠ papel do banco): os testes recebem o mesmo ambiente nos dois servidores; o código dos testes é propagado", () => {
    const envs: Record<string, string> = {};
    for (const [name, exports] of Object.entries(EXECUTOR_EXPORTS)) {
      const h = host();
      const out = h.run(`${exports}\nexport VARIAVEL_COMUM=preservada\nIDS_TEST_RUNNER=env IDS_TEST_RUNNER_ARGS="" ids_run_test_gate; echo RC=$?`);
      assert.match(out, /RC=0/, `${name}\n${out}`);
      const leaked = out.split("\n").filter((l) => /^(IDS_|PG)[A-Z0-9_]*=/.test(l));
      assert.deepEqual(leaked, [], `${name}: configuração do cluster chegou aos testes`);
      assert.doesNotMatch(out, /segredo-do-cluster|runuser -u|\/var\/run\/postgresql|\/run\/induscost-pg17/);
      assert.match(out, /^VARIAVEL_COMUM=preservada$/m, "o resto do ambiente continua chegando");
      envs[name] = out.split("\n").filter((l) => /^(DATABASE_URL|DIRECT_URL|INDUSCOST_TEST_GATE|NOMUS_TOKEN)=/.test(l)).sort().join("\n");
      assert.match(h.run(`${exports}\nIDS_TEST_RUNNER=bash IDS_TEST_RUNNER_ARGS="-c" ids_run_test_gate 'exit 7'; echo RC=$?`), /RC=7/, `${name}: código dos testes propagado`);
    }
    assert.equal(envs.producao, envs.homologacao, "homologação e produção entregam o mesmo ambiente isolado aos testes");
  });

  // Cliente PostgreSQL "oficial" do servidor, em dois modos: recusando a autenticação (o que salvou a produção em
  // 29/10) e ACEITANDO (root com peer/trust/.pgpass válidos): registra e "executa" todo SQL recebido.
  for (const mode of ["recusa", "aceita"] as const) {
    it(`G4-${mode}. configuração da produção no ambiente do processo de teste e cliente oficial que ${mode === "recusa" ? "recusa" : "ACEITA"} a autenticação (também primeiro no PATH): D3, janela M e homologação S produzem os códigos esperados e nenhum SQL chega ao cliente oficial`, () => {
      const official = join(work, `oficial-${mode}-${seq}`);
      mkdirSync(official, { recursive: true });
      const marker = join(official, "sql-recebido");
      for (const tool of ["psql", "pg_restore", "pg_dump", "pg_dumpall", "createdb", "dropdb"]) {
        writeFileSync(
          join(official, tool),
          mode === "recusa"
            ? `#!/usr/bin/env bash\necho "${tool} $*" >> "${toPosix(marker)}"\necho 'psql: error: connection to server on socket "/var/run/postgresql/.s.PGSQL.5432" failed: FATAL:  Peer authentication failed for user "postgres"' >&2\nexit 2\n`
            : `#!/usr/bin/env bash\necho "${tool} $*" >> "${toPosix(marker)}"\necho 0\nexit 0\n`
        );
        chmodSync(join(official, tool), 0o755);
      }
      const saved = { ...process.env };
      Object.assign(process.env, {
        PATH: `${official}${process.platform === "win32" ? ";" : ":"}${process.env.PATH ?? ""}`,
        IDS_PG: "",
        IDS_PG_USER: "",
        IDS_PG_BIN: toPosix(official),
        IDS_PG_HOST: "/var/run/postgresql",
        IDS_PG_PORT: "5432",
        IDS_PG_ADMIN_ROLE: "postgres",
        IDS_PG_MAINT_DB: "postgres",
        IDS_APP_MARK_PATTERN: "/opt/induscost",
        IDS_CRON_GLOB: "induscost*",
        PGHOST: "/var/run/postgresql",
        PGUSER: "postgres",
        PGDATABASE: "teste_bi",
      });
      try {
        const dump = (h: ReturnType<typeof host>) => toPosix(join(h.base, "d"));
        // D3
        const d = host();
        assert.match(d.run(`echo x > "${dump(d)}"; ids_assert_backup_readable "${dump(d)}"; echo RC=$?`, { STUB_TABLES: "0" }), /RC=32/);
        assert.match(d.run(`ids_assert_backup_readable "${toPosix(join(d.base, "inexistente"))}"; echo RC=$?`), /RC=31/);
        // M1/M4 (janela, trava, sessão estranha 41)
        const m = host(TIMERS, CRONS);
        const out = m.run(`ids_maintenance_begin teste_bi; echo RC=$?`);
        assert.match(out, /trava de escrita ligada em teste_bi[\s\S]*RC=0/, out);
        assert.match(m.run(`ids_maintenance_end; echo RC=$?`), /RC=0/);
        const m4 = host(TIMERS, CRONS);
        assert.match(m4.run(`ids_maintenance_begin teste_bi; echo RC=$?`, { STUB_SESSIONS: "4242|bi|metabase" }), /RC=41/);
        // S3/S5 (homologação no mesmo host)
        const s = host({ "induscost-homolog.service": "active" }, { "induscost-homolog": "*/15 * * * * root cd /opt/induscost-homolog/app && npm run sync:x\n" });
        const env = `IDS_APP_MARK_PATTERN=/opt/induscost-homolog IDS_CRON_GLOB='induscost-homolog*' IDS_UNIT_GLOB='induscost-homolog-*' IDS_APP_SERVICE=induscost-homolog.service`;
        assert.match(s.run(`${env} ids_maintenance_begin teste_bi_homolog; echo RC=$?`), /RC=0/);
        assert.match(s.run(`${env} ids_maintenance_end; echo RC=$?`), /RC=0/);
        // Nenhum SQL, dump, restore ou createdb/dropdb chegou ao cliente oficial; os simulados atenderam tudo.
        assert.ok(!existsSync(marker), `cliente oficial recebeu: ${existsSync(marker) ? readFileSync(marker, "utf8") : ""}`);
        assert.match(m.calls(), /psql .*ALTER DATABASE "teste_bi" SET default_transaction_read_only = on/, "o SQL foi para o psql simulado do cenário");
        for (const h of [d, m, m4, s]) assert.doesNotMatch(h.calls(), /BLOQUEADO/, "nenhum cliente sem simulado foi tentado");
      } finally {
        for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
        Object.assign(process.env, saved);
      }
      assert.equal(process.env.IDS_PG_BIN, saved.IDS_PG_BIN, "ambiente do processo restaurado (independe da ordem dos testes)");
    });
  }

  it("G6. biblioteca nos cenários simulados: PATH resolve todo cliente PostgreSQL para um simulado; IDS_PG_BIN vazio; host/porta do sandbox; nenhuma variável PG* do host", () => {
    const saved = { ...process.env };
    Object.assign(process.env, { IDS_PG_BIN: "/usr/lib/postgresql/17/bin", IDS_PG_HOST: "/var/run/postgresql", PGHOST: "/var/run/postgresql", PGUSER: "postgres", PGPASSWORD: "x" });
    try {
      const h = host();
      const out = h.run(
        `for t in psql pg_restore pg_dump pg_dumpall createdb dropdb; do printf '%s=%s\\n' "$t" "$(command -v "$t")"; done; echo "BIN=[$IDS_PG_BIN] HOST=$IDS_PG_HOST PORT=$IDS_PG_PORT ROLE=$IDS_PG_ADMIN_ROLE"; echo "conninfo=$(ids_conninfo teste_bi)"; env | grep -E '^PG(HOST|USER|PASSWORD|PORT|DATABASE)=' || echo SEM_PG_DO_HOST`
      );
      for (const tool of ["psql", "pg_restore", "pg_dump", "pg_dumpall", "createdb", "dropdb"]) {
        assert.match(out, new RegExp(`^${tool}=${toPosix(join(work, "bin")).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/${tool}$`, "m"), `${tool} não resolve para o simulado\n${out}`);
      }
      assert.match(out, /BIN=\[\] HOST=\S+sem-cluster PORT=1 ROLE=ids_teste_simulado/);
      assert.match(out, /conninfo=dbname='teste_bi' .*host='\S+sem-cluster' port=1 user='ids_teste_simulado'/);
      assert.match(out, /SEM_PG_DO_HOST/);
    } finally {
      for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
      Object.assign(process.env, saved);
    }
  });

  it("G5. autenticação recusada pelo cluster durante a janela: código 50 (sem conexão administrativa), não 48 (trava de terceiros); a janela é desfeita sem perder agendamentos", () => {
    const h = host(TIMERS, CRONS);
    const out = h.run(`ids_maintenance_begin teste_bi; echo RC=$?`, { STUB_PSQL_AUTH_FAIL: "1" });
    assert.match(out, /Peer authentication failed/);
    assert.match(out, /sem conexão administrativa ao cluster para conferir a trava de escrita em teste_bi/);
    assert.match(out, /RC=50/);
    assert.doesNotMatch(out, /RC=48/);
    assert.doesNotMatch(h.calls(), /ALTER DATABASE/, "nenhuma alteração tentada sem a conferência");
    assert.match(h.run(`ids_maintenance_end; echo RC=$?`), /RC=0/);
    assert.deepEqual(readdirSync(h.cron).sort(), Object.keys(CRONS).sort(), "crons devolvidos");
    assert.equal(h.state("induscost-legal-djen.timer"), "active", "timer religado");
  });

  const check = (file: string) => {
    const r = spawnSync(BASH!, [toPosix(CHECKER), toPosix(file)], { encoding: "utf8" });
    return { code: r.status, out: r.stdout };
  };
  const OLD_EXECUTOR = `#!/usr/bin/env bash
install -d -m 0700 "$BACKUP_DIR"
runuser -u postgres -- pg_dump -Fc --no-owner --no-acl -d "$DB" -f "$TMP_DUMP"
rollback() {
  runuser -u postgres -- dropdb --if-exists "$DB"
  runuser -u postgres -- createdb -O "$DB_OWNER" "$DB"
  runuser -u postgres -- pg_restore --no-owner --no-acl --role="$DB_OWNER" --dbname="$DB" "$DB_BACKUP"
}
npx tsx --test "\${FILES[@]}"
./node_modules/.bin/prisma migrate deploy
systemctl start "$SERVICE"
`;

  it("K1. verificador reprova o executor do incidente e aprova o executor versionado do repositório", () => {
    const old = join(work, "old-executor.sh");
    writeFileSync(old, OLD_EXECUTOR);
    const r = check(old);
    assert.equal(r.code, 1);
    for (const missing of ["nenhum dropdb", "nenhum --no-owner/--no-acl", "carrega a biblioteca", "G1/G2: janela de manutenção", "G3: ids_mark_db_changes_started", "G4: rollback"]) {
      assert.ok(r.out.includes(`FALTA ${missing}`), `${missing}\n${r.out}`);
    }
    const ok = check(EXECUTOR);
    assert.equal(ok.code, 0, ok.out);
    assert.match(ok.out, /RESULTADO: executor protegido\./);
  });

  it("K2. verificador segue o wrapper instalado: MANIFEST íntegro aprova; arquivo adulterado reprova", () => {
    const release = join(work, "release");
    mkdirSync(release);
    for (const f of ["induscost-deploy-safety.sh", "induscost-deploy-executor.sh"]) writeFileSync(join(release, f), readFileSync(join(process.cwd(), "infra/deploy", f)));
    spawnSync(BASH!, ["-c", `cd "${toPosix(release)}" && sha256sum induscost-deploy-safety.sh induscost-deploy-executor.sh > MANIFEST.sha256`]);
    const wrapper = join(work, "deploy-induscost-producao");
    writeFileSync(wrapper, `#!/usr/bin/env bash\nexec "${toPosix(join(release, "induscost-deploy-executor.sh"))}" --env-file "/etc/induscost/deploy-executor-producao.env" "$@"\n`);
    const ok = check(wrapper);
    assert.equal(ok.code, 0, ok.out);
    assert.match(ok.out, /OK    instalação íntegra/);
    writeFileSync(join(release, "induscost-deploy-safety.sh"), readFileSync(join(release, "induscost-deploy-safety.sh"), "utf8") + "\n# alterado\n");
    const bad = check(wrapper);
    assert.equal(bad.code, 1);
    assert.match(bad.out, /FALTA instalação íntegra/);
    assert.match(bad.out, /FALTA biblioteca ao lado do executor idêntica/);
  });

  // Checkout no Windows com core.autocrlf entrega CRLF; as mutações são escritas em LF. Cada mutação precisa casar
  // EXATAMENTE uma vez — senão o executor "mutado" seria o original e o teste não provaria nada.
  const toLf = (s: string) => s.replace(/\r\n/g, "\n");
  const toCrlf = (s: string) => toLf(s).replace(/\n/g, "\r\n");
  function mutateOnce(src: string, from: string | RegExp, to: string): string {
    const hits = typeof from === "string" ? src.split(from).length - 1 : (src.match(new RegExp(from.source, `${from.flags.replace("g", "")}g`)) ?? []).length;
    assert.equal(hits, 1, `mutação deveria casar uma única vez: ${String(from)}`);
    return src.replace(from, () => to);
  }
  const lateWindow = (src: string) =>
    mutateOnce(mutateOnce(src, 'ids_maintenance_begin "$DB" || {', "true || {"), 'ids_backup_db "$DB" "$DB_BACKUP" 9>&- || {', 'ids_backup_db "$DB" "$DB_BACKUP" 9>&- || {\n  ids_maintenance_begin "$DB"');
  const noCheckpoint = (src: string) => mutateOnce(src, '  ids_open_for_app "$BACKUP_DIR" "$DB"\n', "");

  it("K3. verificador reprova executor que faz backup antes da janela ou sobe a aplicação antes do ponto de controle", () => {
    const src = toLf(readFileSync(EXECUTOR, "utf8"));
    const f1 = join(work, "exec-late-window.sh");
    writeFileSync(f1, lateWindow(src));
    assert.match(check(f1).out, /FALTA G1\/G2: janela de manutenção/);
    const f2 = join(work, "exec-no-checkpoint.sh");
    writeFileSync(f2, noCheckpoint(src));
    assert.match(check(f2).out, /FALTA G3: ids_open_for_app/);
  });

  it("K4. o verificador dá o mesmo resultado com LF e com CRLF (aprova o executor; reprova as mutações)", () => {
    const src = toLf(readFileSync(EXECUTOR, "utf8"));
    for (const [eol, conv] of [["LF", toLf], ["CRLF", toCrlf]] as const) {
      // O verificador também confere a biblioteca AO LADO do executor (cópia idêntica à do repositório).
      const dir = join(work, `k4-${eol}`);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "induscost-deploy-safety.sh"), readFileSync(LIB));
      const ok = join(dir, `exec-${eol}.sh`);
      writeFileSync(ok, conv(src));
      const approved = check(ok);
      assert.equal(approved.code, 0, `${eol}: ${approved.out}`);
      const late = join(dir, `exec-late-${eol}.sh`);
      writeFileSync(late, conv(lateWindow(src)));
      assert.match(check(late).out, /FALTA G1\/G2: janela de manutenção/, eol);
      const noCp = join(dir, `exec-nocp-${eol}.sh`);
      writeFileSync(noCp, conv(noCheckpoint(src)));
      assert.match(check(noCp).out, /FALTA G3: ids_open_for_app/, eol);
    }
  });

  /** Cópia isolada de infra/deploy (instalador + biblioteca + executor) com um ambiente de ensaio completo. */
  function installerSandbox(crlfLib: boolean, opts: { hooks?: boolean; envExtra?: string[] } = {}) {
    seq += 1;
    const base = join(work, `inst-${seq}`);
    const deploy = join(base, "deploy");
    mkdirSync(deploy, { recursive: true });
    const files = ["install-induscost-deploy.sh", "induscost-deploy-safety.sh", "induscost-deploy-executor.sh", ...(opts.hooks ? ["hooks/servidor01-checks.sh"] : [])];
    if (opts.hooks) mkdirSync(join(deploy, "hooks"));
    for (const f of files) {
      const content = toLf(readFileSync(join(process.cwd(), "infra/deploy", f), "utf8"));
      writeFileSync(join(deploy, f), crlfLib && f === "induscost-deploy-safety.sh" ? toCrlf(content) : content);
    }
    const exec = join(base, "bin", "deploy-induscost-ensaio");
    mkdirSync(join(base, "bin"));
    writeFileSync(exec, "#!/usr/bin/env bash\necho executor antigo\n");
    const envFile = join(base, "ensaio.env");
    writeFileSync(
      envFile,
      [
        "IDS_ENV_NAME=ensaio",
        `EXECUTOR_PATH=${toPosix(exec)}`,
        "APP=/opt/induscost",
        "SERVICE=induscost.service",
        "DB=teste_bi",
        "HEALTH=http://127.0.0.1:3000/api/health",
        "BACKUP_ROOT=/var/backups/x",
        `LOCK=${toPosix(join(base, "deploy.lock"))}`,
        "GIT_REMOTE=origin",
        "DEFAULT_TARGET=origin/main",
        "EXPECTED_MODE=none",
        "PRECUTOVER_EXPECTED=none",
        "START_SERVICE_POLICY=if-was-active",
        "APP_MARK_PATTERN=/opt/induscost",
        "CRON_GLOB='induscost*'",
        "UNIT_GLOB='induscost-*'",
        `IDS_STATE_DIR=${toPosix(join(base, "state"))}`,
        ...(opts.envExtra ?? []),
        "",
      ].join("\n")
    );
    const run = (args: string) => {
      const r = spawnSync(BASH!, [toPosix(join(deploy, "install-induscost-deploy.sh")), "--env", "ensaio", ...args.split(" ")], {
        encoding: "utf8",
        env: {
          ...isolatedHostEnv(),
          IDS_INSTALL_ROOT: toPosix(join(base, "lib")),
          IDS_INSTALL_ETC: toPosix(join(base, "etc")),
          IDS_INSTALL_ALLOW_NONROOT: "1",
          IDS_INSTALL_ENV_SOURCE: toPosix(envFile),
        },
      });
      return { code: r.status, out: `${r.stdout}\n${r.stderr}` };
    };
    return { base, exec, run };
  }

  it("I3. instalador recusa biblioteca/executor com CRLF (cópia vinda do Windows) e nada é instalado", () => {
    const s = installerSandbox(true);
    for (const mode of ["--dry-run", "--apply"]) {
      const r = s.run(mode);
      assert.equal(r.code, 3, r.out);
      assert.match(r.out, /RECUSADO: arquivo\(s\) com fim de linha CRLF/);
      assert.match(r.out, /induscost-deploy-safety\.sh/);
    }
    assert.equal(readFileSync(s.exec, "utf8"), "#!/usr/bin/env bash\necho executor antigo\n", "executor anterior intocado");
    assert.ok(!existsSync(join(s.base, "lib", "releases")));
  });

  it("I4. com LF o instalador instala e o --verify confere fim de linha; arquivo instalado convertido a CRLF reprova", () => {
    const s = installerSandbox(false);
    const r = s.run("--apply");
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /OK {4}fim de linha LF/);
    const release = readFileSync(join(s.base, "lib", "ensaio.current"), "utf8").trim().replace(/^\/([a-z])\//, (_m, d: string) => `${d.toUpperCase()}:/`);
    const lib = join(release, "induscost-deploy-safety.sh");
    chmodSync(lib, 0o644);
    writeFileSync(lib, toCrlf(readFileSync(lib, "utf8")));
    const v = s.run("--verify");
    assert.equal(v.code, 1, v.out);
    assert.match(v.out, /FALHA .*induscost-deploy-safety\.sh com fim de linha CRLF/);
  });

  it("I5. hooks versionados: instalados na release (0555) e no MANIFEST; @release/ inexistente recusa (3) sem instalar; hook adulterado reprova o --verify (MANIFEST)", () => {
    const missing = installerSandbox(false, { hooks: true, envExtra: ["HOOKS_PRE_DEPLOY=@release/hooks/inexistente.sh"] });
    for (const mode of ["--dry-run", "--apply"]) {
      const r = missing.run(mode);
      assert.equal(r.code, 3, r.out);
      assert.match(r.out, /RECUSADO: HOOKS_PRE_DEPLOY referencia @release\/hooks\/inexistente\.sh, que não é um arquivo desta release/);
    }
    assert.ok(!existsSync(join(missing.base, "lib", "releases")));
    assert.equal(readFileSync(missing.exec, "utf8"), "#!/usr/bin/env bash\necho executor antigo\n");

    const s = installerSandbox(false, { hooks: true, envExtra: ["HOOKS_PRE_DEPLOY=@release/hooks/servidor01-checks.sh", "HOOKS_POST_START=none", "HOOKS_POST_ROLLBACK=@release/hooks/servidor01-checks.sh"] });
    const r = s.run("--apply");
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /OK {4}HOOKS_PRE_DEPLOY: @release\/hooks\/servidor01-checks\.sh faz parte da release/);
    assert.match(r.out, /OK {4}sintaxe \(.*hooks\/servidor01-checks\.sh/);
    const release = readFileSync(join(s.base, "lib", "ensaio.current"), "utf8").trim().replace(/^\/([a-z])\//, (_m, d: string) => `${d.toUpperCase()}:/`);
    const manifest = readFileSync(join(release, "MANIFEST.sha256"), "utf8");
    assert.match(manifest, /\s\*?hooks\/servidor01-checks\.sh$/m);
    const hook = join(release, "hooks", "servidor01-checks.sh");
    assert.equal(readFileSync(hook, "utf8"), toLf(readFileSync(HOOK_SRC, "utf8")));
    if (process.platform !== "win32") assert.equal(statSync(hook).mode & 0o777, 0o555);
    const ok = s.run("--verify");
    assert.equal(ok.code, 0, ok.out);
    assert.match(ok.out, /OK {4}HOOKS_PRE_DEPLOY: @release\/hooks\/servidor01-checks\.sh está na release/);
    // Checkout com outro conjunto de hooks (ex.: um hook novo ainda não instalado): só AVISO, a instalação segue íntegra.
    const extra = join(s.base, "deploy", "hooks", "outro-hook.sh");
    writeFileSync(extra, "#!/usr/bin/env bash\nexit 0\n");
    const other = s.run("--verify");
    assert.equal(other.code, 0, other.out);
    assert.match(other.out, /AVISO hooks\/outro-hook\.sh do repositório não está na release instalada/);
    rmSync(extra);
    // Ambiente instalado que referencia hook fora da release: o --verify reprova (o executor recusaria rodar).
    const etcEnv = join(s.base, "etc", "deploy-executor-ensaio.env");
    const envText = readFileSync(etcEnv, "utf8");
    chmodSync(etcEnv, 0o600);
    writeFileSync(etcEnv, `${envText}HOOKS_POST_START=@release/hooks/outro-hook.sh\n`);
    const bad = s.run("--verify");
    assert.equal(bad.code, 1, bad.out);
    assert.match(bad.out, /FALHA HOOKS_POST_START: @release\/hooks\/outro-hook\.sh não está na release instalada/);
    writeFileSync(etcEnv, envText);
    if (process.platform === "linux") {
      // Release reutilizada com permissão alterada: o --apply devolve 0555 (o executor recusaria hook gravável).
      chmodSync(hook, 0o775);
      assert.equal(s.run("--verify").code, 1);
      const again = s.run("--apply");
      assert.equal(again.code, 0, again.out);
      assert.match(again.out, /já instalada e íntegra: reutilizada/);
      assert.equal(statSync(hook).mode & 0o777, 0o555);
    }
    chmodSync(hook, 0o755);
    writeFileSync(hook, `${readFileSync(hook, "utf8")}\n/usr/local/bin/update-induscost-homolog-egress\n`);
    const v = s.run("--verify");
    assert.equal(v.code, 1, v.out);
    assert.match(v.out, /FALHA MANIFEST/);
  });
});
