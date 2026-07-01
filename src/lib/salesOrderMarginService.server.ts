/**
 * Serviço server-only: anexa margem calculada aos payloads internos de Pedidos de Venda.
 */
import type { PrismaClient } from "@prisma/client";
import {
  calculateSalesOrderItemMargin,
  calculateSalesOrderMarginSummary,
} from "./salesOrderMarginMath.js";
import {
  type ProductResolution,
  resolveSalesOrderItemProducts,
  type SalesOrderMarginResolverItem,
} from "./salesOrderMarginResolver.js";
import {
  buildSalesOrderMarginInputsFromVersionedProductionCosts,
  loadSalesOrderMarginProductBatchIndex,
} from "./salesOrderMarginResolver.server.js";
import {
  refineSalesOrderMarginSummaryStatus,
  resolveSalesOrderMarginStatusMeta,
  resolveSalesOrderMarginSummaryStatusMeta,
} from "./salesOrderMarginStatus.js";
import { aggregateSalesOrderMarginSummaries } from "./salesOrderMarginDisplay.js";

export { aggregateSalesOrderMarginSummaries };
import type {
  SalesOrderItemMarginPayload,
  SalesOrderMarginItemResult,
  SalesOrderMarginSummaryPayload,
} from "./salesOrderMarginTypes.js";
import {
  extractNomusRawItems,
  matchRawItemToDbItem,
  resolveSalesOrderItemNomusStatus,
} from "./salesOrderNomusRaw.js";

export const SALES_ORDER_ITEM_MARGIN_SELECT = {
  id: true,
  salesOrderId: true,
  productId: true,
  externalProductId: true,
  skuSnapshot: true,
  productNameSnapshot: true,
  quantity: true,
  negotiatedPrice: true,
  totalNetValue: true,
  unitCost: true,
} as const;

/** Select mínimo para margem agregada da listagem (todos os pedidos filtrados). */
export const SALES_ORDER_LIST_MARGIN_PRISMA_SELECT = {
  id: true,
  issueDate: true,
  nomusRawResponse: true,
  items: { select: SALES_ORDER_ITEM_MARGIN_SELECT },
} as const;

export type SalesOrderItemForMargin = {
  id: string;
  salesOrderId?: string;
  productId?: string | null;
  externalProductId?: number | null;
  skuSnapshot?: string | null;
  productNameSnapshot?: string | null;
  quantity: unknown;
  negotiatedPrice?: unknown;
  totalNetValue?: unknown;
  unitCost?: unknown | null;
};

export type SalesOrderForMargin = {
  id: string;
  issueDate?: Date | string | null;
  nomusRawResponse?: unknown;
  items?: SalesOrderItemForMargin[];
};

export type SalesOrderMarginOrderResult = {
  marginSummary: SalesOrderMarginSummaryPayload;
  itemMargins: Map<string, SalesOrderItemMarginPayload>;
  itemResults: SalesOrderMarginItemResult[];
};

export type SalesOrderMarginContext = {
  byOrderId: Map<string, SalesOrderMarginOrderResult>;
  costAnalysisCalls: number;
};

function mapItemToResolverInput(
  item: SalesOrderItemForMargin,
  order: SalesOrderForMargin,
  itemIndex: number,
  totalItems: number
): SalesOrderMarginResolverItem {
  const dbItem = {
    externalProductId: item.externalProductId,
    skuSnapshot: item.skuSnapshot,
    productNameSnapshot: item.productNameSnapshot,
  };
  const matchOptions = { itemIndex, totalDbItems: totalItems };
  const rawItems = extractNomusRawItems(order.nomusRawResponse);
  const matched = matchRawItemToDbItem(rawItems, dbItem, matchOptions);
  const nomusStatus = resolveSalesOrderItemNomusStatus(
    order.nomusRawResponse,
    dbItem,
    matchOptions
  );

  return {
    salesOrderItemId: item.id,
    productId: item.productId,
    externalProductId: item.externalProductId,
    skuSnapshot: item.skuSnapshot,
    productNameSnapshot: item.productNameSnapshot,
    quantity: item.quantity,
    negotiatedPrice: item.negotiatedPrice,
    totalNetValue: item.totalNetValue,
    unitCost: item.unitCost,
    itemStatus: nomusStatus === "cancelled" ? "CANCELADO" : matched?.status ?? null,
    isCanceled: nomusStatus === "cancelled",
    nomusRawItem: matched?.raw ?? null,
    referenceDate: order.issueDate ?? null,
  };
}

