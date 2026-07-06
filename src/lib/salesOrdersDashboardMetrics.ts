import { prisma } from "@/src/lib/prisma.js";
import {
  safeMetricNumber,
  startOfMonth,
} from "@/src/lib/executiveDashboardHelpers.js";
import {
  formatExecutiveCompactCurrency,
  formatExecutiveCurrency,
  formatExecutiveInteger,
  formatExecutivePercent,
} from "@/src/lib/executiveDashboardFormatters.js";
import {
  countWorkdaysElapsedInYear,
  countWorkdaysInMonth,
  countWorkdaysInYear,
  endOfYear,
  startOfYear,
} from "@/src/lib/executiveDashboardWorkdays.js";
import {
  computeAchievementPercent,
  computeGrowthTarget,
  computeMonthProjection,
  computeRealizedMinusTarget,
  computeTargetGap,
  computeTicketAverage,
  computeYearProjection,
  computeYtdDailyAverageByWorkday,
  EXECUTIVE_ACHIEVEMENT_HINT,
  EXECUTIVE_ANNUAL_TARGET_HINT,
  EXECUTIVE_MONTHLY_TARGET_HINT,
  EXECUTIVE_OVERDUE_ORDERS_HINT,
  EXECUTIVE_PROJECTION_HINT,
  EXECUTIVE_REALIZED_HINT,
  EXECUTIVE_SALES_YTD_DAILY_AVERAGE_HINT,
  EXECUTIVE_TARGET_GAP_HINT,
  TARGET_GROWTH_FACTOR,
} from "@/src/lib/salesOrderDashboardRules.js";
import { SALES_ORDER_STATUS_LABELS } from "@/src/lib/materialDemandFilters.js";
import {
  loadSalesOrderEnrichedMetricsForIssueYear,
  loadSalesOrderEnrichedMetricsFromDb,
} from "@/src/lib/salesOrderMetricsEngine.js";
import {
  mapPrismaOrderToSalesOrderRulesInput,
  resolveOfficialSalesOrderExecutiveMetrics,
  buildOfficialStatusBreakdownFromOrders,
  SALES_ORDER_RULES_PRISMA_SELECT,
} from "@/src/lib/salesOrderRulesAdapter.js";
import { loadSalesOrderLinkedNfeContextMap } from "@/src/lib/salesOrderLinkedNfe.js";
import {
  buildAccumulatedSeriesPoints,
  buildChartSeriesConfig,
  buildMonthlySeriesPoints,
} from "@/src/lib/executiveDashboardChartSeries.js";
import type { ExecutiveDashboardYearContext } from "@/src/lib/executiveDashboardYear.js";
import type {
  DashboardMetricCard,
  DashboardStatusBreakdownRow,
  DashboardTargetBlock,
  OverdueOrderRow,
  SalesOrdersDashboardTab,
  SalesOrdersProjectionBlock,
  SalesOrdersTargetsBlock,
} from "@/src/lib/executiveDashboardTypes.js";

const OVERDUE_LIST_LIMIT = 15;

function metricCard(
  id: string,
  label: string,
  value: number | null,
  opts?: { hint?: string; asCurrency?: boolean; compact?: boolean; asPercent?: boolean }
): DashboardMetricCard {
  const formatted = opts?.asPercent
    ? formatExecutivePercent(value, 1)
    : opts?.asCurrency
      ? formatExecutiveCurrency(value)
      : formatExecutiveInteger(value);
  return {
    id,
    label,
    value,
    formatted,
    compactFormatted: opts?.compact && opts?.asCurrency ? formatExecutiveCompactCurrency(value) : undefined,
    hint: opts?.hint,
  };
}

function buildTargetBlock(
  actual: number | null,
  previousPeriod: number | null
): DashboardTargetBlock {
  const target = computeGrowthTarget(previousPeriod);
  const gap = computeTargetGap(actual, target);
  const achievementPercent = computeAchievementPercent(actual, target);
  return {
    actual,
    previousPeriod,
    target,
    gap,
    achievementPercent,
    formatted: {
      actual: formatExecutiveCurrency(actual),
      previousPeriod: formatExecutiveCurrency(previousPeriod),
      target: formatExecutiveCurrency(target),
      gap: formatExecutiveCurrency(gap),
      achievementPercent: formatExecutivePercent(achievementPercent, 1),
    },
  };
}

