/**
 * OP-49 — Carregador canônico read-only de evidências do Fluxo de Pedidos.
 *
 * - Sem chamadas HTTP ao Nomus
 * - Sem escrita
 * - Sem N+1 (orçamento fixo de queries por lote de orderIds)
 * - Deduplicação por identificadores oficiais no assembler puro
 *
 * Reutiliza fatias oficiais: SalesOrder stage, SalesOrderNfeLink/NomusNfe,
 * NomusProductionOrderSalesLink, NomusStockDocument, OrderToCashAuditFact.
 */

import type { PrismaClient } from "@prisma/client";
import {
  assembleSalesOrderFlowEvidenceBatch,
  type SalesOrderFlowEvidencePack,
  type SalesOrderFlowEvidenceAllocationRow,
  type SalesOrderFlowEvidenceItemRow,
  type SalesOrderFlowEvidenceNfeLinkRow,
  type SalesOrderFlowEvidenceNomusNfeRow,
  type SalesOrderFlowEvidenceOrderRow,
  type SalesOrderFlowEvidenceProductRow,
  type SalesOrderFlowEvidenceProductionLinkRow,
  type SalesOrderFlowEvidenceProductionOrderRow,
  type SalesOrderFlowEvidenceStockDocumentItemRow,
  type SalesOrderFlowEvidenceStockDocumentRow,
} from "./salesOrderFlowEvidence.js";

export type SalesOrderFlowEvidencePrisma = Pick<
  PrismaClient,
  | "salesOrder"
  | "product"
  | "salesOrderNfeLink"
  | "nomusNfe"
  | "nomusProductionOrderSalesLink"
  | "nomusProductionOrder"
  | "orderToCashAuditFact"
  | "nomusStockDocument"
  | "nomusStockDocumentItem"
>;

export type LoadSalesOrderFlowEvidenceBatchOptions = {
  /** Quando true, inclui vínculos OP com isCurrent=false (default: só atuais). */
  includeNonCurrentProductionLinks?: boolean;
};

const ORDER_SELECT = {
  id: true,
  orderCode: true,
  status: true,
  externalSalesOrderId: true,
  externalSalesOrderCode: true,
  issueDate: true,
  expectedDeliveryDate: true,
  totalNetValue: true,
  totalGrossValue: true,
  customerId: true,
  externalSellerId: true,
  nomusSellerName: true,
  companyIssuer: true,
  externalCompanyId: true,
  notes: true,
  internalNotes: true,
  responsible: true,
  paymentTerms: true,
  paymentMethod: true,
  freightCondition: true,
  deliveryLocation: true,
  Customer: {
    select: {
      id: true,
      companyName: true,
      tradeName: true,
      taxId: true,
    },
  },
  items: {
    select: {
      id: true,
      salesOrderId: true,
      productId: true,
      externalProductId: true,
      nomusItemExternalId: true,
      nomusItemSequence: true,
      skuSnapshot: true,
      productNameSnapshot: true,
      quantity: true,
      nomusQuantityFulfilled: true,
      nomusQuantityPending: true,
      nomusItemStatusRaw: true,
      nomusItemStatusNormalized: true,
      nomusIsCanceled: true,
      nomusIsStale: true,
      nomusIsCut: true,
    },
    orderBy: { createdAt: "asc" as const },
  },
} as const;

function uniqueNumbers(values: Array<number | null | undefined>): number[] {
  return [...new Set(values.filter((v): v is number => typeof v === "number"))];
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.filter((v): v is string => typeof v === "string" && v.length > 0))];
}

/**
 * Carrega evidências canônicas para um ou vários pedidos em lote.
 * Relacionamentos apenas por IDs oficiais (pedido, item, NF, OP, documento).
 */
