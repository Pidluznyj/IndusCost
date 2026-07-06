/**
 * Apply — classificação em lote de centros de custo em títulos AP elegíveis.
 *
 * Uso (dry-run — sem alteração):
 *   npx tsx scripts/finance-cost-center-classification-apply.ts
 *   npx tsx scripts/finance-cost-center-classification-apply.ts --unclassified-only
 *
 * Apply real (exige confirmação textual):
 *   npx tsx scripts/finance-cost-center-classification-apply.ts \
 *     --unclassified-only \
 *     --confirm="APLICAR CENTROS DE CUSTO AP"
 *
 * Não altera NomusAccountsPayable nem executa sync Nomus.
 */
import "dotenv/config";
import {
  applyBatchAccountsPayableAllocationDefault,
  type BatchAllocationFilters,
} from "../src/lib/financeAccountsPayableCostCenterAllocation.js";
import { FINANCE_AP_ALLOCATION_BATCH_CONFIRMATION_TEXT } from "../src/lib/financeApAllocationShared.js";
import {
  FINANCE_CLI_LOG_PREFIX,
  FINANCE_CLI_USER,
  logDryRunApplyRequired,
  parseConfirmArg,
  parseFlag,
  parseStringArg,
  requireDatabaseUrl,
} from "../src/lib/financeCostCenterScriptsCli.js";

function parseFilters(argv: string[]): BatchAllocationFilters {
  const filters: BatchAllocationFilters = {};
  if (parseFlag(argv, "--unclassified-only")) filters.unclassifiedOnly = true;
  const company = parseStringArg(argv, "company");
  if (company) filters.companyName = company;
  const supplierId = parseStringArg(argv, "supplier-id");
  if (supplierId) filters.supplierId = supplierId;
  return filters;
}

async function main(): Promise<void> {
  const prefix = FINANCE_CLI_LOG_PREFIX.classificationApply;
  requireDatabaseUrl(prefix);

  const argv = process.argv.slice(2);
  const confirm = parseConfirmArg(argv);
  if (!confirm) {
    logDryRunApplyRequired(prefix, FINANCE_AP_ALLOCATION_BATCH_CONFIRMATION_TEXT);
    process.exit(0);
  }

  const filters = parseFilters(argv);
  console.warn(`${prefix} Aplicando classificação em lote…`);

  const result = await applyBatchAccountsPayableAllocationDefault(
    filters,
    confirm,
    {
      userId: FINANCE_CLI_USER.userId,
      userName: FINANCE_CLI_USER.userName,
    }
  );

  console.warn(`${prefix} Apply concluído em ${result.appliedAt}`);
  console.warn(`${prefix} Criados: ${result.created} · Substituídos: ${result.replaced}`);
  console.warn(`${prefix} Ignorados: ${result.skipped}`);
  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error(FINANCE_CLI_LOG_PREFIX.classificationApply, err);
  process.exit(1);
});
