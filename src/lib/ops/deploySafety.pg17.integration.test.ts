/**
 * Biblioteca de segurança do deploy (infra/deploy/induscost-deploy-safety.sh) num PostgreSQL 17 REAL e
 * descartável (loopback, porta livre, diretório temporário), com os binários REAIS do PostgreSQL 17:
 * psql, createdb, pg_dump e pg_restore. Nada aqui é simulado além de systemctl/pgrep (sem systemd local).
 *
 * Cobre: trava de escrita, prova de ausência de escrita (tuplas, sequências sem XID, TRUNCATE, sessões durante as
 * migrations), decisão de rollback por compatibilidade (manter / restaurar / bloquear), restauração fiel (donos,
 * ACL, privilégios padrão, enums, identidade, sequências, constraints, migrations), troca atômica, congelamento,
 * quedas do processo em vários pontos e recuperação.
 *
 * Executar: COMMISSION_PG17_BIN=<pasta bin do PostgreSQL 17 com pg_dump/pg_restore/psql/createdb>
 *   npx tsx --test src/lib/ops/deploySafety.pg17.integration.test.ts
 */
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, before, describe, it } from "node:test";
import { PrismaClient } from "@prisma/client";
import { isolatedHostEnv } from "./deployTestIsolation";
import {
  commissionPg17BinDir,
  executeSqlFile,
  startCommissionPostgres17,
  type CommissionPg17Database,
} from "../../../scripts/testing/commissionPostgresHarness.js";

const REPO = resolve(import.meta.dirname ?? ".", "..", "..", "..");
const LIB = join(REPO, "infra/deploy/induscost-deploy-safety.sh");
const EXE = process.platform === "win32" ? ".exe" : "";

function findBash(): string | null {
  if (process.platform !== "win32") return "bash";
  for (const c of ["C:\\Program Files\\Git\\bin\\bash.exe", "C:\\Program Files (x86)\\Git\\bin\\bash.exe"]) if (existsSync(c)) return c;
  return null;
}
const BASH = findBash();
const pg17Bin = commissionPg17BinDir();
const hasClients = !!pg17Bin && ["psql", "pg_dump", "pg_restore", "createdb"].every((t) => existsSync(join(pg17Bin, `${t}${EXE}`)));
const SKIP = !pg17Bin
  ? "COMMISSION_PG17_BIN ausente: suite PostgreSQL 17 não executada."
  : !hasClients
    ? "COMMISSION_PG17_BIN sem psql/pg_dump/pg_restore/createdb: suite com binários reais não executada."
    : !BASH
      ? "bash não encontrado."
      : false;
const posix = (p: string) => (process.platform === "win32" ? p.replace(/\\/g, "/").replace(/^([A-Za-z]):/, (_m, d: string) => `/${d.toLowerCase()}`) : p);
const OVERRIDE = "&options=-c%20default_transaction_read_only%3Doff";

const FIXTURE = `
CREATE TYPE "Status" AS ENUM ('A', 'B');
CREATE TABLE "Item" (id serial PRIMARY KEY, name text NOT NULL, qty int DEFAULT 0, status "Status" NOT NULL DEFAULT 'A', legacy text, CONSTRAINT qty_nonneg CHECK (qty >= 0));
CREATE UNIQUE INDEX "Item_name_key" ON "Item"(name);
CREATE TABLE "ItemEvent" (id serial PRIMARY KEY, item_id int NOT NULL REFERENCES "Item"(id), at timestamptz DEFAULT now());
CREATE INDEX "ItemEvent_item_idx" ON "ItemEvent"(item_id);
CREATE TABLE "Audit" (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, note text);
CREATE FUNCTION touch_event() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.at := now(); RETURN NEW; END $$;
CREATE TRIGGER item_event_touch BEFORE INSERT ON "ItemEvent" FOR EACH ROW EXECUTE FUNCTION touch_event();
CREATE VIEW item_summary AS SELECT name, qty FROM "Item";
CREATE TABLE "_prisma_migrations" (id varchar(36) PRIMARY KEY, checksum varchar(64) NOT NULL, finished_at timestamptz, migration_name varchar(255) NOT NULL, logs text, rolled_back_at timestamptz, started_at timestamptz NOT NULL DEFAULT now(), applied_steps_count int NOT NULL DEFAULT 0);
INSERT INTO "_prisma_migrations" (id, checksum, finished_at, migration_name, applied_steps_count) VALUES ('m1', 'x', now(), '20261001120000_init', 1);
INSERT INTO "Item" (name, qty) VALUES ('a', 1), ('b', 2), ('c', 3);
INSERT INTO "ItemEvent" (item_id) VALUES (1), (2);
INSERT INTO "Audit" (note) VALUES ('x'), ('y');
SELECT setval('"Item_id_seq"', 41);
ALTER TYPE "Status" OWNER TO app_owner;
ALTER TABLE "Item" OWNER TO app_owner;
ALTER TABLE "ItemEvent" OWNER TO app_owner;
ALTER TABLE "Audit" OWNER TO app_owner;
ALTER TABLE "_prisma_migrations" OWNER TO app_owner;
ALTER VIEW item_summary OWNER TO app_owner;
ALTER FUNCTION touch_event() OWNER TO app_owner;
GRANT USAGE ON SCHEMA public TO app_reader;
GRANT SELECT ON "Item", item_summary TO app_reader;
ALTER DEFAULT PRIVILEGES FOR ROLE app_owner IN SCHEMA public GRANT SELECT ON TABLES TO app_reader;
`;

