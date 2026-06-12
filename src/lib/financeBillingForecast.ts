import { Prisma } from "@prisma/client";
import { billingMarketCustomerFilterSql } from "@/src/lib/billingMarketCustomerSql.js";
import type { ExecutiveDashboardYearContext } from "@/src/lib/executiveDashboardYear.js";
import { prisma } from "@/src/lib/prisma.js";
import {
  decimalToNumber,
  endOfMonth,
  startOfMonth,
} from "@/src/lib/executiveDashboardHelpers.js";
import {
  formatExecutiveCurrency,
  formatExecutiveInteger,
} from "@/src/lib/executiveDashboardFormatters.js";
import { addLocalDays, startOfLocalDay } from "@/src/lib/financeAccountsReceivableDashboard.js";
import { buildFinanceBillingHorizonSummary } from "@/src/lib/financeHorizonAggregation.js";
import type { FinanceHorizonSummary } from "@/src/lib/financeHorizonAggregation.js";
import {
  nomusNfesElementsSql,
  orderNotInvoicedSql,
  toPgDateYmd,
} from "@/src/lib/salesOrderInvoicingSql.js";
import { endOfYear, startOfYear } from "@/src/lib/executiveDashboardWorkdays.js";

const NOT_CANCELLED = Prisma.sql`so.status != 'CANCELLED'`;
const MARKET_CUSTOMER = billingMarketCustomerFilterSql("c");

const MONTH_SHORT = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

export type BillingForecastOrderRow = {
  orderId: string;
  orderCode: string;
  customerName: string;
  expectedDeliveryDate: string | null;
  totalNetValue: number;
  status: string;
  daysOverdue: number;
  hasLinkedNfe: boolean;
};

export type BillingForecastMonthlyPoint = {
  month: number;
  monthLabel: string;
  realized: number | null;
  forecast: number | null;
  difference: number | null;
};

export type BillingForecastDailyPoint = {
  date: string;
  label: string;
  realized: number;
  forecast: number;
  difference: number;
};

export type BillingForecastBlock = {
  dateField: "expectedDeliveryDate";
  portfolioAmount: number;
  monthForecastAmount: number;
  overdueAmount: number;
  overdueCount: number;
  ordersWithoutDateCount: number;
  note: string;
  formatted: {
    portfolioAmount: string;
    monthForecastAmount: string;
    overdueAmount: string;
    overdueCount: string;
  };
  monthlyComparison: BillingForecastMonthlyPoint[];
  dailySeries: BillingForecastDailyPoint[];
  orders: BillingForecastOrderRow[];
  financialHorizon: FinanceHorizonSummary;
};

type RawForecastOrder = {
  id: string;
  order_code: string;
  customer_name: string;
  expected_delivery_date: Date | null;
  total_net_value: unknown;
  status: string;
  has_nfe: boolean;
};

function computeDaysOverdue(expectedDate: Date, today: Date): number {
  const exp = startOfLocalDay(expectedDate);
  const ref = startOfLocalDay(today);
  const diff = Math.floor((ref.getTime() - exp.getTime()) / 86400000);
  return diff > 0 ? diff : 0;
}

export async function queryBillingForecastHorizonOrders(
  referenceDate: Date = new Date()
): Promise<RawForecastOrder[]> {
  const today = startOfLocalDay(referenceDate);
  const horizonEnd = addLocalDays(today, 60);
  const fromYmd = toPgDateYmd(today);
  const toYmd = toPgDateYmd(horizonEnd);

  return prisma.$queryRaw<RawForecastOrder[]>(
    Prisma.sql`
      SELECT
        so.id,
        so."orderCode" AS order_code,
        COALESCE(NULLIF(TRIM(c."tradeName"), ''), c."companyName") AS customer_name,
        so."expectedDeliveryDate" AS expected_delivery_date,
        so."totalNetValue" AS total_net_value,
        so.status,
        EXISTS (
          SELECT 1 FROM ${nomusNfesElementsSql("so")}
        ) AS has_nfe
      FROM "SalesOrder" so
      INNER JOIN "Customer" c ON c.id = so."customerId"
      WHERE ${NOT_CANCELLED}
        AND ${MARKET_CUSTOMER}
        AND ${orderNotInvoicedSql("so")}
        AND so."expectedDeliveryDate" IS NOT NULL
        AND so."expectedDeliveryDate" >= ${fromYmd}::date
        AND so."expectedDeliveryDate" <= ${toYmd}::date
      ORDER BY so."expectedDeliveryDate" ASC, so."issueDate" DESC
      LIMIT 2000
    `
  );
}

