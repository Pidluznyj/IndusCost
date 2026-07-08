/**
 * Helpers puros do gráfico mensal por centro de custo (Mapa de Gastos).
 * Client-safe — sem Prisma / dashboard server.
 */
import { roundMoney } from "./financeAccountsPayableDashboard.js";
import type { FinanceCostCentersUiFilters } from "./financeCostCentersPageTypes.js";
import { buildFinanceCostCentersDashboardQuery } from "./financeCostCentersPageTypes.js";

export const COST_CENTER_MONTHLY_CHART_MONTH_LABELS = [
  "Jan",
  "Fev",
  "Mar",
  "Abr",
  "Mai",
  "Jun",
  "Jul",
  "Ago",
  "Set",
  "Out",
  "Nov",
  "Dez",
] as const;

/** Linha mínima da série mensal byCostCenter — alinhada ao dashboard oficial. */
export type CostCenterMonthlyChartSourceRow = {
  year: number;
  month: number;
  costCenterId: string;
  paidAmount: number;
  openAmount: number;
  amount: number;
};

export type CostCenterMonthlyChartPoint = {
  year: number;
  month: number;
  monthLabel: string;
  paidAmount: number;
  openAmount: number;
  totalAmount: number;
  highlighted: boolean;
};

export type CostCenterMonthlyChartPayload = {
  year: number;
  costCenterIds: string[];
  series: CostCenterMonthlyChartPoint[];
  hasData: boolean;
  periodLabel: string;
  metricsScope: string;
  highlightMonth: number | null;
};

export function formatCostCenterMonthlyChartPeriodLabel(
  year: number,
  month?: number | null
): string {
  if (month != null && month >= 1 && month <= 12) {
    return `${String(month).padStart(2, "0")}/${year} (mês filtrado destacado no gráfico)`;
  }
  return `Ano ${year} — janeiro a dezembro`;
}

export function parseCostCenterMonthlyChartCostCenterIds(
  query: Record<string, unknown>
): string[] {
  const rawList =
    typeof query.costCenterIds === "string" && query.costCenterIds.trim()
      ? query.costCenterIds
      : typeof query.costCenterId === "string" && query.costCenterId.trim()
        ? query.costCenterId
        : "";
  return [
    ...new Set(
      rawList
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean)
    ),
  ];
}

export function buildCostCenterMonthlyChartFilters<T extends { month?: number }>(
  filters: T
): T & { month?: undefined } {
  return {
    ...filters,
    month: undefined,
  };
}

export function buildCostCenterMonthlyChartSeries(input: {
  rows: CostCenterMonthlyChartSourceRow[];
  costCenterIds: string[];
  year: number;
  highlightMonth?: number | null;
}): CostCenterMonthlyChartPoint[] {
  const idSet = new Set(input.costCenterIds);
  const buckets = Array.from({ length: 12 }, (_, index) => ({
    month: index + 1,
    paidAmount: 0,
    openAmount: 0,
    totalAmount: 0,
  }));

  for (const row of input.rows) {
    if (row.year !== input.year) continue;
    if (!idSet.has(row.costCenterId)) continue;
    if (row.month < 1 || row.month > 12) continue;
    const bucket = buckets[row.month - 1]!;
    bucket.paidAmount += row.paidAmount;
    bucket.openAmount += row.openAmount;
    bucket.totalAmount += row.amount;
  }

  return buckets.map((bucket) => ({
    year: input.year,
    month: bucket.month,
    monthLabel: COST_CENTER_MONTHLY_CHART_MONTH_LABELS[bucket.month - 1]!,
    paidAmount: roundMoney(bucket.paidAmount),
    openAmount: roundMoney(bucket.openAmount),
    totalAmount: roundMoney(bucket.totalAmount),
    highlighted: input.highlightMonth === bucket.month,
  }));
}

export function buildCostCenterMonthlyChartQuery(
  appliedFilters: FinanceCostCentersUiFilters,
  costCenterIds: string[]
): string {
  const q = new URLSearchParams(
    buildFinanceCostCentersDashboardQuery({
      ...appliedFilters,
      month: null,
    })
  );
  if (costCenterIds.length > 0) {
    q.set("costCenterIds", costCenterIds.join(","));
  }
  return q.toString();
}
