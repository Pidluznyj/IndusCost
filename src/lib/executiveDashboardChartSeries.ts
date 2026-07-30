import type { ExecutiveDashboardYearContext } from "@/src/lib/executiveDashboardYear.js";
import {
  computeAchievementPercent,
  computeGrowthTarget,
  computeRealizedMinusTarget,
  computeTargetGap,
  formatTargetGrowthRateLabel,
} from "@/src/lib/salesOrderDashboardRules.js";
import { getExecutiveChartColors, type ExecutiveChartKind } from "@/src/lib/executiveDashboardChartTheme.js";
import type {
  DashboardChartSeriesConfig,
  DashboardMonthlySeriesPoint,
  SalesOrdersAccumulatedPoint,
} from "@/src/lib/executiveDashboardTypes.js";
import { countWorkdaysThroughMonth } from "@/src/lib/executiveDashboardWorkdays.js";

const MONTH_SHORT = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

export function buildChartSeriesLabels(
  kind: ExecutiveChartKind,
  ctx: ExecutiveDashboardYearContext
): DashboardChartSeriesConfig["labels"] {
  const prefix = kind === "salesOrders" ? "Pedidos" : "Faturamento";
  const { selectedYear, previousYear, isSelectedYearCurrent } = ctx;
  return {
    previousYearBar: `${prefix} ${previousYear}`,
    currentYearBar: isSelectedYearCurrent ? `${prefix} ${selectedYear} YTD` : `${prefix} ${selectedYear}`,
    targetLine: `Meta ${selectedYear} (${formatTargetGrowthRateLabel()})`,
    projectedLine: `Projeção ${selectedYear}`,
  };
}

export function buildChartSeriesConfig(
  kind: ExecutiveChartKind,
  ctx: ExecutiveDashboardYearContext
): DashboardChartSeriesConfig {
  return {
    kind,
    selectedYear: ctx.selectedYear,
    previousYear: ctx.previousYear,
    ytdMonthLimit: ctx.ytdMonthLimit,
    targetAsLine: true,
    labels: buildChartSeriesLabels(kind, ctx),
    colors: getExecutiveChartColors(kind),
  };
}

export function buildMonthlySeriesPoints(
  ctx: ExecutiveDashboardYearContext,
  selectedYearMap: Map<number, number>,
  previousYearMap: Map<number, number>,
  options?: {
    projectedMonthValue?: number | null;
    /** Mês de referência para projeção (default: ytdMonthLimit). */
    projectionMonth?: number;
  }
): DashboardMonthlySeriesPoint[] {
  const projectionMonth = options?.projectionMonth ?? ctx.ytdMonthLimit;

  return MONTH_SHORT.map((monthLabel, idx) => {
    const month = idx + 1;
    const previousYearValue = previousYearMap.get(month) ?? 0;
    const targetValue = computeGrowthTarget(previousYearValue) ?? 0;
    const currentYearValue =
      month <= ctx.ytdMonthLimit ? (selectedYearMap.get(month) ?? 0) : null;

    let projectedValue: number | null = null;
    if (
      ctx.isSelectedYearCurrent &&
      options?.projectedMonthValue != null &&
      month === projectionMonth
    ) {
      projectedValue = options.projectedMonthValue;
    }

    const achievementPercent =
      currentYearValue != null
        ? computeAchievementPercent(currentYearValue, targetValue)
        : null;
    const differenceToTarget =
      currentYearValue != null
        ? computeRealizedMinusTarget(currentYearValue, targetValue)
        : null;

    return {
      month,
      monthLabel,
      periodLabel: `${monthLabel}/${ctx.selectedYear}`,
      previousYearValue,
      currentYearValue,
      targetValue,
      projectedValue,
      achievementPercent,
      differenceToTarget,
    };
  });
}

/** Converte série mensal para gráfico acumulado enriquecido (meta + projeção). */
export function buildAccumulatedSeriesPoints(
  ctx: ExecutiveDashboardYearContext,
  monthlySeries: DashboardMonthlySeriesPoint[],
  options?: {
    dailyAverageYtd?: number | null;
  }
): SalesOrdersAccumulatedPoint[] {
  let cumPrev = 0;
  let cumCurrent = 0;
  let cumTarget = 0;
  const dailyAvg = options?.dailyAverageYtd ?? null;

  return monthlySeries.map((point) => {
    cumPrev += point.previousYearValue;
    cumTarget += point.targetValue;

    if (point.currentYearValue != null) {
      cumCurrent += point.currentYearValue;
    }

    const projectedAccumulated =
      dailyAvg != null
        ? dailyAvg * countWorkdaysThroughMonth(ctx.selectedYear, point.month)
        : null;

    const currentYearAccumulated = point.currentYearValue != null ? cumCurrent : null;
    const differenceToTarget =
      currentYearAccumulated != null
        ? computeRealizedMinusTarget(currentYearAccumulated, cumTarget)
        : null;
    const achievementPercent =
      currentYearAccumulated != null
        ? computeAchievementPercent(currentYearAccumulated, cumTarget)
        : null;

    return {
      month: point.month,
      monthLabel: point.monthLabel,
      periodLabel: point.periodLabel,
      previousYearAccumulated: cumPrev,
      currentYearAccumulated,
      accumulatedTarget: cumTarget,
      projectedAccumulated,
      differenceToTarget,
      achievementPercent,
    };
  });
}

/** Converte série mensal para gráfico acumulado simples (YTD progressivo). */
export function buildCumulativeFromMonthlySeries(
  series: DashboardMonthlySeriesPoint[]
): Array<{
  month: number;
  monthLabel: string;
  periodLabel: string;
  previousYearValue: number;
  currentYearValue: number | null;
}> {
  let cumPrev = 0;
  let cumCurrent = 0;

  return series.map((point) => {
    cumPrev += point.previousYearValue;
    if (point.currentYearValue != null) {
      cumCurrent += point.currentYearValue;
    }
    return {
      month: point.month,
      monthLabel: point.monthLabel,
      periodLabel: point.periodLabel,
      previousYearValue: cumPrev,
      currentYearValue: point.currentYearValue != null ? cumCurrent : null,
    };
  });
}
