/**
 * Ensaio ponta a ponta do executor versionado (infra/deploy/induscost-deploy-executor.sh), INSTALADO pelo instalador
 * reversível (infra/deploy/install-induscost-deploy.sh) num diretório temporário, contra:
 *   - git real (repositório "origin" + checkout da aplicação, como /opt/induscost);
 *   - Prisma migrate deploy/status reais;
 *   - PostgreSQL 17 descartável com psql/pg_dump/pg_restore/createdb reais.
 * Simulados (não existem nesta máquina): systemd (timers, serviço da aplicação), npm, curl (health) e flock.
 *
 * Executar: COMMISSION_PG17_BIN=<bin do PostgreSQL 17 com os clientes> npx tsx --test src/lib/ops/deployExecutor.pg17.e2e.test.ts
 */
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { after, before, describe, it } from "node:test";
import { PrismaClient } from "@prisma/client";
import { commissionPg17BinDir, startCommissionPostgres17, type CommissionPg17Database } from "../../../scripts/testing/commissionPostgresHarness.js";

const REPO = resolve(import.meta.dirname ?? ".", "..", "..", "..");
const EXE = process.platform === "win32" ? ".exe" : "";
const BASH = process.platform !== "win32" ? "bash" : ["C:\\Program Files\\Git\\bin\\bash.exe", "C:\\Program Files (x86)\\Git\\bin\\bash.exe"].find((c) => existsSync(c)) ?? null;
const pg17Bin = commissionPg17BinDir();
const hasClients = !!pg17Bin && ["psql", "pg_dump", "pg_restore", "createdb"].every((t) => existsSync(join(pg17Bin, `${t}${EXE}`)));
const gitOk = spawnSync("git", ["--version"]).status === 0;
const SKIP = !hasClients ? "COMMISSION_PG17_BIN sem binários cliente do PostgreSQL 17: ensaio não executado." : !BASH ? "bash não encontrado." : !gitOk ? "git ausente." : false;
const posix = (p: string) => (process.platform === "win32" ? p.replace(/\\/g, "/").replace(/^([A-Za-z]):/, (_m, d: string) => `/${d.toLowerCase()}`) : p);

const INIT_MIGRATION = `CREATE TABLE "Item" ("id" SERIAL PRIMARY KEY, "name" TEXT NOT NULL, "legacy" TEXT);
CREATE UNIQUE INDEX "Item_name_key" ON "Item"("name");
INSERT INTO "Item" ("name", "legacy") VALUES ('a', 'x'), ('b', 'y');
`;

const STUBS: Record<string, string> = {
  // systemd com estado em arquivos: <unidade> → active|inactive|failed. A "aplicação" roda fake-app.sh do checkout.
  systemctl: `#!/usr/bin/env bash
S="$STUB_SYSTEMD"; echo "systemctl $*" >> "$S/calls"
case "$1" in
  is-active) [[ "$2" == --quiet ]] && { u="$3"; q=1; } || { u="$2"; q=0; }
    st="$(cat "$S/$u" 2>/dev/null || echo inactive)"; [[ $q == 0 ]] && echo "$st"; [[ "$st" == active ]]; exit $? ;;
  stop) echo inactive > "$S/$2" ;;
  start) if [[ "$2" == induscost.service ]]; then bash "$STUB_APP_DIR/fake-app.sh" || exit 1; fi; echo active > "$S/$2" ;;
  reset-failed) : ;;
  list-units) t=""; for a in "$@"; do [[ "$a" == --type=* ]] && t="\${a#--type=}"; done
    for f in "$S"/induscost-*."$t"; do [[ -f "$f" ]] && echo "$(basename "$f") loaded $(cat "$f") waiting x"; done ;;
  show) u="\${@: -1}"; if [[ -f "$S/$u.show" ]]; then cat "$S/$u.show"; else echo "WorkingDirectory=$STUB_APP_DIR"; fi ;;
esac
exit 0
`,
  npm: `#!/usr/bin/env bash
echo "npm $*" >> "$STUB_SYSTEMD/calls"
[[ "$1 $2" == "run build" && -f BUILD_FAIL ]] && exit 1
exit 0
`,
  curl: `#!/usr/bin/env bash
[[ "$(cat "$STUB_APP_DIR/HEALTH" 2>/dev/null)" == ok && "$(cat "$STUB_SYSTEMD/induscost.service" 2>/dev/null)" == active ]] && exit 0
exit 22
`,
  flock: `#!/usr/bin/env bash\nexit 0\n`,
  pgrep: `#!/usr/bin/env bash\nexit 1\n`,
  // Simulados do hook do servidor-01 (gateway/AWS/CNPJ, SSH da AWS, papel do servidor); chamadas em hook-calls.
  "hook-curl": `#!/usr/bin/env bash
echo "curl $*" >> "$STUB_SYSTEMD/hook-calls"
url="\${@: -1}"; k="\${url//[^A-Za-z0-9]/_}"
if [[ "$*" == *http_code* ]]; then [[ -f "$STUB_SYSTEMD/hook-down-$k" ]] && { echo 000; exit 28; }; echo 200; exit 0; fi
[[ -f "$STUB_SYSTEMD/hook-down-$k" ]] && exit 7
exit 0
`,
  "hook-ssh": `#!/usr/bin/env bash
echo "ssh $*" >> "$STUB_SYSTEMD/hook-calls"
n=$(( $(cat "$STUB_SYSTEMD/ssh-n" 2>/dev/null || echo 0) + 1 )); echo "$n" > "$STUB_SYSTEMD/ssh-n"
if [[ -f "$STUB_SYSTEMD/aws-sha-$n" ]]; then cat "$STUB_SYSTEMD/aws-sha-$n"; else echo 0123456789abcdef0123456789abcdef01234567; fi
`,
  "runtime-role": `#!/usr/bin/env bash
echo "role $*" >> "$STUB_SYSTEMD/hook-calls"
[[ "$1" == get ]] && echo CLOUD_PRIMARY
exit 0
`,
  // HANG: registra a cadeia de processos do executor (para o teste simular a queda com SIGKILL) e fica parado.
  "fake-test-runner": `#!/usr/bin/env bash
ppid_of() { ps -o ppid= -p "$1" 2>/dev/null | tr -d ' ' | grep . || ps -p "$1" 2>/dev/null | awk 'NR == 2 { n = 0; for (i = 1; i <= NF; i++) if ($i ~ /^[0-9]+$/) { n++; if (n == 2) { print $i; exit } } }'; }
for f in "$@"; do
  if grep -q HANG "$f"; then
    chain="$$"; p="$PPID"
    for i in 1 2 3 4 5 6; do [[ -n "$p" && "$p" != 1 ]] || break; chain="$chain $p"; p="$(ppid_of "$p")"; done
    echo "$chain" > "$STUB_SYSTEMD/executor-chain"; sleep 300
  fi
  grep -q FAIL "$f" && { echo "teste falhou: $f"; exit 1; }
done
echo "testes ok: $*"
`,
};

