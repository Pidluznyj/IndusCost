/**
 * Motor server-side da aba Resultado — compõe margem oficial, imposto TaxRule e projeção.
 */
import type { PrismaClient } from "@prisma/client";
import {
  loadProductTaxPercentIndex,
  resolveDefaultSalesTaxPercent,
} from "./averageSalesTaxEngine.js";
import {
  buildSalesOrderMarginIndicatorWhere,
  parseSalesOrderMarginIndicatorFilters,
} from "./salesOrderMarginIndicators.server.js";
import {
  buildOfficialSalesMarginRulesResult,
  buildOfficialSalesOrderResultMarginPayload,
  mapMarginContextToRulesOrders,
} from "./salesMarginRulesAdapter.js";
import {
  buildSalesOrderMarginContext,
  SALES_ORDER_ITEM_MARGIN_SELECT,
  type SalesOrderForMargin,
} from "./salesOrderMarginService.server.js";
import { buildSalesOrderResultRealizedVsProjected } from "./salesOrderResultProjection.js";
import {
  buildOfficialSalesOrderResultSalesBundle,
  mapPrismaOrderToSalesOrderRulesInput,
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

  const marginContext = await buildSalesOrderMarginContext(db, orders as SalesOrderForMargin[]);
  const marginRulesOrders = mapMarginContextToRulesOrders(
    orders as SalesOrderForMargin[],
    marginContext.byOrderId
  );

  const productIds = orders.flatMap((order) =>
    order.items.map((item) => item.productId).filter((id): id is string => Boolean(id))
  );
  const [productTaxIndex, defaultTax] = await Promise.all([
    loadProductTaxPercentIndex(db, productIds),
    resolveDefaultSalesTaxPercent(db),
  ]);

  const rules = buildOfficialSalesMarginRulesResult(marginRulesOrders, {
    taxMode: "deductFromGross",
    taxContext: {
      productTaxIndex,
      defaultTaxPercent: defaultTax.percent,
      defaultTaxLabel: defaultTax.label,
    },
    year: filters.year,
    month: filters.month,
    referenceDate,
    filters: {
      year: filters.year,
      month: filters.month ?? null,
      customerId: filters.customerId ?? null,
      productId: filters.productId ?? null,
      sellerId: filters.sellerId ?? null,
      companyId: filters.companyId ?? null,
    },
  });

  const marginPayload = buildOfficialSalesOrderResultMarginPayload({
    rules,
    salesBundle,
    filters,
  });

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
    totals: marginPayload.totals,
    monthlyMargin: marginPayload.monthlyMargin,
    realizedVsProjected,
    projection,
    warnings: marginPayload.warnings,
    source: marginPayload.source,
  };
}
