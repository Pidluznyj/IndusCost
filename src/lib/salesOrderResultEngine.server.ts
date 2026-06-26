/**
 * Motor server-side da aba Resultado — compõe margem oficial, imposto TaxRule e projeção.
 */
import type { PrismaClient } from "@prisma/client";
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
import { buildSalesOrderResultRealizedVsProjected } from "./salesOrderResultProjection.js";
import {
  buildOfficialSalesOrderResultSalesBundle,
  mapPrismaOrderToSalesOrderRulesInput,
  OFFICIAL_SO_RULES_SOURCE,
} from "./salesOrderRulesAdapter.js";
import type {
  SalesOrderResultDashboardPayload,
  SalesOrderResultFilters,
} from "./salesOrderResultTypes.js";

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

async function loadSalesOrderResultRulesOrders(
  db: PrismaClient,
  where: ReturnType<typeof buildSalesOrderMarginIndicatorWhere>
) {
  const rows = await db.salesOrder.findMany({
    where,
    select: {
      id: true,
      orderCode: true,
      status: true,
      customerId: true,
      issueDate: true,
      expectedDeliveryDate: true,
      totalNetValue: true,
      totalGrossValue: true,
      totalItems: true,
      responsible: true,
      nomusRawResponse: true,
      companyIssuer: true,
      externalSalesOrderId: true,
      Customer: { select: { companyName: true, tradeName: true, taxId: true } },
      items: {
        select: {
          id: true,
          externalProductId: true,
          skuSnapshot: true,
          productNameSnapshot: true,
          quantity: true,
          status: true,
        },
      },
    },
  });
  return rows.map(mapPrismaOrderToSalesOrderRulesInput);
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

  const rulesOrders = await loadSalesOrderResultRulesOrders(db, where);
  const salesBundle = buildOfficialSalesOrderResultSalesBundle({
    orders: rulesOrders,
    year: filters.year,
    month: filters.month,
    referenceDate,
    customerId: filters.customerId,
    sellerId: filters.sellerId,
    companyId: filters.companyId,
    productId: filters.productId,
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

  for (const order of orders) {
    if (!order.issueDate) continue;
    const issueMonth = order.issueDate.getMonth() + 1;
    if (filters.month != null && issueMonth !== filters.month) continue;
    if (order.issueDate.getFullYear() !== filters.year) continue;

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

  const marginTotals = aggregateSalesOrderResultTotals(computedItems, {
    taxPercentApplied: effectiveTaxPercent,
    taxSourceLabel: defaultTax.label,
  });

  const totals = filters.productId
    ? {
        ...marginTotals,
        ordersCount: salesBundle.metrics.filteredOrders,
      }
    : {
        ...marginTotals,
        salesAmount: salesBundle.metrics.soldAmount,
        ordersCount: salesBundle.metrics.filteredOrders,
        itemsCount: salesBundle.metrics.totalItems,
      };

  const monthlyMargin = buildSalesOrderResultMonthlyRows(computedItems, filters.year);
  const monthlySales = salesBundle.monthlyTimeline.map((point) => ({
    month: point.month,
    amount: point.soldAmount,
  }));
  const previousYearMonthly = new Map(
    salesBundle.previousYearTimeline.map((point) => [point.month, point.soldAmount])
  );
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
      sales: OFFICIAL_SO_RULES_SOURCE,
      margin: "official-sales-order-margin-engine",
      cost: "official-product-cost-engine",
      tax: "official-tax-rule-engine",
      projection: OFFICIAL_SO_RULES_SOURCE,
    },
  };
}
