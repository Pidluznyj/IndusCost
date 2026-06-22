/**
 * Apply — reconstrução de fornecedores financeiros a partir de AP.
 *
 * Uso (dry-run — sem alteração):
 *   npx tsx scripts/finance-suppliers-from-ap-apply.ts
 *
 * Apply real (exige confirmação textual):
 *   npx tsx scripts/finance-suppliers-from-ap-apply.ts --confirm="RECONSTRUIR FORNECEDORES AP"
 *
 * Não altera NomusAccountsPayable nem executa sync Nomus.
 */
import "dotenv/config";
import { applyFinancialSuppliersFromAccountsPayableDefault } from "../src/lib/financeSupplierRebuild.js";
import { FINANCE_SUPPLIER_REBUILD_CONFIRMATION_TEXT } from "../src/lib/financeSupplierRebuildShared.js";
import {
  FINANCE_CLI_LOG_PREFIX,
  FINANCE_CLI_USER,
  logDryRunApplyRequired,
  parseConfirmArg,
  requireDatabaseUrl,
} from "../src/lib/financeCostCenterScriptsCli.js";

async function main(): Promise<void> {
  const prefix = FINANCE_CLI_LOG_PREFIX.suppliersApply;
  requireDatabaseUrl(prefix);

  const confirm = parseConfirmArg(process.argv.slice(2));
  if (!confirm) {
    logDryRunApplyRequired(prefix, FINANCE_SUPPLIER_REBUILD_CONFIRMATION_TEXT);
    process.exit(0);
  }

  console.warn(`${prefix} Aplicando rebuild de fornecedores…`);

  const result = await applyFinancialSuppliersFromAccountsPayableDefault({
    confirmationText: confirm,
    userId: FINANCE_CLI_USER.userId,
    userName: FINANCE_CLI_USER.userName,
  });

  console.warn(`${prefix} Apply concluído em ${result.appliedAt}`);
  console.warn(`${prefix} Novos: ${result.newSuppliers} · Atualizados: ${result.updatedSuppliers}`);
  console.warn(`${prefix} Aliases novos: ${result.newAliases} · Aliases atualizados: ${result.updatedAliases}`);
  console.warn(`${prefix} Ignorados: ${result.skippedSuppliers}`);
  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error(FINANCE_CLI_LOG_PREFIX.suppliersApply, err);
  process.exit(1);
});
