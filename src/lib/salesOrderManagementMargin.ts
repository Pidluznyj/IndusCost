/**
 * Agregação econômica da Gestão de Pedidos — usa payloads de margem do backend.
 */
import { aggregateSalesOrderMarginSummaries } from "./salesOrderMarginDisplay.js";
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
  consolidated: SalesOrderMarginSummaryPayload | null;
  ordersWithMarginData: number;
  ordersWithNegativeMargin: number;
  ordersWithoutCost: number;
  ordersWithoutProduct: number;
  itemCounts: SalesOrderManagementMarginItemCounts;
  scopeNote: string;
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

  return {
    consolidated: aggregateSalesOrderMarginSummaries(summaries) ?? null,
    ordersWithMarginData: summaries.length,
    ordersWithNegativeMargin,
    ordersWithoutCost,
    ordersWithoutProduct,
    itemCounts,
    scopeNote:
      "Totais econômicos consolidados de todos os pedidos do filtro atual (margem % ponderada por receita).",
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
