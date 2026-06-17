/**
 * Formatação e mapeamento visual do Relatório Presidencial.
 * Apenas apresentação — sem recalcular regras financeiras.
 */
import type { BillingMultiYearMonthlyPoint } from "./financeBillingChartData.js";
import { billingMonthlyChartHasData } from "./financeBillingChartRender.js";
import {
  getFinanceBillingYearColor,
  resolveFinanceBillingComparisonYears,
} from "./financeBillingChartTheme.js";
import type { BillingRealizedVsProjected } from "./executiveDashboardTypes.js";
import type { DashboardMonthlySeriesPoint } from "./executiveDashboardTypes.js";
import type { FinanceArMonthlyDue } from "./financeAccountsReceivableDashboardTypes.js";
import type { FinanceApMonthlyDue } from "./financeAccountsPayableDashboardTypes.js";
import type { FinanceCashFlowExecutiveMonthlyRow } from "./financeCashFlowExecutiveSummary.js";
import { formatExecutivePercent } from "./executiveDashboardFormatters.js";
import { formatFinanceKpiCurrency } from "./financeKpiFormat.js";

export const EXECUTIVE_REPORT_EMPTY_MESSAGE =
  "Sem dados suficientes para este indicador.";

export const EXECUTIVE_REPORT_NO_TARGET_MESSAGE =
  "Meta não cadastrada para este período.";

export const EXECUTIVE_REPORT_MONTH_LABELS_PT = [
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

export function executiveReportMonthLabelPt(month: number): string {
  if (month >= 1 && month <= 12) return EXECUTIVE_REPORT_MONTH_LABELS_PT[month - 1];
  return String(month);
}

/** Moeda compacta para cards e tooltips (R$ mil / R$ Mi). */
export function formatExecutiveReportPresentationCurrency(
  value: number | null | undefined
): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return formatFinanceKpiCurrency(value);
}

/** Percentual com duas casas para apresentação executiva. */
export function formatExecutiveReportPresentationPercent(
  value: number | null | undefined,
  decimals: 1 | 2 = 2
): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return formatExecutivePercent(value, decimals);
}

