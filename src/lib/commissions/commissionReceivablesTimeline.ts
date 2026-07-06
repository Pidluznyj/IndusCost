/**
 * Timeline mensal de comissão a pagar (settlementDate) + snapshot de previsão (dueDate).
 * Lógica pura para agregação multi-mês — scripts e testes E2E.
 */
import type { CommissionMonthlyPayableSummary } from "./commissionMonthlyPayable.js";
import { buildMonthKey, formatMonthLabelPt } from "./commissionMonthlyPayable.js";
import type { ReceivableForecastSummary } from "./commissionReceivableForecast.js";

export type TimelineMonthPayableRow = {
  year: number;
  month: number;
  monthKey: string;
  monthLabelPt: string;
  payableCommissionTotal: number;
  allocatedBaseAmountTotal: number;
  receivedAmountTotal: number;
  uniqueReceivablesCount: number;
  uniqueSellersCount: number;
  averageCommissionRate: number;
  sellers: Array<{
    sellerId: string;
    sellerName: string;
    payableCommission: number;
    allocatedBase: number;
    receivedAmount: number;
    titlesCount: number;
  }>;
};

export type CommissionReceivablesTimeline = {
  fromMonthKey: string;
  toMonthKey: string;
  payableByMonth: TimelineMonthPayableRow[];
  payableYearTotal: number;
  payableYearBase: number;
  forecastSnapshot: {
    futureCommissionTotal: number;
    overdueCommissionTotal: number;
    futureTitlesAmountTotal: number;
    overdueTitlesAmountTotal: number;
    monthlyBuckets: number;
    titleCount: number;
  } | null;
  settlementDateBasis: "NomusAccountsReceivable.settlementDate";
  forecastDueDateBasis: "NomusAccountsReceivable.dueDate";
};

export function parseMonthRangeArg(raw: string): { year: number; month: number } {
  const match = /^(\d{4})-(\d{1,2})$/.exec(raw.trim());
  if (!match) throw new Error(`Mês inválido: ${raw}. Use YYYY-MM.`);
  const year = Number.parseInt(match[1]!, 10);
  const month = Number.parseInt(match[2]!, 10);
  if (!Number.isFinite(year) || month < 1 || month > 12) {
    throw new Error(`Mês inválido: ${raw}.`);
  }
  return { year, month };
}

export function enumerateMonthKeys(from: string, to: string): Array<{ year: number; month: number }> {
  const start = parseMonthRangeArg(from);
  const end = parseMonthRangeArg(to);
  const out: Array<{ year: number; month: number }> = [];
  let y = start.year;
  let m = start.month;
  while (y < end.year || (y === end.year && m <= end.month)) {
    out.push({ year: y, month: m });
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

export function mapPayableSummaryToTimelineRow(
  summary: CommissionMonthlyPayableSummary
): TimelineMonthPayableRow {
  return {
    year: summary.year,
    month: summary.month,
    monthKey: summary.monthKey,
    monthLabelPt: summary.monthLabelPt,
    payableCommissionTotal: summary.payableCommissionTotal,
    allocatedBaseAmountTotal: summary.allocatedBaseAmountTotal,
    receivedAmountTotal: summary.receivedAmountTotal,
    uniqueReceivablesCount: summary.uniqueReceivablesCount,
    uniqueSellersCount: summary.uniqueSellersCount,
    averageCommissionRate: summary.averageCommissionRate,
    sellers: summary.sellers.map((s) => ({
      sellerId: s.sellerId,
      sellerName: s.sellerName,
      payableCommission: s.releasedCommissionAmount,
      allocatedBase: s.allocatedBaseAmount,
      receivedAmount: s.receivedAmount,
      titlesCount: s.receivedTitlesCount,
    })),
  };
}

export function buildCommissionReceivablesTimeline(input: {
  fromMonthKey: string;
  toMonthKey: string;
  payableSummaries: CommissionMonthlyPayableSummary[];
  forecast: ReceivableForecastSummary | null;
}): CommissionReceivablesTimeline {
  const payableByMonth = input.payableSummaries.map(mapPayableSummaryToTimelineRow);
  let payableYearTotal = 0;
  let payableYearBase = 0;
  for (const row of payableByMonth) {
    payableYearTotal += row.payableCommissionTotal;
    payableYearBase += row.allocatedBaseAmountTotal;
  }

  return {
    fromMonthKey: input.fromMonthKey,
    toMonthKey: input.toMonthKey,
    payableByMonth,
    payableYearTotal: Math.round(payableYearTotal * 100) / 100,
    payableYearBase: Math.round(payableYearBase * 100) / 100,
    forecastSnapshot: input.forecast
      ? {
          futureCommissionTotal: input.forecast.cards.futureCommissionTotal,
          overdueCommissionTotal: input.forecast.cards.overdueCommissionTotal,
          futureTitlesAmountTotal: input.forecast.cards.futureTitlesAmountTotal,
          overdueTitlesAmountTotal: input.forecast.cards.overdueTitlesAmountTotal,
          monthlyBuckets: input.forecast.monthly.length,
          titleCount: input.forecast.cards.titleCount,
        }
      : null,
    settlementDateBasis: "NomusAccountsReceivable.settlementDate",
    forecastDueDateBasis: "NomusAccountsReceivable.dueDate",
  };
}

export function findTimelineMonth(
  timeline: CommissionReceivablesTimeline,
  year: number,
  month: number
): TimelineMonthPayableRow | null {
  const key = buildMonthKey(year, month);
  return timeline.payableByMonth.find((r) => r.monthKey === key) ?? null;
}

export function formatTimelineMonthLabel(year: number, month: number): string {
  return formatMonthLabelPt(year, month);
}