async function loadOrdersForExecutiveYear(year: number) {
  const from = startOfYear(new Date(year, 0, 1));
  const to = endOfYear(new Date(year, 0, 1));
  return prisma.salesOrder.findMany({
    where: {
      issueDate: { gte: from, lte: to },
    },
    select: SALES_ORDER_RULES_PRISMA_SELECT,
  });
}

function resolveExecutiveRulesMetrics(
  yearCtx: ExecutiveDashboardYearContext,
  orders: Awaited<ReturnType<typeof loadOrdersForExecutiveYear>>,
  linkedMap: Map<string, import("@/src/lib/salesOrderLinkedNfe.js").SalesOrderLinkedNfeContext>
) {
  const ref = yearCtx.referenceDate;
  const month = ref.getMonth() + 1;
  return resolveOfficialSalesOrderExecutiveMetrics(
    orders.map(mapPrismaOrderToSalesOrderRulesInput),
    ref,
    yearCtx.selectedYear,
    month,
    linkedMap
  );
}

async function queryOpenPortfolio(referenceDate: Date): Promise<{ count: number | null; net: number | null }> {
  const metrics = await loadSalesOrderEnrichedMetricsFromDb(
    { status: { not: "CANCELLED" } },
    referenceDate
  );
  const open = metrics.filter(
    (m) => !m.hasNfe && m.logisticStatusCardId !== "finishedOrCancelled"
  );
  return {
    count: open.length,
    net: open.reduce((sum, m) => sum + m.totalNetValue, 0),
  };
}

async function queryOverdueSummary(
  selectedYear: number,
  today: Date
): Promise<{ count: number | null; net: number | null }> {
  const metrics = await loadSalesOrderEnrichedMetricsForIssueYear(selectedYear, today);
  const overdue = metrics.filter((m) => m.logisticStatusCardId === "overduePending");
  return {
    count: overdue.length,
    net: overdue.reduce((sum, m) => sum + m.totalNetValue, 0),
  };
}

async function queryOverdueList(selectedYear: number, now: Date): Promise<OverdueOrderRow[]> {
  const metrics = await loadSalesOrderEnrichedMetricsForIssueYear(selectedYear, now);
  return metrics
    .filter((m) => m.logisticStatusCardId === "overduePending")
    .sort((a, b) => {
      const da = a.expectedDeliveryDate ? new Date(a.expectedDeliveryDate).getTime() : Infinity;
      const db = b.expectedDeliveryDate ? new Date(b.expectedDeliveryDate).getTime() : Infinity;
      if (da !== db) return da - db;
      const ia = a.issueDate ? new Date(a.issueDate).getTime() : 0;
      const ib = b.issueDate ? new Date(b.issueDate).getTime() : 0;
      return ia - ib;
    })
    .slice(0, OVERDUE_LIST_LIMIT)
    .map((m) => ({
      orderId: m.salesOrderId,
      orderCode: m.orderCode,
      customerName: m.customerName,
      issueDate: m.issueDate ?? new Date(0).toISOString(),
      expectedDeliveryDate: m.expectedDeliveryDate ?? new Date(0).toISOString(),
      daysOverdue: m.daysLate ?? 0,
      totalNetValue: m.totalNetValue,
      status: m.orderStatus,
      statusLabel: SALES_ORDER_STATUS_LABELS[m.orderStatus] ?? m.orderStatus,
    }));
}


async function queryStatusBreakdown(): Promise<DashboardStatusBreakdownRow[]> {
  const rows = await prisma.salesOrder.findMany({
    where: { status: { not: "CANCELLED" } },
    select: { status: true, totalNetValue: true },
  });
  return buildOfficialStatusBreakdownFromOrders(rows, SALES_ORDER_STATUS_LABELS);
}

