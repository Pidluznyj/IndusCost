/**
 * Indicadores consolidados de margem de Pedidos de Venda.
 * Fluxo: buscar pedidos filtrados → margem em lote → agrupar em memória.
 *
 * Margem % consolidada: soma(margem R$) / soma(receita com custo no escopo).
 * Para volumes muito altos, considerar materialização assíncrona (não implementada).
 */
import type { Prisma, PrismaClient } from "@prisma/client";
import { parseExecutiveDashboardYear } from "./executiveDashboardYear.js";
import { decimalToNumber } from "./executiveDashboardHelpers.js";
import {
  matchesSalesOrderMarginStatusFilter,
  type SalesOrderMarginStatusFilter,
} from "./salesOrderManagementMargin.js";
import {
  calculateSalesOrderMarginsForOrders,
  SALES_ORDER_ITEM_MARGIN_SELECT,
  type SalesOrderForMargin,
} from "./salesOrderMarginService.server.js";
import {
  isSalesOrderMarginConsolidationEligible,
  resolveSalesOrderMarginSummaryStatusMeta,
} from "./salesOrderMarginStatus.js";
import type {
  SalesOrderMarginItemResult,
  SalesOrderMarginStatus,
  SalesOrderMarginSummaryPayload,
} from "./salesOrderMarginTypes.js";
import {
  parseSalesOrderMonthParam,
  parseSalesOrderYearParam,
} from "./salesOrderPeriodFilter.js";
import {
  computeSalesOrderMarginCoverageFromItems,
  isSalesOrderMarginItemInSalesScope,
} from "./salesOrderMarginCoverage.js";
import {
  buildSalesOrderListWhere,
  buildSalesOrderListTotalsFromPrismaOrders,
} from "./salesOrdersListSummary.js";
import type {
  SalesOrderMarginIndicatorAlerts,
  SalesOrderMarginIndicatorCustomerRow,
  SalesOrderMarginIndicatorFilters,
  SalesOrderMarginIndicatorProductRow,
  SalesOrderMarginIndicatorSellerRow,
  SalesOrderMarginIndicatorSummary,
  SalesOrderMarginIndicatorsPayload,
} from "./salesOrderMarginIndicatorsTypes.js";

const LOW_MARGIN_PERCENT_THRESHOLD = 15;
const RANKING_LIMIT = 25;
const ALERT_LIMIT = 50;

const VALID_ITEM_MARGIN_STATUSES = new Set<SalesOrderMarginStatus>([
  "OK",
  "PARTIAL",
  "SEM_CUSTO",
  "SEM_PRODUTO_VINCULADO",
  "MARGEM_NEGATIVA",
  "REVISAR_DADOS",
]);

type MarginBucket = {
  netRevenue: number;
  marginRevenueCovered: number;
  totalCost: number;
  marginValue: number;
  orderIds: Set<string>;
  customerIds: Set<string>;
  itemsWithoutCost: number;
  itemsWithoutProduct: number;
  itemsWithNegativeMargin: number;
  itemCount: number;
};

type EnrichedItem = {
  orderId: string;
  orderCode: string;
  itemId: string;
  customerId: string | null;
  customerName: string;
  responsible: string | null;
  productId: string | null;
  productSku: string;
  productName: string;
  quantity: number;
  item: SalesOrderMarginItemResult;
};

function parseDateParam(value: unknown): Date | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const d = new Date(value.trim());
  return Number.isFinite(d.getTime()) ? d : undefined;
}

