import {
  filterFinanceApManagementReportRows,
  filterFinanceApRows,
  isFinanceApOpen,
  roundMoney,
  startOfLocalDay,
  sumFinanceApPaidInPaymentPeriodFromFilteredRows,
  toFinanceApPaymentScopeFilters,
  type FinanceApDashboardFilters,
} from "./financeAccountsPayableDashboard.js";
import {
  filterFinanceArManagementReportRows,
  sumFinanceArReceivedBySettlementInFilteredRows,
  toFinanceArSettlementScopeFilters,
} from "./financeAccountsReceivableDashboard.js";
import { DEFAULT_FINANCE_MANAGEMENT_SCOPE } from "./financeInternalGroupExclusions.js";
import {
  resolveOfficialArCashFlowExecutiveMetrics,
} from "./financeAccountsReceivableRulesAdapter.js";
import { sumOfficialArOpenDueInPeriod } from "./financeAccountsReceivableRulesEngine.js";
import { isFinanceCashFlowArOpenRow } from "./financeCashFlowDataset.js";
import type {
  FinanceCashFlowApRow,
  FinanceCashFlowArRow,
  FinanceCashFlowDashboardFilters,
} from "./financeCashFlowDashboard.js";
import {
  resolveOfficialApCashFlowExecutiveMetrics,
} from "./financeAccountsPayableRulesAdapter.js";
import { sumOfficialApOpenDueInPeriod } from "./financeAccountsPayableRulesEngine.js";
import { toApLoadFilters, toArLoadFilters } from "./financeCashFlowDashboard.js";
import type { NetCashPositionStatus } from "./financeCashFlowDashboardTypes.js";
import {
  buildYtdDashboardFilters,
  filterArRowsForYtdReceived,
  resolveYtdDateRange,
  sumArReceivedInPeriod,
} from "./financeCashFlowExecutiveYtd.js";
import type { FinanceCashFlowArFilterOptions } from "./financeCashFlowRowFilters.js";
import type { NomusArReportSyncCutoff } from "./financeNomusArReportFreshness.js";
import {
  resolveEffectiveNomusApReportSyncCutoff,
  type NomusApReportSyncCutoff,
} from "./financeNomusApReportFreshness.js";
import {
  resolveFinanceApEffectivePaymentDate,
  resolveFinanceApRealizedAmount,
} from "./financeAccountsPayableRules.js";

export type FinanceCashFlowExecutiveSummaryMetadata = {
  year: number;
  month?: number;
  today: string;
  yearEnd: string;
  forwardRangeLabel: string;
  forwardRangeActive: boolean;
  annualScopeIgnoresMonthFilter: boolean;
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

export type FinanceCashFlowPayableForwardMonthBreakdown = {
  month: number;
  monthLabel: string;
  openAmount: number;
  includedInForwardRange: boolean;
};

export type FinanceCashFlowPeriodVsForwardPayable = {
  filteredMonth: number;
  filteredMonthLabel: string;
  periodOutflowAmount: number;
  forwardOpenTotal: number;
  forwardOpenInFilteredMonth: number;
  forwardOpenOutsideFilteredMonth: number;
  gapVsPeriodOutflow: number;
  annualScopeIgnoresMonthFilter: true;
  forwardRangeLabel: string;
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
    openForwardByMonth: FinanceCashFlowPayableForwardMonthBreakdown[];
    periodVsForward: FinanceCashFlowPeriodVsForwardPayable | null;
  };
  net: FinanceCashFlowExecutiveSummaryNet;
  period: FinanceCashFlowExecutiveSummaryPeriod;
  /** Linha do tempo mensal: Recebido/Pago por data de movimento; aberto por vencimento. */
  monthlyTimeline: FinanceCashFlowExecutiveMonthlyRow[];
  /**
   * Fluxo planejado / comparativo anual / calendário: Recebido/Pago e aberto
   * alocados por vencimento (`dueDate`). Distinto de `monthlyTimeline`.
   */
  plannedMonthlyTimeline: FinanceCashFlowExecutiveMonthlyRow[];
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

/** Filtros AP gerenciais alinhados a Contas a Pagar (YTD anual, sem mês fixo na carteira). */
export function toExecutiveApManagementFilters(
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
    year: filters.year,
    month: undefined,
    paymentMethodName: filters.paymentMethodName,
    bankAccountName: filters.bankAccountName,
    managementScope: filters.cashFlowScope ?? DEFAULT_FINANCE_MANAGEMENT_SCOPE,
  };
}