describe("executor de deploy instalado — ensaio com git, Prisma e PostgreSQL 17 reais", { skip: SKIP }, () => {
  let db: CommissionPg17Database;
  let admin: PrismaClient;
  let root: string;
  let stubs: string;
  let n = 0;

  before(async () => {
    db = await startCommissionPostgres17(pg17Bin!, { schema: "none" });
    admin = new PrismaClient({ datasourceUrl: db.poolUrl(2) });
    root = mkdtempSync(join(tmpdir(), "deploy-executor-e2e-"));
    stubs = join(root, "stubs");
    mkdirSync(stubs);
    for (const [name, body] of Object.entries(STUBS)) {
      writeFileSync(join(stubs, name), body);
      chmodSync(join(stubs, name), 0o755);
    }
  });
  after(async () => {
    await admin?.$disconnect();
    await db?.stop();
    if (root) rmSync(root, { recursive: true, force: true });
  });

  const urlOf = (name: string) => db.url.replace(/\/postgres\?/, `/${name}?`);
  const sh = (cwd: string, cmd: string, env: Record<string, string> = {}) => {
    const r = spawnSync(BASH!, ["-c", cmd], { cwd, encoding: "utf8", env: { ...process.env, ...env } });
    if (r.status !== 0) throw new Error(`${cmd}\n${r.stdout}\n${r.stderr}`);
    return r.stdout;
  };
  const GIT_ENV = { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };

  /** Servidor de mentira completo: origin, checkout, banco migrado em C0, serviço/timers/cron, executor instalado. */
  async function server(c1: Record<string, string | null>, envExtra: Record<string, string> = {}) {
    n += 1;
    const w = join(root, `s${n}`);
    const dev = join(w, "dev");
    const app = join(w, "app");
    const sysd = join(w, "systemd");
    const cron = join(w, "cron.d");
    for (const d of [w, sysd, cron]) mkdirSync(d, { recursive: true });
    const dbName = `app${n}`;
    await admin.$executeRawUnsafe(`CREATE DATABASE "${dbName}"`);

    sh(w, `git init -q --bare -b main origin.git && git clone -q origin.git dev`, GIT_ENV);
    const write = (base: string, files: Record<string, string | null>) => {
      for (const [p, content] of Object.entries(files)) {
        const f = join(base, p);
        if (content === null) rmSync(f, { force: true });
        else {
          mkdirSync(dirname(f), { recursive: true });
          writeFileSync(f, content);
        }
      }
    };
    write(dev, {
      ".gitignore": "node_modules/\n.env\n",
      "prisma/schema.prisma": `datasource db {\n  provider = "postgresql"\n  url      = env("DATABASE_URL")\n}\n`,
      "prisma/migrations/migration_lock.toml": 'provider = "postgresql"\n',
      "prisma/migrations/20261001120000_init/migration.sql": INIT_MIGRATION,
      HEALTH: "ok",
      "fake-app.sh": `[[ -f "$STUB_APP_DIR/APP_WRITES" ]] && psql -X -q -d "$STUB_DB" -c "INSERT INTO \\"Item\\" (name) VALUES ('escrita-da-aplicacao')"\nexit 0\n`,
      "src/a.test.ts": "pass\n",
    });
    sh(dev, `git add -A && git commit -qm c0 && git push -q origin main`, GIT_ENV);
    sh(w, `git clone -q origin.git app`, GIT_ENV);
    writeFileSync(join(app, ".env"), `DATABASE_URL="${urlOf(dbName)}"\nSEGREDO_DO_SERVIDOR=nao-pode-vazar\n`);
    mkdirSync(join(app, "node_modules", ".bin"), { recursive: true });
    writeFileSync(
      join(app, "node_modules", ".bin", "prisma"),
      `#!/usr/bin/env bash\n[[ "$1" == generate ]] && { echo "prisma generate (simulado)"; exit 0; }\nexec "${posix(process.execPath)}" "${posix(join(REPO, "node_modules/prisma/build/index.js"))}" "$@"\n`
    );
    chmodSync(join(app, "node_modules", ".bin", "prisma"), 0o755);
    sh(app, `./node_modules/.bin/prisma migrate deploy >/dev/null`, { DATABASE_URL: urlOf(dbName) });

    write(sysd, { "induscost.service": "active", "induscost-legal-djen.timer": "active", "induscost-legal-datajud.timer": "inactive", "induscost-legal-tribunal.timer": "failed" });
    write(cron, { "induscost-production": `17 */2 * * * root cd ${posix(app)} && npm run sync:nomus:accounts-receivable:apply\n`, "outro-sistema": "0 3 * * * root /usr/bin/backup\n" });
    writeFileSync(join(w, "deploy-mode"), "production");

    write(dev, c1);
    sh(dev, `git add -A && git commit -qm c1 && git push -q origin main`, GIT_ENV);
    const c0 = sh(app, `git rev-parse HEAD`).trim();
    const c1sha = sh(dev, `git rev-parse HEAD`).trim();

    const executorPath = join(w, "bin", "deploy-induscost-teste");
    mkdirSync(dirname(executorPath));
    writeFileSync(executorPath, "#!/usr/bin/env bash\necho executor antigo\n");
    const envFile = join(w, "teste.env");
    const u = new URL(db.url);
    const envValues: Record<string, string> = {
      IDS_ENV_NAME: "teste",
      EXECUTOR_PATH: posix(executorPath),
      EXECUTOR_EXPECTED_SHA256: "",
      LEGACY_WRAPPER_PATH: "none",
      APP: posix(app),
      SERVICE: "induscost.service",
      DB: dbName,
      HEALTH: "http://127.0.0.1:9/api/health",
      BACKUP_ROOT: posix(join(w, "backups", "deploys")),
      LOCK: posix(join(w, "deploy.lock")),
      GIT_REMOTE: "origin",
      DEFAULT_TARGET: "origin/main",
      IDS_PG_OS_USER: "none",
      IDS_PG_BIN: "PATH",
      IDS_PG_HOST: u.hostname,
      IDS_PG_PORT: u.port,
      IDS_PG_ADMIN_ROLE: decodeURIComponent(u.username),
      IDS_PG_EXPECT_MAJOR: "17",
      PROTECTED_DATABASES: "''",
      MODE_FILE: posix(join(w, "deploy-mode")),
      EXPECTED_MODE: "production",
      PRECUTOVER_DROPIN: posix(join(w, "10-precutover-isolation.conf")),
      PRECUTOVER_EXPECTED: "absent",
      START_SERVICE_POLICY: "if-was-active",
      APP_MARK_PATTERN: posix(app),
      CRON_GLOB: "'induscost*'",
      UNIT_GLOB: "'induscost-*'",
      PROTECTED_UNITS: "''",
      HOOKS_PRE_DEPLOY: "none",
      HOOKS_POST_START: "none",
      HOOKS_POST_ROLLBACK: "none",
      HEALTH_TRIES: "2",
      HEALTH_INTERVAL: "0",
      IDS_PIDFILE: posix(join(w, "deploy.pid")),
      IDS_STATE_DIR: posix(join(w, "state")),
      IDS_MAINT_FLAG: posix(join(w, "maintenance.flag")),
      IDS_CRON_DIR: posix(cron),
      IDS_CRON_SCAN_FILES: '""',
      IDS_CRON_SPOOL_DIRS: '""',
      IDS_CRON_RELOAD_WAIT: "0",
      IDS_STATS_SETTLE_SECONDS: "1",
      IDS_SYSTEMCTL: posix(join(stubs, "systemctl")),
      IDS_CURL: posix(join(stubs, "curl")),
      IDS_TEST_RUNNER: posix(join(stubs, "fake-test-runner")),
      IDS_TEST_RUNNER_ARGS: '""',
      ...envExtra,
    };
    writeFileSync(envFile, `${Object.entries(envValues).map(([k, v]) => `${k}=${v}`).join("\n")}\n`);
    const env = {
      ...GIT_ENV,
      PATH: `${posix(stubs)}:${posix(pg17Bin!)}:${process.env.PATH}`,
      PGHOST: u.hostname,
      PGPORT: u.port,
      PGUSER: decodeURIComponent(u.username),
      STUB_SYSTEMD: posix(sysd),
      STUB_APP_DIR: posix(app),
      STUB_DB: dbName,
      IDS_INSTALL_ROOT: posix(join(w, "lib")),
      IDS_INSTALL_ETC: posix(join(w, "etc")),
      IDS_INSTALL_ALLOW_NONROOT: "1",
      IDS_INSTALL_ENV_SOURCE: posix(envFile),
    };
    const run = (args: string) => {
      const r = spawnSync(BASH!, ["-c", `"${posix(executorPath)}" ${args}`], { cwd: w, encoding: "utf8", env: { ...process.env, ...env } });
      return { code: r.status, out: `${r.stdout}\n${r.stderr}` };
    };
    const install = (args: string) => {
      const r = spawnSync(BASH!, [posix(join(REPO, "infra/deploy/install-induscost-deploy.sh")), "--env", "teste", ...args.split(" ").filter(Boolean)], { cwd: w, encoding: "utf8", env: { ...process.env, ...env } });
      return { code: r.status, out: `${r.stdout}\n${r.stderr}` };
    };
    const inst = install("--apply");
    assert.equal(inst.code, 0, inst.out);
    const state = (unit: string) => readFileSync(join(sysd, unit), "utf8").trim();
    const head = () => sh(app, `git rev-parse HEAD`).trim();
    const q = async <T = Record<string, unknown>>(sql: string) => {
      const c = new PrismaClient({ datasourceUrl: urlOf(dbName) });
      try {
        return (await c.$queryRawUnsafe(sql)) as T[];
      } finally {
        await c.$disconnect();
      }
    };
    const columns = async () => (await q<{ c: string }>(`SELECT column_name AS c FROM information_schema.columns WHERE table_name = 'Item' ORDER BY 1`)).map((r) => r.c);
    const lockOn = async () => Number(((await admin.$queryRawUnsafe(`SELECT count(*)::int AS c FROM pg_db_role_setting s, unnest(s.setconfig) c WHERE s.setdatabase = (SELECT oid FROM pg_database WHERE datname = '${dbName}') AND c = 'default_transaction_read_only=on'`)) as Array<{ c: number }>)[0]!.c);
    const dbs = async () => ((await admin.$queryRawUnsafe(`SELECT datname FROM pg_database WHERE datname LIKE '${dbName}%' ORDER BY 1`)) as Array<{ datname: string }>).map((d) => d.datname);
    const backupDir = () => {
      const base = join(w, "backups", "deploys");
      const d = readdirSync(base).sort().pop()!;
      return join(base, d);
    };
    // Sem o arquivo = nenhuma chamada ao systemctl (o executor recusou antes de tocar em qualquer serviço).
    const calls = () => (existsSync(join(sysd, "calls")) ? readFileSync(join(sysd, "calls"), "utf8") : "");
    /** Executor em segundo plano, saída num arquivo; resolve com o código de saída. */
    const runAsync = (args: string) => {
      const log = join(w, "executor.log");
      const child = spawn(BASH!, ["-c", `"${posix(executorPath)}" ${args} > "${posix(log)}" 2>&1`], { cwd: w, env: { ...process.env, ...env }, stdio: "ignore" });
      const done = new Promise<number | null>((res) => child.on("exit", (code) => res(code)));
      return { child, done, log: () => readFileSync(log, "utf8") };
    };
    const waitFor = async (file: string, tries = 1200) => {
      for (let i = 0; i < tries && !existsSync(file); i++) await new Promise((res) => setTimeout(res, 100));
      return existsSync(file);
    };
    return { w, app, sysd, cron, executorPath, envFile, run, runAsync, waitFor, install, state, head, q, columns, lockOn, dbs, backupDir, calls, c0, c1: c1sha, dbName, env };
  }

  /** Hook executável num diretório próprio; registra fase e variáveis de contexto. */
  function hook(dir: string, name: string, exitCode: number) {
    mkdirSync(dir, { recursive: true });
    const f = join(dir, name);
    writeFileSync(f, `#!/usr/bin/env bash\necho "fase=$IDS_DEPLOY_PHASE alvo=$IDS_TARGET anterior=$IDS_OLD_COMMIT backup=$IDS_BACKUP_DIR" >> "$(dirname "$0")/${name}.log"\nexit ${exitCode}\n`);
    chmodSync(f, 0o755);
    return { path: posix(f), log: () => (existsSync(`${f}.log`) ? readFileSync(`${f}.log`, "utf8") : "") };
  }

  /** Agendamentos voltaram exatamente ao estado anterior: só o timer ativo foi religado; inativo/falho intocados. */
  function assertSchedulersRestored(s: Awaited<ReturnType<typeof server>>) {
    assert.deepEqual(readdirSync(s.cron).sort(), ["induscost-production", "outro-sistema"]);
    assert.equal(s.state("induscost-legal-djen.timer"), "active");
    assert.equal(s.state("induscost-legal-datajud.timer"), "inactive");
    assert.equal(s.state("induscost-legal-tribunal.timer"), "failed");
    assert.doesNotMatch(s.calls(), /start induscost-legal-(datajud|tribunal)/);
    assert.ok(!existsSync(join(s.w, "state", "maintenance.state")));
  }

  it("E1. deploy bem-sucedido: migration aplicada, testes isolados, janela encerrada com agendamentos como estavam", async () => {
    const s = await server({ "prisma/migrations/20261101120000_color/migration.sql": `ALTER TABLE "Item" ADD COLUMN "color" TEXT;\n`, "src/a.test.ts": "pass 2\n" });
    const r = s.run("");
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /testes ok: src\/a\.test\.ts/);
    assert.doesNotMatch(r.out, /nao-pode-vazar/);
    assert.equal(s.head(), s.c1);
    assert.deepEqual(await s.columns(), ["color", "id", "legacy", "name"]);
    assert.equal(await s.lockOn(), 0);
    assert.equal(s.state("induscost.service"), "active");
    assertSchedulersRestored(s);
    assert.match(s.calls(), /stop induscost-legal-djen\.timer[\s\S]*start induscost-legal-djen\.timer/);
  });

  it("E2. teste do pacote falha (antes das migrations): código anterior, banco intocado, sem restauração, sistema de volta", async () => {
    const s = await server({ "prisma/migrations/20261101120000_color/migration.sql": `ALTER TABLE "Item" ADD COLUMN "color" TEXT;\n`, "src/a.test.ts": "FAIL\n" });
    const r = s.run("");
    assert.notEqual(r.code, 0);
    assert.match(r.out, /banco não foi alterado por este deploy/);
    assert.match(r.out, /ROLLBACK AUTOMÁTICO CONCLUÍDO/);
    assert.equal(s.head(), s.c0);
    assert.deepEqual(await s.columns(), ["id", "legacy", "name"]);
    assert.deepEqual(await s.dbs(), [s.dbName]);
    assert.equal(s.state("induscost.service"), "active");
    assertSchedulersRestored(s);
  });

  it("E3. migration incompatível e aplicação nova cai no health sem escrever: restaura o backup e volta o código", async () => {
    const s = await server({ "prisma/migrations/20261101120000_drop/migration.sql": `ALTER TABLE "Item" DROP COLUMN "legacy";\n`, HEALTH: "erro" });
    const r = s.run("");
    assert.notEqual(r.code, 0);
    assert.match(r.out, /decisão: RESTAURAR/, r.out);
    assert.match(r.out, /ROLLBACK AUTOMÁTICO CONCLUÍDO/);
    assert.equal(s.head(), s.c0);
    assert.deepEqual(await s.columns(), ["id", "legacy", "name"]);
    assert.deepEqual(await s.dbs(), [s.dbName, `${s.dbName}__failed_${s.backupDir().split(/[\\/]/).pop()}`]);
    assert.equal((await s.q<{ c: bigint }>(`SELECT count(*) AS c FROM "_prisma_migrations"`))[0]!.c, 1n);
    assert.equal(s.state("induscost.service"), "active");
    assertSchedulersRestored(s);
  });

  it("E4. migration compatível, aplicação escreveu e caiu: banco MANTIDO com a escrita, código anterior no ar", async () => {
    const s = await server({ "prisma/migrations/20261101120000_color/migration.sql": `ALTER TABLE "Item" ADD COLUMN "color" TEXT;\n`, HEALTH: "erro", APP_WRITES: "1" });
    const r = s.run("");
    assert.notEqual(r.code, 0);
    assert.match(r.out, /banco MANTIDO/, r.out);
    assert.equal(s.head(), s.c0);
    assert.deepEqual(await s.columns(), ["color", "id", "legacy", "name"]);
    assert.equal((await s.q<{ c: bigint }>(`SELECT count(*) AS c FROM "Item" WHERE name = 'escrita-da-aplicacao'`))[0]!.c, 1n);
    assert.deepEqual(await s.dbs(), [s.dbName]);
    assert.equal(s.state("induscost.service"), "active");
    assertSchedulersRestored(s);
  });

  it("E5. migration incompatível, aplicação escreveu e caiu: BLOQUEIO (2) — nada destrutivo, dados preservados; recover encerra a janela", async () => {
    const s = await server({ "prisma/migrations/20261101120000_drop/migration.sql": `ALTER TABLE "Item" DROP COLUMN "legacy";\n`, HEALTH: "erro", APP_WRITES: "1" });
    const r = s.run("");
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /BLOQUEIO/);
    assert.match(r.out, /deploy-induscost-teste --restore-backup/);
    assert.equal(s.head(), s.c1, "código novo mantido até a decisão");
    assert.deepEqual(await s.columns(), ["id", "name"]);
    assert.equal((await s.q<{ c: bigint }>(`SELECT count(*) AS c FROM "Item" WHERE name = 'escrita-da-aplicacao'`))[0]!.c, 1n);
    assert.deepEqual(await s.dbs(), [s.dbName]);
    assert.equal(s.state("induscost.service"), "inactive");
    assert.equal(await s.lockOn(), 1);
    assert.deepEqual(readdirSync(s.cron), ["outro-sistema"], "agendamentos do IndusCost continuam pausados");
    const blocked = s.run("");
    assert.equal(blocked.code, 46, "novo deploy recusado com a janela aberta");
    const rec = s.run("--recover --resume");
    assert.equal(rec.code, 0, rec.out);
    assert.equal(await s.lockOn(), 0);
    assertSchedulersRestored(s);
  });

  it("E6. executor morto no meio (durante os testes): próximo deploy recusa (46); --recover --resume devolve o estado anterior", async () => {
    const s = await server({ "src/a.test.ts": "HANG\n" });
    const child = spawn(BASH!, ["-c", `"${posix(s.executorPath)}"`], { cwd: s.w, env: { ...process.env, ...s.env }, stdio: "ignore" });
    const chainFile = join(s.w, "systemd", "executor-chain");
    for (let i = 0; i < 1200 && !existsSync(chainFile); i++) await new Promise((res) => setTimeout(res, 100));
    assert.ok(existsSync(chainFile), "executor chegou aos testes");
    // Queda abrupta (SIGKILL, sem traps) de toda a cadeia do executor.
    spawnSync(BASH!, ["-c", `kill -9 ${readFileSync(chainFile, "utf8").trim()} 2>/dev/null; true`]);
    child.kill("SIGKILL");
    await new Promise((res) => setTimeout(res, 1000));
    assert.equal(await s.lockOn(), 1, "queda deixou a trava ligada");
    assert.ok(existsSync(join(s.w, "state", "maintenance.state")));
    const again = s.run("");
    assert.equal(again.code, 46, again.out);
    assert.match(again.out, /deploy interrompido/);
    const rec = s.run("--recover --resume");
    assert.equal(rec.code, 0, rec.out);
    assert.equal(await s.lockOn(), 0);
    assertSchedulersRestored(s);
  });

  it("E7. --check não altera nada (cluster, disco e escopo conferidos; hooks listados, não executados)", async () => {
    const s = await server({ "prisma/migrations/20261101120000_color/migration.sql": `ALTER TABLE "Item" ADD COLUMN "color" TEXT;\n` });
    const r = s.run("--check");
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /Migrations novas: 1 20261101120000_color/);
    assert.match(r.out, /cluster conferido: PostgreSQL 17, porta \d+/);
    assert.match(r.out, /escopo da janela conferido/);
    assert.match(r.out, /Hooks prévios:/);
    assert.equal(s.head(), s.c0);
    assert.deepEqual(await s.columns(), ["id", "legacy", "name"]);
    assert.ok(!existsSync(join(s.w, "backups")));
    assert.equal(s.state("induscost-legal-djen.timer"), "active");
  });

  it("E8. --stop durante os testes: SIGTERM só à árvore do executor; rollback controlado (código anterior, serviço de volta, janela encerrada); saída 143", async () => {
    const s = await server({ "src/a.test.ts": "HANG\n" });
    const bg = s.runAsync("");
    assert.ok(await s.waitFor(join(s.sysd, "executor-chain")), "executor chegou aos testes");
    assert.ok(existsSync(join(s.w, "deploy.pid")), "pidfile gravado");
    const stop = s.run("--stop");
    assert.equal(stop.code, 0, stop.out);
    assert.match(stop.out, /SIGTERM enviado ao executor/);
    const code = await Promise.race([bg.done, new Promise<number | null>((res) => setTimeout(() => res(-1), 120_000))]);
    assert.equal(code, 143, bg.log());
    assert.match(bg.log(), /SIGTERM recebido/);
    assert.match(bg.log(), /interrompido por SIGTERM/);
    assert.match(bg.log(), /ROLLBACK AUTOMÁTICO CONCLUÍDO/);
    assert.equal(s.head(), s.c0);
    assert.equal(s.state("induscost.service"), "active");
    assert.equal(await s.lockOn(), 0);
    assert.ok(!existsSync(join(s.w, "deploy.pid")), "pidfile removido");
    assertSchedulersRestored(s);
    assert.equal(s.run("--stop").code, 1, "sem executor em andamento");
  });

  it("E9. --abort-hard (queda simulada: SIGKILL na árvore) deixa a janela; próximo deploy recusa (46); --recover --rollback conclui pelo rollback normal", async () => {
    const s = await server({ "prisma/migrations/20261101120000_color/migration.sql": `ALTER TABLE "Item" ADD COLUMN "color" TEXT;\n`, "src/a.test.ts": "HANG\n" });
    const bg = s.runAsync("");
    assert.ok(await s.waitFor(join(s.sysd, "executor-chain")), "executor chegou aos testes");
    const abort = s.run("--abort-hard");
    assert.equal(abort.code, 0, abort.out);
    assert.match(abort.out, /simulação de queda/);
    await Promise.race([bg.done, new Promise((res) => setTimeout(res, 15_000))]);
    assert.equal(await s.lockOn(), 1, "queda deixou a trava ligada");
    assert.ok(existsSync(join(s.w, "state", "maintenance.state")));
    assert.match(readFileSync(join(s.w, "state", "maintenance.state"), "utf8"), /^deploy .*backups/m, "janela registra o backup do deploy");
    assert.equal(s.head(), s.c1, "código novo no checkout");
    const again = s.run("");
    assert.equal(again.code, 46, again.out);
    assert.match(again.out, /--recover --rollback/);
    const status = s.run("--recover");
    assert.equal(status.code, 46, status.out);
    const rb = s.run("--recover --rollback");
    assert.equal(rb.code, 0, rb.out);
    assert.match(rb.out, /banco não foi alterado por este deploy/);
    assert.match(rb.out, /ROLLBACK AUTOMÁTICO CONCLUÍDO/);
    assert.equal(s.head(), s.c0);
    assert.deepEqual(await s.columns(), ["id", "legacy", "name"]);
    assert.equal(s.state("induscost.service"), "active");
    assert.equal(await s.lockOn(), 0);
    assertSchedulersRestored(s);
  });

  it("E10. hooks por fase: prévio falha → 9 e nada muda; prévio OK recebe o contexto; pós-subida falha → rollback (44); política warn segue; hook inválido → 3", async () => {
    const dir = join(root, "hooks");
    const fail = hook(dir, "falha.sh", 7);
    const ok = hook(dir, "ok.sh", 0);
    const s1 = await server({ "src/a.test.ts": "pass 2\n" }, { HOOKS_PRE_DEPLOY: fail.path });
    const r1 = s1.run("");
    assert.equal(r1.code, 9, r1.out);
    assert.match(r1.out, /verificação prévia falhou/);
    assert.equal(s1.head(), s1.c0);
    assert.ok(!existsSync(join(s1.w, "backups")));
    assert.equal(s1.state("induscost.service"), "active");
    assert.ok(!existsSync(join(s1.w, "state", "maintenance.state")));
    assert.match(fail.log(), /fase=HOOKS_PRE_DEPLOY/);

    const s2 = await server({ "src/a.test.ts": "pass 2\n" }, { HOOKS_PRE_DEPLOY: ok.path, HOOKS_POST_START: fail.path, HOOKS_POST_ROLLBACK: ok.path });
    const r2 = s2.run("");
    assert.equal(r2.code, 44, r2.out);
    assert.match(r2.out, /verificação pós-subida falhou/);
    assert.match(r2.out, /ROLLBACK AUTOMÁTICO CONCLUÍDO/);
    assert.equal(s2.head(), s2.c0);
    assert.equal(s2.state("induscost.service"), "active");
    assert.match(ok.log(), new RegExp(`fase=HOOKS_PRE_DEPLOY alvo=${s2.c1} anterior=${s2.c0} backup=\\n`));
    assert.match(ok.log(), new RegExp(`fase=HOOKS_POST_ROLLBACK alvo=${s2.c1} anterior=${s2.c0} backup=\\S+backups`));
    assert.match(fail.log(), /fase=HOOKS_POST_START/);
    assertSchedulersRestored(s2);

    const s3 = await server({ "src/a.test.ts": "pass 2\n" }, { HOOKS_POST_START: fail.path, HOOKS_POST_START_FAILURE: "warn" });
    const r3 = s3.run("");
    assert.equal(r3.code, 0, r3.out);
    assert.match(r3.out, /HOOKS_POST_START_FAILURE=warn/);
    assert.equal(s3.head(), s3.c1);

    const s4 = await server({ "src/a.test.ts": "pass 2\n" }, { HOOKS_PRE_DEPLOY: "relativo/hook.sh" });
    const r4 = s4.run("--check");
    assert.equal(r4.code, 3, r4.out);
    assert.match(r4.out, /não é um executável com caminho absoluto/);
  });

  it("E11. cluster diferente do configurado (versão maior ou socket): recusa (50) antes de parar o serviço ou criar backup", async () => {
    const s1 = await server({ "src/a.test.ts": "pass 2\n" }, { IDS_PG_EXPECT_MAJOR: "16" });
    const r1 = s1.run("");
    assert.equal(r1.code, 50, r1.out);
    assert.match(r1.out, /cluster conectado é PostgreSQL 17; esperado 16/);
    assert.ok(!existsSync(join(s1.w, "backups")));
    assert.equal(s1.state("induscost.service"), "active");
    assert.doesNotMatch(s1.calls(), /systemctl stop/);
    const s2 = await server({ "src/a.test.ts": "pass 2\n" }, { IDS_PG_HOST: "/run/induscost-pg17-inexistente" });
    const r2 = s2.run("--check");
    assert.equal(r2.code, 50, r2.out);
    assert.match(r2.out, /sem conexão administrativa com o cluster/);
    assert.doesNotMatch(s2.calls(), /systemctl stop/);
  });

  it("E12. espaço em disco insuficiente para a restauração: recusa (51) antes de qualquer ação", async () => {
    const s = await server({ "src/a.test.ts": "pass 2\n" }, { IDS_DISK_DATA_FACTOR: "1000000000" });
    const r = s.run("");
    assert.equal(r.code, 51, r.out);
    assert.match(r.out, /a restauração de app\d+ exige/);
    assert.ok(!existsSync(join(s.w, "backups")));
    assert.doesNotMatch(s.calls(), /systemctl stop/);
  });

  it("E13. UNIT_GLOB que casa unidade protegida ou de outro ambiente: recusa (52) antes de parar o serviço; banco protegido nunca é o alvo (50)", async () => {
    const s = await server({ "src/a.test.ts": "pass 2\n" }, { PROTECTED_UNITS: "'induscost-db-backup.timer'" });
    writeFileSync(join(s.sysd, "induscost-db-backup.timer"), "active");
    writeFileSync(join(s.sysd, "induscost-db-backup.timer.show"), "Unit=induscost-db-backup.service\n");
    writeFileSync(join(s.sysd, "induscost-db-backup.service.show"), "ExecStart={ path=/usr/bin/pg_dump ; argv[]=/usr/bin/pg_dump -p 5432 teste_bi }\nWorkingDirectory=/var/lib/postgresql\n");
    const r = s.run("");
    assert.equal(r.code, 52, r.out);
    assert.match(r.out, /unidade protegida induscost-db-backup\.timer/);
    assert.doesNotMatch(s.calls(), /systemctl stop/);
    assert.ok(!existsSync(join(s.w, "backups")));
    assert.equal(s.state("induscost-db-backup.timer"), "active");
    const s2 = await server({ "src/a.test.ts": "pass 2\n" }, { PROTECTED_DATABASES: `'app${n + 1} outro'` });
    const r2 = s2.run("--check");
    assert.equal(r2.code, 50, r2.out);
    assert.match(r2.out, /está em IDS_PROTECTED_DATABASES/);
  });

  it("I1. instalação: --verify confere; biblioteca adulterada → executor recusa (4) e --verify reprova; --uninstall devolve o executor antigo byte a byte", async () => {
    const s = await server({ "src/a.test.ts": "pass 2\n" });
    assert.equal(s.install("--verify").code, 0);
    const release = readFileSync(join(s.w, "lib", "teste.current"), "utf8").trim();
    const libFile = join(release.replace(/^\/([a-z])\//, (_m, d: string) => `${d.toUpperCase()}:/`), "induscost-deploy-safety.sh");
    chmodSync(libFile, 0o644);
    writeFileSync(libFile, readFileSync(libFile, "utf8") + "\n# alterado\n");
    const r = s.run("--check");
    assert.equal(r.code, 4, r.out);
    assert.equal(s.install("--verify").code, 1);
    const un = s.install("--uninstall");
    assert.equal(un.code, 0, un.out);
    assert.equal(readFileSync(s.executorPath, "utf8"), "#!/usr/bin/env bash\necho executor antigo\n");
  });

  it("E14. janela não abre (sessão estranha no banco): aborta com o código real (41), serviço religado, trava removida, RESULTADO: ABORTADO", async () => {
    const s = await server({ "src/a.test.ts": "pass 2\n" });
    const holder = new PrismaClient({ datasourceUrl: `${db.url.replace(/\/postgres\?/, `/${s.dbName}?`)}&application_name=bi-metabase` });
    await holder.$queryRawUnsafe(`SELECT 1`);
    try {
      const r = s.run("");
      assert.equal(r.code, 41, r.out);
      assert.match(r.out, /bi-metabase/);
      assert.match(r.out, /janela de manutenção não abriu \(RC=41\)/);
      assert.match(r.out, /RESULTADO: ABORTADO \(janela\) .* rc=41/);
      assert.equal(s.head(), s.c0);
      assert.equal(s.state("induscost.service"), "active");
      assert.ok(!existsSync(join(s.w, "state", "maintenance.state")));
    } finally {
      await holder.$disconnect();
    }
    assert.equal(await s.lockOn(), 0);
    assertSchedulersRestored(s);
  });

  it("E15. --recover --rollback com git reset impossível (index.lock órfão): código NÃO reinstalado, serviço NÃO religado, janela mantida; removido o lock, conclui", async () => {
    const s = await server({ "src/a.test.ts": "HANG\n" });
    const bg = s.runAsync("");
    assert.ok(await s.waitFor(join(s.sysd, "executor-chain")), "executor chegou aos testes");
    assert.equal(s.run("--abort-hard").code, 0);
    await Promise.race([bg.done, new Promise((res) => setTimeout(res, 15_000))]);
    writeFileSync(join(s.app, ".git", "index.lock"), "");
    const rb = s.run("--recover --rollback");
    assert.notEqual(rb.code, 0, rb.out);
    assert.match(rb.out, /git reset --hard .* falhou/);
    assert.match(rb.out, /index\.lock existe/);
    assert.match(rb.out, /RESULTADO: RETOMADA INCOMPLETA/);
    assert.equal(s.head(), s.c1, "código não revertido");
    assert.equal(s.state("induscost.service"), "inactive", "serviço não religado com o código errado");
    assert.ok(existsSync(join(s.w, "state", "maintenance.state")), "janela mantida");
    rmSync(join(s.app, ".git", "index.lock"));
    const ok = s.run("--recover --rollback");
    assert.equal(ok.code, 0, ok.out);
    assert.equal(s.head(), s.c0);
    assert.equal(s.state("induscost.service"), "active");
    assertSchedulersRestored(s);
  });

  it("E16. DATABASE_URL da aplicação apontando para outro banco: recusa (58) antes de qualquer ação, inclusive em --check", async () => {
    const s = await server({ "src/a.test.ts": "pass 2\n" });
    await admin.$executeRawUnsafe(`CREATE DATABASE "outro${n}"`);
    writeFileSync(join(s.app, ".env"), `DATABASE_URL="${db.url.replace(/\/postgres\?/, `/outro${n}?`)}"\n`);
    const r = s.run("--check");
    assert.equal(r.code, 58, r.out);
    assert.match(r.out, new RegExp(`aponta para banco=outro${n}`));
    assert.match(r.out, /RESULTADO: RECUSADO \(DATABASE_URL da aplicação\)/);
    assert.doesNotMatch(s.calls(), /systemctl (stop|start)/, "só leituras do systemd (escopo da janela) antes da recusa");
    assert.ok(!existsSync(join(s.w, "backups")));
  });

  it("E17. --restore-backup após BLOQUEIO: só sob BACKUP_ROOT, só com backup-meta do mesmo banco; restaura, preserva __failed_, --recover --resume encerra", async () => {
    const s = await server({ "prisma/migrations/20261101120000_drop/migration.sql": `ALTER TABLE "Item" DROP COLUMN "legacy";\n`, HEALTH: "erro", APP_WRITES: "1" });
    assert.equal(s.run("").code, 2);
    const dir = s.backupDir();
    const outside = join(s.w, "fora");
    mkdirSync(outside, { recursive: true });
    for (const f of readdirSync(dir)) writeFileSync(join(outside, f), readFileSync(join(dir, f)));
    const far = s.run(`--restore-backup "${posix(outside)}"`);
    assert.equal(far.code, 3, far.out);
    assert.match(far.out, /não está sob/);
    const meta = readFileSync(join(dir, "backup-meta.txt"), "utf8");
    writeFileSync(join(dir, "backup-meta.txt"), "env=teste|db=outro|sysid=0|version=0\n");
    const wrong = s.run(`--restore-backup "${posix(dir)}"`);
    assert.equal(wrong.code, 33, wrong.out);
    assert.match(wrong.out, /backup de outro banco\/cluster/);
    assert.deepEqual(await s.columns(), ["id", "name"], "nada restaurado");
    writeFileSync(join(dir, "backup-meta.txt"), meta);
    const ok = s.run(`--restore-backup "${posix(dir)}"`);
    assert.equal(ok.code, 0, ok.out);
    assert.match(ok.out, /Restauração manual RC=0/);
    assert.deepEqual(await s.columns(), ["id", "legacy", "name"]);
    assert.deepEqual(await s.dbs(), [s.dbName, `${s.dbName}__failed_${dir.split(/[\\/]/).pop()}`]);
    assert.equal(s.run("--recover --resume").code, 0);
    assert.equal(await s.lockOn(), 0);
    assertSchedulersRestored(s);
  });

  it("E18. globs malformados (espaço, sufixo .timer) e PROTECTED_* = none: recusa (3) / aceito", async () => {
    const s1 = await server({ "src/a.test.ts": "pass 2\n" }, { UNIT_GLOB: "'induscost-*.timer'" });
    const r1 = s1.run("--check");
    assert.equal(r1.code, 3, r1.out);
    assert.match(r1.out, /sem sufixo \.timer/);
    const s2 = await server({ "src/a.test.ts": "pass 2\n" }, { CRON_GLOB: "'induscost* outro*'" });
    const r2 = s2.run("--check");
    assert.equal(r2.code, 3, r2.out);
    assert.match(r2.out, /um único padrão/);
    const s3 = await server({ "src/a.test.ts": "pass 2\n" }, { PROTECTED_DATABASES: "none", PROTECTED_UNITS: "none" });
    assert.equal(s3.run("--check").code, 0);
  });

  it("I3. instalador confere o sha256 do executor antigo: diferente → recusa (3) e nada muda; igual → instala, --verify confere o guardado; --uninstall recusa se o arquivo já não é o wrapper", async () => {
    const s = await server({ "src/a.test.ts": "pass 2\n" });
    const u0 = s.install("--uninstall"); assert.equal(u0.code, 0, u0.out);
    const old = readFileSync(s.executorPath);
    const { createHash } = await import("node:crypto");
    const sha = createHash("sha256").update(old).digest("hex");
    const setSha = (v: string) => writeFileSync(s.envFile, readFileSync(s.envFile, "utf8").replace(/^EXECUTOR_EXPECTED_SHA256=.*$/m, `EXECUTOR_EXPECTED_SHA256=${v}`));
    setSha("0000000000000000000000000000000000000000000000000000000000000000");
    const bad = s.install("--apply --replace-env");
    assert.equal(bad.code, 3, bad.out);
    assert.match(bad.out, /não é o executor auditado/);
    assert.equal(readFileSync(s.executorPath, "utf8"), old.toString("utf8"), "executor antigo intocado");
    setSha(sha);
    const good = s.install("--apply --replace-env");
    assert.equal(good.code, 0, good.out);
    assert.match(good.out, /é o executor auditado \(sha256 confere\)/);
    assert.match(good.out, /executor antigo guardado em .* \(sha256 confere\)/);
    const ck = s.run("--check"); assert.equal(ck.code, 0, ck.out);
    // Reinstalação (--replace-env) guarda o wrapper anterior; um único --uninstall desfaz a cadeia até o executor antigo.
    writeFileSync(s.envFile, `${readFileSync(s.envFile, "utf8")}# reinstalação\n`);
    const again = s.install("--apply --replace-env");
    assert.equal(again.code, 0, again.out);
    assert.match(again.out, /wrapper de uma instalação anterior/);
    const chain = s.install("--uninstall");
    assert.equal(chain.code, 0, chain.out);
    assert.match(chain.out, /2 instalação\(ões\) desfeita\(s\)/);
    assert.equal(readFileSync(s.executorPath, "utf8"), old.toString("utf8"), "executor antigo de volta byte a byte");
    const re = s.install("--apply --replace-env");
    assert.equal(re.code, 0, re.out);
    assert.match(re.out, /já instalada e íntegra: reutilizada/);
    writeFileSync(s.executorPath, "#!/usr/bin/env bash\necho outro\n");
    const un = s.install("--uninstall");
    assert.equal(un.code, 3, un.out);
    assert.match(un.out, /já não é o wrapper desta instalação/);
  });

  // --- hooks do servidor-01 (infra/deploy/hooks/servidor01-checks.sh) instalados na release e chamados pelo executor ---
  const SHA_AWS = "0123456789abcdef0123456789abcdef01234567";
  const GATEWAY_KEY = "http___192_168_100_5_3000_api_health";
  const AWS_KEY = "http___100_85_97_124_3000_api_health";
  const hookEnv = (extra: Record<string, string> = {}) => ({
    HOOKS_PRE_DEPLOY: "@release/hooks/servidor01-checks.sh",
    HOOKS_POST_START: "@release/hooks/servidor01-checks.sh",
    HOOKS_POST_ROLLBACK: "@release/hooks/servidor01-checks.sh",
    HOOK_RUNTIME_ROLE_CMD: posix(join(stubs, "runtime-role")),
    HOOK_RUNTIME_ROLE_EXPECTED: "CLOUD_PRIMARY",
    HOOK_RUNTIME_ROLE_CHECK_ARGS: "none",
    HOOK_LOCAL_PROD_SERVICE: "producao-local.service",
    HOOK_NGINX_SERVICE: "nginx.service",
    HOOK_GATEWAY_HEALTH: "http://192.168.100.5:3000/api/health",
    HOOK_AWS_HEALTH: "http://100.85.97.124:3000/api/health",
    HOOK_AWS_SSH_TARGET: "deploy@aws-prod",
    HOOK_AWS_APP_DIR: "/opt/induscost",
    HOOK_CNPJ_URLS: "'https://brasilapi.com.br/ https://publica.cnpj.ws/'",
    HOOK_CURL: posix(join(stubs, "hook-curl")),
    HOOK_SSH: posix(join(stubs, "hook-ssh")),
    HOOK_RETRY_DELAY: "0",
    HOOK_HTTP_ATTEMPTS: "2",
    ...extra,
  });
  const hookServer = async (c1: Record<string, string | null>, extra: Record<string, string> = {}) => {
    const s = await server(c1, hookEnv(extra));
    writeFileSync(join(s.sysd, "nginx.service"), "active");
    // systemctl show simulado: a produção local existe (LoadState) e o serviço não tem restrição de egress.
    writeFileSync(join(s.sysd, "producao-local.service.show"), "loaded\n");
    writeFileSync(join(s.sysd, "induscost.service.show"), "IPAddressDeny=\nIPAddressAllow=\n");
    const hookCalls = () => (existsSync(join(s.sysd, "hook-calls")) ? readFileSync(join(s.sysd, "hook-calls"), "utf8") : "");
    const contexts = () => (existsSync(join(s.w, "state", "hook-context")) ? readdirSync(join(s.w, "state", "hook-context")) : []);
    return { ...s, hookCalls, contexts };
  };
  /** O hook só leu: systemctl is-active/show, ssh com o git rev-parse fixo, nada que altere nginx/egress. */
  const assertHookReadOnly = (s: { calls: () => string; hookCalls: () => string }) => {
    assert.doesNotMatch(s.calls(), /systemctl (stop|start|restart|reload|enable|disable|set-property|daemon-reload) (nginx|producao-local)/);
    for (const l of s.hookCalls().split("\n").filter((x) => x.startsWith("ssh "))) assert.match(l, / deploy@aws-prod git -C '\/opt\/induscost' rev-parse --verify HEAD$/, l);
    assert.doesNotMatch(s.hookCalls(), /update-induscost-homolog-egress/);
  };

  it("X1. hooks do servidor-01 na release (@release): deploy OK; contexto próprio da execução (id no backup), commit AWS registrado antes e conferido depois; só leituras", async () => {
    const s = await hookServer({ "src/a.test.ts": "pass 2\n" });
    const r = s.run("");
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /--- hook HOOKS_PRE_DEPLOY: \S+\/hooks\/servidor01-checks\.sh OK/);
    assert.match(r.out, /--- hook HOOKS_POST_START: \S+\/hooks\/servidor01-checks\.sh OK/);
    assert.match(r.out, /commit da produção AWS inalterado durante o deploy/);
    assert.match(r.out, /RESULTADO: DEPLOY CONCLUÍDO ambiente=teste rc=0/);
    const runId = readFileSync(join(s.backupDir(), "deploy-run-id"), "utf8").trim();
    assert.match(runId, /^\d{8}T\d{6}Z-\d+-[0-9a-f]+$/);
    assert.deepEqual(s.contexts(), [runId], "um contexto por execução");
    const before = readFileSync(join(s.w, "state", "hook-context", runId, "aws-commit.before"), "utf8");
    assert.match(before, new RegExp(`^run_id=${runId}$`, "m"));
    assert.match(before, new RegExp(`^target=${s.c1}$`, "m"));
    assert.match(before, new RegExp(`^old_commit=${s.c0}$`, "m"));
    assert.match(before, new RegExp(`^aws_commit=${SHA_AWS}$`, "m"));
    assert.ok(existsSync(join(s.w, "state", "hook-context", runId, "aws-commit.after-HOOKS_POST_START")));
    assert.equal(s.head(), s.c1);
    assertHookReadOnly(s);
    // Segundo deploy (nada para instalar) não reaproveita contexto; --check não executa hooks nem cria contexto.
    assert.equal(s.run("--check").code, 0);
    assert.deepEqual(s.contexts(), [runId]);
  });

  it("X2. gateway ou AWS indisponível antes do deploy: recusa (9) antes de qualquer alteração — sem backup, serviço ativo, sem janela, nada registrado", async () => {
    for (const down of [GATEWAY_KEY, AWS_KEY]) {
      const s = await hookServer({ "prisma/migrations/20261101120000_color/migration.sql": `ALTER TABLE "Item" ADD COLUMN "color" TEXT;\n` });
      writeFileSync(join(s.sysd, `hook-down-${down}`), "");
      const r = s.run("");
      assert.equal(r.code, 9, r.out);
      assert.match(r.out, down === GATEWAY_KEY ? /FALHA crítica: gateway indisponível/ : /FALHA crítica: produção AWS indisponível/);
      assert.match(r.out, /RESULTADO: ABORTADO \(hook prévio\)/);
      assert.equal(s.head(), s.c0);
      assert.deepEqual(await s.columns(), ["id", "legacy", "name"]);
      assert.ok(!existsSync(join(s.w, "backups")), "nenhum backup");
      assert.ok(!existsSync(join(s.w, "state", "maintenance.state")), "janela não abriu");
      assert.equal(s.state("induscost.service"), "active");
      assert.doesNotMatch(s.calls(), /systemctl stop/);
      const [ctx] = s.contexts();
      assert.ok(ctx && !existsSync(join(s.w, "state", "hook-context", ctx, "aws-commit.before")), "sem registro quando a crítica falha");
      assertSchedulersRestored(s);
    }
  });

  it("X3. commit da produção AWS muda durante o deploy: concluído SEM rollback (59) — código novo no ar, janela encerrada, nenhuma ação na AWS", async () => {
    const s = await hookServer({ "src/a.test.ts": "pass 2\n" });
    writeFileSync(join(s.sysd, "aws-sha-2"), "fedcba9876543210fedcba9876543210fedcba98\n");
    const r = s.run("");
    assert.equal(r.code, 59, r.out);
    assert.match(r.out, /ALTERAÇÃO INESPERADA no commit da produção AWS: antes do deploy 0123456789abcdef0123456789abcdef01234567, agora fedcba98/);
    assert.match(r.out, /ALERTA: hook HOOKS_POST_START: .* reportou falha que não pede rollback \(RC=10\)/);
    assert.match(r.out, /RESULTADO: DEPLOY CONCLUÍDO COM ALERTA \(hook pós-subida; sem rollback\) ambiente=teste rc=59/);
    assert.doesNotMatch(r.out, /ROLLBACK/);
    assert.equal(s.head(), s.c1);
    assert.equal(s.state("induscost.service"), "active");
    assert.equal(await s.lockOn(), 0);
    assertSchedulersRestored(s);
    assert.ok(existsSync(join(s.backupDir(), "hook-alert")));
    assert.equal(s.hookCalls().split("\n").filter((l) => l.startsWith("ssh ")).length, 2, "duas leituras do commit, nenhuma outra chamada à AWS");
    assertHookReadOnly(s);
  });

  it("X4. execução após rollback: build falha → rollback → hook pós-rollback compara com o registro da MESMA execução; CNPJ indisponível só avisa; queda + --recover --rollback recupera o contexto pelo backup", async () => {
    const s = await hookServer({ BUILD_FAIL: "1", "src/a.test.ts": "pass 2\n" });
    writeFileSync(join(s.sysd, "hook-down-https___brasilapi_com_br_"), "");
    const r = s.run("");
    assert.notEqual(r.code, 0, r.out);
    assert.match(r.out, /ROLLBACK AUTOMÁTICO CONCLUÍDO/);
    assert.match(r.out, /ATENÇÃO CNPJ: https:\/\/brasilapi\.com\.br\/ indisponível/);
    assert.match(r.out, /--- hook HOOKS_POST_ROLLBACK: \S+servidor01-checks\.sh OK/);
    assert.match(r.out, /Hooks RC: {6}0 \(HOOKS_POST_ROLLBACK/);
    const runId = readFileSync(join(s.backupDir(), "deploy-run-id"), "utf8").trim();
    assert.ok(existsSync(join(s.w, "state", "hook-context", runId, "aws-commit.after-HOOKS_POST_ROLLBACK")), "pós-rollback usou o contexto desta execução");
    assert.equal(s.head(), s.c0);
    assert.equal(s.state("induscost.service"), "active");
    assertHookReadOnly(s);

    const k = await hookServer({ "src/a.test.ts": "HANG\n" });
    const bg = k.runAsync("");
    assert.ok(await k.waitFor(join(k.sysd, "executor-chain")), "executor chegou aos testes");
    assert.equal(k.run("--abort-hard").code, 0);
    await Promise.race([bg.done, new Promise((res) => setTimeout(res, 15_000))]);
    const kid = readFileSync(join(k.backupDir(), "deploy-run-id"), "utf8").trim();
    const rb = k.run("--recover --rollback");
    assert.equal(rb.code, 0, rb.out);
    assert.match(rb.out, /--- hook HOOKS_POST_ROLLBACK: \S+servidor01-checks\.sh OK/);
    assert.match(rb.out, /commit da produção AWS inalterado/);
    assert.ok(existsSync(join(k.w, "state", "hook-context", kid, "aws-commit.after-HOOKS_POST_ROLLBACK")), "retomada usou o contexto da execução interrompida");
    assert.deepEqual(k.contexts(), [kid], "a retomada não cria outro contexto");
    assert.equal(k.head(), k.c0);
  });

  it("X5. atualizador de egress listado como hook: recusado (3) sem executar; hook da release adulterado: executor recusa (4) antes de qualquer hook", async () => {
    const dir = join(root, "egress");
    mkdirSync(dir, { recursive: true });
    const updater = join(dir, "update-induscost-homolog-egress");
    writeFileSync(updater, `#!/usr/bin/env bash\ntouch "$(dirname "$0")/EXECUTADO"\n`);
    chmodSync(updater, 0o755);
    const s = await hookServer({ "src/a.test.ts": "pass 2\n" }, { HOOKS_POST_START: posix(updater) });
    for (const args of ["--check", ""]) {
      const r = s.run(args);
      assert.equal(r.code, 3, r.out);
      assert.match(r.out, /altera drop-in\/egress e reinicia o serviço; não pode ser hook/);
    }
    assert.ok(!existsSync(join(dir, "EXECUTADO")));
    assert.equal(s.head(), s.c0);

    const t = await hookServer({ "src/a.test.ts": "pass 2\n" });
    const release = readFileSync(join(t.w, "lib", "teste.current"), "utf8").trim().replace(/^\/([a-z])\//, (_m, d: string) => `${d.toUpperCase()}:/`);
    const hook = join(release, "hooks", "servidor01-checks.sh");
    chmodSync(hook, 0o755);
    writeFileSync(hook, readFileSync(hook, "utf8").replace("set -Euo pipefail", "set -Euo pipefail\nexit 0"));
    const r = t.run("");
    assert.equal(r.code, 4, r.out);
    assert.match(r.out, /instalação adulterada/);
    assert.equal(t.hookCalls(), "", "nenhum hook executado");
    assert.equal(t.head(), t.c0);
  });

  it("X6. serviço parado antes do deploy (if-was-active): hooks pós-subida rodam mesmo assim e o commit AWS alterado termina em 59 (serviço segue parado); retomada com ALERTA pós-rollback termina em 59", async () => {
    const s = await hookServer({ "src/a.test.ts": "pass 2\n" });
    writeFileSync(join(s.sysd, "induscost.service"), "inactive");
    writeFileSync(join(s.sysd, "aws-sha-2"), "fedcba9876543210fedcba9876543210fedcba98\n");
    const r = s.run("");
    assert.equal(r.code, 59, r.out);
    assert.match(r.out, /mantido parado \(START_SERVICE_POLICY=if-was-active\); health NÃO executado/);
    assert.match(r.out, /ALTERAÇÃO INESPERADA no commit da produção AWS/);
    assert.match(r.out, /ALERTA: verificação pós-deploy falhou \(RC=10\) com induscost\.service mantido parado/);
    assert.match(r.out, /RESULTADO: DEPLOY CONCLUÍDO COM ALERTA/);
    assert.equal(s.head(), s.c1);
    assert.equal(s.state("induscost.service"), "inactive", "serviço continua parado");
    assert.equal(await s.lockOn(), 0);

    const k = await hookServer({ "src/a.test.ts": "HANG\n" });
    writeFileSync(join(k.sysd, "aws-sha-2"), "fedcba9876543210fedcba9876543210fedcba98\n");
    const bg = k.runAsync("");
    assert.ok(await k.waitFor(join(k.sysd, "executor-chain")), "executor chegou aos testes");
    assert.equal(k.run("--abort-hard").code, 0);
    await Promise.race([bg.done, new Promise((res) => setTimeout(res, 15_000))]);
    const rb = k.run("--recover --rollback");
    assert.equal(rb.code, 59, rb.out);
    assert.match(rb.out, /ROLLBACK AUTOMÁTICO CONCLUÍDO/);
    assert.match(rb.out, /RESULTADO: ROLLBACK CONCLUÍDO COM ALERTA \(retomada; hook pós-rollback\)/);
    assert.equal(k.head(), k.c0);
    assert.equal(k.state("induscost.service"), "active");
    assertHookReadOnly(k);
  });

  it("I2. ambiente com A_COLETAR: instalação recusada e executor recusa rodar (3)", async () => {
    const s = await server({ "src/a.test.ts": "pass 2\n" });
    const envFile = s.env.IDS_INSTALL_ENV_SOURCE.replace(/^\/([a-z])\//, (_m, d: string) => `${d.toUpperCase()}:/`);
    writeFileSync(envFile, readFileSync(envFile, "utf8").replace("START_SERVICE_POLICY=if-was-active", "START_SERVICE_POLICY=A_COLETAR"));
    const inst = s.install("--apply --replace-env");
    assert.equal(inst.code, 3, inst.out);
    const etcEnv = join(s.w, "etc", "deploy-executor-teste.env");
    writeFileSync(etcEnv, readFileSync(envFile, "utf8"));
    const r = s.run("--check");
    assert.equal(r.code, 3, r.out);
    assert.match(r.out, /START_SERVICE_POLICY/);
  });
});
