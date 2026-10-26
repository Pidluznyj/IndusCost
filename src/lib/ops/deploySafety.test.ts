/**
 * Biblioteca de segurança dos executores de deploy (infra/deploy/induscost-deploy-safety.sh).
 *
 * Roda a biblioteca real num bash com pg_dump/pg_restore/psql/createdb/dropdb SIMULADOS (registram as
 * chamadas num arquivo; nada toca PostgreSQL). Prova as garantias do incidente de 26/10/2026:
 * nenhum dropdb, backup ilegível aborta antes de mudar algo, banco só é restaurado se o deploy o
 * alterou, restauração em banco novo + troca de nomes, gate de testes sem recursos reais.
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

const STUB = `#!/usr/bin/env bash
name="$(basename "$0")"
printf '%s %s\\n' "$name" "$*" >> "$STUB_CALLS"
case "$name" in
  pg_dump)
    while [[ $# -gt 0 ]]; do [[ "$1" == "-f" ]] && { echo DUMP > "$2"; }; shift; done ;;
  pg_restore)
    if [[ "$1" == "-l" ]]; then
      [[ "\${STUB_UNREADABLE:-0}" == 1 ]] && { echo "pg_restore: error: could not open input file: Permission denied" >&2; exit 1; }
      for i in $(seq 1 "\${STUB_TABLES:-3}"); do echo "$i; 2615 1 TABLE public t$i owner"; done
      exit 0
    fi
    [[ "\${STUB_RESTORE_FAIL:-0}" == 1 ]] && exit 1 ;;
  createdb)
    [[ "\${STUB_CREATEDB_FAIL:-0}" == 1 ]] && exit 1 ;;
  psql)
    sql="\${*: -1}"
    if [[ "$sql" == *"RENAME TO"* && "$sql" == *"__rollback_"*"RENAME TO"* && "\${STUB_SECOND_RENAME_FAIL:-0}" == 1 ]]; then exit 1; fi ;;
esac
exit 0
`;

const work = mkdtempSync(join(tmpdir(), "deploy-safety-test-"));
const stubs = join(work, "bin");
mkdirSync(stubs);
for (const name of ["pg_dump", "pg_restore", "psql", "createdb", "dropdb"]) {
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
  const toPosix = (p: string) => (process.platform === "win32" ? p.replace(/\\/g, "/").replace(/^([A-Za-z]):/, (_m, d: string) => `/${d.toLowerCase()}`) : p);
  const full = [
    `export PATH="${toPosix(stubs)}:$PATH"`,
    `export STUB_CALLS="${toPosix(calls)}"`,
    `export IDS_PG="" IDS_PG_USER=""`,
    `BACKUP_DIR="${toPosix(backupDir)}"`,
    `DUMP="$BACKUP_DIR/database-before.dump"; echo DUMP > "$DUMP"`,
    `source "${toPosix(LIB)}"`,
    script,
  ].join("\n");
  const result = spawnSync(BASH!, ["-c", full], { env: { ...process.env, ...env }, encoding: "utf8" });
  const lines = readFileSync(calls, "utf8").split("\n").filter(Boolean);
  return { code: result.status, stdout: result.stdout, stderr: result.stderr, calls: lines, backupDir };
}

describe("biblioteca de segurança do deploy", { skip: SKIP }, () => {
  it("D1. nenhum dropdb, --clean ou DROP DATABASE na biblioteca", () => {
    const src = readFileSync(LIB, "utf8")
      .split("\n")
      .filter((line) => !line.trim().startsWith("#"))
      .join("\n");
    assert.doesNotMatch(src, /\bdropdb\b/);
    assert.doesNotMatch(src, /--clean/);
    assert.doesNotMatch(src, /DROP\s+DATABASE/i);
  });

  it("D2. backup legível pelo usuário do restore passa; pg_dump grava direto no destino", () => {
    const r = run(`ids_backup_db teste_bi "$BACKUP_DIR/novo.dump"; echo RC=$?`);
    assert.match(r.stdout, /RC=0/);
    assert.match(r.calls[0]!, /^pg_dump .* -d teste_bi -f .*novo\.dump$/);
    assert.match(r.calls[1]!, /^pg_restore -l /);
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

  it("D5. falha antes das migrations (sem marcador): rollback NÃO toca no banco", () => {
    const r = run(`ids_rollback_db_if_needed "$BACKUP_DIR" teste_bi dono "$DUMP" 20261026_082516; echo RC=$?`);
    assert.match(r.stdout, /RC=0/);
    assert.match(r.stdout, /restauração do banco NÃO executada/);
    assert.deepEqual(r.calls, []);
  });

  it("D6. com migrations iniciadas: restaura em banco novo e só então troca os nomes; nada é apagado", () => {
    const r = run(
      `ids_mark_db_changes_started "$BACKUP_DIR"; ids_rollback_db_if_needed "$BACKUP_DIR" teste_bi dono "$DUMP" 20261026_082516; echo RC=$?`
    );
    assert.match(r.stdout, /RC=0/);
    const order = r.calls.map((c) => c.split(" ")[0]);
    assert.ok(!order.includes("dropdb"));
    const restoreIdx = r.calls.findIndex((c) => c.startsWith("pg_restore --dbname=teste_bi__rollback_20261026_082516"));
    const renameOld = r.calls.findIndex((c) => /ALTER DATABASE "teste_bi" RENAME TO "teste_bi__failed_20261026_082516"/.test(c));
    const renameNew = r.calls.findIndex((c) => /ALTER DATABASE "teste_bi__rollback_20261026_082516" RENAME TO "teste_bi"/.test(c));
    assert.ok(r.calls.some((c) => c.startsWith("createdb -O dono teste_bi__rollback_20261026_082516")));
    assert.ok(restoreIdx >= 0 && renameOld > restoreIdx && renameNew > renameOld, r.calls.join("\n"));
  });

  it("D7. restore no banco temporário falhou: banco atual intocado (34), sem troca de nomes", () => {
    const r = run(
      `ids_mark_db_changes_started "$BACKUP_DIR"; ids_rollback_db_if_needed "$BACKUP_DIR" teste_bi dono "$DUMP" 1; echo RC=$?`,
      { STUB_RESTORE_FAIL: "1" }
    );
    assert.match(r.stdout, /RC=34/);
    assert.ok(!r.calls.some((c) => c.includes("ALTER DATABASE")));
    assert.ok(!r.calls.some((c) => c.startsWith("dropdb")));
  });

  it("D8. dump ilegível no rollback: nada é criado nem alterado (31)", () => {
    const r = run(
      `ids_mark_db_changes_started "$BACKUP_DIR"; ids_rollback_db_if_needed "$BACKUP_DIR" teste_bi dono "$DUMP" 1; echo RC=$?`,
      { STUB_UNREADABLE: "1" }
    );
    assert.match(r.stdout, /RC=31/);
    assert.deepEqual(r.calls.map((c) => c.split(" ")[0]), ["pg_restore"]);
  });

  it("D9. segunda troca de nome falhou: o banco original volta ao nome (36)", () => {
    const r = run(
      `ids_mark_db_changes_started "$BACKUP_DIR"; ids_rollback_db_if_needed "$BACKUP_DIR" teste_bi dono "$DUMP" 7; echo RC=$?`,
      { STUB_SECOND_RENAME_FAIL: "1" }
    );
    assert.match(r.stdout, /RC=36/);
    assert.ok(r.calls.some((c) => /ALTER DATABASE "teste_bi__failed_7" RENAME TO "teste_bi"/.test(c)));
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
    const posix = process.platform === "win32" ? envFile.replace(/\\/g, "/").replace(/^([A-Za-z]):/, (_m, d: string) => `/${d.toLowerCase()}`) : envFile;
    const r = run(`IDS_ENV_FILE="${posix}" IDS_TEST_RUNNER=env IDS_TEST_RUNNER_ARGS="" ids_run_test_gate; echo RC=$?`, {
      SMTP_PASSWORD: "senha-real",
    });
    assert.match(r.stdout, /RC=0/);
    assert.match(r.stdout, /^SMTP_PASSWORD=$/m);
    assert.match(r.stdout, /^DATAJUD_API_KEY=$/m);
    assert.match(r.stdout, /^DATABASE_URL=postgresql:\/\/offline:offline@127\.0\.0\.1:1\/induscost_test_gate_offline$/m);
    assert.doesNotMatch(r.stdout, /senha-real|prod:x/);
    assert.doesNotMatch(r.stdout, /^COMENTARIO=/m);
  });

  const CHECKER = join(process.cwd(), "scripts/ops/checkDeployExecutorSafety.sh");
  const toPosixPath = (p: string) =>
    process.platform === "win32" ? p.replace(/\\/g, "/").replace(/^([A-Za-z]):/, (_m, d: string) => `/${d.toLowerCase()}`) : p;
  const check = (content: string) => {
    seq += 1;
    const file = join(work, `executor-${seq}.sh`);
    writeFileSync(file, content);
    const r = spawnSync(BASH!, [toPosixPath(CHECKER), toPosixPath(file)], { encoding: "utf8" });
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
  runuser -u postgres -- pg_restore --dbname="$DB" "$DB_BACKUP"
}
npx tsx --test "\${FILES[@]}"
./node_modules/.bin/prisma migrate deploy
`;
  const NEW_EXECUTOR = `#!/usr/bin/env bash
source /usr/local/lib/induscost/induscost-deploy-safety.sh
# dropdb citado só em comentário não conta
BACKUP_DIR="$(ids_prepare_backup_dir "$BACKUP_ROOT" "$TS")"
if ! ids_backup_db "$DB" "$DB_BACKUP"; then exit 31; fi
rollback() {
  ids_rollback_db_if_needed "$BACKUP_DIR" "$DB" "$DB_OWNER" "$DB_BACKUP" "$TS"
}
ids_run_test_gate "\${FILES[@]}"
ids_mark_db_changes_started "$BACKUP_DIR"
./node_modules/.bin/prisma migrate deploy
`;

  it("D12. verificador reprova o executor do incidente (dropdb, sem biblioteca)", () => {
    const r = check(OLD_EXECUTOR);
    assert.equal(r.code, 1);
    assert.match(r.out, /FALTA nenhum dropdb no executor/);
    assert.match(r.out, /FALTA carrega a biblioteca/);
    assert.match(r.out, /FALTA marcador ids_mark_db_changes_started antes de prisma migrate deploy/);
  });

  it("D13. verificador aprova o executor corrigido", () => {
    const r = check(NEW_EXECUTOR);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /RESULTADO: executor protegido\./);
  });

  it("D14. marcador depois do migrate deploy é reprovado", () => {
    const swapped = NEW_EXECUTOR.replace(
      'ids_mark_db_changes_started "$BACKUP_DIR"\n./node_modules/.bin/prisma migrate deploy',
      './node_modules/.bin/prisma migrate deploy\nids_mark_db_changes_started "$BACKUP_DIR"'
    );
    const r = check(swapped);
    assert.equal(r.code, 1);
    assert.match(r.out, /FALTA marcador/);
  });

  it("D11. gate devolve o código de saída dos testes", () => {
    const r = run(`IDS_TEST_RUNNER=false IDS_TEST_RUNNER_ARGS="" ids_run_test_gate; echo RC=$?`);
    assert.match(r.stdout, /RC=1/);
  });
});
