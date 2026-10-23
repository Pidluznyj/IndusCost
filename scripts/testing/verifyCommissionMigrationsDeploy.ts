/**
 * Ensaio do caminho de implantação das migrations de comissões N:N num PostgreSQL 17
 * DESCARTÁVEL (nunca num banco real): reproduz o que `prisma migrate deploy` fará em
 * homologação e confere rollback e reimplantação.
 *
 *   1. banco com o schema da base (--base, padrão a merge-base com origin/main) + objetos
 *      só de migration anteriores, e as migrations anteriores registradas como aplicadas;
 *   2. dados legados (cobertura do evento inteiro) gravados ANTES das migrations novas;
 *   3. `prisma migrate deploy` → só as migrations novas são aplicadas; `migrate status`;
 *   4. drift: banco × schema.prisma atual (esperado: só a tabela-marcador do teste);
 *   5. dados legados preservados e protegidos (índice do evento + trigger);
 *   6. rollback manual (docs/commissions/rollback, ordem inversa) → drift × schema da base;
 *   7. remoção do registro em _prisma_migrations e nova `migrate deploy` → drift zero.
 *
 * Uso: COMMISSION_PG17_BIN=<bin> npx tsx scripts/testing/verifyCommissionMigrationsDeploy.ts [--base=<ref>]
 * Saída 0 = todas as conferências passaram.
 */
import { createHash, randomUUID } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  commissionPg17BinDir,
  executeSqlFile,
  generateSchemaSql,
  migrationOnlyStatements,
  startCommissionPostgres17,
} from "./commissionPostgresHarness.js";

const REPO = resolve(import.meta.dirname ?? ".", "..", "..");
const MIGRATIONS = join(REPO, "prisma/migrations");
const checks: Array<{ check: string; ok: boolean; detail: string }> = [];
const record = (check: string, ok: boolean, detail = "") => {
  checks.push({ check, ok, detail });
  console.log(`${ok ? "OK  " : "FALHA"} ${check}${detail ? ` — ${detail}` : ""}`);
};

function prismaCli(args: string[], url: string): Promise<{ code: number | null; out: string }> {
  return new Promise((resolveRun) => {
    const child = spawn(process.execPath, [join(REPO, "node_modules/prisma/build/index.js"), ...args], {
      cwd: REPO,
      env: { ...process.env, DATABASE_URL: url },
    });
    let out = "";
    child.stdout.on("data", (chunk) => (out += chunk));
    child.stderr.on("data", (chunk) => (out += chunk));
    child.on("close", (code) => resolveRun({ code, out }));
  });
}

/** Statements do diff banco × schema, sem o marcador do teste. */
async function drift(url: string, schemaPath: string): Promise<string[]> {
  const result = await prismaCli(["migrate", "diff", "--from-url", url, "--to-schema-datamodel", schemaPath, "--script"], url);
  return result.out
    .split(";")
    .map((stmt) => stmt.replace(/--[^\n]*/g, "").trim())
    .filter((stmt) => stmt && !/__induscost_test_marker/.test(stmt) && !/^This is an empty migration/.test(stmt));
}

