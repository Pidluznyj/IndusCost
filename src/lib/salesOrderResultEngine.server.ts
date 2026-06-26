/**
 * Motor server-side da aba Resultado — compõe margem oficial, imposto TaxRule e projeção.
 */
import type { PrismaClient } from "@prisma/client";
import { decimalToNumber } from "./executiveDashboardHelpers.js";
import {
  loadProductTaxPercentIndex,
  resolveDefaultSalesTaxPercent,
  resolveItemSalesTaxPercent,
} from "./averageSalesTaxEngine.js";
import {
  buildSalesOrderMarginIndicatorWhere,
  parseSalesOrderMarginIndicatorFilters,
} from "./salesOrderMarginIndicators.server.js";
import {
  calculateSalesOrderMarginsForOrders,
  SALES_ORDER_ITEM_MARGIN_SELECT,
  type SalesOrderForMargin,
} from "./salesOrderMarginService.server.js";
import {
  aggregateSalesOrderResultTotals,
  buildSalesOrderResultMonthlyRows,
  computeSalesOrderResultItem,
} from "./salesOrderResultMath.js";
import {
  buildMonthlySalesFromOrders,
  buildSalesOrderResultRealizedVsProjected,
} from "./salesOrderResultProjection.js";
import { Prisma } from "@prisma/client";
import type {
  SalesOrderResultDashboardPayload,
  SalesOrderResultFilters,
} from "./salesOrderResultTypes.js";

const NOT_CANCELLED = Prisma.sql`so.status != 'CANCELLED'`;

function parseAsOfDate(value: unknown, fallback: Date): Date {
  if (typeof value !== "string" || !value.trim()) return fallback;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return fallback;
  const y = Number(match[1]);
  const m = Number(match[2]) - 1;
  const d = Number(match[3]);
  return new Date(y, m, d, 23, 59, 59, 999);
}

export function parseSalesOrderResultFilters(
  query: Record<string, unknown>,
  now = new Date()
): SalesOrderResultFilters {
  const indicatorFilters = parseSalesOrderMarginIndicatorFilters(query, now);
  const asOfDate =
    typeof query.asOfDate === "string" && query.asOfDate.trim()
      ? query.asOfDate.trim()
      : now.toISOString().slice(0, 10);

  return {
    year: indicatorFilters.year,
    month: indicatorFilters.month,
    customerId: indicatorFilters.customerId,
    productId: indicatorFilters.productId,
    sellerId: indicatorFilters.responsible,
    companyId: indicatorFilters.companyIssuer,
    asOfDate,
  };
}

async function queryPreviousYearMonthlySales(
  db: Pick<PrismaClient, "$queryRaw">,
  year: number
): Promise<Map<number, number>> {
  const from = new Date(year, 0, 1);
  const to = new Date(year, 11, 31, 23, 59, 59, 999);
  const rows = await db.$queryRaw<{ month: number; total: unknown }[]>(
    Prisma.sql`
      SELECT
        EXTRACT(MONTH FROM so."issueDate")::int AS month,
        COALESCE(SUM(so."totalNetValue"), 0) AS total
      FROM "SalesOrder" so
      WHERE ${NOT_CANCELLED}
        AND so."issueDate" >= ${from}
        AND so."issueDate" <= ${to}
      GROUP BY 1
    `
  );
  const map = new Map<number, number>();
  for (const row of rows) {
    map.set(row.month, decimalToNumber(row.total) ?? 0);
  }
  return map;
}

