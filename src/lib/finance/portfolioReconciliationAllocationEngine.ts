/**
 * Motor puro de alocação itemizada Pedido × Documento de Estoque → drafts de PortfolioReconciliationFact.
 *
 * Camada paralela / auditoria — não altera Fluxo, AR, Faturamento, Comissões nem CommissionRecord.
 * Usa NomusStockDocument / Item como ponte itemizada (nunca assume cabeçalho inteiro da NF).
 */

export const PORTFOLIO_PRICE_TOLERANCE = 0.005;

export type PortfolioReconciliationMode = "preview" | "apply" | "manual";

export type PortfolioFactStatus =
  | "ORDER_ONLY"
  | "HEADER_ONLY_LINK"
  | "STOCK_DOCUMENT_ITEMIZED"
  | "ITEM_ALLOCATED"
  | "PARTIALLY_ALLOCATED"
  | "FULLY_ALLOCATED"
  | "OVER_LINKED_BY_HEADER"
  | "PRICE_MISMATCH"
  | "QUANTITY_SURPLUS_IN_NFE"
  | "RECEIVABLE_CONFIRMED"
  | "RECEIVED"
  | "DATA_QUALITY_ISSUE"
  | "AMBIGUOUS_ALLOCATION";

export type PortfolioForecastSource = "RECEIVABLE" | "NFE" | "ORDER" | "UNRESOLVED";
export type PortfolioConfidenceLevel = "HIGH" | "MEDIUM" | "LOW" | "BLOCKED";

export type SnapshotOrderItem = {
  id: string;
  externalSalesOrderItemId?: number | null;
  externalProductId: number | null;
  productSkuSnapshot?: string | null;
  productNameSnapshot?: string | null;
  quantity: number;
  unitPrice: number;
  totalNetValue?: number | null;
  itemStatus?: string | null;
  nomusIsCanceled?: boolean | null;
  nomusIsStale?: boolean | null;
};

export type SnapshotOrder = {
  id: string;
  externalSalesOrderId?: number | null;
  orderCode: string;
  issueDate?: Date | null;
  expectedDeliveryDate?: Date | null;
  customerId?: string | null;
  customerExternalId?: number | null;
  customerNameSnapshot?: string | null;
  totalNetValue?: number | null;
  items: SnapshotOrderItem[];
};

export type SnapshotNfeLink = {
  salesOrderId: string;
  nfeExternalId: number;
  nfeNumber?: string | null;
  nfeSerie?: string | null;
  nfeKey?: string | null;
  dataProcessamento?: Date | null;
};

export type SnapshotNfe = {
  id?: string | null;
  externalId: number;
  numero?: string | null;
  serie?: string | null;
  chave?: string | null;
  dataProcessamento?: Date | null;
  valorLiquido?: number | null;
};

export type SnapshotStockItem = {
  id: string;
  externalItemId?: number | null;
  externalProductId: number | null;
  quantity: number;
  unitValue: number;
  estimatedTotalValue?: number | null;
};

export type SnapshotStockDocument = {
  id: string;
  externalId: number;
  idNfe: number | null;
  dataDocumento?: Date | null;
  items: SnapshotStockItem[];
};

export type PortfolioReconciliationSnapshot = {
  orders: SnapshotOrder[];
  nfeLinks: SnapshotNfeLink[];
  nfes: SnapshotNfe[];
  stockDocuments: SnapshotStockDocument[];
};

export type BuildPortfolioReconciliationFactsInput = {
  runId: string;
  mode: PortfolioReconciliationMode;
  fromDate?: Date | null;
  toDate?: Date | null;
  customerExternalId?: number | null;
  orderCode?: string | null;
  snapshot: PortfolioReconciliationSnapshot;
};

