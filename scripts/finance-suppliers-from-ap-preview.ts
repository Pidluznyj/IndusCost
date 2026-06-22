/**
 * Preview — reconstrução de fornecedores financeiros a partir de AP (read-only).
 *
 * Uso:
 *   npx tsx scripts/finance-suppliers-from-ap-preview.ts
 *   npx tsx scripts/finance-suppliers-from-ap-preview.ts --out=tmp/suppliers-preview.json
 *
 * Não altera NomusAccountsPayable nem executa sync Nomus.
 */
import "dotenv/config";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { buildFinancialSuppliersFromAccountsPayablePreviewDefault } from "../src/lib/financeSupplierRebuild.js";
import {
  FINANCE_CLI_LOG_PREFIX,
  formatCliMoney,
  parseOutArg,
  requireDatabaseUrl,
} from "../src/lib/financeCostCenterScriptsCli.js";

async function main(): Promise<void> {
  const prefix = FINANCE_CLI_LOG_PREFIX.suppliersPreview;
  requireDatabaseUrl(prefix);

  const payload = await buildFinancialSuppliersFromAccountsPayablePreviewDefault();

  console.warn(`${prefix} === Preview fornecedores AP ===`);
  console.warn(`${prefix} Títulos analisados: ${payload.totalTitlesAnalyzed}`);
  console.warn(`${prefix} Fornecedores detectados: ${payload.suppliersDetected}`);
  console.warn(`${prefix} Novos fornecedores: ${payload.newSuppliers}`);
  console.warn(`${prefix} Atualizações: ${payload.updatedSuppliers}`);
  console.warn(`${prefix} Somente estatísticas (manual): ${payload.statsOnlyUpdates}`);
  console.warn(`${prefix} Ignorados: ${payload.skippedSuppliers}`);
  console.warn(`${prefix} Novos aliases: ${payload.newAliases}`);
  console.warn(`${prefix} Aliases atualizados: ${payload.updatedAliases}`);
  console.warn(`${prefix} Registros sem fornecedor: ${payload.unidentifiableRecords}`);
  console.warn(`${prefix} Duplicidades potenciais: ${payload.potentialDuplicates.length}`);

  if (payload.potentialDuplicates.length > 0) {
    console.warn(`${prefix} --- Duplicidades (amostra) ---`);
    for (const dup of payload.potentialDuplicates.slice(0, 10)) {
      const keys = dup.identityKeys.join(" ↔ ");
      console.warn(`${prefix}   ${keys} (${dup.kind})`);
    }
  }

  if (payload.topSuppliersByAmount.length > 0) {
    console.warn(`${prefix} --- Top fornecedores por valor ---`);
    for (const row of payload.topSuppliersByAmount.slice(0, 10)) {
      console.warn(
        `${prefix}   ${row.displayName}: ${row.titlesCount} título(s) · R$ ${formatCliMoney(row.totalAmount)}`
      );
    }
  }

  if (payload.warnings.length > 0) {
    console.warn(`${prefix} Avisos: ${payload.warnings.join(", ")}`);
  }

  console.warn(
    `${prefix} Confirmação apply: "${payload.requiredConfirmationText}"`
  );

  const json = JSON.stringify(payload, null, 2);
  console.log(json);

  const outPath = parseOutArg(process.argv.slice(2));
  if (outPath) {
    const resolved = resolve(outPath);
    mkdirSync(dirname(resolved), { recursive: true });
    writeFileSync(resolved, json, "utf8");
    console.warn(`${prefix} Preview gravado em ${resolved}`);
  }
}

main().catch((err) => {
  console.error(FINANCE_CLI_LOG_PREFIX.suppliersPreview, err);
  process.exit(1);
});
