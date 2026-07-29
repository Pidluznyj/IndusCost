/**
 * Agregação econômica da Gestão de Pedidos — usa payloads de margem do backend.
 */
import { aggregateSalesOrderMarginSummaries } from "./salesOrderMarginDisplay.js";
import {
  aggregateCommercialMarginPayloads,
  resolveCommercialMarginDisplayLabel,
  resolveCommercialMarginDisplayStatus,
} from "./salesOrderCommercialMarginReadModel.js";
import type {
  SalesOrderMarginItemResult,
  SalesOrderMarginSummaryPayload,
} from "./salesOrderMarginTypes.js";

/** Filtro futuro de status margem na gestão (UI opcional). */
export type SalesOrderMarginStatusFilter =
  | ""
  | "OK"
  | "PARTIAL"
  | "SEM_CUSTO"
  | "SEM_PRODUTO_VINCULADO"
  | "MARGEM_NEGATIVA"
  | "REVISAR_DADOS";

export const SALES_ORDER_MARGIN_STATUS_FILTER_OPTIONS: ReadonlyArray<{
  value: SalesOrderMarginStatusFilter;
  label: string;
}> = [
  { value: "", label: "Todos" },
  { value: "OK", label: "OK" },
  { value: "PARTIAL", label: "Parcial" },
  { value: "SEM_CUSTO", label: "Sem custo" },
  { value: "SEM_PRODUTO_VINCULADO", label: "Sem produto" },
  { value: "MARGEM_NEGATIVA", label: "Margem negativa" },
  { value: "REVISAR_DADOS", label: "Revisar dados" },
];

export type SalesOrderManagementMarginItemCounts = {
  itemsWithoutCost: number;
  itemsWithoutProduct: number;
  itemsWithNegativeMargin: number;
};

export type SalesOrderManagementMarginEconomics = {
  /** Consolida gerencial (receita/custo) + commercialMargin anexado. */
  consolidated: SalesOrderMarginSummaryPayload | null;
  ordersWithMarginData: number;
  ordersWithNegativeMargin: number;
  ordersWithoutCost: number;
  ordersWithoutProduct: number;
  itemCounts: SalesOrderManagementMarginItemCounts;
  scopeNote: string;
  /** Status canônico da margem comercial no filtro. */
  commercialStatus: "COMPLETE" | "PARTIAL" | "UNAVAILABLE";
  commercialLabel: string;
};

export function countMarginItemStatuses(
  itemResults: SalesOrderMarginItemResult[]
): SalesOrderManagementMarginItemCounts {
  let itemsWithoutCost = 0;
  let itemsWithoutProduct = 0;
  let itemsWithNegativeMargin = 0;
  for (const item of itemResults) {
    if (item.status === "SEM_CUSTO") itemsWithoutCost += 1;
    if (item.status === "SEM_PRODUTO_VINCULADO") itemsWithoutProduct += 1;
    if (item.status === "MARGEM_NEGATIVA") itemsWithNegativeMargin += 1;
  }
  return { itemsWithoutCost, itemsWithoutProduct, itemsWithNegativeMargin };
}

