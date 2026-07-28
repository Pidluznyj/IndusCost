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
import { buildSalesOrderMarginCommercialReference } from "./salesOrderMarginOfficialPrice.js";
import {
  loadOfficialPriceTableItemsForPairs,
  loadSalesOrderMarginPriceTableContext,
  officialPriceLookupKey,
} from "./salesOrderMarginPriceResolver.server.js";
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
  proposalItemId: true,
  externalProductId: true,
  skuSnapshot: true,
  productNameSnapshot: true,
  quantity: true,
  // canceledQuantity NÃO existe em SalesOrderItem — vive no snapshot do fluxo.
  flowItemSnapshot: {
    select: {
      canceledQuantity: true,
      cutQuantity: true,
    },
  },
  negotiatedPrice: true,
  totalNetValue: true,
  unitCost: true,
  nomusIsCanceled: true,
  nomusIsStale: true,
  nomusIsCut: true,
  nomusItemStatusNormalized: true,
  nomusItemStatusRaw: true,
} as const;

/** Select para margem da página (poucas linhas) — pode incluir raw Nomus. */
export const SALES_ORDER_LIST_MARGIN_PRISMA_SELECT = {
  id: true,
  proposalId: true,
  issueDate: true,
  nomusRawResponse: true,
  items: { select: SALES_ORDER_ITEM_MARGIN_SELECT },
} as const;

/**
 * Select da margem geral (toda a população filtrada).
 * Sem `nomusRawResponse`: o card agregado usa flags persistidas nos itens.
 * Carregar o JSON Nomus de milhares de pedidos saturava o pool e travava a grade.
 */
export const SALES_ORDER_LIST_MARGIN_SUMMARY_PRISMA_SELECT = {
  id: true,
  proposalId: true,
  issueDate: true,
  items: { select: SALES_ORDER_ITEM_MARGIN_SELECT },
} as const;

export type SalesOrderItemForMargin = {
  id: string;
  salesOrderId?: string;
  productId?: string | null;
  proposalItemId?: string | null;
  externalProductId?: number | null;
  skuSnapshot?: string | null;
  productNameSnapshot?: string | null;
  quantity: unknown;
  /** @deprecated use flowItemSnapshot.canceledQuantity — campo não existe em SalesOrderItem. */
  canceledQuantity?: unknown | null;
  flowItemSnapshot?: {
    canceledQuantity?: unknown | null;
    cutQuantity?: unknown | null;
  } | null;
  negotiatedPrice?: unknown;
  totalNetValue?: unknown;
  unitCost?: unknown | null;
  nomusIsCanceled?: boolean | null;
  nomusIsStale?: boolean | null;
  nomusIsCut?: boolean | null;
  nomusItemStatusNormalized?: string | null;
  nomusItemStatusRaw?: string | null;
};

export type SalesOrderForMargin = {
  id: string;
  proposalId?: string | null;
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

  const persistedCanceled =
    item.nomusIsCanceled === true ||
    item.nomusIsStale === true ||
    (item.nomusItemStatusNormalized ?? "").toUpperCase() === "CANCELED" ||
    (item.nomusItemStatusNormalized ?? "").toUpperCase() === "CANCELADO";
  const persistedCut =
    item.nomusIsCut === true ||
    (item.nomusItemStatusNormalized ?? "").toUpperCase() === "FULFILLED_WITH_CUT";
  // Item cortado é encerrado — não gera margem ativa nem NO_MARGIN.
  const isCanceled = persistedCanceled || persistedCut || nomusStatus === "cancelled";

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
    itemStatus: isCanceled
      ? "CANCELADO"
      : item.nomusItemStatusNormalized ?? matched?.status ?? null,
    isCanceled,
    nomusRawItem: matched?.raw ?? null,
    referenceDate: order.issueDate ?? null,
  };
}