export function parseSalesOrderMarginIndicatorFilters(
  query: Record<string, unknown>,
  now = new Date()
): SalesOrderMarginIndicatorFilters {
  const yearFromParam = parseSalesOrderYearParam(query.year);
  const year = yearFromParam ?? parseExecutiveDashboardYear(query.year, now);
  const month = parseSalesOrderMonthParam(query.month) ?? undefined;
  const startDate = parseDateParam(query.startDate);
  const endDate = parseDateParam(query.endDate);

  const marginStatusRaw =
    typeof query.marginStatus === "string" ? query.marginStatus.trim() : "";
  const marginStatus = (
    [
      "",
      "OK",
      "PARTIAL",
      "SEM_CUSTO",
      "SEM_PRODUTO_VINCULADO",
      "MARGEM_NEGATIVA",
      "REVISAR_DADOS",
    ] as SalesOrderMarginStatusFilter[]
  ).includes(marginStatusRaw as SalesOrderMarginStatusFilter)
    ? (marginStatusRaw as SalesOrderMarginStatusFilter)
    : undefined;

  const itemStatusRaw =
    typeof query.itemMarginStatus === "string" ? query.itemMarginStatus.trim() : "";
  const itemMarginStatus = VALID_ITEM_MARGIN_STATUSES.has(itemStatusRaw as SalesOrderMarginStatus)
    ? (itemStatusRaw as SalesOrderMarginStatus)
    : undefined;

  return {
    year,
    month,
    startDate,
    endDate,
    customerId:
      typeof query.customerId === "string" && query.customerId.trim()
        ? query.customerId.trim()
        : undefined,
    responsible:
      typeof query.responsible === "string" && query.responsible.trim()
        ? query.responsible.trim()
        : typeof query.sellerName === "string" && query.sellerName.trim()
          ? query.sellerName.trim()
          : undefined,
    productId:
      typeof query.productId === "string" && query.productId.trim()
        ? query.productId.trim()
        : undefined,
    companyIssuer:
      typeof query.companyIssuer === "string" && query.companyIssuer.trim()
        ? query.companyIssuer.trim()
        : typeof query.company === "string" && query.company.trim()
          ? query.company.trim()
          : undefined,
    status:
      typeof query.status === "string" && query.status.trim() ? query.status.trim() : undefined,
    itemMarginStatus,
    marginStatus: marginStatus || undefined,
  };
}

export function buildSalesOrderMarginIndicatorWhere(
  filters: SalesOrderMarginIndicatorFilters
): Prisma.SalesOrderWhereInput {
  const listWhere = buildSalesOrderListWhere({
    year: filters.startDate ? null : filters.year,
    month: filters.month ?? null,
    startDate: filters.startDate ?? null,
    endDate: filters.endDate ?? null,
    status: filters.status,
    customerId: filters.customerId,
    seller: filters.responsible,
  });

  return {
    ...listWhere,
    ...(filters.companyIssuer
      ? { companyIssuer: { contains: filters.companyIssuer, mode: "insensitive" } }
      : {}),
    ...(filters.productId ? { items: { some: { productId: filters.productId } } } : {}),
  };
}

function customerDisplayName(customer?: {
  companyName?: string | null;
  tradeName?: string | null;
} | null): string {
  return (
    customer?.tradeName?.trim() ||
    customer?.companyName?.trim() ||
    "Cliente não informado"
  );
}

function weightedMetrics(
  bucket: Pick<MarginBucket, "netRevenue" | "totalCost" | "marginValue">,
  marginRevenueCovered: number
) {
  const marginPercent =
    marginRevenueCovered > 0 ? (bucket.marginValue / marginRevenueCovered) * 100 : null;
  const markup =
    bucket.totalCost > 0 && marginRevenueCovered > 0
      ? marginRevenueCovered / bucket.totalCost
      : null;
  return { marginPercent, markup };
}

function createBucket(): MarginBucket {
  return {
    netRevenue: 0,
    marginRevenueCovered: 0,
    totalCost: 0,
    marginValue: 0,
    orderIds: new Set(),
    customerIds: new Set(),
    itemsWithoutCost: 0,
    itemsWithoutProduct: 0,
    itemsWithNegativeMargin: 0,
    itemCount: 0,
  };
}

function addItemToBucket(bucket: MarginBucket, row: EnrichedItem) {
  const item = row.item;
  bucket.netRevenue += item.netRevenue;
  bucket.totalCost += item.totalCost ?? 0;
  bucket.marginValue += item.marginValue ?? 0;
  if (isSalesOrderMarginItemInSalesScope(item.status)) {
    if (
      isSalesOrderMarginConsolidationEligible(item.status) ||
      item.status === "MARGEM_NEGATIVA"
    ) {
      bucket.marginRevenueCovered += item.netRevenue;
    }
  }
  bucket.orderIds.add(row.orderId);
  if (row.customerId) bucket.customerIds.add(row.customerId);
  bucket.itemCount += 1;
  if (item.status === "SEM_CUSTO") bucket.itemsWithoutCost += 1;
  if (item.status === "SEM_PRODUTO_VINCULADO") bucket.itemsWithoutProduct += 1;
  if (item.status === "MARGEM_NEGATIVA") bucket.itemsWithNegativeMargin += 1;
}