async function queryOpenForecastOrders(year: number): Promise<RawForecastOrder[]> {
  const fromYmd = toPgDateYmd(startOfYear(new Date(year, 0, 1)));
  const toYmd = toPgDateYmd(endOfYear(new Date(year, 0, 1)));

  return prisma.$queryRaw<RawForecastOrder[]>(
    Prisma.sql`
      SELECT
        so.id,
        so."orderCode" AS order_code,
        COALESCE(NULLIF(TRIM(c."tradeName"), ''), c."companyName") AS customer_name,
        so."expectedDeliveryDate" AS expected_delivery_date,
        so."totalNetValue" AS total_net_value,
        so.status,
        EXISTS (
          SELECT 1 FROM ${nomusNfesElementsSql("so")}
        ) AS has_nfe
      FROM "SalesOrder" so
      INNER JOIN "Customer" c ON c.id = so."customerId"
      WHERE ${NOT_CANCELLED}
        AND ${MARKET_CUSTOMER}
        AND ${orderNotInvoicedSql("so")}
        AND (
          so."expectedDeliveryDate" IS NULL
          OR (
            so."expectedDeliveryDate" >= ${fromYmd}::date
            AND so."expectedDeliveryDate" <= ${toYmd}::date
          )
        )
      ORDER BY so."expectedDeliveryDate" ASC NULLS LAST, so."issueDate" DESC
      LIMIT 500
    `
  );
}

export function buildBillingForecastMonthlyComparison(
  yearCtx: ExecutiveDashboardYearContext,
  realizedByMonth: Map<number, number>,
  forecastOrders: RawForecastOrder[]
): BillingForecastMonthlyPoint[] {
  const forecastByMonth = new Map<number, number>();
  for (const row of forecastOrders) {
    if (!row.expected_delivery_date) continue;
    const m = row.expected_delivery_date.getMonth() + 1;
    const v = decimalToNumber(row.total_net_value) ?? 0;
    forecastByMonth.set(m, (forecastByMonth.get(m) ?? 0) + v);
  }

  return MONTH_SHORT.map((monthLabel, idx) => {
    const month = idx + 1;
    const realized =
      month <= yearCtx.ytdMonthLimit ? (realizedByMonth.get(month) ?? 0) : null;
    const forecast = forecastByMonth.get(month) ?? 0;
    const hasForecast = forecast > 0;
    const difference =
      realized != null ? realized - (hasForecast ? forecast : 0) : null;

    return {
      month,
      monthLabel,
      realized,
      forecast: hasForecast ? forecast : month <= yearCtx.ytdMonthLimit ? 0 : null,
      difference,
    };
  });
}

function buildDailySeries(
  yearCtx: ExecutiveDashboardYearContext,
  forecastOrders: RawForecastOrder[],
  realizedByDay: Map<string, number>
): BillingForecastDailyPoint[] {
  const ref = yearCtx.referenceDate;
  const monthStart = startOfMonth(ref);
  const monthEnd = endOfMonth(ref);
  const forecastByDay = new Map<string, number>();

  for (const row of forecastOrders) {
    if (!row.expected_delivery_date) continue;
    const d = row.expected_delivery_date;
    if (d < monthStart || d > monthEnd) continue;
    const key = toPgDateYmd(d);
    const v = decimalToNumber(row.total_net_value) ?? 0;
    forecastByDay.set(key, (forecastByDay.get(key) ?? 0) + v);
  }

  const points: BillingForecastDailyPoint[] = [];
  const cursor = new Date(monthStart);
  while (cursor <= monthEnd) {
    const key = toPgDateYmd(cursor);
    const realized = realizedByDay.get(key) ?? 0;
    const forecast = forecastByDay.get(key) ?? 0;
    points.push({
      date: key,
      label: cursor.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }),
      realized,
      forecast,
      difference: realized - forecast,
    });
    cursor.setDate(cursor.getDate() + 1);
  }
  return points;
}

