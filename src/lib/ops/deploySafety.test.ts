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
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

const LIB = join(process.cwd(), "infra/deploy/induscost-deploy-safety.sh");
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
  list-units) t=""; for a in "$@"; do [[ "$a" == --type=* ]] && t="\${a#--type=}"; done
    for f in "$S"/induscost-*."$t"; do [[ -f "$f" ]] && echo "$(basename "$f") loaded $(cat "$f") x x"; done ;;
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
  [[ "\${STUB_UNREADABLE:-0}" == 1 ]] && { echo "pg_restore: error: could not open input file: Permission denied" >&2; exit 1; }
  for i in $(seq 1 "\${STUB_TABLES:-3}"); do echo "$i; 2615 1 TABLE public t$i owner"; done
fi
exit 0
`,
};

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
      `export PATH="${toPosix(stubs)}:$PATH"`,
      `export IDS_PG="" IDS_PG_USER="" IDS_SYSTEMCTL="${toPosix(join(stubs, "systemctl"))}"`,
      `export IDS_STATE_DIR="${toPosix(join(base, "state"))}" IDS_MAINT_FLAG="${toPosix(join(base, "flag"))}" IDS_CRON_DIR="${toPosix(cron)}"`,
      `export IDS_CRON_SCAN_FILES="${toPosix(join(base, "crontab"))}" IDS_CRON_SPOOL_DIRS="${toPosix(join(base, "spool"))}" IDS_CRON_RELOAD_WAIT=0 IDS_STATS_SETTLE_SECONDS=0 IDS_WRITER_POLL_SECONDS=0`,
      `export STUB_SYSTEMD="${toPosix(sysd)}"`,
      `source "${toPosix(LIB)}"`,
      script,
    ].join("\n");
    const r = spawnSync(BASH!, ["-c", full], { env: { ...process.env, ...env }, encoding: "utf8" });
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

  it("D3. backup ilegível pelo postgres aborta (31); sem tabelas aborta (32)", () => {
    const h = host();
    assert.match(h.run(`echo x > "${toPosix(join(h.base, "d"))}"; ids_assert_backup_readable "${toPosix(join(h.base, "d"))}"; echo RC=$?`, { STUB_UNREADABLE: "1" }), /RC=31[\s\S]*|Permission denied[\s\S]*RC=31/);
    assert.match(h.run(`ids_assert_backup_readable x; echo RC=$?`, { STUB_TABLES: "0" }), /RC=32/);
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
  function installerSandbox(crlfLib: boolean) {
    seq += 1;
    const base = join(work, `inst-${seq}`);
    const deploy = join(base, "deploy");
    mkdirSync(deploy, { recursive: true });
    for (const f of ["install-induscost-deploy.sh", "induscost-deploy-safety.sh", "induscost-deploy-executor.sh"]) {
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
        "",
      ].join("\n")
    );
    const run = (args: string) => {
      const r = spawnSync(BASH!, [toPosix(join(deploy, "install-induscost-deploy.sh")), "--env", "ensaio", ...args.split(" ")], {
        encoding: "utf8",
        env: {
          ...process.env,
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
});