function resolveBucketStatus(bucket: MarginBucket): SalesOrderMarginSummaryPayload["status"] {
  if (bucket.itemCount === 0) return "REVISAR_DADOS";
  if (bucket.itemsWithoutProduct > 0 && bucket.itemsWithoutCost === 0) return "SEM_PRODUTO_VINCULADO";
  if (bucket.itemsWithoutCost > 0 && bucket.itemsWithoutProduct === 0) return "SEM_CUSTO";
  if (bucket.itemsWithoutCost > 0 || bucket.itemsWithoutProduct > 0) return "PARTIAL";
  if (bucket.itemsWithNegativeMargin > 0) return "MARGEM_NEGATIVA";
  return "OK";
}

async function loadSalesOrderMarginIndicatorOrders(
  prisma: PrismaClient,
  filters: SalesOrderMarginIndicatorFilters
) {
  const where = buildSalesOrderMarginIndicatorWhere(filters);
  return prisma.salesOrder.findMany({
    where,
    select: {
      id: true,
      orderCode: true,
      issueDate: true,
      responsible: true,
      customerId: true,
      totalNetValue: true,
      totalItems: true,
      nomusRawResponse: true,
      Customer: { select: { companyName: true, tradeName: true } },
      items: { select: SALES_ORDER_ITEM_MARGIN_SELECT },
    },
  });
}

async function loadEnrichedMarginItems(
  prisma: PrismaClient,
  filters: SalesOrderMarginIndicatorFilters,
  orders?: Awaited<ReturnType<typeof loadSalesOrderMarginIndicatorOrders>>
): Promise<EnrichedItem[]> {
  const scopedOrders = orders ?? (await loadSalesOrderMarginIndicatorOrders(prisma, filters));

  if (scopedOrders.length === 0) return [];

  const marginByOrder = await calculateSalesOrderMarginsForOrders(
    prisma,
    scopedOrders as SalesOrderForMargin[]
  );

  const enriched: EnrichedItem[] = [];

  for (const order of scopedOrders) {
    const marginResult = marginByOrder.get(order.id);
    if (!marginResult) continue;

    if (
      filters.marginStatus &&
      !matchesSalesOrderMarginStatusFilter(marginResult.marginSummary, filters.marginStatus)
    ) {
      continue;
    }

    const customerName = customerDisplayName(order.Customer);
    const itemResultsById = new Map(
      marginResult.itemResults
        .filter((r) => r.salesOrderItemId)
        .map((r) => [r.salesOrderItemId!, r])
    );

    for (const dbItem of order.items) {
      if (filters.productId && dbItem.productId !== filters.productId) continue;

      const itemResult = itemResultsById.get(dbItem.id);
      if (!itemResult) continue;

      if (filters.itemMarginStatus && itemResult.status !== filters.itemMarginStatus) {
        continue;
      }

      enriched.push({
        orderId: order.id,
        orderCode: order.orderCode,
        itemId: dbItem.id,
        customerId: order.customerId,
        customerName,
        responsible: order.responsible,
        productId: dbItem.productId,
        productSku: dbItem.skuSnapshot?.trim() || "—",
        productName: dbItem.productNameSnapshot?.trim() || "Produto não informado",
        quantity: decimalToNumber(dbItem.quantity) ?? 0,
        item: itemResult,
      });
    }
  }

  return enriched;
}

export function buildSalesOrderMarginPeriodSummary(
  items: EnrichedItem[]
): SalesOrderMarginIndicatorSummary {
  const bucket = createBucket();
  for (const row of items) addItemToBucket(bucket, row);
  const coverage = computeSalesOrderMarginCoverageFromItems(items.map((row) => row.item));
  const { marginPercent, markup } = weightedMetrics(bucket, coverage.marginRevenueCovered);
  return {
    netRevenue: bucket.netRevenue,
    totalCost: bucket.totalCost,
    marginValue: bucket.marginValue,
    marginPercent,
    markup,
    ordersCount: bucket.orderIds.size,
    itemsCount: bucket.itemCount,
    itemsWithoutCost: bucket.itemsWithoutCost,
    itemsWithoutProduct: bucket.itemsWithoutProduct,
    itemsWithNegativeMargin: bucket.itemsWithNegativeMargin,
    totalSoldAmount: 0,
    filteredTotalItems: 0,
    filteredAverageTicket: 0,
    ...coverage,
  };
}

