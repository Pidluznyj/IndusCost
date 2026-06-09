import type { BillingMultiYearMonthlyPoint } from "./financeBillingChartData.js";
import type { SalesOrdersAccumulatedPoint } from "./executiveDashboardTypes.js";

/** Detecta se a série acumulada tem ao menos um ponto com valor significativo. */
export function billingAccumulatedChartHasData(series: SalesOrdersAccumulatedPoint[]): boolean {
  if (!series.length) return false;
  return series.some(
    (p) =>
      (p.currentYearAccumulated != null && p.currentYearAccumulated !== 0) ||
      p.previousYearAccumulated !== 0 ||
      p.accumulatedTarget !== 0 ||
      (p.projectedAccumulated != null && p.projectedAccumulated !== 0)
  );
}

/** Detecta se comparativo mensal multi-ano tem dados. */
export function billingMonthlyChartHasData(
  points: BillingMultiYearMonthlyPoint[],
  years: number[]
): boolean {
  if (!points.length) return false;
  return points.some((p) =>
    years.some((y) => {
      const v = p.values[y];
      return v != null && v !== 0;
    })
  );
}

/** Mapeia série acumulada para Recharts. */
export function mapBillingAccumulatedChartData(series: SalesOrdersAccumulatedPoint[]) {
  return series.map((p) => ({
    name: p.monthLabel,
    previous: p.previousYearAccumulated,
    current: p.currentYearAccumulated,
    target: p.accumulatedTarget,
    projected: p.projectedAccumulated,
  }));
}

/** Mapeia comparativo mensal para Recharts. */
export function mapBillingMonthlyChartData(
  points: BillingMultiYearMonthlyPoint[],
  years: number[],
  showTarget: boolean
) {
  return points.map((p) => {
    const row: Record<string, string | number | null> = { name: p.monthLabel };
    for (const year of years) {
      row[`y${year}`] = p.values[year] ?? null;
    }
    if (showTarget) row.target = p.targetValue;
    return row;
  });
}
