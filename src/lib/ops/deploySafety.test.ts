/**
 * Biblioteca de segurança dos executores de deploy (infra/deploy/induscost-deploy-safety.sh) — parte SIMULADA.
 *
 * Roda a biblioteca real num bash com pg_dump/pg_restore/psql/createdb/dropdb/systemctl/pgrep SIMULADOS
 * (registram as chamadas num arquivo; nada toca PostgreSQL, systemd ou cron). Cobre o que não depende do banco:
 * pausa/retomada de timers, cron e processos (G1), legibilidade do dump e cerca de escrita durante o backup (G2),
 * gate de testes isolado (G6) e o verificador do executor. Restauração, troca de nomes e recuperação são
 * provadas num PostgreSQL 17 real em deploySafety.pg17.integration.test.ts.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

const LIB = join(process.cwd(), "infra/deploy/induscost-deploy-safety.sh");

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

const STUB = `#!/usr/bin/env bash
name="$(basename "$0")"
printf '%s %s\\n' "$name" "$*" >> "$STUB_CALLS"
count() { local f="$STUB_CALLS.$1"; local n=$(( $(cat "$f" 2>/dev/null || echo 0) + 1 )); echo "$n" > "$f"; echo "$n"; }
case "$name" in
  pg_dump)
    while [[ $# -gt 0 ]]; do [[ "$1" == "-f" ]] && { echo DUMP > "$2"; }; shift; done ;;
  pg_restore)
    if [[ "$1" == "-l" ]]; then
      [[ "\${STUB_UNREADABLE:-0}" == 1 ]] && { echo "pg_restore: error: could not open input file: Permission denied" >&2; exit 1; }
      for i in $(seq 1 "\${STUB_TABLES:-3}"); do echo "$i; 2615 1 TABLE public t$i owner"; done
      exit 0
    fi ;;
  psql)
    sql="\${*: -1}"
    case "$sql" in
      *pg_snapshot_xmax*) n="$(count xid)"; if [[ "$n" -gt 1 && -n "\${STUB_XID_AFTER:-}" ]]; then echo "$STUB_XID_AFTER"; else echo "\${STUB_XID:-100}"; fi ;;
      *pg_stat_activity*) [[ -n "\${STUB_SESSIONS:-}" ]] && printf '%s\\n' "$STUB_SESSIONS" ;;
      *to_regclass*) echo f ;;
      *) echo "linha" ;;
    esac ;;
  systemctl)
    case "$1" in
      list-units) for u in \${STUB_TIMERS:-}; do echo "$u loaded active waiting x"; done ;;
      is-active) [[ " \${STUB_ACTIVE:-} " == *" $3 "* ]] || exit 3 ;;
      start) [[ "$2" == "\${STUB_START_FAIL:-none}" ]] && exit 1 ;;
    esac ;;
  pgrep)
    n="$(count pgrep)"
    if [[ "$n" -le "\${STUB_PGREP_BUSY:-0}" ]]; then echo "4242 tsx scripts/nomusAccountsReceivableSync.ts apply"; exit 0; fi
    exit 1 ;;
esac
exit 0
`;

const work = mkdtempSync(join(tmpdir(), "deploy-safety-test-"));
const stubs = join(work, "bin");
mkdirSync(stubs);
for (const name of ["pg_dump", "pg_restore", "psql", "createdb", "dropdb", "systemctl", "pgrep"]) {
  writeFileSync(join(stubs, name), STUB);
  chmodSync(join(stubs, name), 0o755);
}
after(() => rmSync(work, { recursive: true, force: true }));

let seq = 0;
function run(script: string, env: Record<string, string> = {}) {
  seq += 1;
  const calls = join(work, `calls-${seq}.txt`);
  writeFileSync(calls, "");
  const backupDir = join(work, `backup-${seq}`);
  mkdirSync(backupDir);
  const full = [
    `export PATH="${toPosix(stubs)}:$PATH"`,
    `export STUB_CALLS="${toPosix(calls)}"`,
    `export IDS_PG="" IDS_PG_USER="" IDS_WRITER_POLL_SECONDS=0`,
    `BACKUP_DIR="${toPosix(backupDir)}"`,
    `DUMP="$BACKUP_DIR/database-before.dump"; echo DUMP > "$DUMP"`,
    `source "${toPosix(LIB)}"`,
    script,
  ].join("\n");
  const result = spawnSync(BASH!, ["-c", full], { env: { ...process.env, ...env }, encoding: "utf8" });
  const lines = readFileSync(calls, "utf8").split("\n").filter(Boolean);
  return { code: result.status, stdout: result.stdout, stderr: result.stderr, calls: lines, backupDir };
}

describe("biblioteca de segurança do deploy (comandos simulados)", { skip: SKIP }, () => {
  it("D1. nenhum dropdb, --clean, DROP DATABASE nem --no-owner/--no-acl na biblioteca", () => {
    const src = readFileSync(LIB, "utf8")
      .split("\n")
      .filter((line) => !line.trim().startsWith("#"))
      .join("\n");
    assert.doesNotMatch(src, /\bdropdb\b/);
    assert.doesNotMatch(src, /--clean/);
    assert.doesNotMatch(src, /DROP\s+DATABASE/i);
    assert.doesNotMatch(src, /--no-owner|--no-acl/);
  });

  it("D2. backup: XID antes do pg_dump, dump conferido, metadados e impressão digital gravados", () => {
    const r = run(`ids_backup_db teste_bi "$BACKUP_DIR/novo.dump"; echo RC=$?`);
    assert.match(r.stdout, /RC=0/);
    assert.match(r.stdout, /cerca de escrita no XID 100/);
    const dumpIdx = r.calls.findIndex((c) => /^pg_dump -Fc -Z 6 -d teste_bi -f .*novo\.dump$/.test(c));
    assert.ok(dumpIdx > 0 && /pg_snapshot_xmax/.test(r.calls[dumpIdx - 1]!), "XID lido antes do pg_dump");
    assert.match(r.calls[dumpIdx + 1]!, /^pg_restore -l /);
    for (const f of ["db-meta.txt", "fingerprint-before.txt", "schema-before.txt", "xid-at-backup"]) {
      assert.ok(existsSync(join(r.backupDir, f)), f);
    }
    assert.equal(readFileSync(join(r.backupDir, "xid-at-backup"), "utf8").trim(), "100");
  });

  it("D2b. escrita durante o backup (XID avançou): backup recusado (39), sem xid-at-backup", () => {
    const r = run(`ids_backup_db teste_bi "$DUMP"; echo RC=$?`, { STUB_XID_AFTER: "101" });
    assert.match(r.stdout, /RC=39/);
    assert.match(r.stdout, /XID 100 → 101/);
    assert.ok(!existsSync(join(r.backupDir, "xid-at-backup")));
  });

  it("D3. backup ilegível pelo postgres aborta (31) antes de qualquer mudança", () => {
    const r = run(`ids_assert_backup_readable "$DUMP"; echo RC=$?`, { STUB_UNREADABLE: "1" });
    assert.match(r.stdout, /RC=31/);
    assert.match(r.stdout, /Permission denied/);
  });

  it("D4. backup sem tabelas aborta (32)", () => {
    const r = run(`ids_assert_backup_readable "$DUMP"; echo RC=$?`, { STUB_TABLES: "0" });
    assert.match(r.stdout, /RC=32/);
  });

  it("D5. marcador sem backup válido (sem xid-at-backup): migrations NÃO começam (43)", () => {
    const r = run(`ids_mark_db_changes_started "$BACKUP_DIR" teste_bi; echo RC=$?; ls "$BACKUP_DIR"`);
    assert.match(r.stdout, /RC=43/);
    assert.doesNotMatch(r.stdout, /db-changes-started/);
  });

  it("S1. pausa só os timers ativos do glob e o cron; retomada em ordem inversa limpa o estado", () => {
    const env = {
      STUB_TIMERS: "induscost-legal-datajud.timer induscost-legal-djen.timer induscost-legal-tribunal.timer",
      STUB_ACTIVE: "induscost-legal-datajud.timer induscost-legal-tribunal.timer cron",
    };
    const r = run(`ids_pause_writers "$BACKUP_DIR/w.state" teste_bi; echo RC=$?; cat "$BACKUP_DIR/w.state"; ids_resume_writers "$BACKUP_DIR/w.state"; echo RC2=$?; wc -c < "$BACKUP_DIR/w.state"`, env);
    assert.match(r.stdout, /RC=0/);
    assert.match(r.stdout, /unit induscost-legal-datajud\.timer\nunit induscost-legal-tribunal\.timer\nunit cron\n/);
    const stops = r.calls.filter((c) => c.startsWith("systemctl stop")).map((c) => c.split(" ")[2]);
    assert.deepEqual(stops, ["induscost-legal-datajud.timer", "induscost-legal-tribunal.timer", "cron"]);
    const starts = r.calls.filter((c) => c.startsWith("systemctl start")).map((c) => c.split(" ")[2]);
    assert.deepEqual(starts, ["cron", "induscost-legal-tribunal.timer", "induscost-legal-datajud.timer"]);
    assert.match(r.stdout, /RC2=0\n0\s*$/);
  });

  it("S2. rotina Nomus em execução: espera terminar e só então confere sessões", () => {
    const r = run(`IDS_WRITER_WAIT_SECONDS=10 IDS_WRITER_POLL_SECONDS=1 ids_pause_writers "$BACKUP_DIR/w.state" teste_bi; echo RC=$?`, {
      STUB_PGREP_BUSY: "2",
    });
    assert.match(r.stdout, /RC=0/);
    assert.equal(r.calls.filter((c) => c.startsWith("pgrep")).length, 3);
    const lastPgrep = r.calls.map((c) => c.startsWith("pgrep")).lastIndexOf(true);
    assert.ok(r.calls.findIndex((c) => c.includes("pg_stat_activity")) > lastPgrep);
  });

  it("S3. rotina não termina no prazo (40): lista o processo; o que foi parado continua registrado para retomar", () => {
    const r = run(`IDS_WRITER_WAIT_SECONDS=0 ids_pause_writers "$BACKUP_DIR/w.state" teste_bi; echo RC=$?; cat "$BACKUP_DIR/w.state"`, {
      STUB_PGREP_BUSY: "99",
      STUB_ACTIVE: "cron",
    });
    assert.match(r.stdout, /RC=40/);
    assert.match(r.stdout, /nomusAccountsReceivableSync\.ts/);
    assert.match(r.stdout, /unit cron/);
  });

  it("S4. sessão aberta no banco depois da pausa (41): lista pid/usuário/aplicação", () => {
    const r = run(`ids_pause_writers "$BACKUP_DIR/w.state" teste_bi; echo RC=$?`, { STUB_SESSIONS: "777|bi|metabase|10.0.0.5" });
    assert.match(r.stdout, /RC=41/);
    assert.match(r.stdout, /777\|bi\|metabase\|10\.0\.0\.5/);
  });

  it("S5. retomada falhou (42): estado mantido para nova tentativa; IDS_PAUSE_CRON=0 não toca no cron", () => {
    const r = run(
      `IDS_PAUSE_CRON=0 ids_pause_writers "$BACKUP_DIR/w.state" teste_bi >/dev/null; ids_resume_writers "$BACKUP_DIR/w.state"; echo RC=$?; cat "$BACKUP_DIR/w.state"`,
      { STUB_TIMERS: "induscost-legal-djen.timer", STUB_ACTIVE: "induscost-legal-djen.timer cron", STUB_START_FAIL: "induscost-legal-djen.timer" }
    );
    assert.match(r.stdout, /RC=42/);
    assert.match(r.stdout, /unit induscost-legal-djen\.timer/);
    assert.ok(!r.calls.some((c) => c === "systemctl stop cron"));
  });

  it("D10. gate de testes sem .env, banco inalcançável, credenciais vazias e locks temporários", () => {
    const r = run(
      `IDS_TEST_RUNNER=env IDS_TEST_RUNNER_ARGS="" ids_run_test_gate; echo RC=$?`,
      { DATABASE_URL: "postgresql://prod:segredo@db.producao/teste_bi", NOMUS_TOKEN: "TOKEN-REAL" }
    );
    assert.match(r.stdout, /RC=0/);
    assert.match(r.stdout, /^DATABASE_URL=postgresql:\/\/offline:offline@127\.0\.0\.1:1\/induscost_test_gate_offline$/m);
    assert.match(r.stdout, /^NOMUS_TOKEN=$/m);
    assert.match(r.stdout, /^DOTENV_CONFIG_PATH=.*\.env\.inexistente$/m);
    assert.match(r.stdout, /^NOMUS_ACCOUNTS_RECEIVABLE_CANONICAL_LOCK_FILE=.*induscost-test-gate-locks\..*ar\.canonical\.lock$/m);
    assert.doesNotMatch(r.stdout, /segredo|TOKEN-REAL/);
  });

  it("D10b. toda chave do .env do servidor chega vazia aos testes (valores nunca lidos)", () => {
    const envFile = join(work, "server.env");
    writeFileSync(envFile, "DATABASE_URL=postgresql://prod:x@db/teste_bi\nexport SMTP_PASSWORD=senha-real\nDATAJUD_API_KEY = chave\n# COMENTARIO=1\n");
    const r = run(`IDS_ENV_FILE="${toPosix(envFile)}" IDS_TEST_RUNNER=env IDS_TEST_RUNNER_ARGS="" ids_run_test_gate; echo RC=$?`, {
      SMTP_PASSWORD: "senha-real",
    });
    assert.match(r.stdout, /RC=0/);
    assert.match(r.stdout, /^SMTP_PASSWORD=$/m);
    assert.match(r.stdout, /^DATAJUD_API_KEY=$/m);
    assert.match(r.stdout, /^DATABASE_URL=postgresql:\/\/offline:offline@127\.0\.0\.1:1\/induscost_test_gate_offline$/m);
    assert.doesNotMatch(r.stdout, /senha-real|prod:x/);
    assert.doesNotMatch(r.stdout, /^COMENTARIO=/m);
  });

  it("D11. gate devolve o código de saída dos testes", () => {
    const r = run(`IDS_TEST_RUNNER=false IDS_TEST_RUNNER_ARGS="" ids_run_test_gate; echo RC=$?`);
    assert.match(r.stdout, /RC=1/);
  });

  const CHECKER = join(process.cwd(), "scripts/ops/checkDeployExecutorSafety.sh");
  const check = (content: string, installedLib = LIB) => {
    seq += 1;
    const file = join(work, `executor-${seq}.sh`);
    writeFileSync(file, content);
    const r = spawnSync(BASH!, [toPosix(CHECKER), toPosix(file)], {
      encoding: "utf8",
      env: { ...process.env, IDS_LIB_INSTALLED: toPosix(installedLib) },
    });
    return { code: r.status, out: r.stdout };
  };
  const OLD_EXECUTOR = `#!/usr/bin/env bash
BACKUP_ROOT="/var/backups/induscost-production/deploys"
install -d -m 0700 "$BACKUP_DIR"
runuser -u postgres -- pg_dump -Fc -d "$DB" -f "$TMP_DUMP"
pg_restore -l "$TMP_DUMP" >/dev/null
rollback() {
  runuser -u postgres -- dropdb --if-exists "$DB"
  runuser -u postgres -- createdb -O "$DB_OWNER" "$DB"
  runuser -u postgres -- pg_restore --no-owner --no-acl --role="$DB_OWNER" --dbname="$DB" "$DB_BACKUP"
}
npx tsx --test "\${FILES[@]}"
./node_modules/.bin/prisma migrate deploy
systemctl start "$SERVICE"
`;
  const NEW_EXECUTOR = `#!/usr/bin/env bash
source /usr/local/lib/induscost/induscost-deploy-safety.sh
# dropdb citado só em comentário não conta
ids_recover_db_state "$DB" "" || exit 45
BACKUP_DIR="$(ids_prepare_backup_dir "$BACKUP_ROOT" "$TS")"
trap 'ids_resume_writers "$WRITERS_STATE" || true' EXIT
if ! ids_pause_writers "$WRITERS_STATE" "$DB"; then exit 40; fi
if ! ids_backup_db "$DB" "$DB_BACKUP"; then exit 31; fi
rollback() {
  ids_rollback_db_if_needed "$BACKUP_DIR" "$DB" "$DB_BACKUP" "$TS"
  DB_RC=$?
  if [[ "$DB_RC" == 2 ]]; then trap - EXIT; exit 2; fi
  ids_resume_writers "$WRITERS_STATE"
}
ids_run_test_gate "\${FILES[@]}"
ids_mark_db_changes_started "$BACKUP_DIR" "$DB" || { rollback; exit 43; }
./node_modules/.bin/prisma migrate deploy
ids_mark_app_starting "$BACKUP_DIR"
systemctl start "$SERVICE"
ids_resume_writers "$WRITERS_STATE"
`;

  it("D12. verificador reprova o executor do incidente (dropdb, --no-owner, sem biblioteca nem pausa)", () => {
    const r = check(OLD_EXECUTOR);
    assert.equal(r.code, 1);
    for (const missing of [
      "nenhum dropdb no executor",
      "carrega a biblioteca",
      "G1: escritores pausados",
      "G2: ids_mark_db_changes_started com o banco",
      "G3: ids_mark_app_starting",
      "nenhum pg_restore --no-owner/--no-acl",
      "G5: ids_recover_db_state",
    ]) {
      assert.match(r.out, new RegExp(`FALTA ${missing.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}`));
    }
  });

  it("D13. verificador aprova o executor corrigido (com a biblioteca instalada idêntica)", () => {
    const r = check(NEW_EXECUTOR);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /RESULTADO: executor protegido\./);
  });

  it("D14. marcador depois do migrate deploy, ou sem o banco (assinatura v1), é reprovado", () => {
    const swapped = NEW_EXECUTOR.replace(
      'ids_mark_db_changes_started "$BACKUP_DIR" "$DB" || { rollback; exit 43; }\n./node_modules/.bin/prisma migrate deploy',
      './node_modules/.bin/prisma migrate deploy\nids_mark_db_changes_started "$BACKUP_DIR" "$DB" || { rollback; exit 43; }'
    );
    assert.notEqual(swapped, NEW_EXECUTOR);
    assert.match(check(swapped).out, /FALTA G2: ids_mark_db_changes_started/);
    const v1 = NEW_EXECUTOR.replace('ids_mark_db_changes_started "$BACKUP_DIR" "$DB"', 'ids_mark_db_changes_started "$BACKUP_DIR"');
    assert.match(check(v1).out, /FALTA G2: ids_mark_db_changes_started/);
  });

  it("D15. rollback com assinatura v1 (DB_OWNER), sem tratar DB_RC=2 ou pausa depois do backup: reprovado", () => {
    const v1 = NEW_EXECUTOR.replace('ids_rollback_db_if_needed "$BACKUP_DIR" "$DB" "$DB_BACKUP" "$TS"', 'ids_rollback_db_if_needed "$BACKUP_DIR" "$DB" "$DB_OWNER" "$DB_BACKUP" "$TS"');
    assert.match(check(v1).out, /FALTA G3\/G5: rollback/);
    const no2 = NEW_EXECUTOR.replace('  if [[ "$DB_RC" == 2 ]]; then trap - EXIT; exit 2; fi\n', "");
    assert.match(check(no2).out, /FALTA G3: DB_RC=2/);
    const late = NEW_EXECUTOR.replace('if ! ids_pause_writers "$WRITERS_STATE" "$DB"; then exit 40; fi\nif ! ids_backup_db "$DB" "$DB_BACKUP"; then exit 31; fi', 'if ! ids_backup_db "$DB" "$DB_BACKUP"; then exit 31; fi\nif ! ids_pause_writers "$WRITERS_STATE" "$DB"; then exit 40; fi');
    assert.notEqual(late, NEW_EXECUTOR);
    assert.match(check(late).out, /FALTA G1: escritores pausados/);
  });

  it("D16. biblioteca instalada diferente da do repositório é reprovada", () => {
    const stale = join(work, "stale-lib.sh");
    writeFileSync(stale, readFileSync(LIB, "utf8").replace("v2.", "v1."));
    const r = check(NEW_EXECUTOR, stale);
    assert.equal(r.code, 1);
    assert.match(r.out, /FALTA biblioteca instalada/);
  });
});