/** Base saneada única para timeline executiva mensal e totais AP do resumo. */
export function filterApRowsForCashFlowExecutiveTimeline(
  rows: FinanceCashFlowApRow[],
  filters: FinanceCashFlowDashboardFilters,
  referenceDate: Date,
  syncCutoff?: NomusApReportSyncCutoff | null
): FinanceCashFlowApRow[] {
  const apFilters = toExecutiveApManagementFilters(filters);
  const effectiveCutoff = resolveEffectiveNomusApReportSyncCutoff(rows, syncCutoff);
  return filterFinanceApManagementReportRows(
    rows,
    apFilters,
    referenceDate,
    effectiveCutoff
  ) as FinanceCashFlowApRow[];
}

/** @deprecated Use filterApRowsForCashFlowExecutiveTimeline — alias mantido para testes legados. */
export function filterApRowsForYtdPaid(
  rows: FinanceCashFlowApRow[],
  filters: FinanceCashFlowDashboardFilters,
  referenceDate: Date,
  syncCutoff?: NomusApReportSyncCutoff | null
): FinanceCashFlowApRow[] {
  return filterApRowsForCashFlowExecutiveTimeline(rows, filters, referenceDate, syncCutoff);
}

export function resolveApPaymentDate(row: FinanceCashFlowApRow): Date | null {
  return resolveFinanceApEffectivePaymentDate(row);
}

