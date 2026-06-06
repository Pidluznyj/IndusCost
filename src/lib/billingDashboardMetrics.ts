import { Prisma } from "@prisma/client";
import { billingMarketCustomerFilterSql } from "@/src/lib/billingMarketCustomerSql.js";
import {
  buildChartSeriesConfig,
  buildCumulativeFromMonthlySeries,
  buildMonthlySeriesPoints,
} from "@/src/lib/executiveDashboardChartSeries.js";
import type { ExecutiveDashboardYearContext } from "@/src/lib/executiveDashboardYear.js";
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
  countWorkdaysInMonth,
  endOfYear,
  startOfYear,
} from "@/src/lib/executiveDashboardWorkdays.js";
import {
  computeAchievementPercent,
  computeDailyAverageByWorkday,
  computeGrowthTarget,
  computeMonthProjection,
  computeTargetGap,
  computeTicketAverage,
} from "@/src/lib/salesOrderDashboardRules.js";
import {
  nfeProcessamentoDateSql,
  nomusNfesElementsSql,
  orderInvoicedInPeriodSql,
  orderIsInvoicedSql,
  toPgDateYmd,
} from "@/src/lib/salesOrderInvoicingSql.js";
import type {
  BillingDashboardTab,
  BillingProjectionBlock,
  BillingRealizedVsProjected,
  BillingTopCustomerRow,
  BillingYearComparison,
  DashboardCumulativeChartPoint,
  DashboardMetricCard,
  DashboardTargetBlock,
  RecentInvoicedOrderRow,
} from "@/src/lib/executiveDashboardTypes.js";

const RECENT_INVOICED_LIMIT = 15;
const TOP_CUSTOMERS_LIMIT = 10;
const MARKET_BILLING_NOTE =
  "Faturamento de mercado: NF com dataProcessamento, pedido não cancelado, clientes do grupo (Lazarios, Koppetel, SM) excluídos. Valor: totalNetValue do pedido.";

const NOT_CANCELLED = Prisma.sql`so.status != 'CANCELLED'`;
const MARKET_CUSTOMER = billingMarketCustomerFilterSql("c");

function metricCard(
  id: string,
  label: string,
  value: number | null,
  opts?: { hint?: string; asCurrency?: boolean; compact?: boolean; asPercent?: boolean }
): DashboardMetricCard {
  return {
    id,
    label,
    value,
    formatted: opts?.asPercent
      ? formatExecutivePercent(value, 1)
      : opts?.asCurrency
        ? formatExecutiveCurrency(value)
        : formatExecutiveInteger(value),
    compactFormatted:
      opts?.compact && opts?.asCurrency ? formatExecutiveCompactCurrency(value) : undefined,
    hint: opts?.hint,
  };
}

