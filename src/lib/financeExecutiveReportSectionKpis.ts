/**
 * KPIs de comparação para o Relatório Executivo — apenas apresentação sobre motores oficiais.
 */
import type { FinanceCashFlowAnnualComparisonPayload } from "./financeCashFlowAnnualComparison.js";
import type { BillingDashboardTab, SalesOrdersDashboardTab } from "./executiveDashboardTypes.js";
import type { FinanceArDashboardCards } from "./financeAccountsReceivableDashboardTypes.js";
import type { FinanceApDashboardCards } from "./financeAccountsPayableDashboardTypes.js";
import {
  formatExecutiveReportPresentationCurrency,
  formatExecutiveReportPresentationPercent,
} from "./financeExecutiveReportPresentation.js";

export type ExecutiveReportVariationTone =
  | "positive"
  | "negative"
  | "neutral"
  | "warning"
  | "reference"
  | "target"
  | "accent";

export type ExecutiveReportVariation = {
  absolute: number | null;
  percent: number | null;
  formattedAbsolute: string;
  formattedPercent: string;
  tone: ExecutiveReportVariationTone;
  hasBase: boolean;
};

export function computeExecutiveReportVariation(
  current: number | null | undefined,
  previous: number | null | undefined,
  higherIsBetter = true
): ExecutiveReportVariation {
  const cur = current != null && Number.isFinite(current) ? current : null;
  const prev = previous != null && Number.isFinite(previous) ? previous : null;

  if (cur == null && prev == null) {
    return {
      absolute: null,
      percent: null,
      formattedAbsolute: "—",
      formattedPercent: "—",
      tone: "neutral",
      hasBase: false,
    };
  }

  if (prev == null || prev === 0) {
    return {
      absolute: cur,
      percent: null,
      formattedAbsolute: formatExecutiveReportPresentationCurrency(cur),
      formattedPercent: "sem base comparativa",
      tone: "neutral",
      hasBase: false,
    };
  }

  const absolute = (cur ?? 0) - prev;
  const percent = (absolute / prev) * 100;
  let tone: ExecutiveReportVariationTone = "neutral";
  if (absolute > 0) tone = higherIsBetter ? "positive" : "warning";
  else if (absolute < 0) tone = higherIsBetter ? "negative" : "positive";

  return {
    absolute,
    percent,
    formattedAbsolute: formatExecutiveReportPresentationCurrency(absolute),
    formattedPercent: formatExecutiveReportPresentationPercent(percent, 1),
    tone,
    hasBase: true,
  };
}

function sumAnnualMetricYtd(
  payload: FinanceCashFlowAnnualComparisonPayload,
  endMonth: number,
  pick: (m: FinanceCashFlowAnnualComparisonPayload["months"][number]) => number
): number {
  return payload.months
    .filter((m) => m.month <= endMonth)
    .reduce((acc, m) => acc + pick(m), 0);
}

function monthMetric(
  payload: FinanceCashFlowAnnualComparisonPayload,
  month: number,
  pick: (m: FinanceCashFlowAnnualComparisonPayload["months"][number]) => number
): number {
  const row = payload.months.find((m) => m.month === month);
  if (!row) return 0;
  return pick(row);
}

export function buildExecutiveReportArKpis(input: {
  currentYear: FinanceCashFlowAnnualComparisonPayload;
  previousYear: FinanceCashFlowAnnualComparisonPayload;
  cards: FinanceArDashboardCards;
  month: number;
}) {
  const { currentYear, previousYear, cards, month } = input;
  const receivedMonthCurrent = monthMetric(currentYear, month, (m) => m.receivedAmount);
  const receivedMonthPrevious = monthMetric(previousYear, month, (m) => m.receivedAmount);
  const receivedYtdCurrent = sumAnnualMetricYtd(currentYear, month, (m) => m.receivedAmount);
  const receivedYtdPrevious = sumAnnualMetricYtd(previousYear, month, (m) => m.receivedAmount);

  return {
    receivedMonthCurrent,
    receivedMonthPrevious,
    receivedMonthVariation: computeExecutiveReportVariation(
      receivedMonthCurrent,
      receivedMonthPrevious,
      true
    ),
    receivedYtdCurrent,
    receivedYtdPrevious,
    receivedYtdVariation: computeExecutiveReportVariation(
      receivedYtdCurrent,
      receivedYtdPrevious,
      true
    ),
    openAmount: cards.totalOpenAmount,
    overdueAmount: cards.overdueAmount,
    futureOpenAmount: currentYear.totals.receivableOpenAmount,
  };
}

