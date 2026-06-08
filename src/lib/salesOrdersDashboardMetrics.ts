import { Prisma } from "@prisma/client";
import { prisma } from "@/src/lib/prisma.js";
import {
  decimalToNumber,
  endOfMonth,
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
  orderNotInvoicedSql,
  toPgDateYmd,
} from "@/src/lib/salesOrderInvoicingSql.js";
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

const NOT_CANCELLED = Prisma.sql`so.status != 'CANCELLED'`;

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

async function aggregateByIssueDate(from: Date, to: Date): Promise<{ count: number | null; net: number | null }> {
  const agg = await prisma.salesOrder.aggregate({
    where: {
      status: { not: "CANCELLED" },
      issueDate: { gte: from, lte: to },
    },
    _count: true,
    _sum: { totalNetValue: true },
  });
  return {
    count: safeMetricNumber(agg._count),
    net: decimalToNumber(agg._sum.totalNetValue),
  };
}

async function queryOpenPortfolio(): Promise<{ count: number | null; net: number | null }> {
  const [row] = await prisma.$queryRaw<{ c: bigint; v: unknown }[]>(
    Prisma.sql`
      SELECT COUNT(*)::bigint AS c, COALESCE(SUM(so."totalNetValue"), 0) AS v
      FROM "SalesOrder" so
      WHERE ${NOT_CANCELLED}
        AND ${orderNotInvoicedSql("so")}
    `
  );
  return { count: safeMetricNumber(Number(row?.c ?? 0n)), net: decimalToNumber(row?.v) };
}

async function queryOverdueSummary(
  selectedYear: number,
  today: Date
): Promise<{ count: number | null; net: number | null }> {
  const todayYmd = toPgDateYmd(today);
  const yearStart = startOfYear(new Date(selectedYear, 0, 1));
  const yearEnd = endOfYear(new Date(selectedYear, 0, 1));
  const [row] = await prisma.$queryRaw<{ c: bigint; v: unknown }[]>(
    Prisma.sql`
      SELECT COUNT(*)::bigint AS c, COALESCE(SUM(so."totalNetValue"), 0) AS v
      FROM "SalesOrder" so
      WHERE ${NOT_CANCELLED}
        AND ${orderNotInvoicedSql("so")}
        AND so."issueDate" >= ${yearStart}
        AND so."issueDate" <= ${yearEnd}
        AND so."expectedDeliveryDate" IS NOT NULL
        AND so."expectedDeliveryDate"::date < ${todayYmd}::date
    `
  );
  return { count: safeMetricNumber(Number(row?.c ?? 0n)), net: decimalToNumber(row?.v) };
}

async function queryOverdueList(selectedYear: number, now: Date): Promise<OverdueOrderRow[]> {
  const todayYmd = toPgDateYmd(now);
  const yearStart = startOfYear(new Date(selectedYear, 0, 1));
  const yearEnd = endOfYear(new Date(selectedYear, 0, 1));
  const rows = await prisma.$queryRaw<
    {
      id: string;
      order_code: string;
      customer_name: string;
      issue_date: Date;
      expected_delivery_date: Date;
      total_net_value: unknown;
      status: string;
    }[]
  >(
    Prisma.sql`
      SELECT
        so.id,
        so."orderCode" AS order_code,
        COALESCE(NULLIF(TRIM(c."tradeName"), ''), c."companyName") AS customer_name,
        so."issueDate" AS issue_date,
        so."expectedDeliveryDate" AS expected_delivery_date,
        so."totalNetValue" AS total_net_value,
        so.status::text AS status
      FROM "SalesOrder" so
      INNER JOIN "Customer" c ON c.id = so."customerId"
      WHERE ${NOT_CANCELLED}
        AND ${orderNotInvoicedSql("so")}
        AND so."issueDate" >= ${yearStart}
        AND so."issueDate" <= ${yearEnd}
        AND so."expectedDeliveryDate" IS NOT NULL
        AND so."expectedDeliveryDate"::date < ${todayYmd}::date
      ORDER BY so."expectedDeliveryDate" ASC, so."issueDate" ASC
      LIMIT ${OVERDUE_LIST_LIMIT}
    `
  );

  const todayDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return rows.map((row) => {
    const delivery = new Date(row.expected_delivery_date);
    const deliveryDay = new Date(delivery.getFullYear(), delivery.getMonth(), delivery.getDate());
    const daysOverdue = Math.max(
      0,
      Math.floor((todayDay.getTime() - deliveryDay.getTime()) / (24 * 60 * 60 * 1000))
    );
    return {
      orderId: row.id,
      orderCode: row.order_code,
      customerName: row.customer_name,
      issueDate: row.issue_date.toISOString(),
      expectedDeliveryDate: delivery.toISOString(),
      daysOverdue,
      totalNetValue: decimalToNumber(row.total_net_value),
      status: row.status,
      statusLabel: SALES_ORDER_STATUS_LABELS[row.status] ?? row.status,
    };
  });
}