async function queryRealizedByDayInMonth(
  monthStart: Date,
  monthEnd: Date
): Promise<Map<string, number>> {
  const fromYmd = toPgDateYmd(monthStart);
  const toYmd = toPgDateYmd(monthEnd);
  const rows = await prisma.$queryRaw<{ day: Date; total: unknown }[]>(
    Prisma.sql`
      SELECT
        inv.invoice_date::date AS day,
        COALESCE(SUM(so."totalNetValue"), 0) AS total
      FROM "SalesOrder" so
      INNER JOIN "Customer" c ON c.id = so."customerId"
      INNER JOIN LATERAL (
        SELECT MAX((
          CASE
            WHEN NULLIF(TRIM(BOTH FROM COALESCE(nfe->>'dataProcessamento', '')), '') ~ '^[0-9]{2}/[0-9]{2}/[0-9]{4}$'
            THEN to_date(TRIM(nfe->>'dataProcessamento'), 'DD/MM/YYYY')
            ELSE NULL
          END
        )) AS invoice_date
        FROM ${nomusNfesElementsSql("so")}
      ) inv ON inv.invoice_date IS NOT NULL
      WHERE ${NOT_CANCELLED}
        AND ${MARKET_CUSTOMER}
        AND inv.invoice_date >= ${fromYmd}::date
        AND inv.invoice_date <= ${toYmd}::date
      GROUP BY 1
    `
  );
  const map = new Map<string, number>();
  for (const row of rows) {
    map.set(toPgDateYmd(row.day), decimalToNumber(row.total) ?? 0);
  }
  return map;
}

export async function buildBillingForecastBlock(
  yearCtx: ExecutiveDashboardYearContext,
  realizedByMonth: Map<number, number>
): Promise<BillingForecastBlock> {
  const ref = yearCtx.referenceDate;
  const year = yearCtx.selectedYear;
  const monthStart = startOfMonth(ref);
  const monthEnd = endOfMonth(ref);

  const [rawOrders, horizonOrders, realizedByDay] = await Promise.all([
    queryOpenForecastOrders(year),
    queryBillingForecastHorizonOrders(ref),
    queryRealizedByDayInMonth(monthStart, monthEnd),
  ]);

  const today = startOfLocalDay(ref);
  let portfolioAmount = 0;
  let monthForecastAmount = 0;
  let overdueAmount = 0;
  let overdueCount = 0;
  let ordersWithoutDateCount = 0;

  const orders: BillingForecastOrderRow[] = rawOrders.map((row) => {
    const value = decimalToNumber(row.total_net_value) ?? 0;
    const exp = row.expected_delivery_date;
    if (!exp) {
      ordersWithoutDateCount += 1;
    } else {
      portfolioAmount += value;
      if (exp >= monthStart && exp <= monthEnd) {
        monthForecastAmount += value;
      }
      const daysOverdue = computeDaysOverdue(exp, today);
      if (daysOverdue > 0) {
        overdueAmount += value;
        overdueCount += 1;
      }
    }
    return {
      orderId: row.id,
      orderCode: row.order_code,
      customerName: row.customer_name,
      expectedDeliveryDate: exp?.toISOString() ?? null,
      totalNetValue: value,
      status: row.status,
      daysOverdue: exp ? computeDaysOverdue(exp, today) : 0,
      hasLinkedNfe: row.has_nfe,
    };
  });

  const financialHorizon = buildFinanceBillingHorizonSummary(
    horizonOrders.map((row) => ({
      totalNetValue: decimalToNumber(row.total_net_value) ?? 0,
      expectedDeliveryDate: row.expected_delivery_date,
    })),
    ref
  );

  return {
    dateField: "expectedDeliveryDate",
    portfolioAmount,
    monthForecastAmount,
    overdueAmount,
    overdueCount,
    ordersWithoutDateCount,
    note:
      "Previsto: pedidos de mercado não faturados (sem dataProcessamento NF) com data prevista de entrega. Campo: SalesOrder.expectedDeliveryDate (Nomus dataEntregaPadrao). Realizado: SalesOrder com NF processada.",
    formatted: {
      portfolioAmount: formatExecutiveCurrency(portfolioAmount),
      monthForecastAmount: formatExecutiveCurrency(monthForecastAmount),
      overdueAmount: formatExecutiveCurrency(overdueAmount),
      overdueCount: formatExecutiveInteger(overdueCount),
    },
    monthlyComparison: buildBillingForecastMonthlyComparison(yearCtx, realizedByMonth, rawOrders),
    dailySeries: buildDailySeries(yearCtx, rawOrders, realizedByDay),
    orders: orders.filter((o) => o.expectedDeliveryDate != null).slice(0, 50),
    financialHorizon,
  };
}

export function billingForecastMetricsAreFinite(block: BillingForecastBlock): boolean {
  const nums = [
    block.portfolioAmount,
    block.monthForecastAmount,
    block.overdueAmount,
    ...block.monthlyComparison.flatMap((p) => [p.realized, p.forecast, p.difference]),
    ...block.dailySeries.flatMap((p) => [p.realized, p.forecast, p.difference]),
    ...block.orders.map((o) => o.totalNetValue),
    ...block.financialHorizon.buckets.map((b) => b.amount),
    block.financialHorizon.total.amount,
  ];
  return nums.every((v) => v == null || Number.isFinite(v));
}