function formatItemMarginPayload(
  result: SalesOrderMarginItemResult,
  productResolution: ProductResolution,
  commercialReference?: import("./salesOrderMarginTypes.js").SalesOrderMarginCommercialReference | null
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
    commercialReference: commercialReference ?? null,
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

  const priceTableContext = await loadSalesOrderMarginPriceTableContext(
    prisma,
    orders.map((order) => ({
      id: order.id,
      proposalId: order.proposalId,
      items: (order.items ?? itemsByOrderId.get(order.id) ?? []).map((item) => ({
        id: item.id,
        proposalItemId: item.proposalItemId,
      })),
    }))
  );

  const officialPricePairs: Array<{ priceTableId: string; productId: string; referenceDate: Date }> =
    [];
  for (const order of orders) {
    if (!order.issueDate) continue;
    const ref =
      order.issueDate instanceof Date ? order.issueDate : new Date(order.issueDate);
    if (Number.isNaN(ref.getTime())) continue;
    const items = order.items ?? itemsByOrderId.get(order.id) ?? [];
    for (const item of items) {
      const productId = item.productId;
      if (!productId) continue;
      const priceTableId =
        priceTableContext.priceTableByItemId.get(item.id)?.priceTableId ??
        priceTableContext.priceTableByOrderId.get(order.id)?.priceTableId ??
        null;
      if (!priceTableId) continue;
      officialPricePairs.push({ priceTableId, productId, referenceDate: ref });
    }
  }

  const officialPricesByKey = await loadOfficialPriceTableItemsForPairs(
    prisma,
    officialPricePairs
  );

  const productTypesById = new Map<string, string>();
  for (const product of productIndex.byId.values()) {
    const row = product as { id: string; type?: string };
    if (row.type) productTypesById.set(row.id, row.type);
  }

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

    const order = orders.find((o) => o.id === orderId);
    const priceTableId =
      priceTableContext.priceTableByItemId.get(itemId)?.priceTableId ??
      (order ? priceTableContext.priceTableByOrderId.get(order.id)?.priceTableId : null) ??
      null;

    let officialPriceMeta: import("./salesOrderMarginTypes.js").SalesOrderMarginOfficialPriceMeta | null =
      null;
    let officialPriceItem: import("./salesOrderMarginOfficialPrice.js").OfficialPriceTableItemSnapshot | null =
      null;

    if (order?.issueDate && priceTableId && input.productId) {
      const ref =
        order.issueDate instanceof Date ? order.issueDate : new Date(order.issueDate);
      if (!Number.isNaN(ref.getTime())) {
        const priceKey = officialPriceLookupKey(priceTableId, input.productId, ref);
        const resolved = officialPricesByKey.get(priceKey);
        if (resolved) {
          officialPriceMeta = resolved.meta;
          officialPriceItem = resolved.item;
        } else {
          officialPriceMeta = {
            priceTableId,
            priceTableCode:
              priceTableContext.priceTableByItemId.get(itemId)?.priceTableCode ??
              priceTableContext.priceTableByOrderId.get(orderId)?.priceTableCode ??
              "",
            priceTableName: "",
            priceTableVersionId: "",
            versionNumber: 0,
            effectiveFrom: null,
            effectiveTo: null,
            priceTableItemId: "",
            orderIssueDate: ref.toISOString().slice(0, 10),
          };
        }
      }
    }

    const commercialReference = buildSalesOrderMarginCommercialReference({
      item: result,
      productionCost: result.productionCost ?? null,
      officialPrice: officialPriceMeta,
      officialPriceItem,
      productType: input.productId ? productTypesById.get(input.productId) ?? null : null,
    });

    const orderItemResults = itemResultsByOrder.get(orderId) ?? [];
    orderItemResults.push(result);
    itemResultsByOrder.set(orderId, orderItemResults);

    const orderItemMargins = itemMarginsByOrder.get(orderId) ?? new Map();
    orderItemMargins.set(
      itemId,
      formatItemMarginPayload(result, productResolution, commercialReference)
    );
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
  const marginByOrder = await calculateOfficialSalesOrderMarginsForOrders(
    prisma,
    orders,
    options
  );
  await mergeCommercialMarginsIntoOrderResults(prisma, orders, marginByOrder);
  return marginByOrder;
}

async function mergeCommercialMarginsIntoOrderResults(
  prisma: PrismaClient,
  orders: SalesOrderForMargin[],
  marginByOrder: Map<
    string,
    {
      marginSummary?: SalesOrderMarginSummaryPayload;
      itemMargins: Map<string, SalesOrderItemMarginPayload>;
    }
  >
): Promise<void> {
  try {
    const { calculateCommercialMarginsForSalesOrders } = await import(
      "./salesOrderCommercialMargin.server.js"
    );
    const commercialByOrder = await calculateCommercialMarginsForSalesOrders(
      prisma,
      orders.map((order) => ({
        id: order.id,
        issueDate: order.issueDate,
        items: order.items,
      }))
    );

    for (const order of orders) {
      const result = marginByOrder.get(order.id);
      const commercial = commercialByOrder.get(order.id);
      if (!result || !commercial) continue;
      result.marginSummary = {
        ...(result.marginSummary as SalesOrderMarginSummaryPayload),
        commercialMargin: commercial.summary,
      };
      for (const [itemId, payload] of result.itemMargins) {
        result.itemMargins.set(itemId, {
          ...payload,
          commercialMargin: commercial.byItemId.get(itemId) ?? null,
        });
      }
    }
  } catch (err) {
    // Não derruba a margem gerencial se a formação comercial não puder ser resolvida
    // (ex.: mocks de teste sem priceTable / ambiente sem tabelas comerciais).
    console.warn(
      "[salesOrderMarginService] falha ao calcular margem comercial; gerencial preservada.",
      err
    );
  }
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

  const marginByOrder = await calculateSalesOrderMarginsForOrders(prisma, orders);
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
  const marginByOrder = await calculateSalesOrderMarginsForOrders(prisma, [order], {
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