async function main(): Promise<number> {
  const bin = commissionPg17BinDir();
  if (!bin) throw new Error("COMMISSION_PG17_BIN ausente.");
  const baseRef =
    process.argv.find((arg) => arg.startsWith("--base="))?.slice(7) ??
    execFileSync("git", ["merge-base", "HEAD", "origin/main"], { cwd: REPO }).toString().trim();
  const baseMigrations = new Set(
    execFileSync("git", ["ls-tree", "--name-only", `${baseRef}:prisma/migrations`], { cwd: REPO })
      .toString()
      .split("\n")
      .map((name) => name.trim())
      .filter((name) => name && name !== "migration_lock.toml")
  );
  // Nomes de migration do repo nem sempre têm 14 dígitos (ex.: 20260427_…): vale o diretório.
  const allMigrations = readdirSync(MIGRATIONS).filter((name) => existsSync(join(MIGRATIONS, name, "migration.sql"))).sort();
  const newMigrations = allMigrations.filter((name) => !baseMigrations.has(name));
  console.log(`Base ${baseRef} · migrations anteriores ${baseMigrations.size} · novas: ${newMigrations.join(", ")}`);

  const db = await startCommissionPostgres17(bin, { schema: "none" });
  const workDir = db.dataDir;
  try {
    console.log(`Banco descartável: ${db.validation.engine.slice(0, 40)} · 127.0.0.1:${db.validation.port}`);
    // 1. Schema da base + objetos de migrations anteriores.
    const baseSchema = join(workDir, "base-schema.prisma");
    writeFileSync(baseSchema, execFileSync("git", ["show", `${baseRef}:prisma/schema.prisma`], { cwd: REPO }));
    const baseSql = join(workDir, "base.sql");
    const priorObjects = migrationOnlyStatements(MIGRATIONS, (name) => baseMigrations.has(name)).map((stmt) => `${stmt.trim().replace(/;$/, "")};`);
    writeFileSync(baseSql, `${await generateSchemaSql(baseSchema)}\n${priorObjects.join("\n")}\n`);
    await executeSqlFile(db.url, baseSql);
    const baseDrift = await drift(db.url, baseSchema);
    record("banco da base sem drift contra o schema.prisma da base", baseDrift.length === 0, baseDrift.slice(0, 3).join(" | "));

    // Migrations anteriores registradas como aplicadas (como em homologação).
    const registry = [
      `CREATE TABLE "_prisma_migrations" ("id" VARCHAR(36) PRIMARY KEY, "checksum" VARCHAR(64) NOT NULL, "finished_at" TIMESTAMPTZ, "migration_name" VARCHAR(255) NOT NULL, "logs" TEXT, "rolled_back_at" TIMESTAMPTZ, "started_at" TIMESTAMPTZ NOT NULL DEFAULT now(), "applied_steps_count" INTEGER NOT NULL DEFAULT 0);`,
      ...allMigrations
        .filter((name) => baseMigrations.has(name))
        .map((name) => {
          const checksum = createHash("sha256").update(readFileSync(join(MIGRATIONS, name, "migration.sql"))).digest("hex");
          return `INSERT INTO "_prisma_migrations" VALUES ('${randomUUID()}', '${checksum}', now(), '${name}', NULL, NULL, now(), 1);`;
        }),
    ];
    // 2. Dado legado: cobertura do evento inteiro (Nomus) gravada antes das migrations novas.
    registry.push(
      `INSERT INTO "CommissionReceiptCoverage" ("receiptExternalId","receivableExternalId","coverageSource","coverageStatus","naturalReceiptDate","naturalYear","naturalMonth","coveredReceivedAmount","associationMethod") VALUES (555001, 5550, 'NOMUS_LEGACY', 'COVERED', '2026-09-10', 2026, 9, 1000, 'RECEIPT_ID');`
    );
    const registryFile = join(workDir, "registry.sql");
    writeFileSync(registryFile, registry.join("\n"));
    await executeSqlFile(db.url, registryFile);

    // 3. Deploy real.
    const deploy = await prismaCli(["migrate", "deploy"], db.url);
    const applied = newMigrations.filter((name) => deploy.out.includes(name));
    if (deploy.code !== 0) console.log(deploy.out.slice(-3000));
    record("prisma migrate deploy aplica só as migrations novas", deploy.code === 0 && applied.length === newMigrations.length, `saída ${deploy.code}; aplicadas: ${applied.join(", ")}`);
    const status = await prismaCli(["migrate", "status"], db.url);
    record("prisma migrate status: em dia", status.code === 0 && /up to date/i.test(status.out), status.out.split("\n").filter(Boolean).slice(-1)[0] ?? "");
    // 4. Drift contra o schema atual.
    const headDrift = await drift(db.url, join(REPO, "prisma/schema.prisma"));
    record("sem drift entre banco migrado e schema.prisma atual", headDrift.length === 0, headDrift.slice(0, 3).join(" | "));
    // 5. Legado preservado e protegido.
    const legacy = await db.query<{ salesOrderId: string | null; n: number }>(`select "salesOrderId", count(*)::int as n from "CommissionReceiptCoverage" where "receiptExternalId" = 555001 group by 1`);
    record("cobertura legada preservada como cobertura do evento inteiro", legacy.length === 1 && legacy[0]!.salesOrderId === null && legacy[0]!.n === 1, JSON.stringify(legacy));
    const insertSql = (salesOrderId: string | null) =>
      `INSERT INTO "CommissionReceiptCoverage" ("receiptExternalId","receivableExternalId","coverageSource","coverageStatus","naturalReceiptDate","naturalYear","naturalMonth","coveredReceivedAmount","associationMethod","salesOrderId") VALUES (555001, 5550, 'INDUSCOST_CLOSING', 'COVERED', '2026-09-10', 2026, 9, 1, 'INDUSCOST_LEDGER', ${salesOrderId ? `'${salesOrderId}'` : "NULL"});`;
    const refused = async (sql: string) => {
      const file = join(workDir, `try-${randomUUID()}.sql`);
      writeFileSync(file, sql);
      return executeSqlFile(db.url, file).then(
        () => false,
        () => true
      );
    };
    record("evento legado recusa segunda cobertura do evento (índice parcial)", await refused(insertSql(null)));
    record("evento legado recusa cobertura por direito (trigger)", await refused(insertSql(randomUUID())));

    // 6. Rollback manual na ordem inversa.
    for (const name of [...newMigrations].reverse()) {
      await executeSqlFile(db.url, join(REPO, "docs/commissions/rollback", `${name}.rollback.sql`));
    }
    const rollbackDrift = await drift(db.url, baseSchema);
    record("rollback devolve exatamente o schema da base", rollbackDrift.length === 0, rollbackDrift.slice(0, 3).join(" | "));
    const afterRollback = await db.query<{ n: number }>(`select count(*)::int as n from "CommissionReceiptCoverage" where "receiptExternalId" = 555001`);
    record("rollback preserva os dados legados", afterRollback[0]!.n === 1);

    // 7. Reimplantação depois do rollback.
    const unregister = join(workDir, "unregister.sql");
    writeFileSync(unregister, `DELETE FROM "_prisma_migrations" WHERE "migration_name" IN (${newMigrations.map((name) => `'${name}'`).join(", ")});`);
    await executeSqlFile(db.url, unregister);
    const redeploy = await prismaCli(["migrate", "deploy"], db.url);
    const redrift = await drift(db.url, join(REPO, "prisma/schema.prisma"));
    record("reimplantação após rollback: deploy ok e sem drift", redeploy.code === 0 && redrift.length === 0, redrift.slice(0, 3).join(" | "));
  } finally {
    await db.stop();
  }
  const failed = checks.filter((row) => !row.ok);
  console.log(`\n${checks.length - failed.length}/${checks.length} conferências OK.`);
  return failed.length === 0 ? 0 : 2;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
