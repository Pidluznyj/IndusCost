/**
 * Comparativo anual AR/AP do Fluxo de Caixa — independente dos filtros da página.
 * Reutiliza o motor oficial do gráfico "Fluxo de caixa planejado" (`buildExecutiveMonthlyTimeline`).
 */
import {
  roundMoney,
  startOfLocalDay,
  isFinanceArReceivedOrSettled,
  matchesFinanceArDashboardFilters,
  resolveFinanceArDueDateBounds,
  isFinanceArAllowedInManagementReport,
  type FinanceArDashboardFilters,
} from "./financeAccountsReceivableDashboard.js";
import { deduplicateFinanceArRows } from "./financeAccountsReceivableDeduplication.js";
import {
  resolveFinanceApEffectivePaymentDate,
  resolveFinanceApOpenAmount,
  resolveFinanceApRealizedAmount,
} from "./financeAccountsPayableRules.js";
import type {
  FinanceCashFlowApRow,
  FinanceCashFlowArRow,
  FinanceCashFlowDashboardFilters,
} from "./financeCashFlowDashboard.js";
import { isFinanceCashFlowArOpenRow } from "./financeCashFlowDataset.js";
import {
  buildExecutiveMonthlyTimeline,
  filterApRowsForCashFlowExecutiveTimeline,
  type FinanceCashFlowExecutiveMonthlyRow,
} from "./financeCashFlowExecutiveSummary.js";
import {
  filterFinanceApManagementReportRows,
  type FinanceApDashboardFilters,
} from "./financeAccountsPayableDashboard.js";
import { resolveEffectiveNomusApReportSyncCutoff } from "./financeNomusApReportFreshness.js";
import { computeGrowthTarget } from "./salesOrderDashboardRules.js";
import type { NomusApReportSyncCutoff } from "./financeNomusApReportFreshness.js";
import type { NomusArReportSyncCutoff } from "./financeNomusArReportFreshness.js";
import { DEFAULT_FINANCE_MANAGEMENT_SCOPE, isInternalGroupCounterparty } from "./financeInternalGroupExclusions.js";
import {
  isNomusArStaleForReports,
  resolveEffectiveNomusArReportSyncCutoff,
} from "./financeNomusArReportFreshness.js";
import { getAccountsPayableOperationalDueDate } from "./financeAccountsPayableOperational.js";
import { isFinanceApOpen } from "./financeAccountsPayableDashboard.js";
import {
  buildYtdDashboardFilters,
  filterArRowsForYtdReceived,
} from "./financeCashFlowExecutiveYtd.js";
import { suppressInferiorPreNfNomusArRows } from "./finance/financeArOperationalPortfolio.js";
import type { FinanceCashFlowArFilterOptions } from "./financeCashFlowRowFilters.js";

export class FinanceCashFlowAnnualComparisonParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FinanceCashFlowAnnualComparisonParseError";
  }
}

const MONTH_LABELS = [
  "jan",
  "fev",
  "mar",
  "abr",
  "mai",
  "jun",
  "jul",
  "ago",
  "set",
  "out",
  "nov",
  "dez",
] as const;

export type FinanceCashFlowAnnualComparisonMonth = {
  month: number;
  monthLabel: string;
  receivedAmount: number;
  receivableOpenAmount: number;
  cashInTotalAmount: number;
  paidAmount: number;
  payableOpenAmount: number;
  cashOutTotalAmount: number;
  netCashAmount: number;
  accumulatedCashAmount: number;
  plannedNetCashAmount: number;
  differenceAgainstPlanned: number;
  receivableGoal: number | null;
};

export type FinanceCashFlowAnnualComparisonTotals = {
  receivedAmount: number;
  receivableOpenAmount: number;
  cashInTotalAmount: number;
  paidAmount: number;
  payableOpenAmount: number;
  cashOutTotalAmount: number;
  netCashAmount: number;
  accumulatedCashAmount: number;
  receivableGoal: number | null;
};

export type FinanceCashFlowAnnualComparisonPayload = {
  year: number;
  months: FinanceCashFlowAnnualComparisonMonth[];
  totals: FinanceCashFlowAnnualComparisonTotals;
  hasReceivableGoal: boolean;
  filterIndependent: true;
  source: "cash-flow-planned-engine";
  generatedAt: string;
};

