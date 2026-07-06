/**
 * Verificação read-only de integridade — fornecedores, regras e alocações CC/AP.
 *
 * Uso:
 *   npx tsx scripts/finance-cost-center-integrity-check.ts
 *   npx tsx scripts/finance-cost-center-integrity-check.ts --out=tmp/cc-integrity.json
 *
 * Exit codes:
 *   0 — sem problemas
 *   1 — avisos (warnings)
 *   2 — problemas críticos
 *   3 — DATABASE_URL ausente ou falha de conexão
 *
 * Não altera dados.
 */
import "dotenv/config";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { Prisma } from "@prisma/client";
import {
  printFinanceCostCenterIntegritySummary,
  runFinanceCostCenterIntegrityCheckDefault,
} from "../src/lib/financeCostCenterIntegrityCheck.js";
import {
  FINANCE_CLI_LOG_PREFIX,
  parseOutArg,
  requireDatabaseUrl,
} from "../src/lib/financeCostCenterScriptsCli.js";

async function main(): Promise<void> {
  const prefix = FINANCE_CLI_LOG_PREFIX.integrityCheck;
  requireDatabaseUrl(prefix);

  const report = await runFinanceCostCenterIntegrityCheckDefault();
  printFinanceCostCenterIntegritySummary(report);

  const json = JSON.stringify(report, null, 2);
  console.log(json);

  const outPath = parseOutArg(process.argv.slice(2));
  if (outPath) {
    const resolved = resolve(outPath);
    mkdirSync(dirname(resolved), { recursive: true });
    writeFileSync(resolved, json, "utf8");
    console.warn(`${prefix} Relatório gravado em ${resolved}`);
  }

  if (report.summary.critical > 0) {
    process.exitCode = 2;
  } else if (report.summary.total > 0) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  if (
    err instanceof Prisma.PrismaClientInitializationError ||
    (err instanceof Error && err.message.includes("Can't reach database server"))
  ) {
    console.error(
      `${FINANCE_CLI_LOG_PREFIX.integrityCheck} Não foi possível conectar ao banco. Verifique DATABASE_URL.`
    );
    process.exit(3);
  }
  console.error(FINANCE_CLI_LOG_PREFIX.integrityCheck, err);
  process.exit(1);
});