export type PortfolioReconciliationFactDraft = {
  runId: string;
  customerId: string | null;
  customerExternalId: number | null;
  customerNameSnapshot: string | null;
  salesOrderId: string | null;
  externalSalesOrderId: number | null;
  orderCode: string | null;
  orderIssueDate: Date | null;
  expectedDeliveryDate: Date | null;
  salesOrderItemId: string | null;
  externalSalesOrderItemId: number | null;
  externalProductId: number | null;
  productSkuSnapshot: string | null;
  productNameSnapshot: string | null;
  orderQuantity: number | null;
  orderUnitPrice: number | null;
  orderItemValue: number | null;
  nomusNfeId: string | null;
  nfeExternalId: number | null;
  nfeNumber: string | null;
  nfeSerie: string | null;
  nfeKey: string | null;
  nfeProcessedAt: Date | null;
  nfeHeaderValue: number | null;
  stockDocumentId: string | null;
  stockDocumentExternalId: number | null;
  stockDocumentItemId: string | null;
  stockDocumentItemExternalId: number | null;
  stockDocumentDate: Date | null;
  stockQuantity: number | null;
  stockUnitValue: number | null;
  stockItemValue: number | null;
  allocatedQuantity: number | null;
  allocatedValueByOrderPrice: number | null;
  allocatedValueByStockPrice: number | null;
  remainingOrderQuantityAfterAllocation: number | null;
  remainingOrderValueAfterAllocation: number | null;
  priceDifferenceUnit: number | null;
  priceDifferenceTotal: number | null;
  receivableIdsJson: number[] | null;
  receivableTotalValue: number | null;
  receivedValue: number | null;
  openReceivableValue: number | null;
  dueDatesJson: Array<string | null> | null;
  settlementDatesJson: Array<string | null> | null;
  forecastSource: PortfolioForecastSource;
  forecastDate: Date | null;
  forecastValue: number | null;
  confidenceLevel: PortfolioConfidenceLevel;
  status: PortfolioFactStatus;
  alertsJson: string[];
  traceJson: Record<string, unknown>;
};

export type BuildPortfolioReconciliationFactsResult = {
  runId: string;
  mode: PortfolioReconciliationMode;
  facts: PortfolioReconciliationFactDraft[];
  summary: {
    ordersProcessed: number;
    factsGenerated: number;
    allocatedLines: number;
    surplusLines: number;
    headerOnlyLinks: number;
    orderOnlyLines: number;
    fullyAllocatedOrders: number;
    partiallyAllocatedOrders: number;
  };
};

type OrderItemBalance = {
  item: SnapshotOrderItem;
  remainingQty: number;
};

function round6(n: number): number {
  return Number(n.toFixed(6));
}

function money(qty: number, unit: number): number {
  return round6(qty * unit);
}

export function pricesMismatch(orderUnit: number, stockUnit: number): boolean {
  return Math.abs(orderUnit - stockUnit) > PORTFOLIO_PRICE_TOLERANCE;
}

function positiveOrderItems(items: SnapshotOrderItem[]): SnapshotOrderItem[] {
  return items.filter((item) => {
    if (item.nomusIsCanceled === true || item.nomusIsStale === true) return false;
    const status = (item.itemStatus ?? "").trim().toUpperCase();
    if (
      status === "CANCELADO" ||
      status === "CANCELED" ||
      status === "CANCELLED"
    ) {
      return false;
    }
    return (
      item.externalProductId != null &&
      Number.isFinite(item.quantity) &&
      item.quantity > 0 &&
      Number.isFinite(item.unitPrice)
    );
  });
}

function filterOrders(
  orders: SnapshotOrder[],
  input: BuildPortfolioReconciliationFactsInput
): SnapshotOrder[] {
  return orders.filter((order) => {
    if (input.orderCode && order.orderCode.trim() !== input.orderCode.trim()) return false;
    if (
      input.customerExternalId != null &&
      order.customerExternalId !== input.customerExternalId
    ) {
      return false;
    }
    if (input.fromDate && order.issueDate && order.issueDate < input.fromDate) return false;
    if (input.toDate && order.issueDate && order.issueDate > input.toDate) return false;
    return true;
  });
}

