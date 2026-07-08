/**
 * Série mensal por centro de custo — gráfico de drilldown do Mapa de Gastos.
 * Reutiliza monthlySeries.byCostCenter do dashboard oficial (competência AP = data de vencimento).
 */
import { roundMoney } from "./financeAccountsPayableDashboard.js";
import {
  buildFinanceCostCenterDashboardDefault,
  type FinanceCostCenterDashboardFilters,
  type FinanceCostCenterDashboardMonthlyByCostCenterRow,
} from "./financeCostCenterDashboard.js";
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

export function buildCostCenterMonthlyChartFilters(
  filters: FinanceCostCenterDashboardFilters
): FinanceCostCenterDashboardFilters {
  return {
    ...filters,
    month: undefined,
  };
}

export function buildCostCenterMonthlyChartSeries(input: {
  rows: FinanceCostCenterDashboardMonthlyByCostCenterRow[];
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

export async function buildCostCenterMonthlyChartPayloadDefault(
  filters: FinanceCostCenterDashboardFilters,
  costCenterIds: string[],
  referenceDate: Date = new Date()
): Promise<CostCenterMonthlyChartPayload> {
  if (costCenterIds.length === 0) {
    const year = filters.year ?? referenceDate.getFullYear();
    return {
      year,
      costCenterIds: [],
      series: buildCostCenterMonthlyChartSeries({
        rows: [],
        costCenterIds: [],
        year,
        highlightMonth: filters.month ?? null,
      }),
      hasData: false,
      periodLabel: formatCostCenterMonthlyChartPeriodLabel(year, filters.month),
      metricsScope: "Valores por data de vencimento (Contas a Pagar)",
      highlightMonth: filters.month ?? null,
    };
  }

  const year = filters.year ?? referenceDate.getFullYear();
  const chartFilters = buildCostCenterMonthlyChartFilters(filters);
  const dashboard = await buildFinanceCostCenterDashboardDefault(chartFilters, referenceDate);
  const series = buildCostCenterMonthlyChartSeries({
    rows: dashboard.monthlySeries.byCostCenter,
    costCenterIds,
    year,
    highlightMonth: filters.month ?? null,
  });
  const hasData = series.some(
    (point) => point.paidAmount > 0 || point.openAmount > 0 || point.totalAmount > 0
  );

  return {
    year,
    costCenterIds,
    series,
    hasData,
    periodLabel: formatCostCenterMonthlyChartPeriodLabel(year, filters.month),
    metricsScope: "Valores por data de vencimento (Contas a Pagar)",
    highlightMonth: filters.month ?? null,
  };
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