async function queryMonthlyByIssueDate(year: number): Promise<Map<number, number>> {
  const from = startOfYear(new Date(year, 0, 1));
  const to = endOfYear(new Date(year, 0, 1));
  const rows = await prisma.$queryRaw<{ month: number; total: unknown }[]>(
    Prisma.sql`
      SELECT
        EXTRACT(MONTH FROM so."issueDate")::int AS month,
        COALESCE(SUM(so."totalNetValue"), 0) AS total
      FROM "SalesOrder" so
      WHERE ${NOT_CANCELLED}
        AND so."issueDate" >= ${from}
        AND so."issueDate" <= ${to}
      GROUP BY 1
      ORDER BY 1
    `
  );
  const map = new Map<number, number>();
  for (const row of rows) {
    map.set(row.month, decimalToNumber(row.total) ?? 0);
  }
  return map;
}

async function queryStatusBreakdown(): Promise<DashboardStatusBreakdownRow[]> {
  const rows = await prisma.$queryRaw<{ status: string; count: bigint; total: unknown }[]>(
    Prisma.sql`
      SELECT
        so.status::text AS status,
        COUNT(*)::bigint AS count,
        COALESCE(SUM(so."totalNetValue"), 0) AS total
      FROM "SalesOrder" so
      WHERE ${NOT_CANCELLED}
      GROUP BY so.status
      ORDER BY count DESC
    `
  );
  return rows.map((row) => ({
    status: row.status,
    label: SALES_ORDER_STATUS_LABELS[row.status] ?? row.status,
    count: Number(row.count),
    value: decimalToNumber(row.total),
  }));
}

export async function buildSalesOrdersDashboardTab(
  yearCtx: ExecutiveDashboardYearContext
): Promise<SalesOrdersDashboardTab> {
  const ref = yearCtx.referenceDate;
  const year = yearCtx.selectedYear;
  const previousYear = yearCtx.previousYear;
  const monthStart = startOfMonth(ref);
  const monthEnd = endOfMonth(ref);
  const yearStart = startOfYear(ref);
  const yearEnd = endOfYear(ref);
  const prevYearStart = startOfYear(new Date(previousYear, 0, 1));
  const prevYearEnd = endOfYear(new Date(previousYear, 0, 1));
  const prevYearSameMonthStart = startOfMonth(new Date(previousYear, ref.getMonth(), 1));
  const prevYearSameMonthEnd = endOfMonth(new Date(previousYear, ref.getMonth(), 1));
  const operationalNow = new Date();
  const periodLabel = ref.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
  const monthCompareLabel = `${ref.toLocaleDateString("pt-BR", { month: "long" })}/${previousYear}`;

  const [
    yearAgg,
    ytdAgg,
    monthAgg,
    prevMonthAgg,
    prevYearTotalAgg,
    openPortfolio,
    overdueSummary,
    overdueList,
    currentYearMonthly,
    previousYearMonthly,
    statusBreakdown,
  ] = await Promise.all([
    aggregateByIssueDate(yearStart, yearEnd),
    aggregateByIssueDate(yearStart, ref),
    aggregateByIssueDate(monthStart, monthEnd),
    aggregateByIssueDate(prevYearSameMonthStart, prevYearSameMonthEnd),
    aggregateByIssueDate(prevYearStart, prevYearEnd),
    queryOpenPortfolio(),
    queryOverdueSummary(year, operationalNow),
    queryOverdueList(year, operationalNow),
    queryMonthlyByIssueDate(year),
    queryMonthlyByIssueDate(previousYear),
    queryStatusBreakdown(),
  ]);

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
  const projectedMonth = computeMonthProjection(dailyAvgYtd, workdaysInMonth);
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
    source: "SalesOrder.totalNetValue por issueDate; metas = ano/mês anterior × 1,30",
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