export function buildSalesOrderManagementMarginEconomics(
  rows: Array<{ marginSummary?: SalesOrderMarginSummaryPayload | null }>,
  itemResultsByOrderId?: Map<string, SalesOrderMarginItemResult[]>
): SalesOrderManagementMarginEconomics {
  const summaries = rows
    .map((row) => row.marginSummary)
    .filter((row): row is SalesOrderMarginSummaryPayload => Boolean(row));

  let ordersWithNegativeMargin = 0;
  let ordersWithoutCost = 0;
  let ordersWithoutProduct = 0;

  const itemCounts: SalesOrderManagementMarginItemCounts = {
    itemsWithoutCost: 0,
    itemsWithoutProduct: 0,
    itemsWithNegativeMargin: 0,
  };

  for (const row of rows) {
    const summary = row.marginSummary;
    if (!summary) continue;
    if (summary.hasNegativeMargin) ordersWithNegativeMargin += 1;
    if (summary.hasMissingCost) ordersWithoutCost += 1;
    if (summary.hasMissingProduct) ordersWithoutProduct += 1;
  }

  if (itemResultsByOrderId) {
    for (const results of itemResultsByOrderId.values()) {
      const counts = countMarginItemStatuses(results);
      itemCounts.itemsWithoutCost += counts.itemsWithoutCost;
      itemCounts.itemsWithoutProduct += counts.itemsWithoutProduct;
      itemCounts.itemsWithNegativeMargin += counts.itemsWithNegativeMargin;
    }
  }

  const managerial = aggregateSalesOrderMarginSummaries(summaries) ?? null;
  const commercialPayloads = summaries
    .map((row) => row.commercialMargin)
    .filter((row): row is NonNullable<typeof row> => Boolean(row));
  const commercialAggregate =
    commercialPayloads.length > 0
      ? aggregateCommercialMarginPayloads(commercialPayloads)
      : null;

  const consolidated = managerial
    ? {
        ...managerial,
        commercialMargin: commercialAggregate,
      }
    : commercialAggregate
      ? ({
          netRevenue: commercialAggregate.commercialSoldTotalValue,
          totalCost: 0,
          marginValue: commercialAggregate.commercialMarginTotalValue,
          marginPercent: commercialAggregate.commercialMarginTotalPercent,
          markup: null,
          itemsCount: commercialAggregate.itemsActive,
          validItemsCount: commercialAggregate.itemsCalculated,
          ignoredItemsCount: commercialAggregate.itemsUnavailable,
          hasMissingCost: commercialAggregate.itemsUnavailable > 0,
          hasMissingProduct: false,
          hasNegativeMargin:
            (commercialAggregate.commercialMarginTotalValue ?? 0) < 0,
          hasInvalidRevenue: false,
          status:
            commercialAggregate.isComplete
              ? "OK"
              : commercialAggregate.itemsCalculated > 0
                ? "PARTIAL"
                : "SEM_CUSTO",
          statusLabel: resolveCommercialMarginDisplayLabel(commercialAggregate),
          statusSeverity: commercialAggregate.isComplete
            ? "success"
            : commercialAggregate.itemsCalculated > 0
              ? "warning"
              : "danger",
          totalSalesRevenueInScope: commercialAggregate.totalActiveSoldValue,
          marginRevenueCovered: commercialAggregate.commercialSoldTotalValue,
          marginRevenueUncovered: Math.max(
            0,
            commercialAggregate.totalActiveSoldValue -
              commercialAggregate.commercialSoldTotalValue
          ),
          marginCoveragePercent:
            commercialAggregate.commercialMarginCoveragePercent,
          itemsTotal: commercialAggregate.itemsActive,
          itemsWithCost: commercialAggregate.itemsCalculated,
          itemsWithoutCost: commercialAggregate.itemsUnavailable,
          costCoverageStatus: commercialAggregate.isComplete
            ? "FULL"
            : commercialAggregate.itemsCalculated > 0
              ? "PARTIAL"
              : "NONE",
          commercialMargin: commercialAggregate,
        } satisfies SalesOrderMarginSummaryPayload)
      : null;

  const commercialStatus = resolveCommercialMarginDisplayStatus(commercialAggregate);
  const commercialLabel = resolveCommercialMarginDisplayLabel(commercialAggregate);

  return {
    consolidated,
    ordersWithMarginData: summaries.length,
    ordersWithNegativeMargin,
    ordersWithoutCost,
    ordersWithoutProduct,
    itemCounts,
    commercialStatus,
    commercialLabel,
    scopeNote: (() => {
      if (!commercialAggregate || commercialStatus === "UNAVAILABLE") {
        return "Margem comercial indisponível no filtro atual — nenhum item com formação histórica calculada.";
      }
      if (commercialStatus === "COMPLETE") {
        return "Margem comercial do período — Σ R$ / Σ valor líquido coberto (ponderada). 100% dos itens ativos calculados.";
      }
      return `Margem comercial parcial — ${commercialAggregate.itemsCalculated} de ${commercialAggregate.itemsActive} itens calculados (cobertura ${commercialAggregate.commercialMarginCoveragePercent ?? 0}% do valor vendido).`;
    })(),
  };
}

export function matchesSalesOrderMarginStatusFilter(
  summary: SalesOrderMarginSummaryPayload | null | undefined,
  filter: SalesOrderMarginStatusFilter
): boolean {
  if (!filter) return true;
  if (!summary) return false;
  return summary.status === filter;
}