export async function loadSalesOrderFlowEvidenceBatch(
  prisma: SalesOrderFlowEvidencePrisma,
  orderIds: readonly string[],
  options: LoadSalesOrderFlowEvidenceBatchOptions = {}
): Promise<Map<string, SalesOrderFlowEvidencePack>> {
  const ids = [...new Set(orderIds.filter((id) => typeof id === "string" && id.length > 0))];
  if (ids.length === 0) return new Map();

  const loadedAt = new Date().toISOString();

  // 1) Pedidos + cliente + itens
  const ordersRaw = await prisma.salesOrder.findMany({
    where: { id: { in: ids } },
    select: ORDER_SELECT,
  });

  const orders: SalesOrderFlowEvidenceOrderRow[] = ordersRaw.map((order) => ({
    ...order,
    items: order.items as SalesOrderFlowEvidenceItemRow[],
  }));

  const productIds = uniqueStrings(
    orders.flatMap((o) => (o.items ?? []).map((i) => i.productId))
  );

  // 2) Produtos (regra oficial / estrutura) — batch
  const productsRaw =
    productIds.length > 0
      ? await prisma.product.findMany({
          where: { id: { in: productIds } },
          select: {
            id: true,
            type: true,
            costingMode: true,
            _count: {
              select: {
                ProductRouting: true,
                ProductBOM: true,
              },
            },
          },
        })
      : [];

  const products: SalesOrderFlowEvidenceProductRow[] = productsRaw.map((p) => ({
    id: p.id,
    type: p.type,
    costingMode: p.costingMode,
    hasProductRouting: (p._count?.ProductRouting ?? 0) > 0,
    hasProductBom: (p._count?.ProductBOM ?? 0) > 0,
  }));

  // 3) Vínculos NF-e do pedido
  const nfeLinksRaw = await prisma.salesOrderNfeLink.findMany({
    where: { salesOrderId: { in: ids } },
    select: {
      id: true,
      salesOrderId: true,
      nfeExternalId: true,
      nfeNumber: true,
      nfeKey: true,
      nfeStatus: true,
      nomusNfeId: true,
    },
  });
  const nfeLinks: SalesOrderFlowEvidenceNfeLinkRow[] = nfeLinksRaw;

  // 4) Alocações O2C materializadas
  const allocationsRaw = await prisma.orderToCashAuditFact.findMany({
    where: { salesOrderId: { in: ids } },
    select: {
      auditKey: true,
      runId: true,
      lineType: true,
      salesOrderId: true,
      salesOrderItemId: true,
      stockDocumentExternalId: true,
      stockDocumentItemId: true,
      nfeExternalId: true,
      quantityUsedForOrder: true,
      orderedQuantity: true,
      nfeLinkedBy: true,
      createdAt: true,
    },
  });
  const allocations: SalesOrderFlowEvidenceAllocationRow[] = allocationsRaw.map((row) => ({
    ...row,
    salesOrderId: row.salesOrderId,
  }));

  const nfeExternalIds = uniqueNumbers([
    ...nfeLinks.map((l) => l.nfeExternalId),
    ...allocations.map((a) => a.nfeExternalId),
  ]);

  // 5) NF-e stage
  const nomusNfesRaw =
    nfeExternalIds.length > 0
      ? await prisma.nomusNfe.findMany({
          where: { externalId: { in: nfeExternalIds } },
          select: {
            id: true,
            externalId: true,
            numero: true,
            chave: true,
            status: true,
          },
        })
      : [];
  const nomusNfes: SalesOrderFlowEvidenceNomusNfeRow[] = nomusNfesRaw;

  // 6) Vínculos OP oficiais
  const productionLinksRaw = await prisma.nomusProductionOrderSalesLink.findMany({
    where: {
      salesOrderId: { in: ids },
      ...(options.includeNonCurrentProductionLinks ? {} : { isCurrent: true }),
    },
    select: {
      id: true,
      productionOrderId: true,
      productionOrderExternalId: true,
      salesOrderId: true,
      salesOrderItemId: true,
      externalSalesOrderId: true,
      externalSalesOrderItemId: true,
      linkedQuantity: true,
      isCurrent: true,
    },
  });
  const productionLinks: SalesOrderFlowEvidenceProductionLinkRow[] = productionLinksRaw;

  const productionOrderIds = uniqueStrings(
    productionLinks.map((l) => l.productionOrderId)
  );
  const productionOrderExternalIds = uniqueNumbers(
    productionLinks.map((l) => l.productionOrderExternalId)
  );

  // 7) OPs (quantidade planejada; produzida permanece null)
  const productionOrdersRaw =
    productionOrderIds.length > 0 || productionOrderExternalIds.length > 0
      ? await prisma.nomusProductionOrder.findMany({
          where: {
            OR: [
              ...(productionOrderIds.length > 0
                ? [{ id: { in: productionOrderIds } }]
                : []),
              ...(productionOrderExternalIds.length > 0
                ? [{ externalId: { in: productionOrderExternalIds } }]
                : []),
            ],
          },
          select: {
            id: true,
            externalId: true,
            status: true,
            quantity: true,
            productCode: true,
            openedAt: true,
            closedAt: true,
          },
        })
      : [];
  const productionOrders: SalesOrderFlowEvidenceProductionOrderRow[] =
    productionOrdersRaw;

  const stockExternalFromAlloc = uniqueNumbers(
    allocations.map((a) => a.stockDocumentExternalId)
  );

  // 8) Documentos de saída: por externalId (O2C) e por idNfe (NF oficial)
  const stockDocumentsRaw =
    stockExternalFromAlloc.length > 0 || nfeExternalIds.length > 0
      ? await prisma.nomusStockDocument.findMany({
          where: {
            OR: [
              ...(stockExternalFromAlloc.length > 0
                ? [{ externalId: { in: stockExternalFromAlloc } }]
                : []),
              ...(nfeExternalIds.length > 0
                ? [{ idNfe: { in: nfeExternalIds } }]
                : []),
            ],
          },
          select: {
            id: true,
            externalId: true,
            idNfe: true,
            tipoDocumentoEstoque: true,
            dataDocumento: true,
            totalValue: true,
            statusRaw: true,
          },
        })
      : [];

  // Dedup docs by externalId (query OR pode repetir)
  const stockDocMap = new Map<number, SalesOrderFlowEvidenceStockDocumentRow>();
  for (const doc of stockDocumentsRaw) {
    stockDocMap.set(doc.externalId, doc);
  }
  const stockDocuments = [...stockDocMap.values()];
  const stockDocumentIds = stockDocuments.map((d) => d.id);

  // 9) Itens de documento
  const stockDocumentItemsRaw =
    stockDocumentIds.length > 0
      ? await prisma.nomusStockDocumentItem.findMany({
          where: { stockDocumentId: { in: stockDocumentIds } },
          select: {
            id: true,
            stockDocumentId: true,
            externalItemId: true,
            externalProductId: true,
            quantity: true,
          },
        })
      : [];
  const stockDocumentItems: SalesOrderFlowEvidenceStockDocumentItemRow[] =
    stockDocumentItemsRaw;

  return assembleSalesOrderFlowEvidenceBatch({
    orders,
    products,
    nfeLinks,
    nomusNfes,
    productionLinks,
    productionOrders,
    stockDocuments,
    stockDocumentItems,
    allocations,
    loadedAt,
  });
}

/** Atalho para um único pedido. */
export async function loadSalesOrderFlowEvidence(
  prisma: SalesOrderFlowEvidencePrisma,
  orderId: string,
  options?: LoadSalesOrderFlowEvidenceBatchOptions
): Promise<SalesOrderFlowEvidencePack | null> {
  const map = await loadSalesOrderFlowEvidenceBatch(prisma, [orderId], options);
  return map.get(orderId) ?? null;
}
