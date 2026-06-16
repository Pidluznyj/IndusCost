import {
  filterFinanceApRows,
  isFinanceApOpen,
  roundMoney,
  startOfLocalDay,
  type FinanceApDashboardFilters,
} from "./financeAccountsPayableDashboard.js";
import {
  filterFinanceArRows,
  isFinanceArOpen,
  type FinanceArDashboardFilters,
} from "./financeAccountsReceivableDashboard.js";
import type {
  FinanceCashFlowApRow,
  FinanceCashFlowArRow,
  FinanceCashFlowDashboardFilters,
} from "./financeCashFlowDashboard.js";
import type { NetCashPositionStatus } from "./financeCashFlowDashboardTypes.js";
import {
  buildYtdDashboardFilters,
  filterArRowsForYtdReceived,
  resolveYtdDateRange,
  sumArReceivedInPeriod,
} from "./financeCashFlowExecutiveYtd.js";
import type { NomusArReportSyncCutoff } from "./financeNomusArReportFreshness.js";
import {
  resolveFinanceApEffectivePaymentDate,
  resolveFinanceApOpenAmount,
  resolveFinanceApRealizedAmount,
} from "./financeAccountsPayableRules.js";

export type FinanceCashFlowExecutiveSummaryMetadata = {
  year: number;
  month?: number;
  today: string;
  yearEnd: string;
  forwardRangeLabel: string;
  forwardRangeActive: boolean;
  receivableOrigin: string;
  viewMode: string;
  ytdScopeLabel: string;
  periodScopeLabel: string;
};

export type FinanceCashFlowExecutiveSummarySide = {
  receivedYtd?: number;
  paidYtd?: number;
  openFromTodayToYearEnd: number;
  estimatedYearTotal: number;
};

export type FinanceCashFlowExecutiveSummaryNet = {
  realizedYtd: number;
  projectedRemaining: number;
  estimatedYearNet: number;
  estimatedYearNetStatus: NetCashPositionStatus;
};

export type FinanceCashFlowExecutiveSummaryPeriod = {
  inflowAmount: number;
  outflowAmount: number;
  netFlowAmount: number;
  accumulatedBalance: number;
  monthFiltered: boolean;
  periodLabel: string;
};

export type FinanceCashFlowExecutiveMonthlyRow = {
  year: number;
  month: number;
  monthLabel: string;
  received: number;
  receivableOpenDue: number;
  estimatedInflow: number;
  paid: number;
  payableOpenDue: number;
  estimatedOutflow: number;
  netFlow: number;
  accumulatedNet: number;
};

export type FinanceCashFlowExecutiveSummary = {
  receivable: {
    receivedYtd: number;
    openFromTodayToYearEnd: number;
    estimatedYearTotal: number;
  };
  payable: {
    paidYtd: number;
    openFromTodayToYearEnd: number;
    estimatedYearTotal: number;
  };
  net: FinanceCashFlowExecutiveSummaryNet;
  period: FinanceCashFlowExecutiveSummaryPeriod;
  monthlyTimeline: FinanceCashFlowExecutiveMonthlyRow[];
  metadata: FinanceCashFlowExecutiveSummaryMetadata;
};

