/**
 * Cobertura de receita na margem de venda — distingue margem total vs parcial.
 */
import { roundPricingMoney, roundPricingPercent } from "./pricingCalculations.js";
import { isSalesOrderMarginConsolidationEligible } from "./salesOrderMarginStatus.js";
import type {
  SalesOrderMarginCostCoverageStatus,
  SalesOrderMarginCoveragePayload,
  SalesOrderMarginItemResult,
  SalesOrderMarginSummaryPayload,
} from "./salesOrderMarginTypes.js";

export function isSalesOrderMarginItemInSalesScope(
  status: SalesOrderMarginItemResult["status"]
): boolean {
  return status !== "ITEM_CANCELADO";
}

export function computeSalesOrderMarginCoverageFromItems(
  items: SalesOrderMarginItemResult[]
): SalesOrderMarginCoveragePayload {
  let totalSalesRevenueInScope = 0;
  let marginRevenueCovered = 0;
  let itemsTotal = 0;
  let itemsWithCost = 0;
  let itemsWithoutCost = 0;

  for (const item of items) {
    if (!isSalesOrderMarginItemInSalesScope(item.status)) continue;

    itemsTotal += 1;
    totalSalesRevenueInScope += item.netRevenue;

    if (item.status === "SEM_CUSTO") {
      itemsWithoutCost += 1;
      continue;
    }

    if (isSalesOrderMarginConsolidationEligible(item.status) || item.status === "MARGEM_NEGATIVA") {
      marginRevenueCovered += item.netRevenue;
      if (item.marginValue != null && Number.isFinite(item.marginValue)) {
        itemsWithCost += 1;
      }
    }
  }

  totalSalesRevenueInScope = roundPricingMoney(totalSalesRevenueInScope);
  marginRevenueCovered = roundPricingMoney(marginRevenueCovered);
  const marginRevenueUncovered = roundPricingMoney(
    Math.max(0, totalSalesRevenueInScope - marginRevenueCovered)
  );

  const marginCoveragePercent =
    totalSalesRevenueInScope > 0
      ? roundPricingPercent((marginRevenueCovered / totalSalesRevenueInScope) * 100)
      : null;

  let costCoverageStatus: SalesOrderMarginCostCoverageStatus = "NONE";
  if (itemsWithCost > 0 && itemsWithoutCost === 0 && marginRevenueUncovered <= 0.01) {
    costCoverageStatus = "FULL";
  } else if (itemsWithCost > 0) {
    costCoverageStatus = "PARTIAL";
  }

  return {
    totalSalesRevenueInScope,
    marginRevenueCovered,
    marginRevenueUncovered,
    marginCoveragePercent,
    itemsTotal,
    itemsWithCost,
    itemsWithoutCost,
    costCoverageStatus,
  };
}

