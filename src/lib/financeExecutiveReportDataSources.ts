/**
 * Orquestração de KPIs AR/AP do Relatório Executivo — apenas delega aos motores oficiais.
 * PERF: uma projeção metrics-only (mesmos primitives do full); sem aging/ranking/grid.
 */
import {
  endOfLocalDay,
  type FinanceArDashboardFilters,
  type FinanceArDashboardRow,
} from "./financeAccountsReceivableDashboard.js";
import {
  buildOfficialAccountsReceivableDashboard,
  buildOfficialAccountsReceivableRulesResult,
  sumOfficialArReceivedBySettlementInPeriod,
} from "./financeAccountsReceivableRulesAdapter.js";
import {
  buildOfficialAccountsPayableDashboard,
  buildOfficialAccountsPayableRulesResult,
  sumOfficialApPaidInPaymentPeriod,
} from "./financeAccountsPayableRulesAdapter.js";
import {
  type FinanceApDashboardFilters,
  type FinanceApDashboardRow,
} from "./financeAccountsPayableDashboard.js";
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
  cards: ReturnType<typeof buildOfficialAccountsReceivableRulesResult>["cards"];
  dataSanitization: ReturnType<typeof buildOfficialAccountsReceivableRulesResult>["dataSanitization"];
};

export type ExecutiveReportPayablesSection = {
  metricsSource: typeof EXECUTIVE_REPORT_PAYABLES_SOURCE;
  kpis: ExecutiveReportApSectionKpis;
  cards: ReturnType<typeof buildOfficialAccountsPayableRulesResult>["cards"];
  dataSanitization: ReturnType<typeof buildOfficialAccountsPayableRulesResult>["dataSanitization"];
  purchaseOrderScheduleAudit: NonNullable<
    ReturnType<typeof buildOfficialAccountsPayableRulesResult>["purchaseOrderScheduleAudit"]
  >;
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

/** Monta KPIs de Contas a Receber usando exclusivamente o motor oficial AR (metrics-only). */
export function buildExecutiveReportReceivablesSection(input: {
  rows: FinanceArDashboardRow[];
  filters: FinanceArDashboardFilters;
  referenceDate: Date;
  syncCutoff: NomusArReportSyncCutoff | null;
  year: number;
  month: number;
}): ExecutiveReportReceivablesSection {
  const { rows, filters, referenceDate, syncCutoff, year, month } = input;
  const monthBounds = monthPeriodBounds(year, month);
  const prevMonthBounds = monthPeriodBounds(year - 1, month);
  const prevYtdStart = new Date(year - 1, 0, 1, 0, 0, 0, 0);
  const prevYtdEnd = previousYearComparableEnd(year, month, referenceDate);

  const rulesCurrent = buildOfficialAccountsReceivableRulesResult({
    rows,
    filters,
    referenceDate,
    syncCutoff,
    year,
    month,
    projection: "metrics",
  });

  const receivedMonthCurrent = sumOfficialArReceivedBySettlementInPeriod(
    rows,
    filters,
    referenceDate,
    syncCutoff,
    monthBounds.start,
    monthBounds.end
  );
  const receivedMonthPrevious = sumOfficialArReceivedBySettlementInPeriod(
    rows,
    filters,
    referenceDate,
    syncCutoff,
    prevMonthBounds.start,
    prevMonthBounds.end
  );
  const receivedYtdCurrent = rulesCurrent.metrics.receivedYtd;
  const receivedYtdPrevious = sumOfficialArReceivedBySettlementInPeriod(
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
      cards: rulesCurrent.cards,
    }),
    cards: rulesCurrent.cards,
    dataSanitization: rulesCurrent.dataSanitization,
  };
}

/** Monta KPIs de Contas a Pagar usando exclusivamente o motor oficial AP (metrics-only). */
export function buildExecutiveReportPayablesSection(input: {
  rows: FinanceApDashboardRow[];
  filters: FinanceApDashboardFilters;
  referenceDate: Date;
  syncCutoff: NomusApReportSyncCutoff | null;
  year: number;
  month: number;
}): ExecutiveReportPayablesSection {
  const { rows, filters, referenceDate, syncCutoff, year, month } = input;
  const monthBounds = monthPeriodBounds(year, month);
  const prevMonthBounds = monthPeriodBounds(year - 1, month);
  const prevYtdStart = new Date(year - 1, 0, 1, 0, 0, 0, 0);
  const prevYtdEnd = previousYearComparableEnd(year, month, referenceDate);

  const rulesCurrent = buildOfficialAccountsPayableRulesResult({
    rows,
    filters,
    referenceDate,
    syncCutoff,
    year,
    month,
    projection: "metrics",
  });

  const paidMonthCurrent = sumOfficialApPaidInPaymentPeriod(
    rows,
    filters,
    referenceDate,
    syncCutoff,
    monthBounds.start,
    monthBounds.end
  );
  const paidMonthPrevious = sumOfficialApPaidInPaymentPeriod(
    rows,
    filters,
    referenceDate,
    syncCutoff,
    prevMonthBounds.start,
    prevMonthBounds.end
  );
  const paidYtdCurrent = rulesCurrent.metrics.paidYtd;
  const paidYtdPrevious = sumOfficialApPaidInPaymentPeriod(
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
      cards: rulesCurrent.cards,
      purchaseOrderScheduleAudit: rulesCurrent.purchaseOrderScheduleAudit,
    }),
    cards: rulesCurrent.cards,
    dataSanitization: rulesCurrent.dataSanitization,
    purchaseOrderScheduleAudit: rulesCurrent.purchaseOrderScheduleAudit,
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
  return buildOfficialAccountsReceivableDashboard(input);
}

/** Payload oficial AP — espelha GET /api/finance/accounts-payable/dashboard com mesmos filtros/data-base. */
export function buildOfficialAccountsPayableDashboardForReport(input: {
  rows: FinanceApDashboardRow[];
  filters: FinanceApDashboardFilters;
  referenceDate: Date;
  syncCutoff: NomusApReportSyncCutoff | null;
}) {
  return buildOfficialAccountsPayableDashboard(input);
}