export function buildExecutiveReportApKpis(input: {
  currentYear: FinanceCashFlowAnnualComparisonPayload;
  previousYear: FinanceCashFlowAnnualComparisonPayload;
  cards: FinanceApDashboardCards;
  month: number;
}) {
  const { currentYear, previousYear, cards, month } = input;
  const paidMonthCurrent = monthMetric(currentYear, month, (m) => m.paidAmount);
  const paidMonthPrevious = monthMetric(previousYear, month, (m) => m.paidAmount);
  const paidYtdCurrent = sumAnnualMetricYtd(currentYear, month, (m) => m.paidAmount);
  const paidYtdPrevious = sumAnnualMetricYtd(previousYear, month, (m) => m.paidAmount);

  return {
    paidMonthCurrent,
    paidMonthPrevious,
    paidMonthVariation: computeExecutiveReportVariation(paidMonthCurrent, paidMonthPrevious, false),
    paidYtdCurrent,
    paidYtdPrevious,
    paidYtdVariation: computeExecutiveReportVariation(paidYtdCurrent, paidYtdPrevious, false),
    openAmount: cards.totalOpenAmount,
    overdueAmount: cards.overdueAmount,
    futureOpenAmount: currentYear.totals.payableOpenAmount,
  };
}

export function buildExecutiveReportSalesOrdersKpis(tab: SalesOrdersDashboardTab, month: number) {
  const monthRow = tab.monthlySeries.find((p) => p.month === month);
  const monthCurrent = monthRow?.currentYearValue ?? tab.target?.actual ?? null;
  const monthPrevious = monthRow?.previousYearValue ?? tab.target?.previousPeriod ?? null;
  const ytdCurrent = tab.summaryCards.find((c) => c.id === "realized-ytd")?.value ?? null;
  const ytdPrevious = tab.monthlySeries
    .filter((p) => p.month <= month)
    .reduce((acc, p) => acc + (p.previousYearValue ?? 0), 0);

  return {
    monthCurrent,
    monthPrevious,
    monthVariation: computeExecutiveReportVariation(monthCurrent, monthPrevious, true),
    ytdCurrent,
    ytdPrevious,
    ytdVariation: computeExecutiveReportVariation(ytdCurrent, ytdPrevious, true),
    target: tab.target?.target ?? null,
    projection: tab.projection?.monthlyProjection ?? null,
  };
}

export function buildExecutiveReportBillingKpis(tab: BillingDashboardTab, month: number) {
  const monthRow = tab.monthlySeries.find((p) => p.month === month);
  const monthCurrent = monthRow?.currentYearValue ?? tab.target?.actual ?? null;
  const monthPrevious = monthRow?.previousYearValue ?? tab.target?.previousPeriod ?? null;

  return {
    monthCurrent,
    monthPrevious,
    monthVariation: computeExecutiveReportVariation(monthCurrent, monthPrevious, true),
    ytdCurrent: tab.yearComparison.yearToDateCurrent,
    ytdPrevious: tab.yearComparison.yearToDatePrevious,
    ytdVariation: computeExecutiveReportVariation(
      tab.yearComparison.yearToDateCurrent,
      tab.yearComparison.yearToDatePrevious,
      true
    ),
    target: tab.target?.target ?? null,
    projection: tab.projection?.projectedMonth ?? null,
  };
}

export function buildExecutiveReportCashFlowKpis(
  annualChart: {
    points: Array<{
      month: number;
      inflow: number;
      outflow: number;
      netFlow: number;
      accumulated: number;
    }>;
    hasData: boolean;
  },
  year: number
) {
  const points = annualChart.points;
  const totalInflow = points.reduce((acc, p) => acc + p.inflow, 0);
  const totalOutflow = points.reduce((acc, p) => acc + p.outflow, 0);
  const netTotal = totalInflow - totalOutflow;
  const best = points.reduce(
    (best, p) => (p.netFlow > best.netFlow ? p : best),
    points[0] ?? { month: 0, netFlow: -Infinity, accumulated: 0, inflow: 0, outflow: 0 }
  );
  const worst = points.reduce(
    (worst, p) => (p.netFlow < worst.netFlow ? p : worst),
    points[0] ?? { month: 0, netFlow: Infinity, accumulated: 0, inflow: 0, outflow: 0 }
  );
  const finalAccumulated = points[points.length - 1]?.accumulated ?? 0;

  return {
    year,
    totalInflow,
    totalOutflow,
    netTotal,
    bestMonth: best.month,
    worstMonth: worst.month,
    bestNetFlow: best.netFlow,
    worstNetFlow: worst.netFlow,
    finalAccumulated,
    hasData: annualChart.hasData,
  };
}