export function buildSalesOrderMarginByCustomer(
  items: EnrichedItem[]
): SalesOrderMarginIndicatorCustomerRow[] {
  const map = new Map<string, MarginBucket & { customerId: string | null; customerName: string }>();

  for (const row of items) {
    const key = row.customerId ?? `name:${row.customerName}`;
    const bucket =
      map.get(key) ??
      Object.assign(createBucket(), {
        customerId: row.customerId,
        customerName: row.customerName,
      });
    addItemToBucket(bucket, row);
    map.set(key, bucket);
  }

  return [...map.values()]
    .map((bucket) => {
      const status = resolveBucketStatus(bucket);
      const meta = resolveSalesOrderMarginSummaryStatusMeta(status);
      const { marginPercent } = weightedMetrics(bucket, bucket.marginRevenueCovered);
      return {
        customerId: bucket.customerId,
        customerName: bucket.customerName,
        netRevenue: bucket.netRevenue,
        totalCost: bucket.totalCost,
        marginValue: bucket.marginValue,
        marginPercent,
        ordersCount: bucket.orderIds.size,
        itemsWithoutCost: bucket.itemsWithoutCost,
        status,
        statusLabel: meta.statusLabel,
      };
    })
    .sort((a, b) => b.netRevenue - a.netRevenue)
    .slice(0, RANKING_LIMIT);
}

export function buildSalesOrderMarginBySeller(
  items: EnrichedItem[]
): SalesOrderMarginIndicatorSellerRow[] {
  const map = new Map<string, MarginBucket & { sellerName: string }>();

  for (const row of items) {
    const sellerName = row.responsible?.trim() || "Não informado";
    const bucket =
      map.get(sellerName) ?? Object.assign(createBucket(), { sellerName });
    addItemToBucket(bucket, row);
    map.set(sellerName, bucket);
  }

  return [...map.values()]
    .map((bucket) => {
      const { marginPercent } = weightedMetrics(bucket, bucket.marginRevenueCovered);
      return {
        sellerName: bucket.sellerName,
        netRevenue: bucket.netRevenue,
        totalCost: bucket.totalCost,
        marginValue: bucket.marginValue,
        marginPercent,
        ordersCount: bucket.orderIds.size,
        customersCount: bucket.customerIds.size,
        itemsWithoutCost: bucket.itemsWithoutCost,
      };
    })
    .sort((a, b) => b.netRevenue - a.netRevenue)
    .slice(0, RANKING_LIMIT);
}

export function buildSalesOrderMarginByProduct(
  items: EnrichedItem[]
): SalesOrderMarginIndicatorProductRow[] {
  const map = new Map<
    string,
    MarginBucket & {
      productKey: string;
      productId: string | null;
      productName: string;
      sku: string;
      quantitySold: number;
    }
  >();

  for (const row of items) {
    const productKey = row.productId ?? `sku:${row.productSku}`;
    const bucket =
      map.get(productKey) ??
      Object.assign(createBucket(), {
        productKey,
        productId: row.productId,
        productName: row.productName,
        sku: row.productSku,
        quantitySold: 0,
      });
    addItemToBucket(bucket, row);
    bucket.quantitySold += row.quantity;
    map.set(productKey, bucket);
  }

  return [...map.values()]
    .map((bucket) => {
      const status = resolveBucketStatus(bucket);
      const meta = resolveSalesOrderMarginSummaryStatusMeta(status);
      const { marginPercent } = weightedMetrics(bucket, bucket.marginRevenueCovered);
      return {
        productKey: bucket.productKey,
        productId: bucket.productId,
        productName: bucket.productName,
        sku: bucket.sku,
        quantitySold: bucket.quantitySold,
        netRevenue: bucket.netRevenue,
        totalCost: bucket.totalCost,
        marginValue: bucket.marginValue,
        marginPercent,
        ordersCount: bucket.orderIds.size,
        customersCount: bucket.customerIds.size,
        status,
        statusLabel: meta.statusLabel,
      };
    })
    .sort((a, b) => b.netRevenue - a.netRevenue)
    .slice(0, RANKING_LIMIT);
}

function toAlertItem(row: EnrichedItem): SalesOrderMarginIndicatorAlerts["negativeMarginItems"][number] {
  return {
    orderId: row.orderId,
    orderCode: row.orderCode,
    itemId: row.itemId,
    customerName: row.customerName,
    sellerName: row.responsible,
    productName: row.productName,
    sku: row.productSku,
    netRevenue: row.item.netRevenue,
    marginValue: row.item.marginValue,
    marginPercent: row.item.marginPercent,
    status: row.item.status,
    statusLabel: row.item.statusLabel,
  };
}

