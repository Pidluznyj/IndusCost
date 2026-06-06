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
  countWorkdaysElapsedInMonth,
  countWorkdaysElapsedInYear,
  endOfYear,
  startOfYear,
} from "@/src/lib/executiveDashboardWorkdays.js";
import {
  computeAchievementPercent,
  computeDailyAverageByWorkday,
  computeGrowthTarget,
  computeTargetGap,
  computeTicketAverage,
} from "@/src/lib/salesOrderDashboardRules.js";
import { SALES_ORDER_STATUS_LABELS } from "@/src/lib/materialDemandFilters.js";
import {
  orderIsInvoicedSql,
  orderNotInvoicedSql,
  toPgDateYmd,
} from "@/src/lib/salesOrderInvoicingSql.js";
import {
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

async function queryOverdueSummary(): Promise<{ count: number | null; net: number | null }> {
  const todayYmd = toPgDateYmd(new Date());
  const [row] = await prisma.$queryRaw<{ c: bigint; v: unknown }[]>(
    Prisma.sql`
      SELECT COUNT(*)::bigint AS c, COALESCE(SUM(so."totalNetValue"), 0) AS v
      FROM "SalesOrder" so
      WHERE ${NOT_CANCELLED}
        AND ${orderNotInvoicedSql("so")}
        AND so."expectedDeliveryDate" IS NOT NULL
        AND so."expectedDeliveryDate"::date < ${todayYmd}::date
    `
  );
  return { count: safeMetricNumber(Number(row?.c ?? 0n)), net: decimalToNumber(row?.v) };
}

async function queryOverdueList(now: Date): Promise<OverdueOrderRow[]> {
  const todayYmd = toPgDateYmd(now);
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
  const rows = await prisma.$queryRaw<
    { status: string; count: bigint; total: unknown }[]
  >(
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

function buildMonthlyEvolution(
  ctx: ExecutiveDashboardYearContext,
  currentYearMap: Map<number, number>,
  previousYearMap: Map<number, number>
) {
  return buildMonthlySeriesPoints(ctx, currentYearMap, previousYearMap);
}

export async function buildSalesOrdersDashboardTab(
  yearCtx: ExecutiveDashboardYearContext
): Promise<SalesOrdersDashboardTab> {
  const ref = yearCtx.referenceDate;
  const year = yearCtx.selectedYear;
  const monthStart = startOfMonth(ref);
  const monthEnd = endOfMonth(ref);
  const yearStart = startOfYear(ref);
  const yearEnd = endOfYear(ref);
  const prevYearSameMonthStart = startOfMonth(new Date(yearCtx.previousYear, ref.getMonth(), 1));
  const prevYearSameMonthEnd = endOfMonth(new Date(yearCtx.previousYear, ref.getMonth(), 1));
  const operationalNow = new Date();

  const [
    yearAgg,
    monthAgg,
    prevMonthAgg,
    openPortfolio,
    overdueSummary,
    overdueList,
    currentYearMonthly,
    previousYearMonthly,
    statusBreakdown,
  ] = await Promise.all([
    aggregateByIssueDate(yearStart, yearEnd),
    aggregateByIssueDate(monthStart, monthEnd),
    aggregateByIssueDate(prevYearSameMonthStart, prevYearSameMonthEnd),
    queryOpenPortfolio(),
    queryOverdueSummary(),
    queryOverdueList(operationalNow),
    queryMonthlyByIssueDate(year),
    queryMonthlyByIssueDate(yearCtx.previousYear),
    queryStatusBreakdown(),
  ]);

  const ticketAvg = computeTicketAverage(monthAgg.net, monthAgg.count);
  const monthWorkdays = countWorkdaysElapsedInMonth(ref);
  const yearWorkdays = countWorkdaysElapsedInYear(ref);
  const dailyAvgMonth = computeDailyAverageByWorkday(monthAgg.net, monthWorkdays);
  const dailyAvgYear = computeDailyAverageByWorkday(yearAgg.net, yearWorkdays);
  const target = buildTargetBlock(monthAgg.net, prevMonthAgg.net);

  const summaryCards: DashboardMetricCard[] = [
    metricCard("orders-year-value", "Pedidos no ano", yearAgg.net, { asCurrency: true, compact: true }),
    metricCard("orders-month-value", "Pedidos no mês", monthAgg.net, { asCurrency: true, compact: true }),
    metricCard("ticket-avg", "Ticket médio", ticketAvg, { asCurrency: true }),
    metricCard("open-portfolio", "Carteira aberta", openPortfolio.net, {
      asCurrency: true,
      compact: true,
      hint: "Não cancelados sem NF processada",
    }),
    metricCard("daily-avg-month", "Média diária (mês)", dailyAvgMonth, { asCurrency: true }),
    metricCard("daily-avg-year", "Média diária (ano)", dailyAvgYear, { asCurrency: true }),
    metricCard("overdue-count", "Pedidos atrasados", overdueSummary.count),
    metricCard("target-achievement", "% meta do mês", target.achievementPercent, {
      asPercent: true,
      hint: "Meta = mesmo mês ano anterior × 1,30",
    }),
  ];

  return {
    available: true,
    source: "SalesOrder.totalNetValue por issueDate; carteira/atraso via nfes.dataProcessamento",
    periodLabel: ref.toLocaleDateString("pt-BR", { month: "long", year: "numeric" }),
    yearLabel: year,
    summaryCards,
    target,
    monthlySeries: buildMonthlyEvolution(yearCtx, currentYearMonthly, previousYearMonthly),
    chartSeries: buildChartSeriesConfig("salesOrders", yearCtx),
    statusBreakdown,
    overdueOrders: {
      count: overdueSummary.count ?? 0,
      totalValue: overdueSummary.net,
      formattedTotalValue: formatExecutiveCurrency(overdueSummary.net),
      items: overdueList,
    },
    logisticsBreakdown: null,
  };
}