const MONTH_LABELS = [
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

function formatPtBrDate(d: Date): string {
  return d.toLocaleDateString("pt-BR");
}

function toPaidApLoadFilters(
  filters: FinanceCashFlowDashboardFilters
): FinanceApDashboardFilters {
  const status =
    filters.status === "open"
      ? "open"
      : filters.status === "settled"
        ? "settled"
        : filters.status === "overdue"
          ? "overdue"
          : "all";
  return {
    companyName: filters.companyName,
    personName: filters.supplierName,
    personCnpj: filters.personCnpj,
    status,
    paymentMethodName: filters.paymentMethodName,
    bankAccountName: filters.bankAccountName,
    managementScope: filters.cashFlowScope,
  };
}

export function filterApRowsForYtdPaid(
  rows: FinanceCashFlowApRow[],
  filters: FinanceCashFlowDashboardFilters,
  referenceDate: Date
): FinanceCashFlowApRow[] {
  const apFilters = toPaidApLoadFilters(filters);
  return filterFinanceApRows(rows, apFilters, referenceDate) as FinanceCashFlowApRow[];
}

export function resolveApPaymentDate(row: FinanceCashFlowApRow): Date | null {
  return resolveFinanceApEffectivePaymentDate(row);
}

export function isApPaidInPeriod(
  row: FinanceCashFlowApRow,
  startDate: Date,
  endDate: Date
): boolean {
  const realized = resolveFinanceApRealizedAmount(row);
  if (realized <= 0) return false;
  const payDate = resolveFinanceApEffectivePaymentDate(row);
  if (payDate == null) return false;
  const paid = startOfLocalDay(payDate).getTime();
  const start = startOfLocalDay(startDate).getTime();
  const end = startOfLocalDay(endDate).getTime();
  return paid >= start && paid <= end;
}

export function sumApPaidInPeriod(
  rows: FinanceCashFlowApRow[],
  startDate: Date,
  endDate: Date
): number {
  let total = 0;
  for (const row of rows) {
    if (!isApPaidInPeriod(row, startDate, endDate)) continue;
    total += resolveFinanceApRealizedAmount(row);
  }
  return roundMoney(total);
}

export function resolveForwardYearRange(
  year: number,
  referenceDate: Date
): {
  fromDate: Date;
  toDate: Date;
  isActive: boolean;
  label: string;
} {
  const yearStart = startOfLocalDay(new Date(year, 0, 1));
  const yearEnd = startOfLocalDay(new Date(year, 11, 31));
  const today = startOfLocalDay(referenceDate);
  const fromDate =
    today.getTime() > yearStart.getTime() ? today : yearStart;
  if (fromDate.getTime() > yearEnd.getTime()) {
    return {
      fromDate: yearEnd,
      toDate: yearEnd,
      isActive: false,
      label: `Ano ${year} encerrado — sem projeção futura`,
    };
  }
  return {
    fromDate,
    toDate: yearEnd,
    isActive: true,
    label: `${formatPtBrDate(fromDate)} até ${formatPtBrDate(yearEnd)}`,
  };
}

export function isArOpenDueInPeriod(
  row: FinanceCashFlowArRow,
  startDate: Date,
  endDate: Date
): boolean {
  if (!isFinanceArOpen(row) || row.suspendCollection || row.dueDate == null) return false;
  const due = startOfLocalDay(row.dueDate).getTime();
  const start = startOfLocalDay(startDate).getTime();
  const end = startOfLocalDay(endDate).getTime();
  return due >= start && due <= end;
}

export function isApOpenDueInPeriod(
  row: FinanceCashFlowApRow,
  startDate: Date,
  endDate: Date
): boolean {
  if (!isFinanceApOpen(row) || row.suspendPayment || row.dueDate == null) return false;
  const due = startOfLocalDay(row.dueDate).getTime();
  const start = startOfLocalDay(startDate).getTime();
  const end = startOfLocalDay(endDate).getTime();
  return due >= start && due <= end;
}

export function sumArOpenDueInPeriod(
  rows: FinanceCashFlowArRow[],
  startDate: Date,
  endDate: Date
): number {
  let total = 0;
  for (const row of rows) {
    if (!isArOpenDueInPeriod(row, startDate, endDate)) continue;
    total += row.balanceReceivable;
  }
  return roundMoney(total);
}

export function sumApOpenDueInPeriod(
  rows: FinanceCashFlowApRow[],
  startDate: Date,
  endDate: Date
): number {
  let total = 0;
  for (const row of rows) {
    if (!isApOpenDueInPeriod(row, startDate, endDate)) continue;
    total += resolveFinanceApOpenAmount(row);
  }
  return roundMoney(total);
}

function monthEnd(year: number, month: number, capDate: Date | null): Date {
  if (
    capDate &&
    capDate.getFullYear() === year &&
    capDate.getMonth() + 1 === month
  ) {
    return startOfLocalDay(capDate);
  }
  return startOfLocalDay(new Date(year, month, 0));
}

export function buildExecutiveMonthlyTimeline(
  arRows: FinanceCashFlowArRow[],
  apRows: FinanceCashFlowApRow[],
  year: number,
  referenceDate: Date
): FinanceCashFlowExecutiveMonthlyRow[] {
  const isCurrentYear = year === referenceDate.getFullYear();
  const endMonth = 12;
  const capDate = isCurrentYear ? startOfLocalDay(referenceDate) : null;
  const rows: FinanceCashFlowExecutiveMonthlyRow[] = [];
  let accumulated = 0;

  for (let m = 1; m <= endMonth; m += 1) {
    const monthStart = startOfLocalDay(new Date(year, m - 1, 1));
    const monthEndDate = monthEnd(year, m, capDate);
    const received = sumArReceivedInPeriod(arRows, monthStart, monthEndDate);
    const receivableOpenDue = sumArOpenDueInPeriod(arRows, monthStart, monthEndDate);
    const paid = sumApPaidInPeriod(apRows, monthStart, monthEndDate);
    const payableOpenDue = sumApOpenDueInPeriod(apRows, monthStart, monthEndDate);
    const estimatedInflow = roundMoney(received + receivableOpenDue);
    const estimatedOutflow = roundMoney(paid + payableOpenDue);
    const netFlow = roundMoney(estimatedInflow - estimatedOutflow);
    accumulated = roundMoney(accumulated + netFlow);

    rows.push({
      year,
      month: m,
      monthLabel: MONTH_LABELS[m - 1]!,
      received,
      receivableOpenDue,
      estimatedInflow,
      paid,
      payableOpenDue,
      estimatedOutflow,
      netFlow,
      accumulatedNet: accumulated,
    });
  }

  return rows;
}

function resolvePeriodLabel(
  filters: FinanceCashFlowDashboardFilters,
  referenceDate: Date
): string {
  const year = filters.year ?? referenceDate.getFullYear();
  if (filters.month != null) {
    const label = MONTH_LABELS[filters.month - 1] ?? String(filters.month);
    return `${label}/${year}`;
  }
  return `Ano ${year}`;
}

function resolveReceivableOriginLabel(invoiceIssued?: string): string {
  if (invoiceIssued === "yes") return "Com NF";
  if (invoiceIssued === "no") return "Sem NF";
  return "Tudo";
}

export function buildFinanceCashFlowExecutiveSummary(
  allArRows: FinanceCashFlowArRow[],
  allApRows: FinanceCashFlowApRow[],
  filters: FinanceCashFlowDashboardFilters,
  referenceDate: Date,
  period: {
    inflowAmount: number;
    outflowAmount: number;
    netFlowAmount: number;
    accumulatedBalance: number;
  },
  syncCutoff?: NomusArReportSyncCutoff | null
): FinanceCashFlowExecutiveSummary {
  const ytdFilters = buildYtdDashboardFilters(filters, referenceDate);
  const year = ytdFilters.year!;
  const { startDate, endDate, scopeLabel } = resolveYtdDateRange(year, referenceDate);
  const forward = resolveForwardYearRange(year, referenceDate);

  const arYtd = filterArRowsForYtdReceived(allArRows, ytdFilters, referenceDate, syncCutoff);
  const apYtd = filterApRowsForYtdPaid(allApRows, ytdFilters, referenceDate);

  const receivedYtd = sumArReceivedInPeriod(arYtd, startDate, endDate);
  const paidYtd = sumApPaidInPeriod(apYtd, startDate, endDate);
  const openArForward = forward.isActive
    ? sumArOpenDueInPeriod(arYtd, forward.fromDate, forward.toDate)
    : 0;
  const openApForward = forward.isActive
    ? sumApOpenDueInPeriod(apYtd, forward.fromDate, forward.toDate)
    : 0;

  const estimatedArYear = roundMoney(receivedYtd + openArForward);
  const estimatedApYear = roundMoney(paidYtd + openApForward);
  const realizedYtd = roundMoney(receivedYtd - paidYtd);
  const projectedRemaining = roundMoney(openArForward - openApForward);
  const estimatedYearNet = roundMoney(estimatedArYear - estimatedApYear);

  const monthlyTimeline = buildExecutiveMonthlyTimeline(arYtd, apYtd, year, referenceDate);

  return {
    receivable: {
      receivedYtd,
      openFromTodayToYearEnd: openArForward,
      estimatedYearTotal: estimatedArYear,
    },
    payable: {
      paidYtd,
      openFromTodayToYearEnd: openApForward,
      estimatedYearTotal: estimatedApYear,
    },
    net: {
      realizedYtd,
      projectedRemaining,
      estimatedYearNet,
      estimatedYearNetStatus: estimatedYearNet >= 0 ? "surplus" : "deficit",
    },
    period: {
      inflowAmount: period.inflowAmount,
      outflowAmount: period.outflowAmount,
      netFlowAmount: period.netFlowAmount,
      accumulatedBalance: period.accumulatedBalance,
      monthFiltered: filters.month != null,
      periodLabel: resolvePeriodLabel(filters, referenceDate),
    },
    monthlyTimeline,
    metadata: {
      year,
      month: filters.month,
      today: referenceDate.toISOString(),
      yearEnd: forward.toDate.toISOString(),
      forwardRangeLabel: forward.label,
      forwardRangeActive: forward.isActive,
      receivableOrigin: resolveReceivableOriginLabel(filters.invoiceIssued),
      viewMode: filters.viewMode,
      ytdScopeLabel: scopeLabel,
      periodScopeLabel: resolvePeriodLabel(filters, referenceDate),
    },
  };
}

export function executiveSummaryMetricsAreFinite(
  summary: FinanceCashFlowExecutiveSummary
): boolean {
  const nums = [
    summary.receivable.receivedYtd,
    summary.receivable.openFromTodayToYearEnd,
    summary.receivable.estimatedYearTotal,
    summary.payable.paidYtd,
    summary.payable.openFromTodayToYearEnd,
    summary.payable.estimatedYearTotal,
    summary.net.realizedYtd,
    summary.net.projectedRemaining,
    summary.net.estimatedYearNet,
    summary.period.inflowAmount,
    summary.period.outflowAmount,
    summary.period.netFlowAmount,
    summary.period.accumulatedBalance,
  ];
  if (!nums.every((n) => Number.isFinite(n))) return false;
  for (const row of summary.monthlyTimeline) {
    for (const v of Object.values(row)) {
      if (typeof v === "number" && !Number.isFinite(v)) return false;
    }
  }
  return true;
}