export async function buildSalesOrderResultDashboard(
  db: PrismaClient,
  query: Record<string, unknown>,
  now = new Date()
): Promise<SalesOrderResultDashboardPayload> {
  const filters = parseSalesOrderResultFilters(query, now);
  const referenceDate = parseAsOfDate(filters.asOfDate, now);
  const indicatorFilters = parseSalesOrderMarginIndicatorFilters(query, now);
  const where = buildSalesOrderMarginIndicatorWhere(indicatorFilters);

  const orders = await db.salesOrder.findMany({
    where,
    select: {
      id: true,
      issueDate: true,
      totalNetValue: true,
      nomusRawResponse: true,
      items: { select: SALES_ORDER_ITEM_MARGIN_SELECT },
    },
  });

  const marginByOrder = await calculateSalesOrderMarginsForOrders(
    db,
    orders as SalesOrderForMargin[]
  );

  const productIds = orders.flatMap((order) =>
    order.items.map((item) => item.productId).filter((id): id is string => Boolean(id))
  );
  const [productTaxIndex, defaultTax] = await Promise.all([
    loadProductTaxPercentIndex(db, productIds),
    resolveDefaultSalesTaxPercent(db),
  ]);

  const computedItems = [];
  const orderRowsForProjection: Array<{ issueMonth: number; totalNetValue: number }> = [];

  for (const order of orders) {
    if (!order.issueDate) continue;
    const issueMonth = order.issueDate.getMonth() + 1;
    if (filters.month != null && issueMonth !== filters.month) continue;
    if (order.issueDate.getFullYear() !== filters.year) continue;

    orderRowsForProjection.push({
      issueMonth,
      totalNetValue: decimalToNumber(order.totalNetValue) ?? 0,
    });

    const marginResult = marginByOrder.get(order.id);
    if (!marginResult) continue;

    for (const itemResult of marginResult.itemResults) {
      if (itemResult.status === "ITEM_CANCELADO") continue;
      if (filters.productId && itemResult.productId !== filters.productId) continue;
      if (itemResult.netRevenue <= 0) continue;

      const taxPercent = resolveItemSalesTaxPercent({
        productId: itemResult.productId ?? null,
        productTaxIndex,
        defaultTaxPercent: defaultTax.percent,
      });

      computedItems.push(
        computeSalesOrderResultItem({
          salesOrderItemId: itemResult.salesOrderItemId ?? "",
          orderId: order.id,
          issueMonth,
          productId: itemResult.productId ?? null,
          quantity: itemResult.quantity,
          marginStatus: itemResult.status,
          salesAmount: itemResult.netRevenue,
          costAmount: itemResult.totalCost ?? 0,
          taxPercent,
        })
      );
    }
  }

  let weightedTaxNumerator = 0;
  let weightedTaxDenominator = 0;
  for (const item of computedItems) {
    weightedTaxNumerator += item.taxAmount;
    weightedTaxDenominator += item.salesAmount;
  }
  const effectiveTaxPercent =
    weightedTaxDenominator > 0
      ? Math.round(((weightedTaxNumerator / weightedTaxDenominator) * 100 + Number.EPSILON) * 100) / 100
      : defaultTax.percent;

  const totals = aggregateSalesOrderResultTotals(computedItems, {
    taxPercentApplied: effectiveTaxPercent,
    taxSourceLabel: defaultTax.label,
  });

  const monthlyMargin = buildSalesOrderResultMonthlyRows(computedItems, filters.year);
  const monthlySales = buildMonthlySalesFromOrders(orderRowsForProjection);
  const previousYearMonthly = await queryPreviousYearMonthlySales(db, filters.year - 1);
  const { rows: realizedVsProjected, projection } = buildSalesOrderResultRealizedVsProjected({
    monthlySales,
    year: filters.year,
    referenceDate,
    previousYearMonthlySales: previousYearMonthly,
  });

  return {
    filters,
    totals,
    monthlyMargin,
    realizedVsProjected,
    projection,
    warnings: {
      missingCostCount: totals.missingCostCount,
      missingProductCount: totals.missingProductCount,
      negativeMarginCount: totals.negativeMarginCount,
    },
    source: {
      sales: "official-sales-order-engine",
      margin: "official-sales-order-margin-engine",
      cost: "official-product-cost-engine",
      tax: "official-tax-rule-engine",
      projection: "official-sales-order-dashboard-rules",
    },
  };
}