function formatItemMarginPayload(
  result: SalesOrderMarginItemResult,
  productResolution: ProductResolution
): SalesOrderItemMarginPayload {
  const meta = resolveSalesOrderMarginStatusMeta(result.status);
  return {
    netRevenue: result.netRevenue,
    unitCost: result.unitCost,
    totalCost: result.totalCost,
    marginValue: result.marginValue,
    marginPercent: result.marginPercent,
    markup: result.markup,
    status: result.status,
    statusLabel: meta.statusLabel,
    statusSeverity: meta.statusSeverity,
    costSource: result.costSource,
    costConfidence: result.costConfidence,
    marginCostMode: result.marginCostMode,
    productionCost: result.productionCost ?? null,
    productResolutionSource: productResolution.resolutionSource,
    notes: [...productResolution.notes, ...result.notes],
  };
}

function formatSummaryPayload(
  summary: ReturnType<typeof calculateSalesOrderMarginSummary>,
  itemResults: SalesOrderMarginItemResult[]
): SalesOrderMarginSummaryPayload {
  const status = refineSalesOrderMarginSummaryStatus(summary, itemResults);
  const meta = resolveSalesOrderMarginSummaryStatusMeta(status);
  return {
    netRevenue: summary.netRevenue,
    totalCost: summary.totalCost,
    marginValue: summary.marginValue,
    marginPercent: summary.marginPercent,
    markup: summary.markup,
    itemsCount: summary.itemsCount,
    validItemsCount: summary.validItemsCount,
    ignoredItemsCount: summary.ignoredItemsCount,
    hasMissingCost: summary.hasMissingCost,
    hasMissingProduct: summary.hasMissingProduct,
    hasNegativeMargin: summary.hasNegativeMargin,
    hasInvalidRevenue: summary.hasInvalidRevenue,
    status,
    statusLabel: meta.statusLabel,
    statusSeverity: meta.statusSeverity,
    totalSalesRevenueInScope: summary.totalSalesRevenueInScope,
    marginRevenueCovered: summary.marginRevenueCovered,
    marginRevenueUncovered: summary.marginRevenueUncovered,
    marginCoveragePercent: summary.marginCoveragePercent,
    itemsTotal: summary.itemsTotal,
    itemsWithCost: summary.itemsWithCost,
    itemsWithoutCost: summary.itemsWithoutCost,
    costCoverageStatus: summary.costCoverageStatus,
  };
}

export async function loadSalesOrderItemsForMargin(
  prisma: PrismaClient,
  orderIds: string[]
): Promise<Map<string, SalesOrderItemForMargin[]>> {
  if (orderIds.length === 0) return new Map();

  const rows = await prisma.salesOrderItem.findMany({
    where: { salesOrderId: { in: orderIds } },
    select: SALES_ORDER_ITEM_MARGIN_SELECT,
    orderBy: { createdAt: "asc" },
  });

  const map = new Map<string, SalesOrderItemForMargin[]>();
  for (const row of rows) {
    const list = map.get(row.salesOrderId) ?? [];
    list.push(row);
    map.set(row.salesOrderId, list);
  }
  return map;
}

