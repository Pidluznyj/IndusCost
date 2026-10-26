/**
 * Biblioteca de segurança do deploy num PostgreSQL 17 REAL (descartável, loopback).
 *
 * psql e createdb executam no PostgreSQL 17 exatamente o SQL que a biblioteca envia (scripts/testing/
 * pgCliShim.mjs). pg_dump/pg_restore são simulados: o "restore" aplica no banco temporário a mesma fixture
 * usada para criar o banco de origem. Tudo o mais é real: CREATE DATABASE com encoding/collation/dono,
 * ACL e configurações de banco, sessões, ALLOW_CONNECTIONS, troca atômica de nomes, recuperação, cerca de XID
 * e a impressão digital completa (tabelas, linhas, colunas, índices, constraints, sequências, triggers,
 * views, funções, extensões, donos, ACL, migrations).
 *
 * Executar: COMMISSION_PG17_BIN=<bin do PostgreSQL 17> npx tsx --test src/lib/ops/deploySafety.pg17.integration.test.ts
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, before, describe, it } from "node:test";
import { PrismaClient } from "@prisma/client";
import {
  commissionPg17BinDir,
  executeSqlFile,
  startCommissionPostgres17,
  type CommissionPg17Database,
} from "../../../scripts/testing/commissionPostgresHarness.js";

const REPO = resolve(import.meta.dirname ?? ".", "..", "..", "..");
const LIB = join(REPO, "infra/deploy/induscost-deploy-safety.sh");
const SHIM = join(REPO, "scripts/testing/pgCliShim.mjs");

function findBash(): string | null {
  if (process.platform !== "win32") return "bash";
  for (const c of ["C:\\Program Files\\Git\\bin\\bash.exe", "C:\\Program Files (x86)\\Git\\bin\\bash.exe"]) if (existsSync(c)) return c;
  return null;
}
const BASH = findBash();
const pg17Bin = commissionPg17BinDir();
const SKIP = !pg17Bin ? "COMMISSION_PG17_BIN ausente: suite PostgreSQL 17 não executada." : !BASH ? "bash não encontrado." : false;
const posix = (p: string) => (process.platform === "win32" ? p.replace(/\\/g, "/").replace(/^([A-Za-z]):/, (_m, d: string) => `/${d.toLowerCase()}`) : p);

const FIXTURE = `
CREATE TABLE "Item" (id serial PRIMARY KEY, name text NOT NULL, qty int DEFAULT 0, CONSTRAINT qty_nonneg CHECK (qty >= 0));
CREATE UNIQUE INDEX "Item_name_key" ON "Item"(name);
CREATE TABLE "ItemEvent" (id serial PRIMARY KEY, item_id int NOT NULL REFERENCES "Item"(id), at timestamptz DEFAULT now());
CREATE INDEX "ItemEvent_item_idx" ON "ItemEvent"(item_id);
CREATE FUNCTION touch_event() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.at := now(); RETURN NEW; END $$;
CREATE TRIGGER item_event_touch BEFORE INSERT ON "ItemEvent" FOR EACH ROW EXECUTE FUNCTION touch_event();
CREATE VIEW item_summary AS SELECT name, qty FROM "Item";
CREATE TABLE "_prisma_migrations" (id varchar(36) PRIMARY KEY, checksum varchar(64) NOT NULL, finished_at timestamptz, migration_name varchar(255) NOT NULL, logs text, rolled_back_at timestamptz, started_at timestamptz NOT NULL DEFAULT now(), applied_steps_count int NOT NULL DEFAULT 0);
INSERT INTO "_prisma_migrations" (id, checksum, finished_at, migration_name, applied_steps_count) VALUES ('m1', 'x', now(), '20261001120000_init', 1);
INSERT INTO "Item" (name, qty) VALUES ('a', 1), ('b', 2), ('c', 3);
INSERT INTO "ItemEvent" (item_id) VALUES (1), (2);
SELECT setval('"Item_id_seq"', 41);
ALTER TABLE "Item" OWNER TO app_owner;
ALTER TABLE "ItemEvent" OWNER TO app_owner;
ALTER TABLE "_prisma_migrations" OWNER TO app_owner;
ALTER VIEW item_summary OWNER TO app_owner;
ALTER FUNCTION touch_event() OWNER TO app_owner;
GRANT SELECT ON "Item", item_summary TO app_reader;
`;
const BROKEN_FIXTURE = FIXTURE.replace(`CREATE INDEX "ItemEvent_item_idx" ON "ItemEvent"(item_id);\n`, "");

describe("biblioteca de deploy num PostgreSQL 17 real", { skip: SKIP }, () => {
  let db: CommissionPg17Database;
  let admin: PrismaClient;
  let work: string;
  let shimDir: string;
  let urlTemplate: string;
  let fixtureFile: string;
  let brokenFile: string;
  let seq = 0;

  const urlOf = (name: string) => urlTemplate.replace("{DB}", name);

  async function createLive(name: string) {
    await admin.$executeRawUnsafe(`CREATE DATABASE "${name}" OWNER app_owner TEMPLATE template0 ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C'`);
    await admin.$executeRawUnsafe(`ALTER DATABASE "${name}" SET statement_timeout TO '5min'`);
    await admin.$executeRawUnsafe(`ALTER DATABASE "${name}" SET search_path TO "$user", public`);
    await admin.$executeRawUnsafe(`ALTER DATABASE "${name}" CONNECTION LIMIT 50`);
    await admin.$executeRawUnsafe(`REVOKE ALL ON DATABASE "${name}" FROM PUBLIC`);
    await admin.$executeRawUnsafe(`GRANT CONNECT ON DATABASE "${name}" TO app_reader`);
    await executeSqlFile(urlOf(name), fixtureFile);
  }
  async function sql<T = Record<string, unknown>>(dbName: string, query: string): Promise<T[]> {
    const c = new PrismaClient({ datasourceUrl: urlOf(dbName) });
    try {
      return (await c.$queryRawUnsafe(query)) as T[];
    } finally {
      await c.$disconnect();
    }
  }
  async function exec(dbName: string, statement: string) {
    const c = new PrismaClient({ datasourceUrl: urlOf(dbName) });
    try {
      await c.$executeRawUnsafe(statement);
    } finally {
      await c.$disconnect();
    }
  }
  const databases = async (prefix: string) =>
    ((await admin.$queryRawUnsafe(`SELECT datname, datallowconn FROM pg_database WHERE datname LIKE '${prefix}%' ORDER BY 1`)) as Array<{ datname: string; datallowconn: boolean }>);

  function lib(script: string, env: Record<string, string> = {}) {
    seq += 1;
    const dir = join(work, `backup-${seq}`);
    mkdirSync(dir);
    const full = [
      `export PATH="${posix(shimDir)}:$PATH"`,
      `export IDS_PG="" IDS_PG_USER=""`,
      `BACKUP_DIR="${posix(dir)}"; DUMP="$BACKUP_DIR/database-before.dump"`,
      `source "${posix(LIB)}"`,
      script,
    ].join("\n");
    const r = spawnSync(BASH!, ["-c", full], {
      encoding: "utf8",
      env: {
        ...process.env,
        PG_SHIM_URL: urlTemplate,
        PG_SHIM_REPO: REPO,
        PG_SHIM_RESTORE_SQL: fixtureFile,
        PG_SHIM_CALLS: join(work, `calls-${seq}.txt`),
        ...env,
      },
    });
    const calls = existsSync(join(work, `calls-${seq}.txt`)) ? readFileSync(join(work, `calls-${seq}.txt`), "utf8") : "";
    return { out: `${r.stdout}\n${r.stderr}`, dir, calls };
  }

  before(async () => {
    db = await startCommissionPostgres17(pg17Bin!, { schema: "none" });
    admin = new PrismaClient({ datasourceUrl: db.poolUrl(2) });
    await admin.$executeRawUnsafe(`CREATE ROLE app_owner LOGIN`);
    await admin.$executeRawUnsafe(`CREATE ROLE app_reader LOGIN`);
    work = mkdtempSync(join(tmpdir(), "deploy-safety-pg17-"));
    shimDir = join(work, "bin");
    mkdirSync(shimDir);
    for (const tool of ["psql", "createdb", "pg_dump", "pg_restore"]) {
      writeFileSync(join(shimDir, tool), `#!/usr/bin/env bash\nexec "${posix(process.execPath)}" "${posix(SHIM)}" ${tool} "$@"\n`);
      chmodSync(join(shimDir, tool), 0o755);
    }
    for (const tool of ["systemctl", "pgrep"]) {
      writeFileSync(join(shimDir, tool), `#!/usr/bin/env bash\nexit ${tool === "pgrep" ? 1 : 0}\n`);
      chmodSync(join(shimDir, tool), 0o755);
    }
    urlTemplate = db.url.replace(/\/postgres\?/, "/{DB}?");
    fixtureFile = join(work, "fixture.sql");
    writeFileSync(fixtureFile, FIXTURE);
    brokenFile = join(work, "broken.sql");
    writeFileSync(brokenFile, BROKEN_FIXTURE);
  });

  after(async () => {
    await admin?.$disconnect();
    await db?.stop();
    if (work) rmSync(work, { recursive: true, force: true });
  });

  it("P1. backup registra metadados (dono, collation, ACL, configurações), impressão digital e cerca de XID", async () => {
    await createLive("p1");
    const r = lib(`ids_backup_db p1 "$DUMP"; echo RC=$?`);
    assert.match(r.out, /RC=0/, r.out);
    const meta = readFileSync(join(r.dir, "db-meta.txt"), "utf8");
    assert.match(meta, /encoding=UTF8\|collate=C\|ctype=C\|locprovider=c\|owner=app_owner\|connlimit=50\|/);
    assert.match(meta, /aclset=[^|]*app_reader:CONNECT/);
    assert.doesNotMatch(meta, /PUBLIC:CONNECT/, "CONNECT revogado de PUBLIC");
    const fp = readFileSync(join(r.dir, "fingerprint-before.txt"), "utf8");
    for (const expected of [
      /^table\|public\.Item\|owner=app_owner\|acl=\{[^}]*app_reader=r\/app_owner[^}]*\}\|rows=3$/m,
      /^index\|public\.ItemEvent_item_idx\|/m,
      /^constraint\|"Item"\|qty_nonneg\|CHECK \(\(qty >= 0\)\)$/m,
      /^constraint\|"ItemEvent"\|ItemEvent_item_id_fkey\|FOREIGN KEY/m,
      /^sequence\|public\.Item_id_seq\|owner=app_owner\|last=41$/m,
      /^trigger\|"ItemEvent"\|item_event_touch\|/m,
      /^view\|public\.item_summary\|owner=app_owner\|/m,
      /^function\|touch_event\(\)\|owner=app_owner\|/m,
      /^migration\|20261001120000_init\|finished=t\|rolledback=f$/m,
    ]) {
      assert.match(fp, expected);
    }
    assert.match(readFileSync(join(r.dir, "xid-at-backup"), "utf8"), /^\d+\s*$/);
  });

  it("P2. escrita depois do backup (rotina não pausada): migrations NÃO começam (43)", async () => {
    await createLive("p2");
    const r1 = lib(`ids_backup_db p2 "$DUMP" >/dev/null`);
    const dir = r1.dir;
    await exec("p2", `INSERT INTO "Item" (name) VALUES ('escrita-de-cron')`);
    const r2 = lib(`ids_mark_db_changes_started "${posix(dir)}" p2; echo RC=$?`);
    assert.match(r2.out, /RC=43/);
    assert.match(r2.out, /houve escrita no banco depois do backup/);
  });

  it("P3. sessão aberta no banco: pausa e marcador recusam (41/43) e listam a sessão", async () => {
    await createLive("p3");
    const holder = new PrismaClient({ datasourceUrl: urlOf("p3") + "&application_name=cron-nomus" });
    await holder.$queryRawUnsafe("SELECT 1");
    try {
      const pause = lib(`ids_pause_writers "$BACKUP_DIR/writers.state" p3; echo RC=$?`);
      assert.match(pause.out, /RC=41/);
      assert.match(pause.out, /cron-nomus/);
      const r1 = lib(`ids_backup_db p3 "$DUMP" >/dev/null; ids_mark_db_changes_started "$BACKUP_DIR" p3; echo RC=$?`);
      assert.match(r1.out, /RC=43/);
      assert.match(r1.out, /sessões abertas/);
    } finally {
      await holder.$disconnect();
    }
  });

  it("P4. falha antes das migrations: rollback não toca no banco", async () => {
    await createLive("p4");
    const r = lib(`ids_backup_db p4 "$DUMP" >/dev/null; ids_rollback_db_if_needed "$BACKUP_DIR" p4 "$DUMP" 4; echo RC=$?`);
    assert.match(r.out, /RC=0/);
    assert.match(r.out, /restauração NÃO executada/);
    assert.doesNotMatch(r.calls, /createdb|pg_restore --exit-on-error|RENAME/);
    assert.deepEqual((await databases("p4")).map((d) => d.datname), ["p4"]);
  });

  it("P5. migrations iniciadas mas nada aplicado (schema igual): rollback não restaura", async () => {
    await createLive("p5");
    const r = lib(`ids_backup_db p5 "$DUMP" >/dev/null; ids_mark_db_changes_started "$BACKUP_DIR" p5 >/dev/null; ids_rollback_db_if_needed "$BACKUP_DIR" p5 "$DUMP" 5; echo RC=$?`);
    assert.match(r.out, /RC=0/);
    assert.match(r.out, /nenhuma migration foi aplicada/);
    assert.deepEqual((await databases("p5")).map((d) => d.datname), ["p5"]);
  });

  it("P6. migration aplicada e app não subiu: restaura num banco novo, confere e troca atomicamente", async () => {
    await createLive("p6");
    const r1 = lib(`ids_backup_db p6 "$DUMP" >/dev/null && ids_mark_db_changes_started "$BACKUP_DIR" p6 >/dev/null`);
    const dir = r1.dir;
    // "migration" do deploy: muda schema, dados e registra a migration.
    await exec("p6", `ALTER TABLE "Item" ADD COLUMN novo text`);
    await exec("p6", `INSERT INTO "_prisma_migrations" (id, checksum, migration_name) VALUES ('m2', 'y', '20261101120000_falhou')`);
    const r = lib(`ids_rollback_db_if_needed "${posix(dir)}" p6 "${posix(dir)}/database-before.dump" 6; echo RC=$?`);
    assert.match(r.out, /RC=0/, r.out);
    assert.match(r.out, /restaurado e conferido/);
    assert.deepEqual((await databases("p6")).map((d) => [d.datname, d.datallowconn]), [["p6", true], ["p6__failed_6", true]]);
    // O banco restaurado é idêntico ao do backup; o estado anterior ficou preservado.
    const fpBefore = readFileSync(join(dir, "fingerprint-before.txt"), "utf8").trim();
    const fpNow = lib(`ids_db_fingerprint p6`).out.trim();
    assert.equal(fpNow, fpBefore);
    assert.equal((await sql<{ c: bigint }>("p6__failed_6", `SELECT count(*) AS c FROM information_schema.columns WHERE table_name = 'Item' AND column_name = 'novo'`))[0]!.c, 1n);
    const meta = lib(`ids_db_meta p6`).out.trim();
    assert.equal(meta, readFileSync(join(dir, "db-meta.txt"), "utf8").trim(), "dono, collation, limite, ACL e configurações iguais");
    const settings = await admin.$queryRawUnsafe<Array<{ c: string }>>(`SELECT unnest(setconfig) AS c FROM pg_db_role_setting WHERE setdatabase = (SELECT oid FROM pg_database WHERE datname = 'p6') ORDER BY 1`);
    assert.deepEqual(settings.map((s) => s.c), ['search_path="$user", public', "statement_timeout=5min"]);
    // Uma única transação para os dois RENAME; nenhum dropdb.
    assert.match(r.calls, /psql -d postgres -v ON_ERROR_STOP=1 -Atc BEGIN; ALTER DATABASE "p6" RENAME TO "p6__failed_6"; ALTER DATABASE "p6__rollback_6" RENAME TO "p6"; COMMIT;/);
    assert.doesNotMatch(r.calls, /dropdb|DROP DATABASE/);
    assert.match(readFileSync(join(dir, "restore-journal"), "utf8"), /verified[\s\S]*connections-closed[\s\S]*swapped[\s\S]*done/);
  });

  it("P7. migration aplicada e a aplicação nova chegou a subir: decisão manual (2), nada restaurado", async () => {
    await createLive("p7");
    const r1 = lib(`ids_backup_db p7 "$DUMP" >/dev/null && ids_mark_db_changes_started "$BACKUP_DIR" p7 >/dev/null && ids_mark_app_starting "$BACKUP_DIR"`);
    const dir = r1.dir;
    await exec("p7", `ALTER TABLE "Item" ADD COLUMN novo text`);
    const r = lib(`ids_rollback_db_if_needed "${posix(dir)}" p7 "${posix(dir)}/database-before.dump" 7; echo RC=$?`);
    assert.match(r.out, /RC=2/);
    assert.match(r.out, /DECISÃO MANUAL/);
    assert.deepEqual((await databases("p7")).map((d) => d.datname), ["p7"]);
  });

  it("P8. restaurado diferente do backup (índice faltando): troca recusada (38), banco atual intocado", async () => {
    await createLive("p8");
    const r1 = lib(`ids_backup_db p8 "$DUMP" >/dev/null && ids_mark_db_changes_started "$BACKUP_DIR" p8 >/dev/null`);
    const dir = r1.dir;
    await exec("p8", `ALTER TABLE "Item" ADD COLUMN novo text`);
    const r = lib(`ids_rollback_db_if_needed "${posix(dir)}" p8 "${posix(dir)}/database-before.dump" 8; echo RC=$?`, { PG_SHIM_RESTORE_SQL: brokenFile });
    assert.match(r.out, /RC=38/);
    assert.match(readFileSync(join(dir, "restore-verification.diff"), "utf8"), /ItemEvent_item_idx/);
    assert.deepEqual((await databases("p8")).map((d) => [d.datname, d.datallowconn]), [["p8", true], ["p8__rollback_8", true]]);
    assert.equal((await sql<{ c: bigint }>("p8", `SELECT count(*) AS c FROM information_schema.columns WHERE table_name = 'Item' AND column_name = 'novo'`))[0]!.c, 1n, "banco atual não foi trocado");
  });

  it("P9. troca falha dentro da transação: tudo desfeito, banco atual reaberto e intocado (36)", async () => {
    await createLive("p9");
    await admin.$executeRawUnsafe(`CREATE DATABASE "p9__failed_9"`); // colisão de nome força a falha do 1º RENAME
    const r1 = lib(`ids_backup_db p9 "$DUMP" >/dev/null && ids_mark_db_changes_started "$BACKUP_DIR" p9 >/dev/null`);
    const dir = r1.dir;
    await exec("p9", `ALTER TABLE "Item" ADD COLUMN novo text`);
    const r = lib(`ids_rollback_db_if_needed "${posix(dir)}" p9 "${posix(dir)}/database-before.dump" 9; echo RC=$?`);
    assert.match(r.out, /RC=36/);
    const dbs = await databases("p9");
    assert.deepEqual(dbs.map((d) => d.datname), ["p9", "p9__failed_9", "p9__rollback_9"]);
    assert.equal(dbs.find((d) => d.datname === "p9")!.datallowconn, true, "reaberto");
    assert.equal((await sql<{ c: bigint }>("p9", `SELECT count(*) AS c FROM information_schema.columns WHERE table_name = 'Item' AND column_name = 'novo'`))[0]!.c, 1n);
  });

  it("P12. processo morre entre o 1º e o 2º RENAME: o PostgreSQL desfaz o 1º, o banco nunca some", async () => {
    await createLive("p12");
    await admin.$executeRawUnsafe(`CREATE DATABASE "p12__rollback_12"`);
    const swapper = new PrismaClient({ datasourceUrl: urlOf("postgres") });
    const killer = new PrismaClient({ datasourceUrl: urlOf("postgres") });
    try {
      const swap = swapper.$transaction(
        async (tx) => {
          const pid = Number(((await tx.$queryRawUnsafe(`SELECT pg_backend_pid() AS p`)) as Array<{ p: number }>)[0]!.p);
          await tx.$executeRawUnsafe(`ALTER DATABASE p12 RENAME TO "p12__failed_12"`);
          await killer.$queryRawUnsafe(`SELECT pg_terminate_backend(${pid})`); // queda do processo/conexão aqui
          await tx.$executeRawUnsafe(`ALTER DATABASE "p12__rollback_12" RENAME TO p12`);
        },
        { timeout: 30_000 }
      );
      await assert.rejects(swap);
    } finally {
      await swapper.$disconnect().catch(() => undefined);
      await killer.$disconnect();
    }
    assert.deepEqual((await databases("p12")).map((d) => d.datname), ["p12", "p12__rollback_12"]);
    assert.equal((await sql<{ c: bigint }>("p12", `SELECT count(*) AS c FROM "Item"`))[0]!.c, 3n, "p12 é o banco original");
    assert.match(lib(`ids_recover_db_state p12 "$BACKUP_DIR"`).out, /estado consistente/);
  });

  it("P10. queda do processo com o banco fechado para conexões: ids_recover_db_state reabre", async () => {
    await createLive("p10");
    await admin.$executeRawUnsafe(`ALTER DATABASE p10 WITH ALLOW_CONNECTIONS false`);
    const r = lib(`ids_recover_db_state p10 "$BACKUP_DIR"; echo RC=$?`);
    assert.match(r.out, /RC=0/);
    assert.match(r.out, /voltou a aceitar conexões/);
    assert.equal((await databases("p10"))[0]!.datallowconn, true);
    const again = lib(`ids_recover_db_state p10 "$BACKUP_DIR"; echo RC=$?`);
    assert.match(again.out, /estado consistente/);
  });

  it("P11. banco principal ausente (estado anômalo): nada é renomeado automaticamente (45)", async () => {
    await createLive("p11");
    await admin.$executeRawUnsafe(`ALTER DATABASE p11 RENAME TO "p11__failed_11"`);
    const r = lib(`ids_recover_db_state p11 "$BACKUP_DIR"; echo RC=$?`);
    assert.match(r.out, /RC=45/);
    assert.match(r.out, /p11__failed_11/);
    assert.deepEqual((await databases("p11")).map((d) => d.datname), ["p11__failed_11"]);
  });
});
