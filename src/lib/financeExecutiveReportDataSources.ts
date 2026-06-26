/**
 * Orquestração de KPIs AR/AP do Relatório Executivo — apenas delega aos motores oficiais.
 */
import {
  buildFinanceAccountsReceivableDashboard,
  endOfLocalDay,
  sumFinanceArReceivedBySettlementInPeriod,
  type FinanceArDashboardFilters,
  type FinanceArDashboardRow,
} from "./financeAccountsReceivableDashboard.js";
import {
  buildFinanceAccountsPayableDashboard,
  sumFinanceApPaidInPaymentPeriod,
  type FinanceApDashboardFilters,
  type FinanceApDashboardRow,
} from "./financeAccountsPayableDashboard.js";
import type { FinanceArDashboardCards } from "./financeAccountsReceivableDashboardTypes.js";
import type { FinanceApDashboardCards, FinanceApPurchaseOrderScheduleAudit } from "./financeAccountsPayableDashboardTypes.js";
import type { NomusArReportSyncCutoff } from "./financeNomusArReportFreshness.js";
import type { NomusApReportSyncCutoff } from "./financeNomusApReportFreshness.js";
import {
  buildExecutiveReportApKpisFromOfficial,
  buildExecutiveReportArKpisFromOfficial,
  type ExecutiveReportApSectionKpis,
  type ExecutiveReportArSectionKpis,
} from "./financeExecutiveReportSectionKpis.js";

export const EXECUTIVE_REPORT_RECEIVABLES_SOURCE = "official-accounts-receivable-engine" as const;
export const EXECUTIVE_REPORT_PAYABLES_SOURCE = "official-accounts-payable-engine" as const;

export type ExecutiveReportReceivablesSection = {
  metricsSource: typeof EXECUTIVE_REPORT_RECEIVABLES_SOURCE;
  kpis: ExecutiveReportArSectionKpis;
};

export type ExecutiveReportPayablesSection = {
  metricsSource: typeof EXECUTIVE_REPORT_PAYABLES_SOURCE;
  kpis: ExecutiveReportApSectionKpis;
};

export function resolveExecutiveReportHighlightMonth(
  month: number | null | undefined,
  referenceDate: Date
): number {
  return month ?? referenceDate.getMonth() + 1;
}

function monthPeriodBounds(year: number, month: number): { start: Date; end: Date } {
  return {
    start: new Date(year, month - 1, 1, 0, 0, 0, 0),
    end: endOfLocalDay(new Date(year, month, 0)),
  };
}

function ytdPeriodBounds(
  year: number,
  month: number,
  referenceDate: Date
): { start: Date; end: Date } {
  const start = new Date(year, 0, 1, 0, 0, 0, 0);
  const sameYearMonth =
    year === referenceDate.getFullYear() && month === referenceDate.getMonth() + 1;
  const end = sameYearMonth
    ? endOfLocalDay(referenceDate)
    : endOfLocalDay(new Date(year, month, 0));
  return { start, end };
}

function previousYearComparableEnd(
  year: number,
  month: number,
  referenceDate: Date
): Date {
  const { end: currentEnd } = ytdPeriodBounds(year, month, referenceDate);
  return endOfLocalDay(
    new Date(
      year - 1,
      currentEnd.getMonth(),
      currentEnd.getDate(),
      currentEnd.getHours(),
      currentEnd.getMinutes(),
      currentEnd.getSeconds(),
      currentEnd.getMilliseconds()
    )
  );
}

/** Monta KPIs de Contas a Receber usando exclusivamente o motor oficial AR. */
export function buildExecutiveReportReceivablesSection(input: {
  rows: FinanceArDashboardRow[];
  filters: FinanceArDashboardFilters;
  referenceDate: Date;
  syncCutoff: NomusArReportSyncCutoff | null;
  year: number;
  month: number;
  cards: FinanceArDashboardCards;
}): ExecutiveReportReceivablesSection {
  const { rows, filters, referenceDate, syncCutoff, year, month, cards } = input;
  const monthBounds = monthPeriodBounds(year, month);
  const prevMonthBounds = monthPeriodBounds(year - 1, month);
  const ytdBounds = ytdPeriodBounds(year, month, referenceDate);
  const prevYtdStart = new Date(year - 1, 0, 1, 0, 0, 0, 0);
  const prevYtdEnd = previousYearComparableEnd(year, month, referenceDate);

  const receivedMonthCurrent = sumFinanceArReceivedBySettlementInPeriod(
    rows,
    filters,
    referenceDate,
    syncCutoff,
    monthBounds.start,
    monthBounds.end
  );
  const receivedMonthPrevious = sumFinanceArReceivedBySettlementInPeriod(
    rows,
    filters,
    referenceDate,
    syncCutoff,
    prevMonthBounds.start,
    prevMonthBounds.end
  );
  const receivedYtdCurrent = sumFinanceArReceivedBySettlementInPeriod(
    rows,
    filters,
    referenceDate,
    syncCutoff,
    ytdBounds.start,
    ytdBounds.end
  );
  const receivedYtdPrevious = sumFinanceArReceivedBySettlementInPeriod(
    rows,
    filters,
    referenceDate,
    syncCutoff,
    prevYtdStart,
    prevYtdEnd
  );

  return {
    metricsSource: EXECUTIVE_REPORT_RECEIVABLES_SOURCE,
    kpis: buildExecutiveReportArKpisFromOfficial({
      receivedMonthCurrent,
      receivedMonthPrevious,
      receivedYtdCurrent,
      receivedYtdPrevious,
      cards,
    }),
  };
}