export async function buildSalesOrderMarginContext(
  prisma: PrismaClient,
  orders: SalesOrderForMargin[],
  options?: {
    itemsByOrderId?: Map<string, SalesOrderItemForMargin[]>;
    costCache?: Map<string, { analysis?: unknown; costLog?: { totalCiu: number; calculatedAt: string } | null }>;
    costPolicy?: import("./salesOrderMarginTypes.js").SalesOrderMarginCostPolicy;
  }
): Promise<SalesOrderMarginContext> {
  const itemsByOrderId =
    options?.itemsByOrderId ??
    (await loadSalesOrderItemsForMargin(
      prisma,
      orders.map((order) => order.id)
    ));

  const resolverItems: SalesOrderMarginResolverItem[] = [];
  const itemOrderMap = new Map<string, string>();

  for (const order of orders) {
    const items = order.items ?? itemsByOrderId.get(order.id) ?? [];
    items.forEach((item, index) => {
      resolverItems.push(mapItemToResolverInput(item, order, index, items.length));
      itemOrderMap.set(item.id, order.id);
    });
  }

  if (resolverItems.length === 0) {
    const byOrderId = new Map<string, SalesOrderMarginOrderResult>();
    for (const order of orders) {
      byOrderId.set(order.id, {
        marginSummary: formatSummaryPayload(
          calculateSalesOrderMarginSummary([]),
          []
        ),
        itemMargins: new Map(),
        itemResults: [],
      });
    }
    return { byOrderId, costAnalysisCalls: 0 };
  }

  const productIndex = await loadSalesOrderMarginProductBatchIndex(prisma, resolverItems);
  const productResolutions = resolveSalesOrderItemProducts(resolverItems, productIndex);

  const marginInputs = await buildSalesOrderMarginInputsFromVersionedProductionCosts(
    prisma,
    resolverItems,
    { productIndex }
  );

  const itemResultsByOrder = new Map<string, SalesOrderMarginItemResult[]>();
  const itemMarginsByOrder = new Map<string, Map<string, SalesOrderItemMarginPayload>>();

  for (const input of marginInputs) {
    const itemId = input.salesOrderItemId;
    if (!itemId) continue;
    const orderId = itemOrderMap.get(itemId);
    if (!orderId) continue;

    const result = calculateSalesOrderItemMargin(input);
    const productResolution =
      productResolutions.get(itemId) ??
      ({
        salesOrderItemId: itemId,
        productId: null,
        productSku: null,
        productName: null,
        resolutionSource: "NOT_FOUND",
        confidence: "MISSING",
        notes: [],
      } satisfies ProductResolution);

    const orderItemResults = itemResultsByOrder.get(orderId) ?? [];
    orderItemResults.push(result);
    itemResultsByOrder.set(orderId, orderItemResults);

    const orderItemMargins = itemMarginsByOrder.get(orderId) ?? new Map();
    orderItemMargins.set(itemId, formatItemMarginPayload(result, productResolution));
    itemMarginsByOrder.set(orderId, orderItemMargins);
  }

  const byOrderId = new Map<string, SalesOrderMarginOrderResult>();
  for (const order of orders) {
    const itemResults = itemResultsByOrder.get(order.id) ?? [];
    byOrderId.set(order.id, {
      marginSummary: formatSummaryPayload(
        calculateSalesOrderMarginSummary(itemResults),
        itemResults
      ),
      itemMargins: itemMarginsByOrder.get(order.id) ?? new Map(),
      itemResults,
    });
  }

  return { byOrderId, costAnalysisCalls: 0 };
}

export async function calculateSalesOrderMarginsForOrders(
  prisma: PrismaClient,
  orders: SalesOrderForMargin[],
  options?: Parameters<typeof buildSalesOrderMarginContext>[2]
): Promise<Map<string, SalesOrderMarginOrderResult>> {
  const { calculateOfficialSalesOrderMarginsForOrders } = await import(
    "./salesMarginRulesAdapter.js"
  );
  return calculateOfficialSalesOrderMarginsForOrders(prisma, orders, options);
}

export async function attachMarginsToSalesOrders<T extends SalesOrderForMargin>(
  prisma: PrismaClient,
  orders: T[]
): Promise<
  Array<
    T & {
      marginSummary?: SalesOrderMarginSummaryPayload;
      marginItems?: SalesOrderItemMarginPayload[];
    }
  >
> {
  if (orders.length === 0) return [];

  const { calculateOfficialSalesOrderMarginsForOrders } = await import(
    "./salesMarginRulesAdapter.js"
  );
  const marginByOrder = await calculateOfficialSalesOrderMarginsForOrders(prisma, orders);
  return orders.map((order) => {
    const result = marginByOrder.get(order.id);
    return {
      ...order,
      marginSummary: result?.marginSummary,
      marginItems: result ? Array.from(result.itemMargins.values()) : undefined,
    };
  });
}

export async function attachMarginToSalesOrderDetail<
  T extends SalesOrderForMargin & { items: SalesOrderItemForMargin[] },
>(prisma: PrismaClient, order: T): Promise<
  T & {
    marginSummary?: SalesOrderMarginSummaryPayload;
    items: Array<T["items"][number] & { margin?: SalesOrderItemMarginPayload }>;
  }
> {
  const { calculateOfficialSalesOrderMarginsForOrders } = await import(
    "./salesMarginRulesAdapter.js"
  );
  const marginByOrder = await calculateOfficialSalesOrderMarginsForOrders(prisma, [order], {
    itemsByOrderId: new Map([[order.id, order.items]]),
  });
  const result = marginByOrder.get(order.id);
  if (!result) {
    return { ...order, items: order.items.map((item) => ({ ...item })) };
  }

  return {
    ...order,
    marginSummary: result.marginSummary,
    items: order.items.map((item) => ({
      ...item,
      margin: result.itemMargins.get(item.id),
    })),
  };
}

/** Atalho para um único pedido com itens já carregados (testes / rotas). */
export async function buildSalesOrderMarginInputsForOrder(
  prisma: PrismaClient,
  order: SalesOrderForMargin & { items: SalesOrderItemForMargin[] }
) {
  const resolverItems = order.items.map((item, index) =>
    mapItemToResolverInput(item, order, index, order.items.length)
  );
  return buildSalesOrderMarginInputsFromVersionedProductionCosts(prisma, resolverItems);
}