describe("biblioteca de deploy com PostgreSQL 17 e binários reais", { skip: SKIP }, () => {
  let db: CommissionPg17Database;
  let admin: PrismaClient;
  let work: string;
  let stubDir: string;
  let fixtureFile: string;
  let pgEnv: Record<string, string>;
  let seq = 0;

  const urlOf = (name: string, extra = "") => db.url.replace(/\/postgres\?/, `/${name}?`) + extra;

  async function createLive(name: string) {
    await admin.$executeRawUnsafe(`CREATE DATABASE "${name}" OWNER app_owner TEMPLATE template0 ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C'`);
    await admin.$executeRawUnsafe(`ALTER DATABASE "${name}" SET statement_timeout TO '5min'`);
    await admin.$executeRawUnsafe(`ALTER DATABASE "${name}" SET search_path TO "$user", public`);
    await admin.$executeRawUnsafe(`ALTER DATABASE "${name}" CONNECTION LIMIT 50`);
    await admin.$executeRawUnsafe(`REVOKE ALL ON DATABASE "${name}" FROM PUBLIC`);
    await admin.$executeRawUnsafe(`GRANT CONNECT ON DATABASE "${name}" TO app_reader`);
    await executeSqlFile(urlOf(name), fixtureFile);
  }
  async function sql<T = Record<string, unknown>>(dbName: string, query: string, extra = ""): Promise<T[]> {
    const c = new PrismaClient({ datasourceUrl: urlOf(dbName, extra) });
    try {
      return (await c.$queryRawUnsafe(query)) as T[];
    } finally {
      await c.$disconnect();
    }
  }
  async function exec(dbName: string, statement: string, extra = "") {
    const c = new PrismaClient({ datasourceUrl: urlOf(dbName, extra) });
    try {
      await c.$executeRawUnsafe(statement);
    } finally {
      await c.$disconnect();
    }
  }
  /** "Migration" do deploy: mesma exceção à trava e mesma identificação que a URL das migrations. */
  const migrate = (dbName: string, statement: string) => exec(dbName, statement, `${OVERRIDE}&application_name=ids-deploy-migrate`);
  const databases = async (prefix: string) =>
    (await admin.$queryRawUnsafe(`SELECT datname, datallowconn FROM pg_database WHERE datname LIKE '${prefix}%' ORDER BY 1`)) as Array<{ datname: string; datallowconn: boolean }>;
  const count = async (dbName: string, query: string) => Number(((await sql<{ c: bigint }>(dbName, query))[0]!).c);

  /** Uma execução do executor: diretório de backup, estado da janela e cron próprios. */
  function deployRun(dbName: string) {
    seq += 1;
    const base = join(work, `run-${seq}`);
    const dir = join(base, "backup");
    for (const d of [dir, join(base, "cron.d")]) mkdirSync(d, { recursive: true });
    const env = {
      ...pgEnv,
      IDS_PG: "",
      IDS_PG_USER: "",
      IDS_STATE_DIR: posix(join(base, "state")),
      IDS_MAINT_FLAG: posix(join(base, "maintenance.flag")),
      IDS_CRON_DIR: posix(join(base, "cron.d")),
      IDS_CRON_SCAN_FILES: "",
      IDS_CRON_SPOOL_DIRS: "",
      IDS_CRON_RELOAD_WAIT: "0",
      IDS_STATS_SETTLE_SECONDS: "1",
      IDS_SYSTEMCTL: posix(join(stubDir, "systemctl")),
    };
    const script = (body: string, extraPath = "") =>
      [`export PATH="${extraPath ? `${posix(extraPath)}:` : ""}${posix(pg17Bin!)}:${posix(stubDir)}:$PATH"`, `DIR="${posix(dir)}"; DUMP="$DIR/database-before.dump"`, `source "${posix(LIB)}"`, body].join("\n");
    const run = (body: string, extra: Record<string, string> = {}, extraPath = "") => {
      const r = spawnSync(BASH!, ["-c", script(body, extraPath)], { encoding: "utf8", env: { ...isolatedHostEnv(), ...env, ...extra } });
      return `${r.stdout}\n${r.stderr}`;
    };
    const runAsync = (body: string, extraPath = "") => spawn(BASH!, ["-c", script(body, extraPath)], { env: { ...isolatedHostEnv(), ...env }, stdio: "ignore" });
    const file = (name: string) => readFileSync(join(dir, name), "utf8");
    return { dir, base, run, runAsync, file, name: dbName };
  }
  const lockSetting = async (dbName: string) =>
    (await admin.$queryRawUnsafe(`SELECT count(*)::int AS c FROM pg_db_role_setting s, unnest(s.setconfig) c WHERE s.setrole = 0 AND s.setdatabase = (SELECT oid FROM pg_database WHERE datname = '${dbName}') AND c = 'default_transaction_read_only=on'`)) as Array<{ c: number }>;

  /** Janela + backup + marcador (o estado de um deploy imediatamente antes de `prisma migrate deploy`). */
  function prepared(dbName: string) {
    const r = deployRun(dbName);
    const out = r.run(`ids_maintenance_begin ${dbName} && ids_backup_db ${dbName} "$DUMP" && ids_mark_db_changes_started "$DIR" ${dbName} && ids_migrate_watch_start "$DIR" ${dbName}; echo RC=$?`);
    assert.match(out, /RC=0/, out);
    return r;
  }

  before(async () => {
    db = await startCommissionPostgres17(pg17Bin!, { schema: "none" });
    admin = new PrismaClient({ datasourceUrl: db.poolUrl(3) });
    await admin.$executeRawUnsafe(`CREATE ROLE app_owner LOGIN`);
    await admin.$executeRawUnsafe(`CREATE ROLE app_reader LOGIN`);
    work = mkdtempSync(join(tmpdir(), "deploy-safety-pg17-"));
    stubDir = join(work, "stubs");
    mkdirSync(stubDir);
    // Sem systemd local: nenhum timer/serviço do IndusCost; nenhum processo de rotina em execução.
    writeFileSync(join(stubDir, "systemctl"), `#!/usr/bin/env bash\ncase "$1" in is-active) echo inactive; exit 3;; esac\nexit 0\n`);
    writeFileSync(join(stubDir, "pgrep"), `#!/usr/bin/env bash\nexit 1\n`);
    for (const f of ["systemctl", "pgrep"]) chmodSync(join(stubDir, f), 0o755);
    const u = new URL(db.url);
    pgEnv = { PGHOST: u.hostname, PGPORT: u.port, PGUSER: decodeURIComponent(u.username), PGSSLMODE: "disable" };
    fixtureFile = join(work, "fixture.sql");
    writeFileSync(fixtureFile, FIXTURE);
  });

  after(async () => {
    await admin?.$disconnect();
    await db?.stop();
    if (work) rmSync(work, { recursive: true, force: true });
  });

  it("R1. janela + backup com pg_dump real: trava de escrita barra até superusuário e nextval; dump legível; metadados", async () => {
    await createLive("r1");
    const r = deployRun("r1");
    const out = r.run(`ids_maintenance_begin r1 && ids_backup_db r1 "$DUMP"; echo RC=$?; pg_restore -l "$DUMP" | grep -c ' TABLE '`);
    assert.match(out, /RC=0/, out);
    assert.match(out, /janela de manutenção aberta/);
    assert.ok(Number(out.trim().split("\n").pop()) >= 4, "pg_restore -l lista as tabelas do dump real");
    assert.deepEqual(await lockSetting("r1"), [{ c: 1 }]);
    await assert.rejects(exec("r1", `INSERT INTO "Item" (name) VALUES ('cron')`), /read-only transaction/);
    await assert.rejects(sql("r1", `SELECT nextval('"Item_id_seq"')`), /read-only transaction/);
    const meta = r.file("db-meta.txt");
    assert.match(meta, /^encoding=UTF8\|collate=C\|ctype=C\|locprovider=c\|owner=app_owner\|connlimit=50\|aclset=[^|]*app_reader:CONNECT[^|]*\|settings=[0-9a-f]{32}$/m);
    const fp = r.file("fingerprint-before.txt");
    for (const expected of [
      /^table\|public\.Item\|owner=app_owner\|acl=\{[^}]*app_reader=r\/app_owner[^}]*\}\|rows=3$/m,
      /^column\|public\.Audit\|id\|bigint\|notnull=t\|default=\|identity=a\|generated=$/m,
      /^index\|public\.ItemEvent\|ItemEvent_item_idx\|unique=f\|/m,
      /^constraint\|public\.Item\|qty_nonneg\|c\|CHECK \(\(qty >= 0\)\)$/m,
      /^sequence\|public\.Item_id_seq\|owner=app_owner\|last=41$/m,
      /^enum\|public\.Status\|A,B$/m,
      /^schema\|public\|owner=pg_database_owner\|acl=\{[^}]*app_reader=U\/pg_database_owner[^}]*\}$/m,
      /^defacl\|app_owner\|public\|r\|\{app_reader=r\/app_owner\}$/m,
      /^migration\|20261001120000_init\|finished=t\|rolledback=f$/m,
    ]) {
      assert.match(fp, expected);
    }
    // Encerrar a janela devolve o banco ao estado anterior (sem a trava).
    assert.match(r.run(`ids_maintenance_end; echo RC=$?`), /RC=0/);
    assert.deepEqual(await lockSetting("r1"), [{ c: 0 }]);
    assert.equal(await count("r1", `SELECT count(*) AS c FROM "Item"`), 3);
  });

  it("R2. schema incompatível, aplicação não subiu: restauração REAL (pg_restore) idêntica ao backup e troca atômica", async () => {
    await createLive("r2");
    const r = prepared("r2");
    await migrate("r2", `ALTER TABLE "Item" DROP COLUMN legacy`);
    await migrate("r2", `INSERT INTO "_prisma_migrations" (id, checksum, finished_at, migration_name) VALUES ('m2', 'y', now(), '20261101120000_drop_legacy')`);
    const out = r.run(`ids_rollback_db_if_needed "$DIR" r2 "$DUMP" 2; echo RC=$?; ids_maintenance_end; echo END=$?`);
    assert.match(out, /RC=0/, out + (existsSync(join(r.dir, "restore-verification.diff")) ? r.file("restore-verification.diff") : ""));
    assert.match(out, /INCOMPATÍVEL/);
    assert.match(out, /decisão: RESTAURAR/);
    assert.match(out, /END=0/);
    assert.match(r.file("rollback-decision.txt"), /decision=RESTORE/);
    assert.deepEqual((await databases("r2")).map((d) => [d.datname, d.datallowconn]), [["r2", true], ["r2__failed_2", true]]);
    // Conteúdo, donos, ACL, privilégios padrão, enums, identidade, sequências e migrations iguais ao backup.
    const fpNow = r.run(`ids_db_fingerprint r2 rows,seq`).trim();
    assert.equal(fpNow, r.file("fingerprint-before.txt").trim());
    assert.equal(r.run(`ids_db_meta r2`).trim(), r.file("db-meta.txt").trim());
    assert.equal(await count("r2", `SELECT count(*) AS c FROM information_schema.columns WHERE table_name = 'Item' AND column_name = 'legacy'`), 1);
    assert.equal(await count("r2__failed_2", `SELECT count(*) AS c FROM information_schema.columns WHERE table_name = 'Item' AND column_name = 'legacy'`), 0);
    // A identidade e a sequência continuam de onde o backup estava; o leitor continua só lendo.
    assert.equal((await sql<{ id: bigint }>("r2", `INSERT INTO "Audit" (note) VALUES ('pos') RETURNING id`))[0]!.id, 3n);
    assert.equal((await sql<{ id: number }>("r2", `INSERT INTO "Item" (name) VALUES ('d') RETURNING id`))[0]!.id, 42);
    const readerUrl = urlOf("r2").replace(/\/\/[^@]+@/, "//app_reader@");
    const reader = new PrismaClient({ datasourceUrl: readerUrl });
    try {
      assert.equal(((await reader.$queryRawUnsafe(`SELECT count(*)::int AS c FROM "Item"`)) as Array<{ c: number }>)[0]!.c, 4);
      await assert.rejects(reader.$executeRawUnsafe(`INSERT INTO "Item" (name) VALUES ('x')`), /permission denied/);
    } finally {
      await reader.$disconnect();
    }
    assert.match(r.file("restore-journal"), /frozen[\s\S]*staging-created[\s\S]*verified[\s\S]*connections-closed[\s\S]*swapped[\s\S]*done/);
    assert.deepEqual(await lockSetting("r2"), [{ c: 0 }], "janela encerrada sem trava no banco restaurado");
  });

  it("R3. schema compatível (tabela nova vazia com FK, coluna opcional, enum sem uso, índice comum): banco MANTIDO", async () => {
    await createLive("r3");
    const r = prepared("r3");
    await migrate("r3", `CREATE TABLE "Tag" (id serial PRIMARY KEY, item_id int NOT NULL REFERENCES "Item"(id), label text)`);
    await migrate("r3", `ALTER TABLE "Item" ADD COLUMN color text`);
    await migrate("r3", `ALTER TYPE "Status" ADD VALUE 'C'`);
    await migrate("r3", `CREATE INDEX "Item_qty_idx" ON "Item"(qty)`);
    await migrate("r3", `INSERT INTO "_prisma_migrations" (id, checksum, finished_at, migration_name) VALUES ('m2', 'y', now(), '20261101120000_additive')`);
    const out = r.run(`ids_rollback_db_if_needed "$DIR" r3 "$DUMP" 3; echo RC=$?`);
    assert.match(out, /RC=0/, out);
    assert.match(out, /banco MANTIDO/);
    assert.deepEqual((await databases("r3")).map((d) => d.datname), ["r3"]);
    const report = r.file("compat-report.txt");
    assert.match(report, /OK\|tabela nova vazia com FK restritiva: public\.Tag/);
    assert.match(report, /OK\|coluna nova opcional: public\.Item\.color/);
    assert.match(report, /OK\|enum com rótulos novos ainda sem uso: public\.Status \(C\)/);
    assert.doesNotMatch(report, /INCOMPATIVEL/);
  });

  it("R4. aplicação subiu e escreveu; schema incompatível: BLOQUEIO (2) — nada restaurado, escrita preservada, trava mantida", async () => {
    await createLive("r4");
    const r = prepared("r4");
    await migrate("r4", `ALTER TABLE "Item" ADD COLUMN sku text NOT NULL DEFAULT 'x'`);
    await migrate("r4", `ALTER TABLE "Item" ALTER COLUMN sku DROP DEFAULT`);
    assert.match(r.run(`ids_open_for_app "$DIR" r4; echo RC=$?`), /RC=0/);
    await exec("r4", `INSERT INTO "Item" (name, sku) VALUES ('pedido-real', 's1')`); // escrita legítima da aplicação nova
    const out = r.run(`ids_rollback_db_if_needed "$DIR" r4 "$DUMP" 4; echo RC=$?`);
    assert.match(out, /RC=2/, out);
    assert.match(out, /coluna nova obrigatória sem valor padrão: public\.Item\.sku/);
    assert.match(out, /a aplicação escreveu \d+ tupla\(s\) depois de subir|mudaram depois que a aplicação subiu/);
    assert.match(out, /BLOQUEIO/);
    assert.deepEqual((await databases("r4")).map((d) => d.datname), ["r4"]);
    assert.equal(await count("r4", `SELECT count(*) AS c FROM "Item" WHERE name = 'pedido-real'`), 1);
    assert.deepEqual(await lockSetting("r4"), [{ c: 1 }], "trava religada no rollback e mantida no bloqueio");
  });

  it("R5. aplicação subiu sem escrever; schema incompatível: prova fecha e o backup é restaurado", async () => {
    await createLive("r5");
    const r = prepared("r5");
    await migrate("r5", `ALTER TABLE "Item" DROP COLUMN legacy`);
    assert.match(r.run(`ids_open_for_app "$DIR" r5; echo RC=$?`), /RC=0/);
    assert.equal(await count("r5", `SELECT count(*) AS c FROM "Item"`), 3); // aplicação só leu e caiu no health
    const out = r.run(`ids_rollback_db_if_needed "$DIR" r5 "$DUMP" 5; echo RC=$?`);
    assert.match(out, /RC=0/, out);
    assert.match(out, /decisão: RESTAURAR/);
    assert.deepEqual((await databases("r5")).map((d) => d.datname), ["r5", "r5__failed_5"]);
  });

  it("R6. aplicação subiu e escreveu; schema compatível: banco MANTIDO com a escrita (continuidade)", async () => {
    await createLive("r6");
    const r = prepared("r6");
    await migrate("r6", `ALTER TABLE "Item" ADD COLUMN color text`);
    assert.match(r.run(`ids_open_for_app "$DIR" r6; echo RC=$?`), /RC=0/);
    await exec("r6", `INSERT INTO "Item" (name, color) VALUES ('pedido-real', 'azul')`);
    const out = r.run(`ids_rollback_db_if_needed "$DIR" r6 "$DUMP" 6; echo RC=$?`);
    assert.match(out, /RC=0/, out);
    assert.match(out, /banco MANTIDO/);
    assert.equal(await count("r6", `SELECT count(*) AS c FROM "Item" WHERE name = 'pedido-real'`), 1);
  });

  it("R7. escrita concorrente DEPOIS do backup (cliente que força escrita): tupla, nextval sem XID e TRUNCATE barram as migrations (43)", async () => {
    for (const [name, statement] of [
      ["r7a", `INSERT INTO "Item" (name) VALUES ('escrita-forcada')`],
      ["r7b", `SELECT nextval('"Item_id_seq"')`],
      ["r7c", `TRUNCATE "Audit"`],
    ] as const) {
      await createLive(name);
      const r = deployRun(name);
      assert.match(r.run(`ids_maintenance_begin ${name} && ids_backup_db ${name} "$DUMP"; echo RC=$?`), /RC=0/);
      if (statement.startsWith("SELECT")) await sql(name, statement, OVERRIDE);
      else await exec(name, statement, OVERRIDE);
      const out = r.run(`ids_mark_db_changes_started "$DIR" ${name}; echo RC=$?`);
      assert.match(out, /RC=43/, `${name}: ${out}`);
      assert.ok(!existsSync(join(r.dir, "db-changes-started")));
      // Sem marcador, o rollback não toca no banco.
      assert.match(r.run(`ids_rollback_db_if_needed "$DIR" ${name} "$DUMP" 7; echo RC=$?; ids_maintenance_end`), /restauração NÃO executada[\s\S]*RC=0/);
    }
  });

  it("R8. sessão estranha durante as migrations: prova inválida; schema incompatível → BLOQUEIO", async () => {
    await createLive("r8");
    const r = prepared("r8");
    // A sessão estranha fica aberta até o observador (que amostra pg_stat_activity por psql) a registrar: com um
    // pg_sleep fixo, sob carga (gate com três suítes em paralelo no Windows) uma amostra pode demorar mais que a
    // sessão e o teste falharia por tempo, não por defeito.
    const bi = new PrismaClient({ datasourceUrl: urlOf("r8", "&application_name=bi-relatorios") });
    await bi.$queryRawUnsafe(`SELECT 1`);
    const raw = join(r.dir, "migrate-sessions.raw");
    for (let i = 0; i < 600 && !(existsSync(raw) && readFileSync(raw, "utf8").includes("bi-relatorios")); i++) await new Promise((res) => setTimeout(res, 100));
    await bi.$disconnect();
    assert.match(readFileSync(raw, "utf8"), /bi-relatorios/, "observador registrou a sessão estranha enquanto ela estava aberta");
    await migrate("r8", `ALTER TABLE "Item" DROP COLUMN legacy`);
    const out = r.run(`ids_rollback_db_if_needed "$DIR" r8 "$DUMP" 8; echo RC=$?`);
    assert.match(out, /sessões estranhas durante as migrations/);
    assert.match(out, /bi-relatorios/);
    assert.match(out, /RC=2/);
    assert.deepEqual((await databases("r8")).map((d) => d.datname), ["r8"]);
  });

  it("R9. sessão presente no congelamento: restauração cancelada (49), banco reaberto e intocado", async () => {
    await createLive("r9");
    const r = prepared("r9");
    await migrate("r9", `ALTER TABLE "Item" DROP COLUMN legacy`);
    r.run(`ids_migrate_watch_stop "$DIR"`);
    const holder = new PrismaClient({ datasourceUrl: urlOf("r9", "&application_name=chegou-depois") });
    await holder.$queryRawUnsafe(`SELECT 1`);
    try {
      const out = r.run(`ids_restore_db_safely r9 "$DUMP" 9; echo RC=$?`);
      assert.match(out, /RC=49/, out);
    } finally {
      await holder.$disconnect().catch(() => undefined);
    }
    assert.deepEqual((await databases("r9")).map((d) => [d.datname, d.datallowconn]), [["r9", true]]);
    assert.equal(await count("r9", `SELECT count(*) AS c FROM information_schema.columns WHERE table_name = 'Item' AND column_name = 'legacy'`), 0);
  });

  it("R10. restaurado difere do backup (índice perdido no restore): troca recusada (38), banco reaberto e intocado", async () => {
    await createLive("r10");
    const r = prepared("r10");
    await migrate("r10", `ALTER TABLE "Item" DROP COLUMN legacy`);
    const breaker = join(r.base, "breaker");
    mkdirSync(breaker);
    writeFileSync(
      join(breaker, "pg_restore"),
      `#!/usr/bin/env bash\n"${posix(join(pg17Bin!, `pg_restore${EXE}`))}" "$@"; rc=$?\n[[ "$1" == -l || $rc != 0 ]] && exit $rc\n"${posix(join(pg17Bin!, `psql${EXE}`))}" -X -q -d r10__rollback_10 -c 'DROP INDEX "ItemEvent_item_idx"'\nexit $rc\n`
    );
    chmodSync(join(breaker, "pg_restore"), 0o755);
    const out = r.run(`ids_rollback_db_if_needed "$DIR" r10 "$DUMP" 10; echo RC=$?`, {}, breaker);
    assert.match(out, /RC=38/, out);
    assert.match(r.file("restore-verification.diff"), /ItemEvent_item_idx/);
    assert.deepEqual((await databases("r10")).map((d) => [d.datname, d.datallowconn]), [["r10", true], ["r10__rollback_10", true]]);
    assert.equal(await count("r10", `SELECT count(*) AS c FROM information_schema.columns WHERE table_name = 'Item' AND column_name = 'legacy'`), 0, "banco atual não foi trocado");
  });

  it("R11. troca falha dentro da transação (nome ocupado): tudo desfeito (36), banco reaberto", async () => {
    await createLive("r11");
    await admin.$executeRawUnsafe(`CREATE DATABASE "r11__failed_11"`);
    const r = prepared("r11");
    await migrate("r11", `ALTER TABLE "Item" DROP COLUMN legacy`);
    const out = r.run(`ids_rollback_db_if_needed "$DIR" r11 "$DUMP" 11; echo RC=$?`);
    assert.match(out, /RC=36/, out);
    const dbs = await databases("r11");
    assert.deepEqual(dbs.map((d) => d.datname), ["r11", "r11__failed_11", "r11__rollback_11"]);
    assert.equal(dbs.find((d) => d.datname === "r11")!.datallowconn, true);
  });

  it("R12. executor morto com o banco congelado (durante o createdb): ids_recover_db_state reabre; nada renomeado", async () => {
    await createLive("r12");
    const r = prepared("r12");
    await migrate("r12", `ALTER TABLE "Item" DROP COLUMN legacy`);
    r.run(`ids_migrate_watch_stop "$DIR"`);
    const hang = join(r.base, "hang");
    mkdirSync(hang);
    writeFileSync(join(hang, "createdb"), `#!/usr/bin/env bash\nsleep 120\n`);
    chmodSync(join(hang, "createdb"), 0o755);
    const child = r.runAsync(`ids_restore_db_safely r12 "$DUMP" 12`, hang);
    const journal = join(r.dir, "restore-journal");
    for (let i = 0; i < 200 && !(existsSync(journal) && readFileSync(journal, "utf8").includes("frozen")); i++) await new Promise((res) => setTimeout(res, 100));
    await new Promise((res) => setTimeout(res, 2500)); // passa da reconferência e entra no createdb
    child.kill("SIGKILL");
    assert.deepEqual((await databases("r12")).map((d) => [d.datname, d.datallowconn]), [["r12", false]], "queda deixou o banco congelado");
    const out = r.run(`ids_recover_db_state r12 "$DIR"; echo RC=$?`);
    assert.match(out, /RC=0/);
    assert.match(out, /voltou a aceitar conexões/);
    assert.deepEqual((await databases("r12")).map((d) => [d.datname, d.datallowconn]), [["r12", true]]);
  });

  it("R13. processo morre entre o 1º e o 2º RENAME: o PostgreSQL desfaz o 1º, o banco nunca some", async () => {
    await createLive("r13");
    await admin.$executeRawUnsafe(`CREATE DATABASE "r13__rollback_13"`);
    const swapper = new PrismaClient({ datasourceUrl: urlOf("postgres") });
    const killer = new PrismaClient({ datasourceUrl: urlOf("postgres") });
    try {
      const swap = swapper.$transaction(
        async (tx) => {
          const pid = Number(((await tx.$queryRawUnsafe(`SELECT pg_backend_pid() AS p`)) as Array<{ p: number }>)[0]!.p);
          await tx.$executeRawUnsafe(`ALTER DATABASE r13 RENAME TO "r13__failed_13"`);
          await killer.$queryRawUnsafe(`SELECT pg_terminate_backend(${pid})`);
          await tx.$executeRawUnsafe(`ALTER DATABASE "r13__rollback_13" RENAME TO r13`);
        },
        { timeout: 30_000 }
      );
      await assert.rejects(swap);
    } finally {
      await swapper.$disconnect().catch(() => undefined);
      await killer.$disconnect();
    }
    assert.deepEqual((await databases("r13")).map((d) => d.datname), ["r13", "r13__rollback_13"]);
    assert.equal(await count("r13", `SELECT count(*) AS c FROM "Item"`), 3);
  });

  it("R14. banco principal ausente: nada renomeado automaticamente (45)", async () => {
    await createLive("r14");
    await admin.$executeRawUnsafe(`ALTER DATABASE r14 RENAME TO "r14__failed_14"`);
    const out = deployRun("r14").run(`ids_recover_db_state r14 ""; echo RC=$?`);
    assert.match(out, /RC=45/);
    assert.match(out, /r14__failed_14/);
  });

  it("R15. janela interrompida (executor morto): próximo deploy recusa (46); recover --resume devolve tudo ao estado anterior", async () => {
    await createLive("r15");
    const r = deployRun("r15");
    writeFileSync(join(r.base, "cron.d", "induscost-nomus-purchase-orders"), "37 * * * * root /opt/induscost/scripts/runNomusPurchaseOrdersSync.sh apply\n");
    writeFileSync(join(r.base, "cron.d", "outro-sistema"), "0 3 * * * root /usr/bin/backup-geral\n");
    assert.match(r.run(`ids_maintenance_begin r15; echo RC=$?`), /RC=0/);
    assert.deepEqual(readdirSync(join(r.base, "cron.d")), ["outro-sistema"], "só o cron do IndusCost foi pausado");
    // "queda" do executor aqui: estado persistido.
    const again = r.run(`ids_maintenance_begin r15; echo RC=$?`);
    assert.match(again, /RC=46/);
    const status = r.run(`ids_maintenance_recover; echo RC=$?`);
    assert.match(status, /RC=46/);
    assert.match(status, /cron .*induscost-nomus-purchase-orders/);
    assert.match(status, /readonly r15/);
    assert.match(r.run(`ids_maintenance_recover --resume; echo RC=$?`), /RC=0/);
    assert.deepEqual(readdirSync(join(r.base, "cron.d")).sort(), ["induscost-nomus-purchase-orders", "outro-sistema"]);
    assert.equal(readFileSync(join(r.base, "cron.d", "induscost-nomus-purchase-orders"), "utf8"), "37 * * * * root /opt/induscost/scripts/runNomusPurchaseOrdersSync.sh apply\n");
    assert.deepEqual(await lockSetting("r15"), [{ c: 0 }]);
    assert.ok(!existsSync(join(r.base, "maintenance.flag")));
  });

  it("R16. sessão aberta antes da janela (transação em andamento): janela não abre (41) e lista a sessão", async () => {
    await createLive("r16");
    const holder = new PrismaClient({ datasourceUrl: urlOf("r16", "&application_name=cron-nomus") });
    await holder.$queryRawUnsafe(`SELECT 1`);
    try {
      const r = deployRun("r16");
      const out = r.run(`ids_maintenance_begin r16; echo RC=$?; ids_maintenance_end`);
      assert.match(out, /RC=41/);
      assert.match(out, /cron-nomus/);
    } finally {
      await holder.$disconnect();
    }
    assert.deepEqual(await lockSetting("r16"), [{ c: 0 }], "janela desfeita");
  });

  it("R18. roteiro de ensaio do servidor (scripts/ops/rehearseDeploySafety.sh): todos os passos OK; --cleanup remove só ids_ensaio_*", async () => {
    const base = join(work, "ensaio");
    const env = { ...isolatedHostEnv(), ...pgEnv, IDS_PG: "", IDS_PG_USER: "", IDS_ENSAIO_ALLOW_ENV: "1", IDS_STATS_SETTLE_SECONDS: "1", IDS_ENSAIO_ROOT: posix(join(base, "backups")), IDS_ENSAIO_STATE: posix(join(base, "state")), IDS_SYSTEMCTL: posix(join(stubDir, "systemctl")) };
    const script = posix(join(REPO, "scripts/ops/rehearseDeploySafety.sh"));
    const path = `export PATH="${posix(pg17Bin!)}:${posix(stubDir)}:$PATH"`;
    const r = spawnSync(BASH!, ["-c", `${path}; bash "${script}"`], { encoding: "utf8", env });
    const out = `${r.stdout}\n${r.stderr}`;
    assert.equal(r.status, 0, out);
    assert.match(out, /resultado: 16 OK, 0 falha\(s\)/);
    assert.ok((await databases("ids_ensaio_")).length >= 4);
    const before = (await databases("r1")).map((d) => d.datname);
    const c = spawnSync(BASH!, ["-c", `${path}; bash "${script}" --cleanup`], { encoding: "utf8", env });
    assert.equal(c.status, 0, c.stdout + c.stderr);
    assert.deepEqual(await databases("ids_ensaio_"), []);
    assert.deepEqual((await databases("r1")).map((d) => d.datname), before, "nada fora do prefixo foi tocado");
  });

  it("R19. ensaio sem --env-file recusa (2) sem tocar no cluster; --cleanup remove só nomes do padrão ids_ensaio_<época>_<cenário> e deixa os demais (1)", async () => {
    const base = join(work, "ensaio2");
    const env = { ...isolatedHostEnv(), ...pgEnv, IDS_PG: "", IDS_PG_USER: "", IDS_ENSAIO_ROOT: posix(join(base, "backups")), IDS_ENSAIO_STATE: posix(join(base, "state")), IDS_SYSTEMCTL: posix(join(stubDir, "systemctl")) };
    const script = posix(join(REPO, "scripts/ops/rehearseDeploySafety.sh"));
    const path = `export PATH="${posix(pg17Bin!)}:${posix(stubDir)}:$PATH"`;
    const r = spawnSync(BASH!, ["-c", `${path}; bash "${script}"`], { encoding: "utf8", env });
    assert.equal(r.status, 2, r.stdout + r.stderr);
    assert.match(r.stdout + r.stderr, /informe --env-file/);
    assert.deepEqual(await databases("ids_ensaio_"), []);
    await admin.$executeRawUnsafe(`CREATE DATABASE "ids_ensaio_bogus"`);
    await admin.$executeRawUnsafe(`CREATE DATABASE "ids_ensaio_1_x"`);
    const c = spawnSync(BASH!, ["-c", `${path}; bash "${script}" --cleanup`], { encoding: "utf8", env: { ...env, IDS_ENSAIO_ALLOW_ENV: "1" } });
    assert.equal(c.status, 1, c.stdout + c.stderr);
    assert.match(c.stdout + c.stderr, /nome fora do padrão do ensaio: ids_ensaio_bogus/);
    assert.match(c.stdout + c.stderr, /removido: ids_ensaio_1_x/);
    assert.deepEqual((await databases("ids_ensaio_")).map((d) => d.datname), ["ids_ensaio_bogus"]);
    await admin.$executeRawUnsafe(`DROP DATABASE "ids_ensaio_bogus"`);
  });

  it("R20. --env-file: cluster diferente do configurado recusa (50) antes de criar qualquer banco; cluster certo roda o ensaio inteiro e o --cleanup", async () => {
    const base = join(work, "ensaio3");
    mkdirSync(base, { recursive: true });
    const u = new URL(db.url);
    const envFile = (extra: string) => {
      const f = join(base, `ensaio-${extra ? "errado" : "certo"}.env`);
      writeFileSync(f, ["IDS_ENV_NAME=teste", "DB=r1", `IDS_PG_OS_USER=none`, `IDS_PG_BIN=PATH`, `IDS_PG_HOST=${u.hostname}`, `IDS_PG_PORT=${u.port}`, `IDS_PG_ADMIN_ROLE=${decodeURIComponent(u.username)}`, `IDS_PG_EXPECT_MAJOR=17`, `PROTECTED_DATABASES='r2 r3'`, extra, ""].join("\n"));
      return posix(f);
    };
    const env = { ...isolatedHostEnv(), IDS_STATS_SETTLE_SECONDS: "1", IDS_ENSAIO_ROOT: posix(join(base, "backups")), IDS_ENSAIO_STATE: posix(join(base, "state")), IDS_SYSTEMCTL: posix(join(stubDir, "systemctl")), PGSSLMODE: "disable" };
    const script = posix(join(REPO, "scripts/ops/rehearseDeploySafety.sh"));
    const path = `export PATH="${posix(pg17Bin!)}:${posix(stubDir)}:$PATH"`;
    const wrong = spawnSync(BASH!, ["-c", `${path}; bash "${script}" --env-file "${envFile("IDS_PG_EXPECT_MAJOR=16")}"`], { encoding: "utf8", env });
    assert.equal(wrong.status, 50, wrong.stdout + wrong.stderr);
    assert.match(wrong.stdout + wrong.stderr, /cluster conectado é PostgreSQL 17; esperado 16/);
    assert.deepEqual(await databases("ids_ensaio_"), []);
    const right = spawnSync(BASH!, ["-c", `${path}; bash "${script}" --env-file "${envFile("")}"`], { encoding: "utf8", env });
    assert.equal(right.status, 0, right.stdout + right.stderr);
    assert.match(right.stdout + right.stderr, /resultado: 16 OK, 0 falha\(s\)/);
    const c = spawnSync(BASH!, ["-c", `${path}; bash "${script}" --env-file "${envFile("")}" --cleanup`], { encoding: "utf8", env });
    assert.equal(c.status, 0, c.stdout + c.stderr);
    assert.deepEqual(await databases("ids_ensaio_"), []);
  });

  it("R17. banco já configurado como read-only por terceiros: trava recusa (48) e não remove a configuração alheia", async () => {
    await createLive("r17");
    await admin.$executeRawUnsafe(`ALTER DATABASE r17 SET default_transaction_read_only = on`);
    const r = deployRun("r17");
    assert.match(r.run(`ids_maintenance_begin r17; echo RC=$?`), /RC=48/);
    assert.match(r.run(`ids_maintenance_end; echo RC=$?`), /RC=0/);
    assert.deepEqual(await lockSetting("r17"), [{ c: 1 }]);
  });
});
