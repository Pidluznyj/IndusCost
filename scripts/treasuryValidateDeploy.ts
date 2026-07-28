/**
 * Validação dry-run pré/pós deploy da Central de Tesouraria.
 * Não escreve no banco; não exige DATABASE_URL.
 *
 * Uso: npx tsx scripts/treasuryValidateDeploy.ts
 * npm: npm run validate:treasury:deploy
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const LOG = "[treasury-validate-deploy]";
const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

type Check = { id: string; ok: boolean; detail: string };

function check(id: string, ok: boolean, detail: string): Check {
  return { id, ok, detail };
}

export function runTreasuryValidateDeploy(repoRoot = root): {
  ok: boolean;
  checks: Check[];
} {
  const schemaPath = join(repoRoot, "prisma/schema.prisma");
  const routesPath = join(repoRoot, "src/lib/treasury/treasuryRoutes.ts");
  const statusPath = join(repoRoot, "docs/treasury/IMPLEMENTATION_STATUS.md");
  const runbookPath = join(repoRoot, "docs/treasury/DEPLOYMENT_RUNBOOK.md");
  const ledgerMigration = join(
    repoRoot,
    "prisma/migrations/20260821120000_treasury_ledger_entry/migration.sql"
  );

  const schema = existsSync(schemaPath)
    ? readFileSync(schemaPath, "utf8")
    : "";
  const routes = existsSync(routesPath)
    ? readFileSync(routesPath, "utf8")
    : "";

  const checks: Check[] = [
    check("schema.exists", existsSync(schemaPath), schemaPath),
    check(
      "schema.treasuryLedgerEntry",
      /model TreasuryLedgerEntry \{/.test(schema),
      "model TreasuryLedgerEntry"
    ),
    check(
      "schema.treasuryFinancialAccount",
      /model TreasuryFinancialAccount \{/.test(schema),
      "model TreasuryFinancialAccount"
    ),
    check(
      "migration.ledger",
      existsSync(ledgerMigration),
      ledgerMigration
    ),
    check("routes.exists", existsSync(routesPath), routesPath),
    check(
      "routes.ledgerEntries",
      /TREASURY_LEDGER_ENTRIES_PATH/.test(routes),
      "ledger-entries routes"
    ),
    check(
      "routes.health",
      /TREASURY_HEALTH_PATH/.test(routes),
      "health route"
    ),
    check(
      "routes.audit",
      /TREASURY_AUDIT_PATH/.test(routes),
      "audit route"
    ),
    check("docs.status", existsSync(statusPath), statusPath),
    check("docs.runbook", existsSync(runbookPath), runbookPath),
  ];

  const ok = checks.every((c) => c.ok);
  return { ok, checks };
}

function main(): void {
  const result = runTreasuryValidateDeploy();
  for (const c of result.checks) {
    console.warn(
      `${LOG} ${c.ok ? "PASS" : "FAIL"} ${c.id} — ${c.detail}`
    );
  }
  if (!result.ok) {
    console.error(`${LOG} validação falhou`);
    process.exitCode = 2;
    return;
  }
  console.warn(`${LOG} ok (${result.checks.length} checks)`);
}

const isDirect =
  process.argv[1]?.includes("treasuryValidateDeploy") ||
  process.argv[1]?.replace(/\\/g, "/").endsWith("treasuryValidateDeploy.ts");

if (isDirect) {
  main();
}