/** Monta KPIs de Contas a Pagar usando exclusivamente o motor oficial AP. */
export function buildExecutiveReportPayablesSection(input: {
  rows: FinanceApDashboardRow[];
  filters: FinanceApDashboardFilters;
  referenceDate: Date;
  syncCutoff: NomusApReportSyncCutoff | null;
  year: number;
  month: number;
  cards: FinanceApDashboardCards;
  purchaseOrderScheduleAudit: FinanceApPurchaseOrderScheduleAudit;
}): ExecutiveReportPayablesSection {
  const { rows, filters, referenceDate, syncCutoff, year, month, cards, purchaseOrderScheduleAudit } =
    input;
  const monthBounds = monthPeriodBounds(year, month);
  const prevMonthBounds = monthPeriodBounds(year - 1, month);
  const ytdBounds = ytdPeriodBounds(year, month, referenceDate);
  const prevYtdStart = new Date(year - 1, 0, 1, 0, 0, 0, 0);
  const prevYtdEnd = previousYearComparableEnd(year, month, referenceDate);

  const paidMonthCurrent = sumFinanceApPaidInPaymentPeriod(
    rows,
    filters,
    referenceDate,
    syncCutoff,
    monthBounds.start,
    monthBounds.end
  );
  const paidMonthPrevious = sumFinanceApPaidInPaymentPeriod(
    rows,
    filters,
    referenceDate,
    syncCutoff,
    prevMonthBounds.start,
    prevMonthBounds.end
  );
  const paidYtdCurrent = sumFinanceApPaidInPaymentPeriod(
    rows,
    filters,
    referenceDate,
    syncCutoff,
    ytdBounds.start,
    ytdBounds.end
  );
  const paidYtdPrevious = sumFinanceApPaidInPaymentPeriod(
    rows,
    filters,
    referenceDate,
    syncCutoff,
    prevYtdStart,
    prevYtdEnd
  );

  return {
    metricsSource: EXECUTIVE_REPORT_PAYABLES_SOURCE,
    kpis: buildExecutiveReportApKpisFromOfficial({
      paidMonthCurrent,
      paidMonthPrevious,
      paidYtdCurrent,
      paidYtdPrevious,
      cards,
      purchaseOrderScheduleAudit,
    }),
  };
}

/** Payload oficial AR — espelha GET /api/finance/accounts-receivable/dashboard com mesmos filtros/data-base. */
export function buildOfficialAccountsReceivableDashboardForReport(input: {
  rows: FinanceArDashboardRow[];
  filters: FinanceArDashboardFilters;
  referenceDate: Date;
  syncCutoff: NomusArReportSyncCutoff | null;
  horizonSourceRows?: FinanceArDashboardRow[];
}) {
  return buildFinanceAccountsReceivableDashboard(
    input.rows,
    input.filters,
    input.referenceDate,
    input.syncCutoff,
    input.horizonSourceRows ? { horizonSourceRows: input.horizonSourceRows } : undefined
  );
}

/** Payload oficial AP — espelha GET /api/finance/accounts-payable/dashboard com mesmos filtros/data-base. */
export function buildOfficialAccountsPayableDashboardForReport(input: {
  rows: FinanceApDashboardRow[];
  filters: FinanceApDashboardFilters;
  referenceDate: Date;
  syncCutoff: NomusApReportSyncCutoff | null;
}) {
  return buildFinanceAccountsPayableDashboard(
    input.rows,
    input.filters,
    input.referenceDate,
    input.syncCutoff
  );
}