function buildTargetBlock(actual: number | null, previousPeriod: number | null): DashboardTargetBlock {
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

async function queryMarketBillingInPeriod(
  from: Date,
  to: Date
): Promise<{ count: number | null; net: number | null }> {
  const fromYmd = toPgDateYmd(from);
  const toYmd = toPgDateYmd(to);
  const [row] = await prisma.$queryRaw<{ c: bigint; v: unknown }[]>(
    Prisma.sql`
      SELECT COUNT(*)::bigint AS c, COALESCE(SUM(so."totalNetValue"), 0) AS v
      FROM "SalesOrder" so
      INNER JOIN "Customer" c ON c.id = so."customerId"
      WHERE ${NOT_CANCELLED}
        AND ${MARKET_CUSTOMER}
        AND ${orderInvoicedInPeriodSql("so", fromYmd, toYmd)}
    `
  );
  return { count: safeMetricNumber(Number(row?.c ?? 0n)), net: decimalToNumber(row?.v) };
}

async function queryMonthlyMarketBilling(year: number): Promise<Map<number, number>> {
  const fromYmd = toPgDateYmd(startOfYear(new Date(year, 0, 1)));
  const toYmd = toPgDateYmd(endOfYear(new Date(year, 0, 1)));
  const rows = await prisma.$queryRaw<{ month: number; total: unknown }[]>(
    Prisma.sql`
      SELECT
        EXTRACT(MONTH FROM inv.invoice_date)::int AS month,
        COALESCE(SUM(so."totalNetValue"), 0) AS total
      FROM "SalesOrder" so
      INNER JOIN "Customer" c ON c.id = so."customerId"
      INNER JOIN LATERAL (
        SELECT MAX((${nfeProcessamentoDateSql()})) AS invoice_date
        FROM ${nomusNfesElementsSql("so")}
        WHERE (${nfeProcessamentoDateSql()}) IS NOT NULL
      ) inv ON inv.invoice_date IS NOT NULL
      WHERE ${NOT_CANCELLED}
        AND ${MARKET_CUSTOMER}
        AND inv.invoice_date >= ${fromYmd}::date
        AND inv.invoice_date <= ${toYmd}::date
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

async function queryRecentMarketInvoicedOrders(): Promise<RecentInvoicedOrderRow[]> {
  const rows = await prisma.$queryRaw<
    {
      id: string;
      order_code: string;
      customer_name: string;
      invoice_date: Date;
      total_net_value: unknown;
      invoice_status: string | null;
    }[]
  >(
    Prisma.sql`
      SELECT
        so.id,
        so."orderCode" AS order_code,
        COALESCE(NULLIF(TRIM(c."tradeName"), ''), c."companyName") AS customer_name,
        inv.invoice_date,
        so."totalNetValue" AS total_net_value,
        inv.invoice_status
      FROM "SalesOrder" so
      INNER JOIN "Customer" c ON c.id = so."customerId"
      INNER JOIN LATERAL (
        SELECT
          MAX((${nfeProcessamentoDateSql()})) AS invoice_date,
          MAX(NULLIF(TRIM(nfe->>'status'), '')) AS invoice_status
        FROM ${nomusNfesElementsSql("so")}
        WHERE (${nfeProcessamentoDateSql()}) IS NOT NULL
      ) inv ON inv.invoice_date IS NOT NULL
      WHERE ${NOT_CANCELLED}
        AND ${MARKET_CUSTOMER}
        AND ${orderIsInvoicedSql("so")}
      ORDER BY inv.invoice_date DESC, so."issueDate" DESC
      LIMIT ${RECENT_INVOICED_LIMIT}
    `
  );
  return rows.map((row) => ({
    orderId: row.id,
    orderCode: row.order_code,
    customerName: row.customer_name,
    invoiceDate: row.invoice_date.toISOString(),
    totalNetValue: decimalToNumber(row.total_net_value),
    invoiceStatus: row.invoice_status,
  }));
}

async function queryTopMarketCustomersInPeriod(from: Date, to: Date): Promise<BillingTopCustomerRow[]> {
  const fromYmd = toPgDateYmd(from);
  const toYmd = toPgDateYmd(to);
  const rows = await prisma.$queryRaw<
    { customer_id: string; customer_name: string; order_count: bigint; total: unknown }[]
  >(
    Prisma.sql`
      SELECT
        c.id AS customer_id,
        COALESCE(NULLIF(TRIM(c."tradeName"), ''), c."companyName") AS customer_name,
        COUNT(*)::bigint AS order_count,
        COALESCE(SUM(so."totalNetValue"), 0) AS total
      FROM "SalesOrder" so
      INNER JOIN "Customer" c ON c.id = so."customerId"
      WHERE ${NOT_CANCELLED}
        AND ${MARKET_CUSTOMER}
        AND ${orderInvoicedInPeriodSql("so", fromYmd, toYmd)}
      GROUP BY c.id, customer_name
      ORDER BY total DESC
      LIMIT ${TOP_CUSTOMERS_LIMIT}
    `
  );
  return rows.map((row) => ({
    customerId: row.customer_id,
    customerName: row.customer_name,
    orderCount: Number(row.order_count),
    totalNetValue: decimalToNumber(row.total),
  }));
}

function toCumulativeBillingPoints(
  series: ReturnType<typeof buildMonthlySeriesPoints>
): DashboardCumulativeChartPoint[] {
  const cumulative = buildCumulativeFromMonthlySeries(series);
  return cumulative.map((row) => ({
    month: row.month,
    label: row.periodLabel,
    currentYear: row.currentYearValue,
    previousYear: row.previousYearValue,
    twoYearsAgo: null,
  }));
}

export async function buildBillingDashboardTab(
  yearCtx: ExecutiveDashboardYearContext
): Promise<BillingDashboardTab> {
  const ref = yearCtx.referenceDate;
  const year = yearCtx.selectedYear;
  const monthStart = startOfMonth(ref);
  const monthEnd = endOfMonth(ref);
  const yearStart = startOfYear(ref);
  const yearEnd = endOfYear(ref);
  const prevYearSameMonthStart = startOfMonth(new Date(yearCtx.previousYear, ref.getMonth(), 1));
  const prevYearSameMonthEnd = endOfMonth(new Date(yearCtx.previousYear, ref.getMonth(), 1));
  const prevYearStart = startOfYear(new Date(yearCtx.previousYear, 0, 1));
  const prevYearEnd = endOfYear(new Date(yearCtx.previousYear, 0, 1));
  const ytdPrevEnd = new Date(
    yearCtx.previousYear,
    ref.getMonth(),
    ref.getDate(),
    23,
    59,
    59,
    999
  );

  const [
    monthAgg,
    yearAgg,
    prevMonthAgg,
    prevYearTotalAgg,
    ytdCurrentAgg,
    ytdPreviousAgg,
    currentYearMonthly,
    previousYearMonthly,
    recentInvoiced,
    topCustomers,
  ] = await Promise.all([
    queryMarketBillingInPeriod(monthStart, monthEnd),
    queryMarketBillingInPeriod(yearStart, yearEnd),
    queryMarketBillingInPeriod(prevYearSameMonthStart, prevYearSameMonthEnd),
    queryMarketBillingInPeriod(prevYearStart, prevYearEnd),
    queryMarketBillingInPeriod(yearStart, ref),
    queryMarketBillingInPeriod(prevYearStart, ytdPrevEnd),
    queryMonthlyMarketBilling(year),
    queryMonthlyMarketBilling(yearCtx.previousYear),
    queryRecentMarketInvoicedOrders(),
    queryTopMarketCustomersInPeriod(yearStart, yearEnd),
  ]);

  const ticketAvg = computeTicketAverage(monthAgg.net, monthAgg.count);
  const monthWorkdaysElapsed = countWorkdaysElapsedInMonth(ref);
  const workdaysInMonth = countWorkdaysInMonth(year, ref.getMonth());
  const dailyAvgMonth = computeDailyAverageByWorkday(monthAgg.net, monthWorkdaysElapsed);
  const projectedMonth = computeMonthProjection(dailyAvgMonth, workdaysInMonth);
  const target = buildTargetBlock(monthAgg.net, prevMonthAgg.net);
  const annualTarget = computeGrowthTarget(prevYearTotalAgg.net);

  const projection: BillingProjectionBlock = {
    dailyAverage: dailyAvgMonth,
    projectedMonth,
    workdaysElapsed: monthWorkdaysElapsed,
    workdaysInMonth,
    formatted: {
      dailyAverage: formatExecutiveCurrency(dailyAvgMonth),
      projectedMonth: formatExecutiveCurrency(projectedMonth),
    },
  };

  const yearComparison: BillingYearComparison = {
    yearToDateCurrent: ytdCurrentAgg.net,
    yearToDatePrevious: ytdPreviousAgg.net,
    previousYearTotal: prevYearTotalAgg.net,
    annualTarget,
    formatted: {
      yearToDateCurrent: formatExecutiveCurrency(ytdCurrentAgg.net),
      yearToDatePrevious: formatExecutiveCurrency(ytdPreviousAgg.net),
      previousYearTotal: formatExecutiveCurrency(prevYearTotalAgg.net),
      annualTarget: formatExecutiveCurrency(annualTarget),
    },
  };

  const realizedVsProjected: BillingRealizedVsProjected = {
    realized: monthAgg.net,
    projected: projectedMonth,
    target: target.target,
    formatted: {
      realized: formatExecutiveCurrency(monthAgg.net),
      projected: formatExecutiveCurrency(projectedMonth),
      target: formatExecutiveCurrency(target.target),
    },
  };

  const summaryCards: DashboardMetricCard[] = [
    metricCard("billing-month", "Faturamento mês atual", monthAgg.net, { asCurrency: true, compact: true }),
    metricCard("billing-prev-month", "Mesmo mês ano anterior", prevMonthAgg.net, {
      asCurrency: true,
      compact: true,
    }),
    metricCard("billing-year", "Faturamento ano atual", yearAgg.net, { asCurrency: true, compact: true }),
    metricCard("billing-daily-avg", "Média diária faturada", dailyAvgMonth, { asCurrency: true }),
    metricCard("billing-projected", "Projeção do mês", projectedMonth, {
      asCurrency: true,
      compact: true,
      hint: `${workdaysInMonth} dias úteis no mês`,
    }),
    metricCard("billing-target", "Meta do mês (+30%)", target.target, { asCurrency: true, compact: true }),
    metricCard("billing-achievement", "% atingimento meta", target.achievementPercent, { asPercent: true }),
    metricCard("billing-gap", "Diferença p/ meta", target.gap, { asCurrency: true, compact: true }),
    metricCard("billing-count-month", "Pedidos faturados no mês", monthAgg.count),
    metricCard("billing-ticket", "Ticket médio faturado", ticketAvg, { asCurrency: true }),
  ];

  const monthlySeries = buildMonthlySeriesPoints(
    yearCtx,
    currentYearMonthly,
    previousYearMonthly,
    { projectedMonthValue: projectedMonth, projectionMonth: yearCtx.ytdMonthLimit }
  );

  return {
    available: true,
    source:
      "SalesOrder.totalNetValue + nfes.dataProcessamento; exclui clientes do grupo; venda de mercado",
    periodLabel: ref.toLocaleDateString("pt-BR", { month: "long", year: "numeric" }),
    yearLabel: year,
    summaryCards,
    target,
    projection,
    yearComparison,
    realizedVsProjected,
    monthlySeries,
    chartSeries: buildChartSeriesConfig("billing", yearCtx),
    cumulativeBilling: toCumulativeBillingPoints(monthlySeries),
    recentInvoicedOrders: recentInvoiced,
    topCustomers,
    intercompanyExclusionApplied: true,
    marketBillingNote: MARKET_BILLING_NOTE,
  };
}