function baseFact(
  runId: string,
  order: SnapshotOrder,
  partial: Partial<PortfolioReconciliationFactDraft> & {
    status: PortfolioFactStatus;
    confidenceLevel: PortfolioConfidenceLevel;
    forecastSource: PortfolioForecastSource;
  }
): PortfolioReconciliationFactDraft {
  return {
    runId,
    customerId: order.customerId ?? null,
    customerExternalId: order.customerExternalId ?? null,
    customerNameSnapshot: order.customerNameSnapshot ?? null,
    salesOrderId: order.id,
    externalSalesOrderId: order.externalSalesOrderId ?? null,
    orderCode: order.orderCode,
    orderIssueDate: order.issueDate ?? null,
    expectedDeliveryDate: order.expectedDeliveryDate ?? null,
    salesOrderItemId: null,
    externalSalesOrderItemId: null,
    externalProductId: null,
    productSkuSnapshot: null,
    productNameSnapshot: null,
    orderQuantity: null,
    orderUnitPrice: null,
    orderItemValue: null,
    nomusNfeId: null,
    nfeExternalId: null,
    nfeNumber: null,
    nfeSerie: null,
    nfeKey: null,
    nfeProcessedAt: null,
    nfeHeaderValue: null,
    stockDocumentId: null,
    stockDocumentExternalId: null,
    stockDocumentItemId: null,
    stockDocumentItemExternalId: null,
    stockDocumentDate: null,
    stockQuantity: null,
    stockUnitValue: null,
    stockItemValue: null,
    allocatedQuantity: null,
    allocatedValueByOrderPrice: null,
    allocatedValueByStockPrice: null,
    remainingOrderQuantityAfterAllocation: null,
    remainingOrderValueAfterAllocation: null,
    priceDifferenceUnit: null,
    priceDifferenceTotal: null,
    receivableIdsJson: null,
    receivableTotalValue: null,
    receivedValue: null,
    openReceivableValue: null,
    dueDatesJson: null,
    settlementDatesJson: null,
    forecastDate: null,
    forecastValue: null,
    alertsJson: [],
    traceJson: {},
    ...partial,
  };
}

function nfeMeta(
  nfeByExternalId: Map<number, SnapshotNfe>,
  link: SnapshotNfeLink
): {
  nomusNfeId: string | null;
  nfeNumber: string | null;
  nfeSerie: string | null;
  nfeKey: string | null;
  nfeProcessedAt: Date | null;
  nfeHeaderValue: number | null;
} {
  const nfe = nfeByExternalId.get(link.nfeExternalId);
  return {
    nomusNfeId: nfe?.id ?? null,
    nfeNumber: link.nfeNumber ?? nfe?.numero ?? null,
    nfeSerie: link.nfeSerie ?? nfe?.serie ?? null,
    nfeKey: link.nfeKey ?? nfe?.chave ?? null,
    nfeProcessedAt: link.dataProcessamento ?? nfe?.dataProcessamento ?? null,
    nfeHeaderValue: nfe?.valorLiquido ?? null,
  };
}

function documentSortKey(doc: SnapshotStockDocument, link: SnapshotNfeLink): number {
  const d = doc.dataDocumento ?? link.dataProcessamento;
  return d ? d.getTime() : Number.MAX_SAFE_INTEGER;
}

function findBalancesForProduct(
  balances: OrderItemBalance[],
  externalProductId: number
): OrderItemBalance[] {
  return balances.filter(
    (b) => b.item.externalProductId === externalProductId && b.remainingQty > 0
  );
}

/**
 * Aloca quantidade de um item de estoque contra saldos do pedido (FIFO por linha).
 * Nunca aloca mais que o saldo restante. Bloqueia se houver ambiguidade (2+ linhas com saldo).
 */
export function allocateStockQuantityToOrderBalances(
  balances: OrderItemBalance[],
  externalProductId: number,
  stockQuantity: number
):
  | { ok: true; allocations: Array<{ balance: OrderItemBalance; qty: number }> }
  | { ok: false; reason: "AMBIGUOUS_ALLOCATION" | "NO_MATCH" } {
  const candidates = findBalancesForProduct(balances, externalProductId);
  if (candidates.length === 0) return { ok: false, reason: "NO_MATCH" };
  if (candidates.length > 1) return { ok: false, reason: "AMBIGUOUS_ALLOCATION" };

  const balance = candidates[0]!;
  const qty = Math.min(stockQuantity, balance.remainingQty);
  if (qty <= 0) return { ok: false, reason: "NO_MATCH" };
  return { ok: true, allocations: [{ balance, qty }] };
}