export type FinanceCashFlowAnnualComparisonChartRow = {
  name: string;
  month: number;
  receivedAmount: number;
  receivableOpenAmount: number;
  cashInTotalAmount: number;
  paidAmount: number;
  payableOpenAmount: number;
  cashOutTotalAmount: number;
  netCashAmount: number;
  accumulatedCashAmount: number;
  receivableGoal: number | null;
};

export const CASH_FLOW_ANNUAL_COMPARISON_SOURCE = "cash-flow-planned-engine" as const;

/** Filtros mínimos — sem recorte de página (mês, cliente, empresa, etc.). */
export function createAnnualComparisonBaseFilters(): FinanceCashFlowDashboardFilters {
  return {
    viewMode: "projected",
    dateBase: "due",
    status: "all",
    cashFlowScope: DEFAULT_FINANCE_MANAGEMENT_SCOPE,
  };
}

export function parseAnnualComparisonYear(
  value: unknown,
  referenceDate = new Date()
): number {
  if (value == null || String(value).trim() === "") {
    return referenceDate.getFullYear();
  }
  const year = Number.parseInt(String(value).trim(), 10);
  if (!Number.isFinite(year) || year < 2000 || year > 2100) {
    throw new FinanceCashFlowAnnualComparisonParseError(
      "Ano inválido. Informe um valor entre 2000 e 2100."
    );
  }
  return year;
}

function calendarMonthEnd(year: number, month: number): Date {
  return startOfLocalDay(new Date(year, month, 0));
}

function isDateInPeriod(date: Date, startDate: Date, endDate: Date): boolean {
  const t = startOfLocalDay(date).getTime();
  const start = startOfLocalDay(startDate).getTime();
  const end = startOfLocalDay(endDate).getTime();
  return t >= start && t <= end;
}

/** Valor realizado AR — usa recebimento; se liquidado sem recebimento registrado, usa valor do título. */
export function resolveAnnualComparisonArRealizedAmount(
  row: FinanceCashFlowArRow
): number {
  if (isFinanceArReceivedOrSettled(row)) {
    return row.amountReceived > 0 ? row.amountReceived : row.amountReceivable;
  }
  if (row.amountReceived > 0) return row.amountReceived;
  return 0;
}

/** Data de realização AR — baixa/liquidação; fallback operacional para título baixado sem data. */
export function resolveAnnualComparisonArRealizationDate(
  row: FinanceCashFlowArRow
): Date | null {
  if (resolveAnnualComparisonArRealizedAmount(row) <= 0) return null;
  if (row.settlementDate) return row.settlementDate;
  if (isFinanceArReceivedOrSettled(row) && row.dueDate) return row.dueDate;
  return null;
}

/** Data de realização AP — pagamento/baixa; fallback operacional quando ausente. */
export function resolveAnnualComparisonApPaymentDate(
  row: FinanceCashFlowApRow
): Date | null {
  const realized = resolveFinanceApRealizedAmount(row);
  if (realized <= 0) return null;
  const payment = row.paymentDate ?? row.settlementDate ?? null;
  if (payment) return payment;
  const effective = resolveFinanceApEffectivePaymentDate(row);
  if (effective) return effective;
  return row.dueDate;
}

export function isArReceivedByRealizationInPeriod(
  row: FinanceCashFlowArRow,
  startDate: Date,
  endDate: Date
): boolean {
  const realization = resolveAnnualComparisonArRealizationDate(row);
  if (!realization) return false;
  return isDateInPeriod(realization, startDate, endDate);
}

export function sumArReceivedByRealizationInPeriod(
  rows: FinanceCashFlowArRow[],
  startDate: Date,
  endDate: Date
): number {
  let total = 0;
  for (const row of rows) {
    if (!isArReceivedByRealizationInPeriod(row, startDate, endDate)) continue;
    total += resolveAnnualComparisonArRealizedAmount(row);
  }
  return roundMoney(total);
}

export function isApPaidByPaymentInPeriod(
  row: FinanceCashFlowApRow,
  startDate: Date,
  endDate: Date
): boolean {
  const payment = resolveAnnualComparisonApPaymentDate(row);
  if (!payment) return false;
  if (resolveFinanceApRealizedAmount(row) <= 0) return false;
  return isDateInPeriod(payment, startDate, endDate);
}

export function sumApPaidByPaymentInPeriod(
  rows: FinanceCashFlowApRow[],
  startDate: Date,
  endDate: Date
): number {
  let total = 0;
  for (const row of rows) {
    if (!isApPaidByPaymentInPeriod(row, startDate, endDate)) continue;
    total += resolveFinanceApRealizedAmount(row);
  }
  return roundMoney(total);
}

