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
  // Drilldown chart always shows the full AP universe for the center in the year
  // (paid + open), regardless of status filters on the page.
  const q = new URLSearchParams(
    buildFinanceCostCentersDashboardQuery({
      ...appliedFilters,
      month: undefined,
      status: "all",
    })
  );
  if (costCenterIds.length > 0) {
    q.set("costCenterIds", costCenterIds.join(","));
  }
  return q.toString();
}

export type CostCenterMonthlyTrendDirection = "up" | "down" | "stable";

export type CostCenterMonthlyTrendSummary = {
  totalAmount: number;
  averageMonthlyAmount: number;
  maxMonth: string;
  maxMonthAmount: number;
  minMonth: string;
  minMonthAmount: number;
  titlesCount: number | null;
  trendDirection: CostCenterMonthlyTrendDirection;
  trendPercent: number | null;
  momChangePercent: number | null;
  momReferenceMonth: string | null;
  momComparisonMonth: string | null;
};

export type CostCenterMonthlyTrendChartPoint = CostCenterMonthlyChartPoint & {
  trendValue: number;
};

function roundTrendPercent(value: number): number {
  return Math.round(value * 10) / 10;
}

/** Tendência linear simples (mínimos quadrados) sobre totalAmount mensal. */
export function buildCostCenterMonthlyLinearTrendValues(
  series: CostCenterMonthlyChartPoint[]
): number[] {
  if (series.length === 0) return [];
  const n = series.length;
  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumXX = 0;
  for (let i = 0; i < n; i += 1) {
    const y = series[i]!.totalAmount;
    sumX += i;
    sumY += y;
    sumXY += i * y;
    sumXX += i * i;
  }
  const denominator = n * sumXX - sumX * sumX;
  const slope = denominator === 0 ? 0 : (n * sumXY - sumX * sumY) / denominator;
  const intercept = (sumY - slope * sumX) / n;
  return series.map((_, index) => roundMoney(Math.max(0, intercept + slope * index)));
}

export function buildCostCenterMonthlyTrendChartData(
  series: CostCenterMonthlyChartPoint[]
): CostCenterMonthlyTrendChartPoint[] {
  const trendValues = buildCostCenterMonthlyLinearTrendValues(series);
  return series.map((point, index) => ({
    ...point,
    trendValue: trendValues[index] ?? 0,
  }));
}

export function buildCostCenterMonthlyTrendSummary(
  series: CostCenterMonthlyChartPoint[],
  options: { titlesCount?: number | null; highlightMonth?: number | null } = {}
): CostCenterMonthlyTrendSummary {
  const amounts = series.map((point) => point.totalAmount);
  const totalAmount = roundMoney(amounts.reduce((sum, value) => sum + value, 0));
  const monthsWithValue = amounts.filter((value) => value > 0).length;
  const averageMonthlyAmount = roundMoney(
    monthsWithValue > 0 ? totalAmount / monthsWithValue : totalAmount / 12
  );

  let maxIndex = 0;
  let minIndex = 0;
  for (let i = 1; i < series.length; i += 1) {
    if ((series[i]?.totalAmount ?? 0) >= (series[maxIndex]?.totalAmount ?? 0)) maxIndex = i;
    if ((series[i]?.totalAmount ?? 0) <= (series[minIndex]?.totalAmount ?? 0)) minIndex = i;
  }

  const highlightMonth = options.highlightMonth ?? null;
  let momChangePercent: number | null = null;
  let momReferenceMonth: string | null = null;
  let momComparisonMonth: string | null = null;
  let trendDirection: CostCenterMonthlyTrendDirection = "stable";
  let trendPercent: number | null = null;

  if (highlightMonth != null && highlightMonth >= 1 && highlightMonth <= 12) {
    const current = series[highlightMonth - 1]?.totalAmount ?? 0;
    const previous = highlightMonth > 1 ? (series[highlightMonth - 2]?.totalAmount ?? 0) : 0;
    momReferenceMonth = series[highlightMonth - 1]?.monthLabel ?? null;
    momComparisonMonth =
      highlightMonth > 1 ? (series[highlightMonth - 2]?.monthLabel ?? null) : null;
    if (previous > 0) {
      momChangePercent = roundTrendPercent(((current - previous) / previous) * 100);
      if (Math.abs(momChangePercent) < 0.5) trendDirection = "stable";
      else trendDirection = momChangePercent > 0 ? "up" : "down";
      trendPercent = momChangePercent;
    } else if (current > 0) {
      trendDirection = "up";
      trendPercent = null;
    }
  } else {
    const first = amounts.findIndex((value) => value > 0);
    const last = amounts.length - 1 - [...amounts].reverse().findIndex((value) => value > 0);
    if (first >= 0 && last > first) {
      const start = amounts[first]!;
      const end = amounts[last]!;
      if (start > 0) {
        trendPercent = roundTrendPercent(((end - start) / start) * 100);
        if (Math.abs(trendPercent) < 0.5) trendDirection = "stable";
        else trendDirection = trendPercent > 0 ? "up" : "down";
      }
    }
  }

  return {
    totalAmount,
    averageMonthlyAmount,
    maxMonth: series[maxIndex]?.monthLabel ?? "—",
    maxMonthAmount: series[maxIndex]?.totalAmount ?? 0,
    minMonth: series[minIndex]?.monthLabel ?? "—",
    minMonthAmount: series[minIndex]?.totalAmount ?? 0,
    titlesCount: options.titlesCount ?? null,
    trendDirection,
    trendPercent,
    momChangePercent,
    momReferenceMonth,
    momComparisonMonth,
  };
}