export function isApPaidInPeriod(
  row: FinanceCashFlowApRow,
  startDate: Date,
  endDate: Date
): boolean {
  // Fluxo de Caixa planejado aloca entradas/saídas pelo vencimento (dueDate),
  // mantendo paymentDate apenas como auditoria operacional.
  const realized = resolveFinanceApRealizedAmount(row);
  if (realized <= 0 || row.dueDate == null) return false;
  const due = startOfLocalDay(row.dueDate).getTime();
  const start = startOfLocalDay(startDate).getTime();
  const end = startOfLocalDay(endDate).getTime();
  return due >= start && due <= end;
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
  if (!isFinanceCashFlowArOpenRow(row) || row.dueDate == null) return false;
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

/** Timeline mensal — saldo aberto por vencimento (dueDate); delega ao motor oficial. */
export function sumArOpenDueInPeriod(
  rows: FinanceCashFlowArRow[],
  startDate: Date,
  endDate: Date
): number {
  return sumOfficialArOpenDueInPeriod(rows, startDate, endDate);
}

export function sumApOpenDueInPeriod(
  rows: FinanceCashFlowApRow[],
  startDate: Date,
  endDate: Date
): number {
  return sumOfficialApOpenDueInPeriod(rows, startDate, endDate);
}

function calendarMonthEnd(year: number, month: number): Date {
  return startOfLocalDay(new Date(year, month, 0));
}

/** Saldo AP em aberto por mês calendário, recortado ao intervalo futuro (hoje → 31/12). */
export function buildApOpenForwardMonthlyBreakdown(
  rows: FinanceCashFlowApRow[],
  year: number,
  forward: ReturnType<typeof resolveForwardYearRange>
): FinanceCashFlowPayableForwardMonthBreakdown[] {
  if (!forward.isActive) {
    return MONTH_LABELS.map((monthLabel, index) => ({
      month: index + 1,
      monthLabel,
      openAmount: 0,
      includedInForwardRange: false,
    }));
  }

  const breakdown: FinanceCashFlowPayableForwardMonthBreakdown[] = [];
  for (let m = 1; m <= 12; m += 1) {
    const monthStart = startOfLocalDay(new Date(year, m - 1, 1));
    const monthEnd = calendarMonthEnd(year, m);
    const rangeStart =
      forward.fromDate.getTime() > monthStart.getTime() ? forward.fromDate : monthStart;
    const rangeEnd = forward.toDate.getTime() < monthEnd.getTime() ? forward.toDate : monthEnd;
    const includedInForwardRange = rangeStart.getTime() <= rangeEnd.getTime();
    const openAmount = includedInForwardRange
      ? sumApOpenDueInPeriod(rows, rangeStart, rangeEnd)
      : 0;
    breakdown.push({
      month: m,
      monthLabel: MONTH_LABELS[m - 1]!,
      openAmount,
      includedInForwardRange,
    });
  }
  return breakdown;
}

export function buildPeriodVsForwardPayableComparison(input: {
  filters: FinanceCashFlowDashboardFilters;
  periodOutflowAmount: number;
  forwardOpenTotal: number;
  openForwardByMonth: FinanceCashFlowPayableForwardMonthBreakdown[];
  forwardRangeLabel: string;
}): FinanceCashFlowPeriodVsForwardPayable | null {
  const filteredMonth = input.filters.month;
  if (filteredMonth == null) return null;

  const forwardOpenInFilteredMonth =
    input.openForwardByMonth.find((row) => row.month === filteredMonth)?.openAmount ?? 0;
  const forwardOpenOutsideFilteredMonth = roundMoney(
    input.openForwardByMonth
      .filter((row) => row.includedInForwardRange && row.month !== filteredMonth)
      .reduce((sum, row) => sum + row.openAmount, 0)
  );

  return {
    filteredMonth,
    filteredMonthLabel: MONTH_LABELS[filteredMonth - 1] ?? String(filteredMonth),
    periodOutflowAmount: input.periodOutflowAmount,
    forwardOpenTotal: input.forwardOpenTotal,
    forwardOpenInFilteredMonth,
    forwardOpenOutsideFilteredMonth,
    gapVsPeriodOutflow: roundMoney(input.forwardOpenTotal - input.periodOutflowAmount),
    annualScopeIgnoresMonthFilter: true,
    forwardRangeLabel: input.forwardRangeLabel,
  };
}

export type FinanceCashFlowTimelineDateAxis = "dueDate" | "movement";

export function buildExecutiveMonthlyTimeline(
  arRows: FinanceCashFlowArRow[],
  apRows: FinanceCashFlowApRow[],
  year: number,
  referenceDate: Date,
  officialContext?: {
    filters: FinanceCashFlowDashboardFilters;
    arSyncCutoff?: NomusArReportSyncCutoff | null;
    apSyncCutoff?: NomusApReportSyncCutoff | null;
    /** População do pago realizado (sem recorte por dueDate). Default: `apRows`. */
    apPaidSourceRows?: FinanceCashFlowApRow[];
    /**
     * `dueDate` — fluxo planejado, comparativo anual e calendário.
     * `movement` — linha do tempo mensal (AR settlementDate, AP data efetiva).
     * Default: `dueDate` para não contaminar gráficos de vencimento.
     */
    dateAxis?: FinanceCashFlowTimelineDateAxis;
  }
): FinanceCashFlowExecutiveMonthlyRow[] {
  const rows: FinanceCashFlowExecutiveMonthlyRow[] = [];
  let accumulated = 0;
  const dateAxis: FinanceCashFlowTimelineDateAxis = officialContext?.dateAxis ?? "dueDate";
  const useMovementAxis = officialContext != null && dateAxis === "movement";

  const arForReceived =
    officialContext == null
      ? arRows
      : filterFinanceArManagementReportRows(
          arRows,
          useMovementAxis
            ? toFinanceArSettlementScopeFilters(toArLoadFilters(officialContext.filters))
            : toArLoadFilters(officialContext.filters),
          referenceDate,
          officialContext.arSyncCutoff
        );
  const apForPaid =
    officialContext == null
      ? apRows
      : filterFinanceApRows(
          useMovementAxis ? (officialContext.apPaidSourceRows ?? apRows) : apRows,
          useMovementAxis
            ? toFinanceApPaymentScopeFilters(toApLoadFilters(officialContext.filters))
            : toApLoadFilters(officialContext.filters),
          referenceDate,
          officialContext.apSyncCutoff
        );

  for (let m = 1; m <= 12; m += 1) {
    const monthStart = startOfLocalDay(new Date(year, m - 1, 1));
    const monthEndDate = calendarMonthEnd(year, m);
    const received = useMovementAxis
      ? sumFinanceArReceivedBySettlementInFilteredRows(arForReceived, monthStart, monthEndDate)
      : sumArReceivedInPeriod(arForReceived, monthStart, monthEndDate);
    const receivableOpenDue = sumArOpenDueInPeriod(arRows, monthStart, monthEndDate);
    const paid = useMovementAxis
      ? sumFinanceApPaidInPaymentPeriodFromFilteredRows(apForPaid, monthStart, monthEndDate)
      : sumApPaidInPeriod(apForPaid, monthStart, monthEndDate);
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
  syncCutoff?: NomusArReportSyncCutoff | null,
  apSyncCutoff?: NomusApReportSyncCutoff | null,
  arFilterOptions?: FinanceCashFlowArFilterOptions
): FinanceCashFlowExecutiveSummary {
  const ytdFilters = buildYtdDashboardFilters(filters, referenceDate);
  const year = ytdFilters.year!;
  const { startDate, endDate, scopeLabel } = resolveYtdDateRange(year, referenceDate);
  const forward = resolveForwardYearRange(year, referenceDate);

  const arYtd = filterArRowsForYtdReceived(
    allArRows,
    ytdFilters,
    referenceDate,
    syncCutoff,
    arFilterOptions
  );
  const apYtd = filterApRowsForCashFlowExecutiveTimeline(
    allApRows,
    ytdFilters,
    referenceDate,
    apSyncCutoff
  );

  const arOfficialFilters = toArLoadFilters(ytdFilters);
  const arOfficial = resolveOfficialArCashFlowExecutiveMetrics(
    arYtd,
    arOfficialFilters,
    referenceDate,
    syncCutoff,
    year
  );
  const apOfficialFilters = toApLoadFilters(ytdFilters);
  const apOfficial = resolveOfficialApCashFlowExecutiveMetrics(
    allApRows,
    apOfficialFilters,
    referenceDate,
    apSyncCutoff,
    year
  );
  const receivedYtd = arOfficial.receivedYtd;
  const paidYtd = apOfficial.paidYtd;
  const openArForward = arOfficial.openUntilYearEnd;
  const openApForward = apOfficial.openUntilYearEnd;

  const estimatedArYear = arOfficial.estimatedYearTotal;
  const estimatedApYear = apOfficial.estimatedYearTotal;
  const realizedYtd = roundMoney(receivedYtd - paidYtd);
  const projectedRemaining = roundMoney(openArForward - openApForward);
  const estimatedYearNet = roundMoney(estimatedArYear - estimatedApYear);

  const monthlyTimeline = buildExecutiveMonthlyTimeline(arYtd, apYtd, year, referenceDate, {
    filters: ytdFilters,
    arSyncCutoff: syncCutoff,
    apSyncCutoff,
    apPaidSourceRows: allApRows,
    dateAxis: "movement",
  });
  const plannedMonthlyTimeline = buildExecutiveMonthlyTimeline(
    arYtd,
    apYtd,
    year,
    referenceDate,
    {
      filters: ytdFilters,
      arSyncCutoff: syncCutoff,
      apSyncCutoff,
      dateAxis: "dueDate",
    }
  );

  const openForwardByMonth = buildApOpenForwardMonthlyBreakdown(apYtd, year, forward);
  const periodVsForward = buildPeriodVsForwardPayableComparison({
    filters,
    periodOutflowAmount: period.outflowAmount,
    forwardOpenTotal: openApForward,
    openForwardByMonth,
    forwardRangeLabel: forward.label,
  });

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
      openForwardByMonth,
      periodVsForward,
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
    plannedMonthlyTimeline,
    metadata: {
      year,
      month: filters.month,
      today: referenceDate.toISOString(),
      yearEnd: forward.toDate.toISOString(),
      forwardRangeLabel: forward.label,
      forwardRangeActive: forward.isActive,
      annualScopeIgnoresMonthFilter: filters.month != null,
      receivableOrigin: resolveReceivableOriginLabel(filters.invoiceIssued),
      viewMode: filters.viewMode,
      ytdScopeLabel: `${scopeLabel} — AR por data de baixa e AP por data efetiva (motor oficial)`,
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
    ...summary.payable.openForwardByMonth.map((row) => row.openAmount),
    summary.net.realizedYtd,
    summary.net.projectedRemaining,
    summary.net.estimatedYearNet,
    summary.period.inflowAmount,
    summary.period.outflowAmount,
    summary.period.netFlowAmount,
    summary.period.accumulatedBalance,
  ];
  if (!nums.every((n) => Number.isFinite(n))) return false;
  for (const row of [...summary.monthlyTimeline, ...summary.plannedMonthlyTimeline]) {
    for (const v of Object.values(row)) {
      if (typeof v === "number" && !Number.isFinite(v)) return false;
    }
  }
  return true;
}