export function isArOpenDueInAnnualPeriod(
  row: FinanceCashFlowArRow,
  startDate: Date,
  endDate: Date
): boolean {
  if (!isFinanceCashFlowArOpenRow(row) || row.dueDate == null) return false;
  return isDateInPeriod(row.dueDate, startDate, endDate);
}

export function sumArOpenDueInAnnualPeriod(
  rows: FinanceCashFlowArRow[],
  startDate: Date,
  endDate: Date
): number {
  let total = 0;
  for (const row of rows) {
    if (!isArOpenDueInAnnualPeriod(row, startDate, endDate)) continue;
    total += row.balanceReceivable;
  }
  return roundMoney(total);
}

export function isApOpenDueInAnnualPeriod(
  row: FinanceCashFlowApRow,
  startDate: Date,
  endDate: Date
): boolean {
  if (!isFinanceApOpen(row) || row.suspendPayment || row.dueDate == null) return false;
  return isDateInPeriod(row.dueDate, startDate, endDate);
}

export function sumApOpenDueInAnnualPeriod(
  rows: FinanceCashFlowApRow[],
  startDate: Date,
  endDate: Date
): number {
  let total = 0;
  for (const row of rows) {
    if (!isApOpenDueInAnnualPeriod(row, startDate, endDate)) continue;
    total += resolveFinanceApOpenAmount(row);
  }
  return roundMoney(total);
}

/** @deprecated Motor legado por data de baixa/pagamento — mantido para testes de regressão. */
export function buildAnnualComparisonMonthlyTimeline(
  arRows: FinanceCashFlowArRow[],
  apRows: FinanceCashFlowApRow[],
  year: number
): Omit<
  FinanceCashFlowAnnualComparisonMonth,
  "receivableGoal" | "accumulatedCashAmount" | "plannedNetCashAmount" | "differenceAgainstPlanned"
>[] {
  const months: Omit<
    FinanceCashFlowAnnualComparisonMonth,
    "receivableGoal" | "accumulatedCashAmount" | "plannedNetCashAmount" | "differenceAgainstPlanned"
  >[] = [];

  for (let m = 1; m <= 12; m += 1) {
    const monthStart = startOfLocalDay(new Date(year, m - 1, 1));
    const monthEnd = calendarMonthEnd(year, m);
    const receivedAmount = sumArReceivedByRealizationInPeriod(arRows, monthStart, monthEnd);
    const receivableOpenAmount = sumArOpenDueInAnnualPeriod(arRows, monthStart, monthEnd);
    const paidAmount = sumApPaidByPaymentInPeriod(apRows, monthStart, monthEnd);
    const payableOpenAmount = sumApOpenDueInAnnualPeriod(apRows, monthStart, monthEnd);
    const cashInTotalAmount = roundMoney(receivedAmount + receivableOpenAmount);
    const cashOutTotalAmount = roundMoney(paidAmount + payableOpenAmount);
    const netCashAmount = roundMoney(cashInTotalAmount - cashOutTotalAmount);

    months.push({
      month: m,
      monthLabel: MONTH_LABELS[m - 1]!,
      receivedAmount,
      receivableOpenAmount,
      cashInTotalAmount,
      paidAmount,
      payableOpenAmount,
      cashOutTotalAmount,
      netCashAmount,
    });
  }

  return months;
}

/** Filtra carteira AR/AP com os mesmos filtros YTD do gráfico planejado (sem mês da página). */
export function filterRowsForPlannedAnnualComparison(
  arRows: FinanceCashFlowArRow[],
  apRows: FinanceCashFlowApRow[],
  year: number,
  referenceDate: Date,
  arSyncCutoff?: NomusArReportSyncCutoff | null,
  apSyncCutoff?: NomusApReportSyncCutoff | null,
  arFilterOptions?: FinanceCashFlowArFilterOptions
): {
  arFiltered: FinanceCashFlowArRow[];
  apFiltered: FinanceCashFlowApRow[];
} {
  const filters = buildYtdDashboardFilters(
    { ...createAnnualComparisonBaseFilters(), year },
    referenceDate
  );
  return {
    arFiltered: filterArRowsForYtdReceived(
      arRows,
      filters,
      referenceDate,
      arSyncCutoff,
      arFilterOptions
    ),
    apFiltered: filterApRowsForCashFlowExecutiveTimeline(
      apRows,
      filters,
      referenceDate,
      apSyncCutoff
    ),
  };
}

