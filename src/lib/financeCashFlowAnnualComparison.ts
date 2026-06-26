/**
 * Comparativo anual AR/AP do Fluxo de Caixa — independente dos filtros da página.
 * Reutiliza buildExecutiveMonthlyTimeline e saneamento gerencial padrão.
 */
import { DEFAULT_FINANCE_MANAGEMENT_SCOPE } from "./financeInternalGroupExclusions.js";
import { roundMoney } from "./financeAccountsReceivableDashboard.js";
import type {
  FinanceCashFlowApRow,
  FinanceCashFlowArRow,
  FinanceCashFlowDashboardFilters,
} from "./financeCashFlowDashboard.js";
import {
  buildExecutiveMonthlyTimeline,
  filterApRowsForCashFlowExecutiveTimeline,
  type FinanceCashFlowExecutiveMonthlyRow,
} from "./financeCashFlowExecutiveSummary.js";
import {
  buildYtdDashboardFilters,
  filterArRowsForYtdReceived,
} from "./financeCashFlowExecutiveYtd.js";
import { computeGrowthTarget } from "./salesOrderDashboardRules.js";
import type { NomusApReportSyncCutoff } from "./financeNomusApReportFreshness.js";
import type { NomusArReportSyncCutoff } from "./financeNomusArReportFreshness.js";

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
  receivablePreviousYear: number;
  payableCurrentYear: number;
  receivableCurrentYear: number;
  receivableGoal: number | null;
};

export type FinanceCashFlowAnnualComparisonTotals = {
  receivablePreviousYear: number;
  payableCurrentYear: number;
  receivableCurrentYear: number;
  receivableGoal: number | null;
};

export type FinanceCashFlowAnnualComparisonPayload = {
  year: number;
  previousYear: number;
  months: FinanceCashFlowAnnualComparisonMonth[];
  totals: FinanceCashFlowAnnualComparisonTotals;
  hasReceivableGoal: boolean;
  filterIndependent: true;
  generatedAt: string;
};

export type FinanceCashFlowAnnualComparisonChartRow = {
  name: string;
  month: number;
  receivablePreviousYear: number;
  payableCurrentYear: number;
  receivableCurrentYear: number;
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

function sumTimelineField(
  rows: FinanceCashFlowExecutiveMonthlyRow[],
  field: keyof Pick<
    FinanceCashFlowExecutiveMonthlyRow,
    "estimatedInflow" | "estimatedOutflow"
  >
): number {
  return roundMoney(rows.reduce((acc, row) => acc + row[field], 0));
}

function filterArForAnnualComparison(
  arRows: FinanceCashFlowArRow[],
  referenceDate: Date,
  syncCutoff?: NomusArReportSyncCutoff | null
): FinanceCashFlowArRow[] {
  const base = createAnnualComparisonBaseFilters();
  return filterArRowsForYtdReceived(arRows, base, referenceDate, syncCutoff);
}

function filterApForAnnualComparisonYear(
  apRows: FinanceCashFlowApRow[],
  year: number,
  referenceDate: Date,
  syncCutoff?: NomusApReportSyncCutoff | null
): FinanceCashFlowApRow[] {
  const filters = buildYtdDashboardFilters(
    { ...createAnnualComparisonBaseFilters(), year },
    referenceDate
  );
  return filterApRowsForCashFlowExecutiveTimeline(
    apRows,
    filters,
    referenceDate,
    syncCutoff
  );
}

export function buildCashFlowAnnualComparison(
  arRows: FinanceCashFlowArRow[],
  apRows: FinanceCashFlowApRow[],
  year: number,
  referenceDate = new Date(),
  arSyncCutoff?: NomusArReportSyncCutoff | null,
  apSyncCutoff?: NomusApReportSyncCutoff | null
): FinanceCashFlowAnnualComparisonPayload {
  const previousYear = year - 1;
  const arBase = filterArForAnnualComparison(arRows, referenceDate, arSyncCutoff);
  const apCurrentYear = filterApForAnnualComparisonYear(
    apRows,
    year,
    referenceDate,
    apSyncCutoff
  );

  const currentTimeline = buildExecutiveMonthlyTimeline(
    arBase,
    apCurrentYear,
    year,
    referenceDate
  );
  const previousReceivableTimeline = buildExecutiveMonthlyTimeline(
    arBase,
    [],
    previousYear,
    referenceDate
  );

  const months: FinanceCashFlowAnnualComparisonMonth[] = MONTH_LABELS.map((monthLabel, idx) => {
    const month = idx + 1;
    const current = currentTimeline[idx];
    const previous = previousReceivableTimeline[idx];
    const receivablePreviousYear = previous?.estimatedInflow ?? 0;
    const receivableGoal = computeGrowthTarget(receivablePreviousYear);

    return {
      month,
      monthLabel,
      receivablePreviousYear,
      payableCurrentYear: current?.estimatedOutflow ?? 0,
      receivableCurrentYear: current?.estimatedInflow ?? 0,
      receivableGoal,
    };
  });

  const totalPreviousReceivable = sumTimelineField(previousReceivableTimeline, "estimatedInflow");
  const hasReceivableGoal = totalPreviousReceivable > 0;

  const totals: FinanceCashFlowAnnualComparisonTotals = {
    receivablePreviousYear: totalPreviousReceivable,
    payableCurrentYear: sumTimelineField(currentTimeline, "estimatedOutflow"),
    receivableCurrentYear: sumTimelineField(currentTimeline, "estimatedInflow"),
    receivableGoal: hasReceivableGoal
      ? roundMoney(
          months.reduce((acc, m) => acc + (m.receivableGoal ?? 0), 0)
        )
      : null,
  };

  return {
    year,
    previousYear,
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
      m.receivablePreviousYear > 0 ||
      m.payableCurrentYear > 0 ||
      m.receivableCurrentYear > 0 ||
      (m.receivableGoal != null && m.receivableGoal > 0)
  );
}

export function mapAnnualComparisonChartRows(
  payload: FinanceCashFlowAnnualComparisonPayload
): FinanceCashFlowAnnualComparisonChartRow[] {
  return payload.months.map((m) => ({
    name: m.monthLabel,
    month: m.month,
    receivablePreviousYear: m.receivablePreviousYear,
    payableCurrentYear: m.payableCurrentYear,
    receivableCurrentYear: m.receivableCurrentYear,
    receivableGoal: payload.hasReceivableGoal ? m.receivableGoal : null,
  }));
}

export function buildAnnualComparisonSeriesLabels(
  year: number,
  previousYear: number
): {
  receivablePreviousYear: string;
  payableCurrentYear: string;
  receivableCurrentYear: string;
  receivableGoal: string;
} {
  return {
    receivablePreviousYear: `Valor a receber ${previousYear}`,
    payableCurrentYear: `Valor a pagar ${year}`,
    receivableCurrentYear: `Valor a receber ${year}`,
    receivableGoal: `Meta recebimento ${year} (+30%)`,
  };
}
