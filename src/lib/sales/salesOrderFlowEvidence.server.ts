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
import {
  buildStockDocumentOrderRefJsonPathFilters,
  extractOutputDocumentOrderRefsFromRaw,
} from "./salesOrderOutputDocumentLinkResolver.js";

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
  /**
   * Quando false, omite NF-e / documentos de saída (detalhe sem permissão fiscal).
   * Recompute deve manter default true.
   */
  includeFiscalEvidence?: boolean;
  /**
   * Quando false, omite vínculos/ordens de produção (detalhe sem permissão de OP).
   * Recompute deve manter default true.
   */
  includeProductionEvidence?: boolean;
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

  const includeFiscalEvidence = options.includeFiscalEvidence !== false;
  const includeProductionEvidence = options.includeProductionEvidence !== false;
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
  const nfeLinksRaw = includeFiscalEvidence
    ? await prisma.salesOrderNfeLink.findMany({
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
      })
    : [];
  const nfeLinks: SalesOrderFlowEvidenceNfeLinkRow[] = nfeLinksRaw;

  // 4) Alocações O2C materializadas (sempre — progresso/corte do motor)
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

  const nfeExternalIds = includeFiscalEvidence
    ? uniqueNumbers([
        ...nfeLinks.map((l) => l.nfeExternalId),
        ...allocations.map((a) => a.nfeExternalId),
      ])
    : [];

  // 5) NF-e stage
  const nomusNfesRaw =
    includeFiscalEvidence && nfeExternalIds.length > 0
      ? await prisma.nomusNfe.findMany({
          where: { externalId: { in: nfeExternalIds } },
          select: {
            id: true,
            externalId: true,
            numero: true,
            serie: true,
            chave: true,
            status: true,
            xmlDhEmi: true,
          },
        })
      : [];

  // 6) Vínculos OP oficiais
  const productionLinksRaw = includeProductionEvidence
    ? await prisma.nomusProductionOrderSalesLink.findMany({
        where: {
          salesOrderId: { in: ids },
          ...(options.includeNonCurrentProductionLinks
            ? {}
            : { isCurrent: true }),
        },
        select: {
          id: true,
          productionOrderId: true,
          productionOrderExternalId: true,
          salesOrderId: true,
          salesOrderItemId: true,
          externalSalesOrderId: true,
          externalSalesOrderItemId: true,
          itemNumber: true,
          linkedQuantity: true,
          isCurrent: true,
        },
      })
    : [];
  const productionLinks: SalesOrderFlowEvidenceProductionLinkRow[] =
    productionLinksRaw;

  const productionOrderIds = uniqueStrings(
    productionLinks.map((l) => l.productionOrderId)
  );
  const productionOrderExternalIds = uniqueNumbers(
    productionLinks.map((l) => l.productionOrderExternalId)
  );

  // 7) OPs (quantidade planejada; produzida permanece null)
  const productionOrdersRaw =
    includeProductionEvidence &&
    (productionOrderIds.length > 0 || productionOrderExternalIds.length > 0)
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

  const stockExternalFromAlloc = includeFiscalEvidence
    ? uniqueNumbers(allocations.map((a) => a.stockDocumentExternalId))
    : [];

  // KAN-LINK-04 — descoberta por refs oficiais no raw (sem migration / sem NF obrigatória).
  const orderExternalIds = includeFiscalEvidence
    ? uniqueNumbers(orders.map((o) => o.externalSalesOrderId))
    : [];
  const itemExternalIds = includeFiscalEvidence
    ? uniqueNumbers(
        orders.flatMap((o) =>
          (o.items ?? []).map((i) => i.nomusItemExternalId)
        )
      )
    : [];
  const orderRefFilters = buildStockDocumentOrderRefJsonPathFilters({
    externalSalesOrderIds: orderExternalIds,
    externalSalesOrderItemIds: itemExternalIds,
  });

  // 8) Documentos de saída: O2C · idNfe · refs oficiais no raw do cabeçalho
  const stockDocumentsRaw =
    includeFiscalEvidence &&
    (stockExternalFromAlloc.length > 0 ||
      nfeExternalIds.length > 0 ||
      orderRefFilters.length > 0)
      ? await prisma.nomusStockDocument.findMany({
          where: {
            OR: [
              ...(stockExternalFromAlloc.length > 0
                ? [{ externalId: { in: stockExternalFromAlloc } }]
                : []),
              ...(nfeExternalIds.length > 0
                ? [{ idNfe: { in: nfeExternalIds } }]
                : []),
              ...orderRefFilters.map((f) => f as never),
            ],
          },
          select: {
            id: true,
            externalId: true,
            idNfe: true,
            tipoDocumentoEstoque: true,
            dataDocumento: true,
            documentNumber: true,
            totalValue: true,
            statusRaw: true,
            isCancelled: true,
            cancelledAt: true,
            cancellationReason: true,
            rawJson: true,
          },
        })
      : [];

  // Itens com ref oficial de pedido/item (podem apontar docs ainda não carregados).
  const stockItemsByOrderRefRaw =
    includeFiscalEvidence && orderRefFilters.length > 0
      ? await prisma.nomusStockDocumentItem.findMany({
          where: { OR: orderRefFilters.map((f) => f as never) },
          select: {
            id: true,
            stockDocumentId: true,
            externalItemId: true,
            externalProductId: true,
            quantity: true,
            rawJson: true,
          },
        })
      : [];

  const extraDocIds = uniqueStrings(
    stockItemsByOrderRefRaw.map((i) => i.stockDocumentId)
  ).filter((id) => !stockDocumentsRaw.some((d) => d.id === id));

  const extraDocsRaw =
    includeFiscalEvidence && extraDocIds.length > 0
      ? await prisma.nomusStockDocument.findMany({
          where: { id: { in: extraDocIds } },
          select: {
            id: true,
            externalId: true,
            idNfe: true,
            tipoDocumentoEstoque: true,
            dataDocumento: true,
            documentNumber: true,
            totalValue: true,
            statusRaw: true,
            isCancelled: true,
            cancelledAt: true,
            cancellationReason: true,
            rawJson: true,
          },
        })
      : [];

  // Dedup docs by externalId (query OR pode repetir)
  const stockDocMap = new Map<
    number,
    SalesOrderFlowEvidenceStockDocumentRow & { rawJson?: unknown }
  >();
  for (const doc of [...stockDocumentsRaw, ...extraDocsRaw]) {
    const headerRefs = extractOutputDocumentOrderRefsFromRaw(doc.rawJson);
    stockDocMap.set(doc.externalId, {
      id: doc.id,
      externalId: doc.externalId,
      idNfe: doc.idNfe,
      tipoDocumentoEstoque: doc.tipoDocumentoEstoque,
      dataDocumento: doc.dataDocumento,
      documentNumber: doc.documentNumber,
      totalValue: doc.totalValue,
      statusRaw: doc.statusRaw,
      isCancelled: doc.isCancelled,
      cancelledAt: doc.cancelledAt,
      cancellationReason: doc.cancellationReason,
      externalSalesOrderId: headerRefs.externalSalesOrderId,
      orderCodeNormalized: headerRefs.orderCodeNormalized,
      rawJson: doc.rawJson,
    });
  }
  const stockDocuments: SalesOrderFlowEvidenceStockDocumentRow[] = [
    ...stockDocMap.values(),
  ].map(({ rawJson: _raw, ...row }) => row);
  const stockDocumentIds = stockDocuments.map((d) => d.id);

  // Carregar NomusNfe também para idNfe descobertos só no Documento de Saída
  // (senão a NF autorizada no Nomus não entra no pack / Kanban).
  const knownNfeIds = new Set(nfeExternalIds);
  const dsOnlyNfeIds = uniqueNumbers(stockDocuments.map((d) => d.idNfe)).filter(
    (id) => !knownNfeIds.has(id)
  );
  const extraNomusNfesRaw =
    includeFiscalEvidence && dsOnlyNfeIds.length > 0
      ? await prisma.nomusNfe.findMany({
          where: { externalId: { in: dsOnlyNfeIds } },
          select: {
            id: true,
            externalId: true,
            numero: true,
            serie: true,
            chave: true,
            status: true,
            xmlDhEmi: true,
          },
        })
      : [];
  const nomusNfes: SalesOrderFlowEvidenceNomusNfeRow[] = [
    ...nomusNfesRaw,
    ...extraNomusNfesRaw,
  ];

  // 9) Itens de documento (+ refs oficiais do raw)
  const stockDocumentItemsRaw =
    includeFiscalEvidence && stockDocumentIds.length > 0
      ? await prisma.nomusStockDocumentItem.findMany({
          where: { stockDocumentId: { in: stockDocumentIds } },
          select: {
            id: true,
            stockDocumentId: true,
            externalItemId: true,
            externalProductId: true,
            quantity: true,
            rawJson: true,
          },
        })
      : [];

  const itemById = new Map<string, (typeof stockDocumentItemsRaw)[number]>();
  for (const row of [...stockDocumentItemsRaw, ...stockItemsByOrderRefRaw]) {
    itemById.set(row.id, row);
  }

  const stockDocumentItems: SalesOrderFlowEvidenceStockDocumentItemRow[] = [
    ...itemById.values(),
  ].map((row) => {
    const refs = extractOutputDocumentOrderRefsFromRaw(row.rawJson);
    return {
      id: row.id,
      stockDocumentId: row.stockDocumentId,
      externalItemId: row.externalItemId,
      externalProductId: row.externalProductId ?? refs.externalProductId,
      quantity: row.quantity,
      externalSalesOrderId: refs.externalSalesOrderId,
      externalSalesOrderItemId: refs.externalSalesOrderItemId,
      orderCodeNormalized: refs.orderCodeNormalized,
      salesOrderItemSequence: refs.salesOrderItemSequence,
      unitCode: refs.unitCode,
      descriptionHintOrderCode: refs.descriptionHintOrderCode,
    };
  });

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
