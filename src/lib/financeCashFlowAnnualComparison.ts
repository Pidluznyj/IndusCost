/**
 * Comparativo anual AR/AP do Fluxo de Caixa — independente dos filtros da página.
 * Realizado: data de baixa/recebimento (AR) e pagamento (AP).
 * Em aberto: vencimento operacional.
 */
import {
  roundMoney,
  startOfLocalDay,
  isFinanceArReceivedOrSettled,
} from "./financeAccountsReceivableDashboard.js";
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
  filterApRowsForCashFlowExecutiveTimeline,
  isApOpenDueInPeriod,
} from "./financeCashFlowExecutiveSummary.js";
import {
  buildYtdDashboardFilters,
  filterArRowsForYtdReceived,
} from "./financeCashFlowExecutiveYtd.js";
import { computeGrowthTarget } from "./salesOrderDashboardRules.js";
import type { NomusApReportSyncCutoff } from "./financeNomusApReportFreshness.js";
import type { NomusArReportSyncCutoff } from "./financeNomusArReportFreshness.js";
import { DEFAULT_FINANCE_MANAGEMENT_SCOPE } from "./financeInternalGroupExclusions.js";
import { getAccountsPayableOperationalDueDate } from "./financeAccountsPayableOperational.js";
import { isFinanceApOpen } from "./financeAccountsPayableDashboard.js";

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
  receivableGoal: number | null;
};

export type FinanceCashFlowAnnualComparisonPayload = {
  year: number;
  months: FinanceCashFlowAnnualComparisonMonth[];
  totals: FinanceCashFlowAnnualComparisonTotals;
  hasReceivableGoal: boolean;
  filterIndependent: true;
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
  receivableGoal: number | null;
};

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

/** Data de realização AR — baixa/liquidação; fallback operacional para título baixado sem data. */
export function resolveAnnualComparisonArRealizationDate(
  row: FinanceCashFlowArRow
): Date | null {
  if (row.amountReceived <= 0) return null;
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
    total += row.amountReceived;
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
  if (!isFinanceApOpen(row) || row.suspendPayment) return false;
  const operationalDueDate = getAccountsPayableOperationalDueDate(row);
  if (!operationalDueDate) return false;
  return isDateInPeriod(operationalDueDate, startDate, endDate);
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

export function buildAnnualComparisonMonthlyTimeline(
  arRows: FinanceCashFlowArRow[],
  apRows: FinanceCashFlowApRow[],
  year: number
): Omit<FinanceCashFlowAnnualComparisonMonth, "receivableGoal">[] {
  const months: Omit<FinanceCashFlowAnnualComparisonMonth, "receivableGoal">[] = [];

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

function filterRowsForAnnualComparison(
  arRows: FinanceCashFlowArRow[],
  apRows: FinanceCashFlowApRow[],
  year: number,
  referenceDate: Date,
  arSyncCutoff?: NomusArReportSyncCutoff | null,
  apSyncCutoff?: NomusApReportSyncCutoff | null
): {
  arFiltered: FinanceCashFlowArRow[];
  apFiltered: FinanceCashFlowApRow[];
} {
  const filters = buildYtdDashboardFilters(
    { ...createAnnualComparisonBaseFilters(), year },
    referenceDate
  );
  return {
    arFiltered: filterArRowsForYtdReceived(arRows, filters, referenceDate, arSyncCutoff),
    apFiltered: filterApRowsForCashFlowExecutiveTimeline(
      apRows,
      filters,
      referenceDate,
      apSyncCutoff
    ),
  };
}

export function buildCashFlowAnnualComparison(
  arRows: FinanceCashFlowArRow[],
  apRows: FinanceCashFlowApRow[],
  year: number,
  referenceDate = new Date(),
  arSyncCutoff?: NomusArReportSyncCutoff | null,
  apSyncCutoff?: NomusApReportSyncCutoff | null
): FinanceCashFlowAnnualComparisonPayload {
  const { arFiltered, apFiltered } = filterRowsForAnnualComparison(
    arRows,
    apRows,
    year,
    referenceDate,
    arSyncCutoff,
    apSyncCutoff
  );

  const timeline = buildAnnualComparisonMonthlyTimeline(arFiltered, apFiltered, year);

  const previousYear = year - 1;
  const previousTimeline = buildAnnualComparisonMonthlyTimeline(
    arFiltered,
    apFiltered,
    previousYear
  );

  const months: FinanceCashFlowAnnualComparisonMonth[] = timeline.map((row, idx) => {
    const previous = previousTimeline[idx];
    const previousInflow = previous?.cashInTotalAmount ?? 0;
    const receivableGoal =
      previousInflow > 0 ? computeGrowthTarget(previousInflow) : null;

    return {
      ...row,
      receivableGoal,
    };
  });

  const totalPreviousInflow = roundMoney(
    previousTimeline.reduce((acc, row) => acc + row.cashInTotalAmount, 0)
  );
  const hasReceivableGoal = totalPreviousInflow > 0;

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