/** Mapeia linha da timeline executiva para o payload do comparativo anual — sem recálculo. */
export function mapExecutiveMonthlyRowToAnnualComparisonMonth(
  row: FinanceCashFlowExecutiveMonthlyRow
): Omit<FinanceCashFlowAnnualComparisonMonth, "receivableGoal"> {
  const plannedNetCashAmount = row.netFlow;
  const netCashAmount = row.netFlow;
  return {
    month: row.month,
    monthLabel: MONTH_LABELS[row.month - 1]!,
    receivedAmount: row.received,
    receivableOpenAmount: row.receivableOpenDue,
    cashInTotalAmount: row.estimatedInflow,
    paidAmount: row.paid,
    payableOpenAmount: row.payableOpenDue,
    cashOutTotalAmount: row.estimatedOutflow,
    netCashAmount,
    accumulatedCashAmount: row.accumulatedNet,
    plannedNetCashAmount,
    differenceAgainstPlanned: roundMoney(netCashAmount - plannedNetCashAmount),
  };
}

function toAnnualComparisonArLoadFilters(): FinanceArDashboardFilters {
  return { status: "all" };
}

/** Carteira AR gerencial para comparativo anual — inclui liquidados sem amountReceived (fantasma Nomus). */
export function filterArRowsForAnnualComparison(
  rows: FinanceCashFlowArRow[],
  referenceDate: Date,
  syncCutoff?: NomusArReportSyncCutoff | null
): FinanceCashFlowArRow[] {
  const arFilters = toAnnualComparisonArLoadFilters();
  const effectiveCutoff = resolveEffectiveNomusArReportSyncCutoff(rows, syncCutoff);
  const { empty } = resolveFinanceArDueDateBounds(arFilters);
  if (empty) return [];

  const matched = rows.filter((row) => {
    if (!matchesFinanceArDashboardFilters(row, arFilters, referenceDate)) return false;
    if (isInternalGroupCounterparty({ personName: row.personName, personCnpj: row.personCnpj })) {
      return false;
    }
    if (isNomusArStaleForReports(row, effectiveCutoff)) return false;
    return isFinanceArAllowedInManagementReport(row, referenceDate);
  });
  return suppressInferiorPreNfNomusArRows(
    deduplicateFinanceArRows(matched).rows
  ) as FinanceCashFlowArRow[];
}

function toAnnualComparisonApManagementFilters(
  filters: FinanceCashFlowDashboardFilters
): FinanceApDashboardFilters {
  return {
    companyName: filters.companyName,
    personName: filters.supplierName,
    personCnpj: filters.personCnpj,
    status: "all",
    year: undefined,
    month: undefined,
    paymentMethodName: filters.paymentMethodName,
    bankAccountName: filters.bankAccountName,
    managementScope: filters.cashFlowScope ?? DEFAULT_FINANCE_MANAGEMENT_SCOPE,
  };
}

export function filterApRowsForAnnualComparison(
  rows: FinanceCashFlowApRow[],
  referenceDate: Date,
  syncCutoff?: NomusApReportSyncCutoff | null
): FinanceCashFlowApRow[] {
  const apFilters = toAnnualComparisonApManagementFilters(createAnnualComparisonBaseFilters());
  const effectiveCutoff = resolveEffectiveNomusApReportSyncCutoff(rows, syncCutoff);
  return filterFinanceApManagementReportRows(
    rows,
    apFilters,
    referenceDate,
    effectiveCutoff
  ) as FinanceCashFlowApRow[];
}