function orderItemFields(item: SnapshotOrderItem) {
  const orderItemValue =
    item.totalNetValue != null && Number.isFinite(item.totalNetValue)
      ? round6(item.totalNetValue)
      : money(item.quantity, item.unitPrice);
  return {
    salesOrderItemId: item.id,
    externalSalesOrderItemId: item.externalSalesOrderItemId ?? null,
    externalProductId: item.externalProductId,
    productSkuSnapshot: item.productSkuSnapshot ?? null,
    productNameSnapshot: item.productNameSnapshot ?? null,
    orderQuantity: item.quantity,
    orderUnitPrice: item.unitPrice,
    orderItemValue,
  };
}

/**
 * Constrói drafts de fato a partir de um snapshot já carregado.
 * preview/apply não persistem aqui — apenas geram linhas rastreáveis.
 */
export function buildPortfolioReconciliationFacts(
  input: BuildPortfolioReconciliationFactsInput
): BuildPortfolioReconciliationFactsResult {
  const orders = filterOrders(input.snapshot.orders, input);
  const nfeByExternalId = new Map(
    input.snapshot.nfes.map((nfe) => [nfe.externalId, nfe] as const)
  );
  const stockByNfeId = new Map<number, SnapshotStockDocument[]>();
  for (const doc of input.snapshot.stockDocuments) {
    if (doc.idNfe == null) continue;
    const list = stockByNfeId.get(doc.idNfe) ?? [];
    list.push(doc);
    stockByNfeId.set(doc.idNfe, list);
  }

  const facts: PortfolioReconciliationFactDraft[] = [];
  let allocatedLines = 0;
  let surplusLines = 0;
  let headerOnlyLinks = 0;
  let orderOnlyLines = 0;
  let fullyAllocatedOrders = 0;
  let partiallyAllocatedOrders = 0;

  for (const order of orders) {
    const items = positiveOrderItems(order.items);
    const balances: OrderItemBalance[] = items.map((item) => ({
      item,
      remainingQty: item.quantity,
    }));

    const links = input.snapshot.nfeLinks
      .filter((link) => link.salesOrderId === order.id)
      .slice()
      .sort((a, b) => {
        const docsA = stockByNfeId.get(a.nfeExternalId) ?? [];
        const docsB = stockByNfeId.get(b.nfeExternalId) ?? [];
        const keyA = docsA.length
          ? Math.min(...docsA.map((d) => documentSortKey(d, a)))
          : a.dataProcessamento?.getTime() ?? Number.MAX_SAFE_INTEGER;
        const keyB = docsB.length
          ? Math.min(...docsB.map((d) => documentSortKey(d, b)))
          : b.dataProcessamento?.getTime() ?? Number.MAX_SAFE_INTEGER;
        return keyA - keyB;
      });

    if (links.length === 0) {
      for (const item of items) {
        orderOnlyLines += 1;
        facts.push(
          baseFact(input.runId, order, {
            ...orderItemFields(item),
            allocatedQuantity: 0,
            remainingOrderQuantityAfterAllocation: item.quantity,
            remainingOrderValueAfterAllocation: money(item.quantity, item.unitPrice),
            forecastSource: "ORDER",
            forecastDate: order.expectedDeliveryDate ?? order.issueDate ?? null,
            forecastValue: orderItemFields(item).orderItemValue,
            confidenceLevel: "LOW",
            status: "ORDER_ONLY",
            alertsJson: ["Pedido sem NF vinculada"],
            traceJson: { rule: "ORDER_ONLY", mode: input.mode },
          })
        );
      }
      continue;
    }

    const headerValues: number[] = [];

    for (const link of links) {
      const meta = nfeMeta(nfeByExternalId, link);
      if (meta.nfeHeaderValue != null) headerValues.push(meta.nfeHeaderValue);

      const docs = (stockByNfeId.get(link.nfeExternalId) ?? [])
        .slice()
        .sort((a, b) => documentSortKey(a, link) - documentSortKey(b, link));

      if (docs.length === 0) {
        headerOnlyLinks += 1;
        facts.push(
          baseFact(input.runId, order, {
            ...meta,
            nfeExternalId: link.nfeExternalId,
            forecastSource: "NFE",
            forecastDate: meta.nfeProcessedAt,
            forecastValue: null,
            confidenceLevel: "LOW",
            status: "HEADER_ONLY_LINK",
            alertsJson: ["NF vinculada só por cabeçalho (sem documento de estoque)"],
            traceJson: {
              rule: "HEADER_ONLY_LINK",
              nfeExternalId: link.nfeExternalId,
              note: "Cabeçalho não implica pertencimento integral ao pedido",
            },
          })
        );
        continue;
      }

      for (const doc of docs) {
        if (doc.items.length === 0) {
          facts.push(
            baseFact(input.runId, order, {
              ...meta,
              nfeExternalId: link.nfeExternalId,
              stockDocumentId: doc.id,
              stockDocumentExternalId: doc.externalId,
              stockDocumentDate: doc.dataDocumento ?? null,
              forecastSource: "NFE",
              forecastDate: doc.dataDocumento ?? meta.nfeProcessedAt,
              forecastValue: null,
              confidenceLevel: "BLOCKED",
              status: "DATA_QUALITY_ISSUE",
              alertsJson: ["Documento de estoque sem itens"],
              traceJson: { rule: "EMPTY_STOCK_DOCUMENT", stockDocumentExternalId: doc.externalId },
            })
          );
          continue;
        }

        for (const stockItem of doc.items) {
          const stockQty = stockItem.quantity;
          const stockUnit = stockItem.unitValue;
          const stockItemValue =
            stockItem.estimatedTotalValue != null
              ? round6(stockItem.estimatedTotalValue)
              : money(stockQty, stockUnit);

          if (stockItem.externalProductId == null) {
            facts.push(
              baseFact(input.runId, order, {
                ...meta,
                nfeExternalId: link.nfeExternalId,
                stockDocumentId: doc.id,
                stockDocumentExternalId: doc.externalId,
                stockDocumentItemId: stockItem.id,
                stockDocumentItemExternalId: stockItem.externalItemId ?? null,
                stockDocumentDate: doc.dataDocumento ?? null,
                stockQuantity: stockQty,
                stockUnitValue: stockUnit,
                stockItemValue,
                allocatedQuantity: 0,
                forecastSource: "UNRESOLVED",
                confidenceLevel: "BLOCKED",
                status: "DATA_QUALITY_ISSUE",
                alertsJson: ["Item de documento sem idProduto"],
                traceJson: { rule: "STOCK_ITEM_MISSING_PRODUCT" },
              })
            );
            continue;
          }

          const productId = stockItem.externalProductId;
          const withRemaining = findBalancesForProduct(balances, productId);
          const anyOrderLine = balances.some((b) => b.item.externalProductId === productId);

          if (!anyOrderLine) {
            facts.push(
              baseFact(input.runId, order, {
                ...meta,
                nfeExternalId: link.nfeExternalId,
                stockDocumentId: doc.id,
                stockDocumentExternalId: doc.externalId,
                stockDocumentItemId: stockItem.id,
                stockDocumentItemExternalId: stockItem.externalItemId ?? null,
                stockDocumentDate: doc.dataDocumento ?? null,
                externalProductId: productId,
                stockQuantity: stockQty,
                stockUnitValue: stockUnit,
                stockItemValue,
                allocatedQuantity: 0,
                forecastSource: "UNRESOLVED",
                confidenceLevel: "LOW",
                status: "DATA_QUALITY_ISSUE",
                alertsJson: ["Item de documento sem item de pedido correspondente"],
                traceJson: {
                  rule: "STOCK_PRODUCT_NOT_IN_ORDER",
                  externalProductId: productId,
                  stockQuantity: stockQty,
                },
              })
            );
            continue;
          }

          if (withRemaining.length === 0) {
            surplusLines += 1;
            facts.push(
              baseFact(input.runId, order, {
                ...meta,
                nfeExternalId: link.nfeExternalId,
                stockDocumentId: doc.id,
                stockDocumentExternalId: doc.externalId,
                stockDocumentItemId: stockItem.id,
                stockDocumentItemExternalId: stockItem.externalItemId ?? null,
                stockDocumentDate: doc.dataDocumento ?? null,
                externalProductId: productId,
                stockQuantity: stockQty,
                stockUnitValue: stockUnit,
                stockItemValue,
                allocatedQuantity: 0,
                remainingOrderQuantityAfterAllocation: 0,
                remainingOrderValueAfterAllocation: 0,
                forecastSource: "UNRESOLVED",
                confidenceLevel: "MEDIUM",
                status: "QUANTITY_SURPLUS_IN_NFE",
                alertsJson: [
                  "Produto repetido em NF/documento após saldo do pedido já atendido",
                  "Quantidade de documento não alocada ao pedido",
                ],
                traceJson: {
                  rule: "NO_REMAINING_ORDER_BALANCE",
                  externalProductId: productId,
                  stockQuantity: stockQty,
                  nfeExternalId: link.nfeExternalId,
                },
              })
            );
            continue;
          }

          const allocation = allocateStockQuantityToOrderBalances(
            balances,
            productId,
            stockQty
          );

          if (!allocation.ok) {
            if (allocation.reason === "AMBIGUOUS_ALLOCATION") {
              facts.push(
                baseFact(input.runId, order, {
                  ...meta,
                  nfeExternalId: link.nfeExternalId,
                  stockDocumentId: doc.id,
                  stockDocumentExternalId: doc.externalId,
                  stockDocumentItemId: stockItem.id,
                  stockDocumentItemExternalId: stockItem.externalItemId ?? null,
                  stockDocumentDate: doc.dataDocumento ?? null,
                  externalProductId: productId,
                  stockQuantity: stockQty,
                  stockUnitValue: stockUnit,
                  stockItemValue,
                  allocatedQuantity: 0,
                  forecastSource: "UNRESOLVED",
                  confidenceLevel: "BLOCKED",
                  status: "AMBIGUOUS_ALLOCATION",
                  alertsJson: [
                    "Alocação ambígua: múltiplas linhas de pedido com o mesmo produto e saldo",
                  ],
                  traceJson: {
                    rule: "AMBIGUOUS_ALLOCATION",
                    externalProductId: productId,
                    candidateItemIds: withRemaining.map((b) => b.item.id),
                  },
                })
              );
            }
            continue;
          }

          for (const { balance, qty } of allocation.allocations) {
            balance.remainingQty = round6(balance.remainingQty - qty);
            const mismatch = pricesMismatch(balance.item.unitPrice, stockUnit);
            const status: PortfolioFactStatus = mismatch ? "PRICE_MISMATCH" : "ITEM_ALLOCATED";
            const alerts: string[] = [];
            if (mismatch) {
              alerts.push("Preço unitário do documento diferente do pedido");
            }
            allocatedLines += 1;
            facts.push(
              baseFact(input.runId, order, {
                ...meta,
                ...orderItemFields(balance.item),
                nfeExternalId: link.nfeExternalId,
                stockDocumentId: doc.id,
                stockDocumentExternalId: doc.externalId,
                stockDocumentItemId: stockItem.id,
                stockDocumentItemExternalId: stockItem.externalItemId ?? null,
                stockDocumentDate: doc.dataDocumento ?? null,
                stockQuantity: stockQty,
                stockUnitValue: stockUnit,
                stockItemValue,
                allocatedQuantity: qty,
                allocatedValueByOrderPrice: money(qty, balance.item.unitPrice),
                allocatedValueByStockPrice: money(qty, stockUnit),
                remainingOrderQuantityAfterAllocation: balance.remainingQty,
                remainingOrderValueAfterAllocation: money(
                  balance.remainingQty,
                  balance.item.unitPrice
                ),
                priceDifferenceUnit: round6(stockUnit - balance.item.unitPrice),
                priceDifferenceTotal: round6(
                  money(qty, stockUnit) - money(qty, balance.item.unitPrice)
                ),
                forecastSource: "NFE",
                forecastDate: doc.dataDocumento ?? meta.nfeProcessedAt,
                forecastValue: money(qty, balance.item.unitPrice),
                confidenceLevel: mismatch ? "MEDIUM" : "HIGH",
                status,
                alertsJson: alerts,
                traceJson: {
                  rule: "ITEM_QTY_ALLOCATION",
                  mode: input.mode,
                  allocatedQuantity: qty,
                  stockQuantity: stockQty,
                  neverAssumesFullNfeHeader: true,
                },
              })
            );
          }

          const allocatedTotal = allocation.allocations.reduce((s, a) => s + a.qty, 0);
          const surplusQty = round6(stockQty - allocatedTotal);
          if (surplusQty > 0) {
            surplusLines += 1;
            const matchedItem = allocation.allocations[0]!.balance.item;
            facts.push(
              baseFact(input.runId, order, {
                ...meta,
                ...orderItemFields(matchedItem),
                nfeExternalId: link.nfeExternalId,
                stockDocumentId: doc.id,
                stockDocumentExternalId: doc.externalId,
                stockDocumentItemId: stockItem.id,
                stockDocumentItemExternalId: stockItem.externalItemId ?? null,
                stockDocumentDate: doc.dataDocumento ?? null,
                stockQuantity: stockQty,
                stockUnitValue: stockUnit,
                stockItemValue,
                allocatedQuantity: 0,
                remainingOrderQuantityAfterAllocation:
                  allocation.allocations[0]!.balance.remainingQty,
                remainingOrderValueAfterAllocation: money(
                  allocation.allocations[0]!.balance.remainingQty,
                  matchedItem.unitPrice
                ),
                forecastSource: "UNRESOLVED",
                confidenceLevel: "MEDIUM",
                status: "QUANTITY_SURPLUS_IN_NFE",
                alertsJson: [
                  "Quantidade de documento maior que saldo do pedido",
                  `Sobra não alocada: ${surplusQty}`,
                ],
                traceJson: {
                  rule: "QUANTITY_SURPLUS_IN_NFE",
                  surplusQuantity: surplusQty,
                  allocatedQuantity: allocatedTotal,
                  stockQuantity: stockQty,
                  nfeExternalId: link.nfeExternalId,
                },
              })
            );
          }
        }
      }
    }

    const orderTotal = order.totalNetValue ?? items.reduce(
      (s, i) => s + (i.totalNetValue ?? money(i.quantity, i.unitPrice)),
      0
    );
    const headerSum = headerValues.reduce((s, v) => s + v, 0);
    if (headerValues.length > 0 && orderTotal > 0 && headerSum > orderTotal + PORTFOLIO_PRICE_TOLERANCE) {
      facts.push(
        baseFact(input.runId, order, {
          forecastSource: "UNRESOLVED",
          confidenceLevel: "MEDIUM",
          status: "OVER_LINKED_BY_HEADER",
          alertsJson: ["Soma de cabeçalhos de NF maior que o pedido"],
          traceJson: {
            rule: "OVER_LINKED_BY_HEADER",
            headerSum,
            orderTotal,
            note: "Cabeçalhos não foram usados como valor alocado",
          },
        })
      );
    }

    const totalOrdered = items.reduce((s, i) => s + i.quantity, 0);
    const totalRemaining = balances.reduce((s, b) => s + b.remainingQty, 0);
    const totalAllocated = round6(totalOrdered - totalRemaining);

    if (totalOrdered > 0 && totalAllocated > 0) {
      if (totalRemaining <= PORTFOLIO_PRICE_TOLERANCE) {
        fullyAllocatedOrders += 1;
        facts.push(
          baseFact(input.runId, order, {
            forecastSource: "NFE",
            forecastDate: order.expectedDeliveryDate ?? null,
            forecastValue: round6(orderTotal),
            confidenceLevel: "MEDIUM",
            status: "FULLY_ALLOCATED",
            alertsJson: facts.some((f) => f.salesOrderId === order.id && f.status === "PRICE_MISMATCH")
              ? ["Pedido atendido em quantidade, com divergência de preço"]
              : [],
            traceJson: {
              rule: "ORDER_ROLLUP",
              totalOrdered,
              totalAllocated,
              totalRemaining: 0,
            },
          })
        );
      } else {
        partiallyAllocatedOrders += 1;
        facts.push(
          baseFact(input.runId, order, {
            forecastSource: "NFE",
            forecastDate: order.expectedDeliveryDate ?? null,
            forecastValue: null,
            confidenceLevel: "MEDIUM",
            status: "PARTIALLY_ALLOCATED",
            alertsJson: ["Pedido parcialmente atendido em quantidade"],
            traceJson: {
              rule: "ORDER_ROLLUP",
              totalOrdered,
              totalAllocated,
              totalRemaining,
            },
          })
        );
      }
    }
  }

  return {
    runId: input.runId,
    mode: input.mode,
    facts,
    summary: {
      ordersProcessed: orders.length,
      factsGenerated: facts.length,
      allocatedLines,
      surplusLines,
      headerOnlyLinks,
      orderOnlyLines,
      fullyAllocatedOrders,
      partiallyAllocatedOrders,
    },
  };
}
