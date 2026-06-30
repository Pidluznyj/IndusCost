#!/usr/bin/env npx tsx
/**
 * Auditoria da configuração de margem Nomus vs motor oficial.
 *
 * Uso:
 *   npx tsx scripts/audit-sales-margin-configuration.ts --year=2026 --month=6 --asOfDate=2026-06-29
 */
import { prisma } from "../src/lib/prisma.js";
import { resolveSalesTaxRuleById } from "../src/lib/averageSalesTaxEngine.js";
import { buildSalesMarginNomusPreview } from "../src/lib/salesMarginNomusConfig.server.js";
import {
  assessSalesMarginNomusFiscalConfig,
  loadSalesMarginNomusConfig,
} from "../src/lib/salesMarginNomusConfig.js";
import { OFFICIAL_SM_RULES_SOURCE } from "../src/lib/salesMarginRulesAdapter.js";
import { readFileSync } from "node:fs";
import { join } from "node:path";

function parseArg(name: string): string | undefined {
  const prefix = `--${name}=`;
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith(prefix)) return arg.slice(prefix.length);
  }
  return undefined;
}

function fmt(n: unknown): string {
  if (n == null) return "—";
  if (typeof n === "number" && Number.isFinite(n)) return n.toFixed(2);
  return String(n);
}

async function main() {
  const year = Number(parseArg("year") ?? "2026");
  const month = Number(parseArg("month") ?? "6");
  const asOfDate = parseArg("asOfDate") ?? "2026-06-29";

  if (!process.env.DATABASE_URL?.trim()) {
    console.warn("DATABASE_URL ausente — auditoria de configuração requer banco.");
    process.exitCode = 1;
    return;
  }

  try {
  const [{ config, configRowId }, preview] = await Promise.all([
    loadSalesMarginNomusConfig(prisma),
    buildSalesMarginNomusPreview(prisma, { year, month, asOfDate }),
  ]);

  const taxRule = config.defaultTaxRuleId
    ? await resolveSalesTaxRuleById(prisma, config.defaultTaxRuleId)
    : null;

  const fiscalAssessment = assessSalesMarginNomusFiscalConfig(
    config,
    taxRule,
    preview.taxRuleSource
  );

  const configOrigin = configRowId
    ? `IndirectCost/GLOBAL_PARAM (${configRowId})`
    : "IndirectCost/GLOBAL_PARAM — linha não encontrada (defaults em memória)";

  console.log(`Auditoria config margem Nomus — year=${year} month=${month} asOfDate=${asOfDate}\n`);
  console.log("### Configuração fiscal");
  console.log(`- configRowId: ${configRowId ?? "—"}`);
  console.log(`- origem: ${configOrigin}`);
  console.log(`- taxMode: ${config.taxMode}`);
  console.log(`- defaultTaxRuleId: ${config.defaultTaxRuleId ?? "—"}`);
  console.log(`- TaxRule encontrada: ${taxRule?.name ?? preview.taxRule?.name ?? "—"}`);
  console.log(`- TaxRule status: ${taxRule?.status ?? preview.taxRule?.status ?? "—"}`);
  console.log(
    `- percentual total: ${taxRule?.totalPercent ?? preview.taxRule?.totalPercent ?? "—"}`
  );
  console.log(`- taxRuleSource (motor): ${preview.taxRuleSource}`);
  console.log(`- usa fallback: ${fiscalAssessment.usesFallback || preview.taxRuleSource.includes("fallback") ? "sim" : "não"}`);
  console.log(`- fiscalConfigComplete: ${preview.taxRuleSource.includes("INCOMPLETA") ? "não" : fiscalAssessment.status === "OK" || config.taxMode === "none" ? "sim" : "não"}`);
  console.log(`- resultado: ${fiscalAssessment.status}`);
  if (fiscalAssessment.reasons.length > 0) {
    for (const reason of fiscalAssessment.reasons) console.log(`  · ${reason}`);
  }
  console.log(`- metricsSource: ${OFFICIAL_SM_RULES_SOURCE}`);

  console.log("\n### Comportamento");
  console.log(`- useFrozenUnitCostFirst: ${config.useFrozenUnitCostFirst}`);
  console.log(`- allowLiveCostFallback: ${config.allowLiveCostFallback}`);
  console.log(`- showPartialCoverageWarning: ${config.showPartialCoverageWarning}`);

  console.log("\n### Preview motor oficial");
  console.log(`- pedidos: ${preview.ordersCount}`);
  console.log(`- totalSalesRevenueInScope: ${fmt(preview.totalSalesRevenueInScope)}`);
  console.log(`- marginRevenueCovered: ${fmt(preview.marginRevenueCovered)}`);
  console.log(`- marginRevenueUncovered: ${fmt(preview.marginRevenueUncovered)}`);
  console.log(`- costCoverageStatus: ${preview.costCoverageStatus}`);
  console.log(`- totalCost: ${fmt(preview.totalCost)}`);
  console.log(`- taxAmount: ${fmt(preview.taxAmount)}`);
  console.log(`- marginValue: ${fmt(preview.marginValue)}`);
  console.log(`- marginPercent: ${preview.marginPercent == null ? "—" : `${fmt(preview.marginPercent)}%`}`);
  console.log(`- itemsWithFrozenSnapshot: ${preview.itemsWithFrozenSnapshot}`);
  console.log(`- itemsUsingLiveFallback: ${preview.itemsUsingLiveFallback}`);
  console.log(`- itemsWithoutCost: ${preview.itemsWithoutCost}`);

  if (preview.warnings.length > 0) {
    console.log("\n### Avisos preview");
    for (const w of preview.warnings) console.log(`- ${w}`);
  }

  const adapterSrc = readFileSync(
    join(process.cwd(), "src/lib/salesMarginRulesAdapter.ts"),
    "utf8"
  );
  if (!adapterSrc.includes("loadSalesMarginNomusConfig")) {
    console.error("\nERRO: motor não consome loadSalesMarginNomusConfig.");
    process.exitCode = 1;
  }

  const panelSrc = readFileSync(
    join(process.cwd(), "src/components/settings/SalesMarginNomusConfigPanel.tsx"),
    "utf8"
  );
  if (panelSrc.includes("marginValue / netRevenue") || panelSrc.match(/marginPercent\s*=.*\/\s*preview/)) {
    console.error("\nERRO: frontend calcula margem localmente.");
    process.exitCode = 1;
  }

  if (fiscalAssessment.status === "BLOQUEANTE") {
    console.error("\nBLOQUEANTE: configuração fiscal incompleta — corrija antes de confiar na margem gerencial.");
    console.error("Execute também: npm run check:sales-margin-policy");
    process.exitCode = 1;
  }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("\nFalha de conexão ou consulta ao banco:", message.split("\n")[0]);
    console.error("Verifique DATABASE_URL e se o PostgreSQL está ativo.");
    process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
