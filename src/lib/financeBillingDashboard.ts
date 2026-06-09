import { buildBillingDashboardTab } from "./billingDashboardMetrics.js";
import { resolveExecutiveDashboardYearContext } from "./executiveDashboardYear.js";
import type { FinanceBillingDashboardPayload } from "./financeBillingDashboardTypes.js";
import type { BillingDashboardTab } from "./executiveDashboardTypes.js";

export async function buildFinanceBillingDashboard(
  yearParam: unknown,
  now = new Date()
): Promise<FinanceBillingDashboardPayload> {
  const yearCtx = resolveExecutiveDashboardYearContext(yearParam, now);
  const tab = await buildBillingDashboardTab(yearCtx);
  const lastInvoicedAt = tab.recentInvoicedOrders[0]?.invoiceDate ?? null;
  return {
    generatedAt: now.toISOString(),
    selectedYear: yearCtx.selectedYear,
    previousYear: yearCtx.previousYear,
    currentMonth: yearCtx.referenceDate.getMonth() + 1,
    periodLabel: tab.periodLabel,
    lastInvoicedAt,
    tab,
  };
}

/** Validação leve para testes — garante ausência de NaN/Infinity em métricas formatadas. */
export function billingTabMetricsAreFinite(tab: BillingDashboardTab): boolean {
  const numericValues: Array<number | null | undefined> = [
    ...tab.summaryCards.map((c) => c.value),
    tab.target.actual,
    tab.target.previousPeriod,
    tab.target.target,
    tab.target.gap,
    tab.target.achievementPercent,
    tab.projection.dailyAverage,
    tab.projection.projectedMonth,
    tab.projection.projectedYear,
    tab.yearComparison.yearToDateCurrent,
    tab.yearComparison.yearToDatePrevious,
    tab.yearComparison.previousYearTotal,
    tab.yearComparison.annualTarget,
    tab.realizedVsProjected.realized,
    tab.realizedVsProjected.projected,
    tab.realizedVsProjected.target,
    ...tab.monthlySeries.flatMap((p) => [
      p.currentYearValue,
      p.projectedValue,
      p.achievementPercent,
      p.differenceToTarget,
    ]),
    ...tab.cumulativeBilling.flatMap((p) => [p.currentYear, p.previousYear]),
    ...tab.accumulatedEvolution.flatMap((p) => [
      p.currentYearAccumulated,
      p.projectedAccumulated,
      p.differenceToTarget,
      p.achievementPercent,
    ]),
    ...tab.multiYearMonthly.flatMap((p) => Object.values(p.values)),
    ...tab.multiYearSummary.flatMap((s) => [s.yearTotal, s.ytdTotal, s.currentMonthValue]),
    ...tab.topCustomers.map((c) => c.totalNetValue),
    ...tab.recentInvoicedOrders.map((o) => o.totalNetValue),
  ];
  return numericValues.every((v) => v == null || Number.isFinite(v));
}