/** Eixo de gráfico — abrevia em mil/Mi. */
export function formatExecutiveReportAxisCurrency(value: number): string {
  if (!Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  if (abs >= 1_000_000) {
    return `R$ ${new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 }).format(value / 1_000_000)} Mi`;
  }
  if (abs >= 1_000) {
    return `R$ ${new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 }).format(value / 1_000)} mil`;
  }
  return formatFinanceKpiCurrency(value);
}

export type ExecutiveBarComparisonSeries = {
  year: number;
  color: string;
  label: string;
};

export type ExecutiveBarComparisonRow = {
  month: number;
  monthLabel: string;
  monthLabelPt: string;
  isCurrentMonth: boolean;
  values: Record<number, number | null>;
};

export function mapBillingMultiYearToBarComparison(
  points: BillingMultiYearMonthlyPoint[],
  selectedYear: number,
  currentMonth: number
): {
  years: ExecutiveBarComparisonSeries[];
  rows: ExecutiveBarComparisonRow[];
  hasData: boolean;
} {
  const years = resolveFinanceBillingComparisonYears(selectedYear, 3);
  const rows = [...points]
    .sort((a, b) => a.month - b.month)
    .map((p) => ({
      month: p.month,
      monthLabel: p.monthLabel,
      monthLabelPt: executiveReportMonthLabelPt(p.month),
      isCurrentMonth: p.month === currentMonth,
      values: Object.fromEntries(years.map((y) => [y, p.values[y] ?? null])),
    }));

  return {
    years: years.map((y) => ({
      year: y,
      color: getFinanceBillingYearColor(y),
      label: String(y),
    })),
    rows,
    hasData: billingMonthlyChartHasData(points, years),
  };
}

export type ExecutiveRealizedProjectedChartModel = {
  realized: number | null;
  projected: number | null;
  target: number | null;
  currentMonthLabel: string;
  hasData: boolean;
  hasTarget: boolean;
  formatted: BillingRealizedVsProjected["formatted"];
};

export function mapRealizedProjectedChart(
  data: BillingRealizedVsProjected,
  currentMonth: number
): ExecutiveRealizedProjectedChartModel {
  const hasTarget = data.target != null && Number.isFinite(data.target);
  return {
    realized: data.realized,
    projected: data.projected,
    target: data.target,
    currentMonthLabel: executiveReportMonthLabelPt(currentMonth),
    hasData:
      (data.realized != null && Number.isFinite(data.realized)) ||
      (data.projected != null && Number.isFinite(data.projected)) ||
      hasTarget,
    hasTarget,
    formatted: data.formatted,
  };
}

export type ExecutiveScheduleChartRow = {
  month: number;
  monthLabel: string;
  isCurrentMonth: boolean;
  openAmount: number;
  overdueAmount: number;
  upcomingAmount: number;
};

export function mapArScheduleToChart(
  rows: FinanceArMonthlyDue[],
  selectedYear: number,
  currentMonth: number
): { rows: ExecutiveScheduleChartRow[]; hasData: boolean } {
  const mapped = rows
    .filter((r) => r.year === selectedYear)
    .sort((a, b) => a.month - b.month)
    .map((r) => ({
      month: r.month,
      monthLabel: executiveReportMonthLabelPt(r.month),
      isCurrentMonth: r.month === currentMonth,
      openAmount: r.openAmount,
      overdueAmount: r.overdueAmount,
      upcomingAmount: r.upcomingAmount,
    }));

  const hasData = mapped.some(
    (r) => r.openAmount !== 0 || r.overdueAmount !== 0 || r.upcomingAmount !== 0
  );
  return { rows: mapped, hasData };
}

export function mapApScheduleToChart(
  rows: FinanceApMonthlyDue[],
  selectedYear: number,
  currentMonth: number
): { rows: ExecutiveScheduleChartRow[]; hasData: boolean } {
  const mapped = rows
    .filter((r) => r.year === selectedYear)
    .sort((a, b) => a.month - b.month)
    .map((r) => ({
      month: r.month,
      monthLabel: executiveReportMonthLabelPt(r.month),
      isCurrentMonth: r.month === currentMonth,
      openAmount: r.openAmount,
      overdueAmount: r.overdueAmount,
      upcomingAmount: r.upcomingAmount,
    }));

  const hasData = mapped.some(
    (r) => r.openAmount !== 0 || r.overdueAmount !== 0 || r.upcomingAmount !== 0
  );
  return { rows: mapped, hasData };
}

export type ExecutiveCashFlowChartRow = {
  month: number;
  monthLabel: string;
  isCurrentMonth: boolean;
  inflow: number;
  outflow: number;
  netFlow: number;
  accumulated: number;
  isNegative: boolean;
};

export function mapCashFlowTimelineToChart(
  timeline: FinanceCashFlowExecutiveMonthlyRow[],
  currentMonth: number
): { rows: ExecutiveCashFlowChartRow[]; hasData: boolean } {
  const rows = [...timeline]
    .sort((a, b) => a.month - b.month)
    .map((r) => ({
      month: r.month,
      monthLabel: r.monthLabel,
      isCurrentMonth: r.month === currentMonth,
      inflow: r.estimatedInflow,
      outflow: r.estimatedOutflow,
      netFlow: r.netFlow,
      accumulated: r.accumulatedNet,
      isNegative: r.netFlow < 0,
    }));

  const hasData = rows.some(
    (r) => r.inflow !== 0 || r.outflow !== 0 || r.netFlow !== 0 || r.accumulated !== 0
  );
  return { rows, hasData };
}

export type ExecutiveSalesOrdersChartRow = {
  month: number;
  monthLabel: string;
  isCurrentMonth: boolean;
  previousYear: number;
  currentYear: number | null;
  target: number;
  projected: number | null;
};

export function mapSalesOrdersMonthlyToChart(
  series: DashboardMonthlySeriesPoint[],
  currentMonth: number
): { rows: ExecutiveSalesOrdersChartRow[]; hasData: boolean } {
  const rows = [...series]
    .sort((a, b) => a.month - b.month)
    .map((p) => ({
      month: p.month,
      monthLabel: p.monthLabel,
      isCurrentMonth: p.month === currentMonth,
      previousYear: p.previousYearValue,
      currentYear:
        p.currentYearValue != null && Number.isFinite(p.currentYearValue)
          ? p.currentYearValue
          : null,
      target: p.targetValue,
      projected:
        p.projectedValue != null && Number.isFinite(p.projectedValue)
          ? p.projectedValue
          : null,
    }));

  const hasData = rows.some(
    (r) =>
      r.previousYear !== 0 ||
      (r.currentYear != null && r.currentYear !== 0) ||
      r.target !== 0 ||
      (r.projected != null && r.projected !== 0)
  );
  return { rows, hasData };
}

export function executiveChartRowsPreserveMonthOrder<T extends { month: number }>(
  rows: T[]
): T[] {
  return [...rows].sort((a, b) => a.month - b.month);
}

export function executiveReportTargetMissing(target: number | null | undefined): boolean {
  return target == null || !Number.isFinite(target);
}
