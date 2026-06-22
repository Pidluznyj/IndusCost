/**
 * Preview — classificação em lote de centros de custo em títulos AP elegíveis (read-only).
 *
 * Uso:
 *   npx tsx scripts/finance-cost-center-classification-preview.ts
 *   npx tsx scripts/finance-cost-center-classification-preview.ts --unclassified-only
 *   npx tsx scripts/finance-cost-center-classification-preview.ts --company="Empresa X"
 *   npx tsx scripts/finance-cost-center-classification-preview.ts --out=tmp/cc-preview.json
 *
 * Não altera NomusAccountsPayable nem executa sync Nomus.
 */
import "dotenv/config";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  previewBatchAccountsPayableAllocationDefault,
  type BatchAllocationFilters,
} from "../src/lib/financeAccountsPayableCostCenterAllocation.js";
import {
  FINANCE_CLI_LOG_PREFIX,
  formatCliMoney,
  parseFlag,
  parseOutArg,
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

function aggregateByCostCenter(
  items: Awaited<ReturnType<typeof previewBatchAccountsPayableAllocationDefault>>["items"]
) {
  const map = new Map<string, { costCenterId: string; titles: number; amount: number }>();
  for (const item of items) {
    if (item.action !== "create" && item.action !== "replace") continue;
    for (const line of item.lines) {
      const row = map.get(line.costCenterId) ?? {
        costCenterId: line.costCenterId,
        titles: 0,
        amount: 0,
      };
      row.titles += 1;
      row.amount += line.amount;
      map.set(line.costCenterId, row);
    }
  }
  return [...map.values()].sort((a, b) => b.amount - a.amount);
}

async function main(): Promise<void> {
  const prefix = FINANCE_CLI_LOG_PREFIX.classificationPreview;
  requireDatabaseUrl(prefix);

  const filters = parseFilters(process.argv.slice(2));
  const payload = await previewBatchAccountsPayableAllocationDefault(filters);
  const byCc = aggregateByCostCenter(payload.items);

  console.warn(`${prefix} === Preview classificação CC ===`);
  console.warn(`${prefix} Títulos analisados: ${payload.summary.analyzed}`);
  console.warn(`${prefix} Criariam classificação: ${payload.summary.wouldCreate}`);
  console.warn(`${prefix} Substituiriam classificação: ${payload.summary.wouldReplace}`);
  console.warn(`${prefix} Ignorados: ${payload.summary.skipped}`);
  console.warn(`${prefix} Manuais preservados (bloqueados): ${payload.summary.skippedManualLocked}`);
  console.warn(`${prefix} Sem regra aplicável: ${payload.summary.skippedNoRule}`);
  console.warn(`${prefix} Período fechado: ${payload.summary.skippedClosedPeriod}`);

  if (byCc.length > 0) {
    console.warn(`${prefix} --- Valores por centro de custo (preview) ---`);
    for (const row of byCc.slice(0, 20)) {
      console.warn(
        `${prefix}   ${row.costCenterId}: ${row.titles} linha(s) · R$ ${formatCliMoney(row.amount)}`
      );
    }
  }

  const applicable = payload.items.filter(
    (item) => item.action === "create" || item.action === "replace"
  );
  if (applicable.length > 0) {
    console.warn(`${prefix} --- Títulos que seriam classificados (amostra) ---`);
    for (const item of applicable.slice(0, 15)) {
      const ccIds = [...new Set(item.lines.map((line) => line.costCenterId))].join(", ");
      console.warn(
        `${prefix}   AP ${item.accountsPayableId} · ${item.action} · CC: ${ccIds} · R$ ${formatCliMoney(item.titleAmount)}`
      );
    }
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
  console.error(FINANCE_CLI_LOG_PREFIX.classificationPreview, err);
  process.exit(1);
});
