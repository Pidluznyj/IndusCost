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
import {
  nfeProcessamentoDateSql,
  nomusNfesElementsSql,
  orderInvoicedInPeriodSql,
  orderIsInvoicedSql,
  toPgDateYmd,
} from "@/src/lib/salesOrderInvoicingSql.js";
import type {
  BillingDashboardTab,
  BillingTopCustomerRow,
  DashboardChartPoint,
  DashboardMetricCard,
  DashboardTargetBlock,
  RecentInvoicedOrderRow,
} from "@/src/lib/executiveDashboardTypes.js";

const MONTH_SHORT = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
const RECENT_INVOICED_LIMIT = 15;
const TOP_CUSTOMERS_LIMIT = 10;

const NOT_CANCELLED = Prisma.sql`so.status != 'CANCELLED'`;

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

async function queryInvoicedInIssuePeriod(
  from: Date,
  to: Date
): Promise<{ count: number | null; net: number | null }> {
  const fromYmd = toPgDateYmd(from);
  const toYmd = toPgDateYmd(to);
  const [row] = await prisma.$queryRaw<{ c: bigint; v: unknown }[]>(
    Prisma.sql`
      SELECT COUNT(*)::bigint AS c, COALESCE(SUM(so."totalNetValue"), 0) AS v
      FROM "SalesOrder" so
      WHERE ${NOT_CANCELLED}
        AND ${orderInvoicedInPeriodSql("so", fromYmd, toYmd)}
    `
  );
  return { count: safeMetricNumber(Number(row?.c ?? 0n)), net: decimalToNumber(row?.v) };
}

async function queryMonthlyBilling(year: number): Promise<Map<number, number>> {
  const fromYmd = toPgDateYmd(startOfYear(new Date(year, 0, 1)));
  const toYmd = toPgDateYmd(endOfYear(new Date(year, 0, 1)));
  const rows = await prisma.$queryRaw<{ month: number; total: unknown }[]>(
    Prisma.sql`
      SELECT
        EXTRACT(MONTH FROM inv.invoice_date)::int AS month,
        COALESCE(SUM(so."totalNetValue"), 0) AS total
      FROM "SalesOrder" so
      INNER JOIN LATERAL (
        SELECT MAX((${nfeProcessamentoDateSql()})) AS invoice_date
        FROM ${nomusNfesElementsSql("so")}
        WHERE (${nfeProcessamentoDateSql()}) IS NOT NULL
      ) inv ON inv.invoice_date IS NOT NULL
      WHERE ${NOT_CANCELLED}
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

async function queryRecentInvoicedOrders(): Promise<RecentInvoicedOrderRow[]> {
  const rows = await prisma.$queryRaw<
    {
      id: string;
      order_code: string;
      customer_name: string;
      invoice_date: Date;
      total_net_value: unknown;
    }[]
  >(
    Prisma.sql`
      SELECT
        so.id,
        so."orderCode" AS order_code,
        COALESCE(NULLIF(TRIM(c."tradeName"), ''), c."companyName") AS customer_name,
        inv.invoice_date,
        so."totalNetValue" AS total_net_value
      FROM "SalesOrder" so
      INNER JOIN "Customer" c ON c.id = so."customerId"
      INNER JOIN LATERAL (
        SELECT MAX((${nfeProcessamentoDateSql()})) AS invoice_date
        FROM ${nomusNfesElementsSql("so")}
        WHERE (${nfeProcessamentoDateSql()}) IS NOT NULL
      ) inv ON inv.invoice_date IS NOT NULL
      WHERE ${NOT_CANCELLED}
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
  }));
}

async function queryTopCustomersInPeriod(from: Date, to: Date): Promise<BillingTopCustomerRow[]> {
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

function buildMonthlyBillingChart(
  currentYearMap: Map<number, number>,
  previousYearMap: Map<number, number>,
  currentYear: number
): DashboardChartPoint[] {
  const currentMonth = new Date().getMonth() + 1;
  return MONTH_SHORT.map((label, idx) => {
    const month = idx + 1;
    const previousYear = previousYearMap.get(month) ?? 0;
    return {
      month,
      label: `${label}/${String(currentYear).slice(-2)}`,
      currentYear: month <= currentMonth ? (currentYearMap.get(month) ?? 0) : null,
      previousYear,
      target: computeGrowthTarget(previousYear),
    };
  });
}

export async function buildBillingDashboardTab(now: Date): Promise<BillingDashboardTab> {
  const year = now.getFullYear();
  const monthStart = startOfMonth(now);
  const monthEnd = endOfMonth(now);
  const yearStart = startOfYear(now);
  const yearEnd = endOfYear(now);
  const prevYearSameMonthStart = startOfMonth(new Date(year - 1, now.getMonth(), 1));
  const prevYearSameMonthEnd = endOfMonth(new Date(year - 1, now.getMonth(), 1));

  const [
    monthAgg,
    yearAgg,
    prevMonthAgg,
    currentYearMonthly,
    previousYearMonthly,
    recentInvoiced,
    topCustomers,
  ] = await Promise.all([
    queryInvoicedInIssuePeriod(monthStart, monthEnd),
    queryInvoicedInIssuePeriod(yearStart, yearEnd),
    queryInvoicedInIssuePeriod(prevYearSameMonthStart, prevYearSameMonthEnd),
    queryMonthlyBilling(year),
    queryMonthlyBilling(year - 1),
    queryRecentInvoicedOrders(),
    queryTopCustomersInPeriod(yearStart, yearEnd),
  ]);

  const ticketAvg = computeTicketAverage(monthAgg.net, monthAgg.count);
  const monthWorkdays = countWorkdaysElapsedInMonth(now);
  const yearWorkdays = countWorkdaysElapsedInYear(now);
  const dailyAvgMonth = computeDailyAverageByWorkday(monthAgg.net, monthWorkdays);
  const target = buildTargetBlock(monthAgg.net, prevMonthAgg.net);

  const summaryCards: DashboardMetricCard[] = [
    metricCard("billing-month", "Faturamento líquido do mês", monthAgg.net, {
      asCurrency: true,
      compact: true,
    }),
    metricCard("billing-year", "Faturamento líquido do ano", yearAgg.net, {
      asCurrency: true,
      compact: true,
    }),
    metricCard("billing-prev-month", "Mesmo mês ano anterior", prevMonthAgg.net, {
      asCurrency: true,
      compact: true,
    }),
    metricCard("billing-target", "Meta do mês", target.target, { asCurrency: true, compact: true }),
    metricCard("billing-achievement", "% atingimento meta", target.achievementPercent, { asPercent: true }),
    metricCard("billing-ticket", "Ticket médio faturado", ticketAvg, { asCurrency: true }),
    metricCard("billing-count-month", "Pedidos faturados no mês", monthAgg.count),
    metricCard("billing-daily-avg", "Média diária faturada", dailyAvgMonth, { asCurrency: true }),
  ];

  return {
    available: true,
    source:
      "SalesOrder.totalNetValue com nfes.dataProcessamento; valor do pedido como base (mesma regra CRM)",
    periodLabel: now.toLocaleDateString("pt-BR", { month: "long", year: "numeric" }),
    yearLabel: year,
    summaryCards,
    target,
    monthlyBilling: buildMonthlyBillingChart(currentYearMonthly, previousYearMonthly, year),
    recentInvoicedOrders: recentInvoiced,
    topCustomers,
  };
}