export function buildCashFlowAnnualComparison(
  arRows: FinanceCashFlowArRow[],
  apRows: FinanceCashFlowApRow[],
  year: number,
  referenceDate = new Date(),
  arSyncCutoff?: NomusArReportSyncCutoff | null,
  apSyncCutoff?: NomusApReportSyncCutoff | null,
  arFilterOptions?: FinanceCashFlowArFilterOptions
): FinanceCashFlowAnnualComparisonPayload {
  const { arFiltered, apFiltered } = filterRowsForPlannedAnnualComparison(
    arRows,
    apRows,
    year,
    referenceDate,
    arSyncCutoff,
    apSyncCutoff,
    arFilterOptions
  );

  const ytdFilters = buildYtdDashboardFilters(
    { ...createAnnualComparisonBaseFilters(), year },
    referenceDate
  );

  const timeline = buildExecutiveMonthlyTimeline(arFiltered, apFiltered, year, referenceDate, {
    filters: ytdFilters,
    arSyncCutoff,
    apSyncCutoff,
  });

  const previousYear = year - 1;
  const previousTimeline = buildExecutiveMonthlyTimeline(
    arFiltered,
    apFiltered,
    previousYear,
    referenceDate,
    {
      filters: { ...ytdFilters, year: previousYear },
      arSyncCutoff,
      apSyncCutoff,
    }
  );

  const months: FinanceCashFlowAnnualComparisonMonth[] = timeline.map((row, idx) => {
    const previous = previousTimeline[idx];
    const previousInflow = previous?.estimatedInflow ?? 0;
    const receivableGoal =
      previousInflow > 0 ? computeGrowthTarget(previousInflow) : null;

    return {
      ...mapExecutiveMonthlyRowToAnnualComparisonMonth(row),
      receivableGoal,
    };
  });

  const totalPreviousInflow = roundMoney(
    previousTimeline.reduce((acc, row) => acc + row.estimatedInflow, 0)
  );
  const hasReceivableGoal = totalPreviousInflow > 0;

  const lastMonth = months[months.length - 1];

  const totals: FinanceCashFlowAnnualComparisonTotals = {
    receivedAmount: roundMoney(months.reduce((acc, m) => acc + m.receivedAmount, 0)),
    receivableOpenAmount: roundMoney(
      months.reduce((acc, m) => acc + m.receivableOpenAmount, 0)
    ),
    cashInTotalAmount: roundMoney(months.reduce((acc, m) => acc + m.cashInTotalAmount, 0)),
    paidAmount: roundMoney(months.reduce((acc, m) => acc + m.paidAmount, 0)),
    payableOpenAmount: roundMoney(months.reduce((acc, m) => acc + m.payableOpenAmount, 0)),
    cashOutTotalAmount: roundMoney(months.reduce((acc, m) => acc + m.cashOutTotalAmount, 0)),
    netCashAmount: roundMoney(months.reduce((acc, m) => acc + m.netCashAmount, 0)),
    accumulatedCashAmount: lastMonth?.accumulatedCashAmount ?? 0,
    receivableGoal: hasReceivableGoal
      ? roundMoney(months.reduce((acc, m) => acc + (m.receivableGoal ?? 0), 0))
      : null,
  };

  return {
    year,
    months,
    totals,
    hasReceivableGoal,
    filterIndependent: true,
    source: CASH_FLOW_ANNUAL_COMPARISON_SOURCE,
    generatedAt: referenceDate.toISOString(),
  };
}

export function annualComparisonHasChartData(
  payload: FinanceCashFlowAnnualComparisonPayload
): boolean {
  return payload.months.some(
    (m) =>
      m.receivedAmount > 0 ||
      m.receivableOpenAmount > 0 ||
      m.paidAmount > 0 ||
      m.payableOpenAmount > 0 ||
      m.cashInTotalAmount > 0 ||
      m.cashOutTotalAmount > 0 ||
      (m.receivableGoal != null && m.receivableGoal > 0)
  );
}

export function mapAnnualComparisonChartRows(
  payload: FinanceCashFlowAnnualComparisonPayload
): FinanceCashFlowAnnualComparisonChartRow[] {
  return payload.months.map((m) => ({
    name: m.monthLabel,
    month: m.month,
    receivedAmount: m.receivedAmount,
    receivableOpenAmount: m.receivableOpenAmount,
    cashInTotalAmount: m.cashInTotalAmount,
    paidAmount: m.paidAmount,
    payableOpenAmount: m.payableOpenAmount,
    cashOutTotalAmount: m.cashOutTotalAmount,
    netCashAmount: m.netCashAmount,
    accumulatedCashAmount: m.accumulatedCashAmount,
    receivableGoal: payload.hasReceivableGoal ? m.receivableGoal : null,
  }));
}

export function buildAnnualComparisonSeriesLabels(year: number): {
  receivedAmount: string;
  receivableOpenAmount: string;
  paidAmount: string;
  payableOpenAmount: string;
  netCashAmount: string;
  receivableGoal: string;
} {
  return {
    receivedAmount: "Recebido",
    receivableOpenAmount: "A Receber",
    paidAmount: "Pago",
    payableOpenAmount: "A Pagar",
    netCashAmount: "Saldo mensal",
    receivableGoal: `Meta de recebimento ${year} (+30%)`,
  };
}
