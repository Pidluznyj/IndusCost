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
  async function server(c1: Record<string, string | null>) {
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
    writeFileSync(
      envFile,
      [
        `IDS_ENV_NAME=teste`,
        `EXECUTOR_PATH=${posix(executorPath)}`,
        `APP=${posix(app)}`,
        `SERVICE=induscost.service`,
        `DB=${dbName}`,
        `HEALTH=http://127.0.0.1:9/api/health`,
        `BACKUP_ROOT=${posix(join(w, "backups", "deploys"))}`,
        `LOCK=${posix(join(w, "deploy.lock"))}`,
        `GIT_REMOTE=origin`,
        `DEFAULT_TARGET=origin/main`,
        `MODE_FILE=${posix(join(w, "deploy-mode"))}`,
        `EXPECTED_MODE=production`,
        `PRECUTOVER_DROPIN=${posix(join(w, "10-precutover-isolation.conf"))}`,
        `PRECUTOVER_EXPECTED=absent`,
        `START_SERVICE_POLICY=if-was-active`,
        `APP_MARK_PATTERN=${posix(app)}`,
        `CRON_GLOB='induscost*'`,
        `UNIT_GLOB='induscost-*'`,
        `HEALTH_TRIES=2`,
        `HEALTH_INTERVAL=0`,
        `IDS_PG=""`,
        `IDS_PG_USER=""`,
        `IDS_STATE_DIR=${posix(join(w, "state"))}`,
        `IDS_MAINT_FLAG=${posix(join(w, "maintenance.flag"))}`,
        `IDS_CRON_DIR=${posix(cron)}`,
        `IDS_CRON_SCAN_FILES=""`,
        `IDS_CRON_SPOOL_DIRS=""`,
        `IDS_CRON_RELOAD_WAIT=0`,
        `IDS_STATS_SETTLE_SECONDS=1`,
        `IDS_SYSTEMCTL=${posix(join(stubs, "systemctl"))}`,
        `IDS_CURL=${posix(join(stubs, "curl"))}`,
        `IDS_TEST_RUNNER=${posix(join(stubs, "fake-test-runner"))}`,
        `IDS_TEST_RUNNER_ARGS=""`,
        "",
      ].join("\n")
    );
    const u = new URL(db.url);
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
    const calls = () => readFileSync(join(sysd, "calls"), "utf8");
    return { w, app, cron, executorPath, run, install, state, head, q, columns, lockOn, dbs, backupDir, calls, c0, c1: c1sha, dbName, env };
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

  it("E7. --check não altera nada", async () => {
    const s = await server({ "prisma/migrations/20261101120000_color/migration.sql": `ALTER TABLE "Item" ADD COLUMN "color" TEXT;\n` });
    const r = s.run("--check");
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /Migrations novas: 1 20261101120000_color/);
    assert.equal(s.head(), s.c0);
    assert.deepEqual(await s.columns(), ["id", "legacy", "name"]);
    assert.ok(!existsSync(join(s.w, "backups")));
    assert.equal(s.state("induscost-legal-djen.timer"), "active");
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