export function mergeSalesOrderMarginCoveragePayloads(
  payloads: SalesOrderMarginCoveragePayload[]
): SalesOrderMarginCoveragePayload {
  if (payloads.length === 0) {
    return {
      totalSalesRevenueInScope: 0,
      marginRevenueCovered: 0,
      marginRevenueUncovered: 0,
      marginCoveragePercent: null,
      itemsTotal: 0,
      itemsWithCost: 0,
      itemsWithoutCost: 0,
      costCoverageStatus: "NONE",
    };
  }

  const merged = payloads.reduce(
    (acc, row) => ({
      totalSalesRevenueInScope: acc.totalSalesRevenueInScope + row.totalSalesRevenueInScope,
      marginRevenueCovered: acc.marginRevenueCovered + row.marginRevenueCovered,
      itemsTotal: acc.itemsTotal + row.itemsTotal,
      itemsWithCost: acc.itemsWithCost + row.itemsWithCost,
      itemsWithoutCost: acc.itemsWithoutCost + row.itemsWithoutCost,
    }),
    {
      totalSalesRevenueInScope: 0,
      marginRevenueCovered: 0,
      itemsTotal: 0,
      itemsWithCost: 0,
      itemsWithoutCost: 0,
    }
  );

  const totalSalesRevenueInScope = roundPricingMoney(merged.totalSalesRevenueInScope);
  const marginRevenueCovered = roundPricingMoney(merged.marginRevenueCovered);
  const marginRevenueUncovered = roundPricingMoney(
    Math.max(0, totalSalesRevenueInScope - marginRevenueCovered)
  );
  const marginCoveragePercent =
    totalSalesRevenueInScope > 0
      ? roundPricingPercent((marginRevenueCovered / totalSalesRevenueInScope) * 100)
      : null;

  let costCoverageStatus: SalesOrderMarginCostCoverageStatus = "NONE";
  if (
    merged.itemsWithCost > 0 &&
    merged.itemsWithoutCost === 0 &&
    marginRevenueUncovered <= 0.01
  ) {
    costCoverageStatus = "FULL";
  } else if (merged.itemsWithCost > 0) {
    costCoverageStatus = "PARTIAL";
  }

  return {
    totalSalesRevenueInScope,
    marginRevenueCovered,
    marginRevenueUncovered,
    marginCoveragePercent,
    itemsTotal: merged.itemsTotal,
    itemsWithCost: merged.itemsWithCost,
    itemsWithoutCost: merged.itemsWithoutCost,
    costCoverageStatus,
  };
}

export function attachCoverageToMarginSummary(
  summary: Omit<SalesOrderMarginSummaryPayload, keyof SalesOrderMarginCoveragePayload>,
  coverage: SalesOrderMarginCoveragePayload
): SalesOrderMarginSummaryPayload {
  return { ...summary, ...coverage };
}

export function resolveSalesOrderMarginMoneyLabel(
  coverage?: Pick<SalesOrderMarginCoveragePayload, "costCoverageStatus"> | null
): string {
  switch (coverage?.costCoverageStatus) {
    case "PARTIAL":
      return "Margem parcial (R$)";
    case "NONE":
      return "Margem indisponível";
    case "FULL":
    default:
      return "Margem gerencial (R$)";
  }
}

export function resolveSalesOrderMarginPercentLabel(
  coverage?: Pick<SalesOrderMarginCoveragePayload, "costCoverageStatus"> | null
): string {
  switch (coverage?.costCoverageStatus) {
    case "PARTIAL":
      return "Margem parcial (%)";
    case "NONE":
      return "Margem % indisponível";
    case "FULL":
    default:
      return "Margem gerencial (%)";
  }
}

export function resolveSalesOrderMarginRevenueLabel(
  summary?: Pick<SalesOrderMarginSummaryPayload, "taxMode"> | null
): string {
  return summary?.taxMode === "none" ? "Valor vendido" : "Receita líquida gerencial";
}

export function buildSalesOrderMarginCoverageHint(
  coverage: SalesOrderMarginCoveragePayload,
  formatMoney: (value: number) => string
): string {
  if (coverage.costCoverageStatus === "FULL") {
    return "Margem calculada sobre 100% da receita vendida no escopo filtrado.";
  }
  if (coverage.costCoverageStatus === "NONE") {
    return "Nenhuma linha com custo disponível — margem não calculada; receita e impostos permanecem identificados.";
  }
  const covered = formatMoney(coverage.marginRevenueCovered);
  const total = formatMoney(coverage.totalSalesRevenueInScope);
  const pct =
    coverage.marginCoveragePercent != null
      ? `${coverage.marginCoveragePercent.toFixed(2)}%`
      : "—";
  return `Margem calculada sobre ${covered} de ${total} vendidos (${pct} da receita), pois há ${coverage.itemsWithoutCost} linha(s) sem custo de ${coverage.itemsTotal}.`;
}

export function marginLabelLooksLikeTotal(label: string): boolean {
  const normalized = label.trim().toLowerCase();
  if (normalized.includes("parcial")) return false;
  if (normalized.includes("indisponível")) return false;
  return (
    normalized.includes("margem total") ||
    normalized.includes("margem r$ total") ||
    normalized === "margem r$" ||
    normalized === "margem do período (r$)"
  );
}
