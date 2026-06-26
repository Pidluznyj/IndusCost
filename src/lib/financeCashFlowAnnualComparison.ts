/**
 * Comparativo anual AR/AP do Fluxo de Caixa — independente dos filtros da página.
 * Reutiliza buildExecutiveMonthlyTimeline (mesmo motor do fluxo planejado).
 */
import { roundMoney } from "./financeAccountsReceivableDashboard.js";
import type {
  FinanceCashFlowApRow,
  FinanceCashFlowArRow,
  FinanceCashFlowDashboardFilters,
} from "./financeCashFlowDashboard.js";
import {
  buildExecutiveMonthlyTimeline,
  filterApRowsForCashFlowExecutiveTimeline,
} from "./financeCashFlowExecutiveSummary.js";
import {
  buildYtdDashboardFilters,
  filterArRowsForYtdReceived,
} from "./financeCashFlowExecutiveYtd.js";
import { computeGrowthTarget } from "./salesOrderDashboardRules.js";
import type { NomusApReportSyncCutoff } from "./financeNomusApReportFreshness.js";
import type { NomusArReportSyncCutoff } from "./financeNomusArReportFreshness.js";
import { DEFAULT_FINANCE_MANAGEMENT_SCOPE } from "./financeInternalGroupExclusions.js";

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
  paidAmount: number;
  payableOpenAmount: number;
  receivableGoal: number | null;
};

export type FinanceCashFlowAnnualComparisonTotals = {
  receivedAmount: number;
  receivableOpenAmount: number;
  paidAmount: number;
  payableOpenAmount: number;
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
  paidAmount: number;
  payableOpenAmount: number;
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

  const timeline = buildExecutiveMonthlyTimeline(
    arFiltered,
    apFiltered,
    year,
    referenceDate
  );

  const previousYear = year - 1;
  const previousTimeline = buildExecutiveMonthlyTimeline(
    arFiltered,
    [],
    previousYear,
    referenceDate
  );

  const months: FinanceCashFlowAnnualComparisonMonth[] = timeline.map((row, idx) => {
    const previous = previousTimeline[idx];
    const previousInflow = previous?.estimatedInflow ?? 0;
    const receivableGoal =
      previousInflow > 0 ? computeGrowthTarget(previousInflow) : null;

    return {
      month: row.month,
      monthLabel: MONTH_LABELS[row.month - 1]!,
      receivedAmount: row.received,
      receivableOpenAmount: row.receivableOpenDue,
      paidAmount: row.paid,
      payableOpenAmount: row.payableOpenDue,
      receivableGoal,
    };
  });

  const totalPreviousInflow = roundMoney(
    previousTimeline.reduce((acc, row) => acc + row.estimatedInflow, 0)
  );
  const hasReceivableGoal = totalPreviousInflow > 0;

  const totals: FinanceCashFlowAnnualComparisonTotals = {
    receivedAmount: roundMoney(months.reduce((acc, m) => acc + m.receivedAmount, 0)),
    receivableOpenAmount: roundMoney(
      months.reduce((acc, m) => acc + m.receivableOpenAmount, 0)
    ),
    paidAmount: roundMoney(months.reduce((acc, m) => acc + m.paidAmount, 0)),
    payableOpenAmount: roundMoney(months.reduce((acc, m) => acc + m.payableOpenAmount, 0)),
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
    paidAmount: m.paidAmount,
    payableOpenAmount: m.payableOpenAmount,
    receivableGoal: payload.hasReceivableGoal ? m.receivableGoal : null,
  }));
}

export function buildAnnualComparisonSeriesLabels(year: number): {
  receivedAmount: string;
  receivableOpenAmount: string;
  paidAmount: string;
  payableOpenAmount: string;
  receivableGoal: string;
} {
  return {
    receivedAmount: `Recebido ${year}`,
    receivableOpenAmount: `A receber ${year}`,
    paidAmount: `Pago ${year}`,
    payableOpenAmount: `A pagar ${year}`,
    receivableGoal: `Meta recebimento ${year} (+30%)`,
  };
}