export async function buildSalesOrdersDashboardTab(
  yearCtx: ExecutiveDashboardYearContext
): Promise<SalesOrdersDashboardTab> {
  const ref = yearCtx.referenceDate;
  const year = yearCtx.selectedYear;
  const previousYear = yearCtx.previousYear;
  const operationalNow = new Date();
  const periodLabel = ref.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
  const monthCompareLabel = `${ref.toLocaleDateString("pt-BR", { month: "long" })}/${previousYear}`;

  const [currentYearOrders, previousYearOrders] = await Promise.all([
    loadOrdersForExecutiveYear(year),
    loadOrdersForExecutiveYear(previousYear),
  ]);

  const linkedMap = await loadSalesOrderLinkedNfeContextMap(
    [...currentYearOrders, ...previousYearOrders].map((order) => ({
      id: order.id,
      totalNetValue: order.totalNetValue,
      issueDate: order.issueDate,
      expectedDeliveryDate: order.expectedDeliveryDate,
      nomusRawResponse: order.nomusRawResponse,
    })),
    ref
  );

  const official = resolveExecutiveRulesMetrics(yearCtx, currentYearOrders, linkedMap);
  const prevYearRef = new Date(previousYear, ref.getMonth(), ref.getDate(), 23, 59, 59, 999);
  const prevOfficial = resolveOfficialSalesOrderExecutiveMetrics(
    previousYearOrders.map(mapPrismaOrderToSalesOrderRulesInput),
    prevYearRef,
    previousYear,
    ref.getMonth() + 1,
    linkedMap
  );

  const monthAgg = { count: official.metrics.ordersMonth, net: official.metrics.soldAmountMonth };
  const ytdAgg = { count: official.metrics.ordersYtd, net: official.metrics.soldAmountYtd };
  const prevMonthAgg = {
    count: null,
    net: official.metrics.soldAmountPreviousYearMonth,
  };
  const prevYearTotalAgg = {
    count: null,
    net: prevOfficial.metrics.soldAmountYtd,
  };
  const yearAgg = {
    count: currentYearOrders.filter((o) => o.status !== "CANCELLED").length,
    net: official.monthlyTimeline.reduce((sum, p) => sum + p.soldAmount, 0),
  };

  const [
    openPortfolio,
    overdueSummary,
    overdueList,
    statusBreakdown,
  ] = await Promise.all([
    queryOpenPortfolio(operationalNow),
    queryOverdueSummary(year, operationalNow),
    queryOverdueList(year, operationalNow),
    queryStatusBreakdown(),
  ]);

  const currentYearMonthly = new Map(
    official.monthlyTimeline.map((p) => [p.month, p.soldAmount])
  );
  const previousYearMonthly = new Map(
    prevOfficial.monthlyTimeline.map((p) => [p.month, p.soldAmount])
  );
  const monthlyTarget = buildTargetBlock(monthAgg.net, prevMonthAgg.net);
  const monthlyRealizedMinusTarget = computeRealizedMinusTarget(monthAgg.net, monthlyTarget.target);
  const annualBlock = buildTargetBlock(ytdAgg.net, prevYearTotalAgg.net);
  const annualTargetValue = annualBlock.target;
  const annualAchievement = annualBlock.achievementPercent;
  const targets: SalesOrdersTargetsBlock = {
    growthRate: TARGET_GROWTH_FACTOR,
    growthRateLabel: "+30%",
    annual: {
      ...annualBlock,
      basePreviousYear: prevYearTotalAgg.net,
      basePreviousYearLabel: previousYear,
      actualYtd: ytdAgg.net,
      hint: EXECUTIVE_ANNUAL_TARGET_HINT,
    },
    monthly: {
      ...monthlyTarget,
      periodLabel,
      basePreviousYearLabel: monthCompareLabel,
      hint: EXECUTIVE_MONTHLY_TARGET_HINT,
      realizedMinusTarget: monthlyRealizedMinusTarget,
      formattedRealizedMinusTarget: formatExecutiveCurrency(monthlyRealizedMinusTarget),
    },
  };

  const yearWorkdaysElapsed = countWorkdaysElapsedInYear(ref);
  const workdaysInMonth = countWorkdaysInMonth(year, ref.getMonth());
  const workdaysInYear = countWorkdaysInYear(year);
  const dailyAvgYtd = computeYtdDailyAverageByWorkday(ytdAgg.net, yearWorkdaysElapsed);
  const projectedMonth = official.metrics.monthProjection ?? computeMonthProjection(dailyAvgYtd, workdaysInMonth);
  const projectedYear = computeYearProjection(dailyAvgYtd, workdaysInYear);

  const projection: SalesOrdersProjectionBlock = {
    ytdBusinessDaysElapsed: yearWorkdaysElapsed,
    totalBusinessDaysInYear: workdaysInYear,
    ytdDailyAverage: dailyAvgYtd,
    annualProjection: projectedYear,
    monthlyProjection: projectedMonth,
    hint: EXECUTIVE_PROJECTION_HINT,
    formatted: {
      ytdDailyAverage: formatExecutiveCurrency(dailyAvgYtd),
      annualProjection: formatExecutiveCurrency(projectedYear),
      monthlyProjection: formatExecutiveCurrency(projectedMonth),
    },
  };

  const monthlySeries = buildMonthlySeriesPoints(yearCtx, currentYearMonthly, previousYearMonthly);
  const accumulatedEvolution = buildAccumulatedSeriesPoints(yearCtx, monthlySeries, {
    dailyAverageYtd: dailyAvgYtd,
  });
  const chartSeries = buildChartSeriesConfig("salesOrders", yearCtx);

  const summaryCards: DashboardMetricCard[] = [
    metricCard("realized-ytd", "Realizado YTD", ytdAgg.net, {
      asCurrency: true,
      compact: true,
      hint: EXECUTIVE_REALIZED_HINT,
    }),
    metricCard("realized-month", "Realizado no mês", monthAgg.net, {
      asCurrency: true,
      compact: true,
      hint: `${EXECUTIVE_REALIZED_HINT} (${periodLabel})`,
    }),
    metricCard("annual-target", "Meta anual", annualTargetValue, {
      asCurrency: true,
      compact: true,
      hint: `${EXECUTIVE_ANNUAL_TARGET_HINT} Base: ${previousYear} · ${targets.growthRateLabel}`,
    }),
    metricCard("monthly-target", "Meta do mês", monthlyTarget.target, {
      asCurrency: true,
      compact: true,
      hint: `${EXECUTIVE_MONTHLY_TARGET_HINT} Comparado: ${monthCompareLabel}`,
    }),
    metricCard("annual-achievement", "Atingimento anual", annualAchievement, {
      asPercent: true,
      hint: EXECUTIVE_ACHIEVEMENT_HINT,
    }),
    metricCard("monthly-achievement", "Atingimento mensal", monthlyTarget.achievementPercent, {
      asPercent: true,
      hint: EXECUTIVE_ACHIEVEMENT_HINT,
    }),
    metricCard("annual-projection", "Projeção anual", projectedYear, {
      asCurrency: true,
      compact: true,
      hint: EXECUTIVE_PROJECTION_HINT,
    }),
    metricCard("daily-avg-ytd", "Média venda/dia útil YTD", dailyAvgYtd, {
      asCurrency: true,
      hint: EXECUTIVE_SALES_YTD_DAILY_AVERAGE_HINT,
    }),
    metricCard("open-portfolio", "Carteira aberta", openPortfolio.net, {
      asCurrency: true,
      compact: true,
      hint: "Pedidos não cancelados sem nota fiscal processada",
    }),
    metricCard("overdue-count", "Pedidos atrasados", overdueSummary.count, {
      hint: EXECUTIVE_OVERDUE_ORDERS_HINT,
    }),
    metricCard("monthly-gap", "Diferença p/ meta (mês)", monthlyRealizedMinusTarget, {
      asCurrency: true,
      hint: EXECUTIVE_TARGET_GAP_HINT,
    }),
  ];

  return {
    available: true,
    source: `${official.metricsSource} — SalesOrder.totalNetValue por issueDate; metas = ano/mês anterior × 1,30`,
    metricsSource: official.metricsSource,
    rulesEngineVersion: official.rulesEngineVersion,
    selectedYear: year,
    previousYear,
    currentMonth: ref.getMonth() + 1,
    periodLabel,
    yearLabel: year,
    summaryCards,
    targets,
    target: monthlyTarget,
    projection,
    monthlySeries,
    accumulatedEvolution,
    chartSeries,
    statusBreakdown,
    overdueOrders: {
      count: overdueSummary.count ?? 0,
      totalValue: overdueSummary.net,
      formattedTotalValue: formatExecutiveCurrency(overdueSummary.net),
      description: EXECUTIVE_OVERDUE_ORDERS_HINT,
      selectedYear: year,
      items: overdueList,
    },
    logisticsBreakdown: null,
  };
}