export function buildSalesOrderMarginAlerts(items: EnrichedItem[]): SalesOrderMarginIndicatorAlerts {
  const negativeMarginItems = items
    .filter((r) => r.item.status === "MARGEM_NEGATIVA")
    .sort((a, b) => (a.item.marginValue ?? 0) - (b.item.marginValue ?? 0))
    .slice(0, ALERT_LIMIT)
    .map(toAlertItem);

  const missingCostItems = items
    .filter((r) => r.item.status === "SEM_CUSTO")
    .slice(0, ALERT_LIMIT)
    .map(toAlertItem);

  const missingProductItems = items
    .filter((r) => r.item.status === "SEM_PRODUTO_VINCULADO")
    .slice(0, ALERT_LIMIT)
    .map(toAlertItem);

  const customerBuckets = buildSalesOrderMarginByCustomer(items);
  const productBuckets = buildSalesOrderMarginByProduct(items);

  const lowMarginCustomers = customerBuckets
    .filter(
      (row) =>
        row.netRevenue > 0 &&
        row.marginPercent != null &&
        row.marginPercent < LOW_MARGIN_PERCENT_THRESHOLD
    )
    .map((row) => ({
      key: row.customerId ?? row.customerName,
      name: row.customerName,
      netRevenue: row.netRevenue,
      marginPercent: row.marginPercent,
      marginValue: row.marginValue,
    }))
    .slice(0, 10);

  const lowMarginProducts = productBuckets
    .filter(
      (row) =>
        row.netRevenue > 0 &&
        row.marginPercent != null &&
        row.marginPercent < LOW_MARGIN_PERCENT_THRESHOLD
    )
    .map((row) => ({
      key: row.productKey,
      name: row.productName,
      netRevenue: row.netRevenue,
      marginPercent: row.marginPercent,
      marginValue: row.marginValue,
    }))
    .slice(0, 10);

  return {
    negativeMarginItems,
    missingCostItems,
    missingProductItems,
    lowMarginCustomers,
    lowMarginProducts,
  };
}

export async function buildSalesOrderMarginIndicatorsPayload(
  prisma: PrismaClient,
  filters: SalesOrderMarginIndicatorFilters
): Promise<SalesOrderMarginIndicatorsPayload> {
  const orders = await loadSalesOrderMarginIndicatorOrders(prisma, filters);
  const listTotals = buildSalesOrderListTotalsFromPrismaOrders(
    orders.map((order) => ({
      totalNetValue: order.totalNetValue,
      totalItems: order.totalItems,
    }))
  );
  const items = await loadEnrichedMarginItems(prisma, filters, orders);
  const summary = {
    ...buildSalesOrderMarginPeriodSummary(items),
    totalSoldAmount: listTotals.totalNetAmount,
    ordersCount: listTotals.totalOrders,
    filteredTotalItems: listTotals.totalItems,
    filteredAverageTicket: listTotals.averageTicket,
  };

  return {
    filters: {
      year: filters.year,
      month: filters.month,
      startDate: filters.startDate?.toISOString(),
      endDate: filters.endDate?.toISOString(),
      customerId: filters.customerId,
      responsible: filters.responsible,
      productId: filters.productId,
      companyIssuer: filters.companyIssuer,
      status: filters.status,
      itemMarginStatus: filters.itemMarginStatus,
      marginStatus: filters.marginStatus,
    },
    scopeNote: (() => {
      if (summary.costCoverageStatus === "FULL") {
        return "Margem do período — indicadores consolidados com % ponderada sobre receita com custo.";
      }
      if (summary.costCoverageStatus === "PARTIAL") {
        return `Margem parcial — calculada sobre ${summary.marginCoveragePercent ?? 0}% da receita dos itens (${summary.itemsWithoutCost} linha(s) sem custo). Valor vendido total usa Σ SalesOrder.totalNetValue.`;
      }
      return "Margem indisponível — nenhuma linha com custo no filtro. Valor vendido total usa Σ SalesOrder.totalNetValue.";
    })(),
    summary,
    byCustomer: buildSalesOrderMarginByCustomer(items),
    bySeller: buildSalesOrderMarginBySeller(items),
    byProduct: buildSalesOrderMarginByProduct(items),
    alerts: buildSalesOrderMarginAlerts(items),
  };
}
