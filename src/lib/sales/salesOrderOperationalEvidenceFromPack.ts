/**
 * KAN-LINK-07 — Montagem do grafo canônico a partir do pack OP-49.
 *
 * Única ponte pack → SalesOrderOperationalEvidenceGraph → motor.
 * Usa resolvedores KAN-LINK-04/05; reconciliação KAN-LINK-06 anexa no grafo.
 */

import type { SalesOrderFlowEvidencePack } from "./salesOrderFlowEvidence.js";
import {
  adaptOperationalEvidenceItemToMotorAllocations,
  buildSalesOrderOperationalEvidenceGraph,
  makeOperationalLinkEdge,
  type OperationalEvidenceMotorAllocations,
} from "./salesOrderOperationalEvidenceGraph.js";
import type {
  SalesOrderOperationalEvidenceGraph,
  SalesOrderOperationalLinkEdge,
  SalesOrderOperationalObligation,
} from "./salesOrderOperationalEvidenceContract.js";
import {
  buildProductionOrderLinksForItemFlow,
} from "./salesOrderProductionOrderLinkResolver.js";
import {
  nfeValidityFromStatus,
  normalizeOutputDocumentOrderCode,
  resolveOutputDocumentLineLinks,
  sumDocumentedQuantityBySalesOrderItem,
  type OutputDocumentLinkDocumentInput,
  type OutputDocumentLinkLineInput,
  type OutputDocumentOrderRefExtract,
  type ResolvedOutputDocumentLineLink,
} from "./salesOrderOutputDocumentLinkResolver.js";

const graphCache = new WeakMap<
  SalesOrderFlowEvidencePack,
  SalesOrderOperationalEvidenceGraph
>();

function isStockDocumentCanceled(
  pack: SalesOrderFlowEvidencePack,
  stockDocumentExternalId: number
): boolean {
  const doc = pack.stockDocuments.find(
    (d) => d.externalId === stockDocumentExternalId
  );
  if (!doc) return false;
  if (doc.isCancelled === true) return true;
  const raw = (doc.statusRaw ?? "").toLowerCase();
  return raw.includes("cancel");
}

function refsFromEvidenceItem(
  item: SalesOrderFlowEvidencePack["stockDocumentItems"][number]
): OutputDocumentOrderRefExtract {
  return {
    externalSalesOrderId: item.externalSalesOrderId ?? null,
    orderCode: null,
    orderCodeNormalized: item.orderCodeNormalized ?? null,
    externalSalesOrderItemId: item.externalSalesOrderItemId ?? null,
    salesOrderItemSequence: item.salesOrderItemSequence ?? null,
    externalProductId: item.externalProductId ?? null,
    unitCode: item.unitCode ?? null,
    descriptionHintOrderCode: item.descriptionHintOrderCode ?? null,
  };
}

function resolveCommerciallyClosedCoverageQty(
  item: SalesOrderFlowEvidencePack["items"][number]
): number {
  const classification = item.fulfillment.classification;
  const ordered = item.quantity ?? 0;
  const fulfilled = item.nomusQuantityFulfilled ?? 0;
  if (classification === "CANCELED") return 0;
  if (classification === "FULFILLED_WITH_CUT") {
    return Math.max(0, fulfilled > 0 ? fulfilled : 0);
  }
  if (classification === "FULLY_FULFILLED") {
    return Math.max(0, fulfilled > 0 ? fulfilled : ordered);
  }
  if (ordered > 0 && fulfilled + 0.000_001 >= ordered) {
    return Math.max(0, fulfilled);
  }
  return 0;
}

function buildCanonicalDocumentLinks(pack: SalesOrderFlowEvidencePack) {
  const nfeLinked = new Set(
    pack.nfes
      .filter((n) => n.linkedSalesOrderIds.includes(pack.orderId))
      .map((n) => n.externalId)
  );
  for (const n of pack.nfes) nfeLinked.add(n.externalId);

  const documents: OutputDocumentLinkDocumentInput[] = pack.stockDocuments.map(
    (d) => {
      const nfe =
        d.idNfe != null
          ? pack.nfes.find((n) => n.externalId === d.idNfe)
          : null;
      return {
        id: d.id,
        externalId: d.externalId,
        idNfe: d.idNfe,
        isCancelled: d.isCancelled,
        statusRaw: d.statusRaw,
        tipoDocumentoEstoque: d.tipoDocumentoEstoque,
        headerRefs: {
          externalSalesOrderId: d.externalSalesOrderId ?? null,
          orderCode: null,
          orderCodeNormalized: d.orderCodeNormalized ?? null,
          externalSalesOrderItemId: null,
          salesOrderItemSequence: null,
          externalProductId: null,
          unitCode: null,
          descriptionHintOrderCode: null,
        },
        nfeValidity: nfe
          ? nfeValidityFromStatus({
              isCanceled: nfe.isCanceled,
              isValidForBilling: nfe.isValidForBilling,
              statusNormalized: nfe.statusNormalized.statusNormalized,
            })
          : d.idNfe == null
            ? null
            : "UNKNOWN",
        linkedViaSalesOrderNfeLink: d.idNfe != null && nfeLinked.has(d.idNfe),
      };
    }
  );

  const lines: OutputDocumentLinkLineInput[] = pack.stockDocumentItems.map(
    (line) => ({
      id: line.id,
      stockDocumentId: line.stockDocumentId,
      stockDocumentExternalId: line.stockDocumentExternalId,
      externalProductId: line.externalProductId,
      quantity: line.quantity,
      refs: refsFromEvidenceItem(line),
    })
  );

  const items = pack.items.map((item) => ({
    id: item.id,
    salesOrderId: pack.orderId,
    externalSalesOrderId: pack.order.externalSalesOrderId,
    orderCodeNormalized: normalizeOutputDocumentOrderCode(pack.order.orderCode),
    nomusItemExternalId: item.nomusItemExternalId,
    nomusItemSequence: item.nomusItemSequence,
    externalProductId: item.externalProductId,
  }));

  const links = resolveOutputDocumentLineLinks({
    salesOrderId: pack.orderId,
    externalSalesOrderId: pack.order.externalSalesOrderId,
    orderCodeNormalized: normalizeOutputDocumentOrderCode(pack.order.orderCode),
    items,
    documents,
    lines,
    nfeExternalIdsLinked: nfeLinked,
  });

  const o2c = pack.allocations
    .filter(
      (a) =>
        a.stockDocumentExternalId == null ||
        !isStockDocumentCanceled(pack, a.stockDocumentExternalId)
    )
    .map((a) => ({
      salesOrderItemId: a.salesOrderItemId,
      stockDocumentExternalId: a.stockDocumentExternalId,
      stockDocumentItemId: a.stockDocumentItemId,
      quantityUsedForOrder: a.quantityUsedForOrder,
      auditKey: a.auditKey,
    }));

  const documentedByItem = sumDocumentedQuantityBySalesOrderItem(links, o2c);
  return { links, documentedByItem, nfeLinked };
}

function obligationFromPackItem(
  item: SalesOrderFlowEvidencePack["items"][number]
): SalesOrderOperationalObligation {
  const ordered = Math.max(0, item.quantity ?? 0);
  const fulfilled = item.nomusQuantityFulfilled;
  let cutQuantity = 0;
  let canceledQuantity = 0;

  if (item.nomusIsCanceled || item.fulfillment.classification === "CANCELED") {
    canceledQuantity = ordered;
  } else if (item.fulfillment.classification === "FULFILLED_WITH_CUT") {
    cutQuantity = Math.max(0, ordered - Math.max(0, fulfilled ?? 0));
  }

  const activeObligationQuantity = Math.max(
    0,
    item.fulfillment.classification === "FULFILLED_WITH_CUT"
      ? Math.max(0, fulfilled ?? 0)
      : ordered - cutQuantity - canceledQuantity
  );

  return {
    salesOrderItemId: item.id,
    orderedQuantity: ordered,
    activeObligationQuantity,
    cutQuantity,
    canceledQuantity,
    fulfilledQuantity: fulfilled,
  };
}

type DocCoverageRow = {
  outputDocumentId: string | null;
  outputDocumentExternalId: number | null;
  salesOrderItemId: string;
  quantity: number;
  isCancelled?: boolean | null;
  statusRaw?: string | null;
  tipoDocumentoEstoque?: string | null;
  idNfe?: number | null;
  link: SalesOrderOperationalLinkEdge;
};

type NfeCoverageRow = {
  nfeId: string | null;
  nfeExternalId: number | null;
  salesOrderItemId: string;
  quantity: number;
  statusNormalized?: string | null;
  isCanceled?: boolean | null;
  isValidForBilling?: boolean | null;
  hasDocument?: boolean;
  link: SalesOrderOperationalLinkEdge;
};

/**
 * Resolve coberturas DS/NF por item (mesma semântica da alocação anterior),
 * já tipadas para o grafo canônico.
 */
function resolveDocumentAndNfeCoverageRows(pack: SalesOrderFlowEvidencePack): {
  documents: DocCoverageRow[];
  nfes: NfeCoverageRow[];
  links: SalesOrderOperationalLinkEdge[];
} {
  const nfeById = new Map(pack.nfes.map((n) => [n.externalId, n] as const));
  const { links: resolvedLinks, documentedByItem } =
    buildCanonicalDocumentLinks(pack);

  const documents: DocCoverageRow[] = [];
  const nfes: NfeCoverageRow[] = [];
  const edgeLinks: SalesOrderOperationalLinkEdge[] = [];
  const seenDocKeysByItem = new Map<string, Set<string>>();

  for (const item of pack.items) {
    const itemAllocations = pack.allocations.filter(
      (a) => a.salesOrderItemId === item.id
    );
    const seenDocKeys = new Set<string>();
    seenDocKeysByItem.set(item.id, seenDocKeys);
    const o2cStockDocExternalIds = new Set<number>();

    const itemLinks = resolvedLinks.filter(
      (l: ResolvedOutputDocumentLineLink) =>
        l.salesOrderItemId === item.id &&
        l.advancesKanban &&
        l.itemCoverage === "RESOLVED"
    );

    // 1) O2C
    for (const a of itemAllocations) {
      if (a.stockDocumentExternalId != null) {
        o2cStockDocExternalIds.add(a.stockDocumentExternalId);
      }
      if (a.stockDocumentExternalId == null) continue;
      const key = a.auditKey.trim();
      if (!key || seenDocKeys.has(key)) continue;
      seenDocKeys.add(key);
      const canceled = isStockDocumentCanceled(pack, a.stockDocumentExternalId);
      const doc = pack.stockDocuments.find(
        (d) => d.externalId === a.stockDocumentExternalId
      );
      const link = makeOperationalLinkEdge({
        sourceType: "SALES_ORDER_NFE_LINK",
        sourceSystem: "INDUSCOST",
        sourceRecordId: key,
        sourceExternalId: a.stockDocumentExternalId,
        targetRecordId: item.id,
        targetExternalId: item.nomusItemExternalId,
        salesOrderId: pack.orderId,
        salesOrderItemId: item.id,
        productionOrderId: null,
        outputDocumentId: doc?.id ?? null,
        nfeId: a.nfeExternalId != null ? String(a.nfeExternalId) : null,
        reason: "OrderToCashAuditFact → item",
        sourceUpdatedAt: null,
        syncedAt: null,
        quantity: a.quantityUsedForOrder ?? 0,
      });
      edgeLinks.push(link);
      documents.push({
        outputDocumentId: doc?.id ?? null,
        outputDocumentExternalId: a.stockDocumentExternalId,
        salesOrderItemId: item.id,
        quantity: a.quantityUsedForOrder ?? 0,
        isCancelled: canceled,
        statusRaw: doc?.statusRaw ?? null,
        tipoDocumentoEstoque: doc?.tipoDocumentoEstoque ?? null,
        idNfe: doc?.idNfe ?? a.nfeExternalId ?? null,
        link,
      });
    }

    // 2) Linhas DS canônicas
    for (const resolved of itemLinks) {
      if (o2cStockDocExternalIds.has(resolved.stockDocumentExternalId)) continue;
      const key = `ds-line:${resolved.stockDocumentItemId}`;
      if (seenDocKeys.has(key)) continue;
      seenDocKeys.add(key);
      const doc = pack.stockDocuments.find(
        (d) => d.externalId === resolved.stockDocumentExternalId
      );
      const link = makeOperationalLinkEdge({
        sourceType: resolved.sourceType,
        sourceSystem: "NOMUS",
        sourceRecordId: key,
        sourceExternalId: resolved.stockDocumentExternalId,
        targetRecordId: item.id,
        targetExternalId: item.nomusItemExternalId,
        salesOrderId: pack.orderId,
        salesOrderItemId: item.id,
        productionOrderId: null,
        outputDocumentId: doc?.id ?? null,
        nfeId: doc?.idNfe != null ? String(doc.idNfe) : null,
        reason: "Linha DS resolvida canonicamente (KAN-LINK-04)",
        sourceUpdatedAt: null,
        syncedAt: null,
        quantity: resolved.quantity,
      });
      edgeLinks.push(link);
      documents.push({
        outputDocumentId: doc?.id ?? null,
        outputDocumentExternalId: resolved.stockDocumentExternalId,
        salesOrderItemId: item.id,
        quantity: resolved.quantity,
        isCancelled: false,
        statusRaw: doc?.statusRaw ?? null,
        tipoDocumentoEstoque: doc?.tipoDocumentoEstoque ?? null,
        idNfe: doc?.idNfe ?? null,
        link,
      });
    }

    // Fallback agregado
    const resolvedQty = documentedByItem.get(item.id) ?? 0;
    const allocatedSum = documents
      .filter(
        (d) =>
          d.salesOrderItemId === item.id &&
          d.isCancelled !== true &&
          d.quantity > 0
      )
      .reduce((s, d) => s + d.quantity, 0);
    if (resolvedQty > allocatedSum + 0.000_001) {
      const key = `ds-resolved:${item.id}`;
      if (!seenDocKeys.has(key)) {
        seenDocKeys.add(key);
        const link = makeOperationalLinkEdge({
          sourceType: "OUTPUT_DOCUMENT_REFERENCE",
          sourceSystem: "DERIVED",
          sourceRecordId: key,
          sourceExternalId: null,
          targetRecordId: item.id,
          targetExternalId: item.nomusItemExternalId,
          salesOrderId: pack.orderId,
          salesOrderItemId: item.id,
          productionOrderId: null,
          outputDocumentId: null,
          nfeId: null,
          reason: "Cobertura agregada do resolvedor DS (join 1:N)",
          sourceUpdatedAt: null,
          syncedAt: null,
          quantity: resolvedQty - allocatedSum,
        });
        edgeLinks.push(link);
        documents.push({
          outputDocumentId: null,
          outputDocumentExternalId: null,
          salesOrderItemId: item.id,
          quantity: resolvedQty - allocatedSum,
          isCancelled: false,
          statusRaw: "emitido",
          idNfe: null,
          link,
        });
      }
    }

    // 3) NF qty
    const nfeQtyById = new Map<number, number>();
    for (const a of itemAllocations) {
      if (a.nfeExternalId == null) continue;
      const q = a.quantityUsedForOrder ?? 0;
      if (q <= 0) continue;
      nfeQtyById.set(
        a.nfeExternalId,
        (nfeQtyById.get(a.nfeExternalId) ?? 0) + q
      );
    }
    for (const resolved of itemLinks) {
      const doc = pack.stockDocuments.find(
        (d) => d.externalId === resolved.stockDocumentExternalId
      );
      if (!doc?.idNfe) continue;
      if (nfeQtyById.has(doc.idNfe)) continue;
      if (isStockDocumentCanceled(pack, doc.externalId)) continue;
      const nfe = nfeById.get(doc.idNfe);
      if (nfe?.isCanceled === true) continue;
      if (nfe && !nfe.isValidForBilling) continue;
      nfeQtyById.set(
        doc.idNfe,
        (nfeQtyById.get(doc.idNfe) ?? 0) + resolved.quantity
      );
    }

    // 4) Fallback comercialmente encerrado
    const commerciallyClosedQty = resolveCommerciallyClosedCoverageQty(item);
    if (commerciallyClosedQty > 0) {
      const documentedSum = documents
        .filter(
          (d) =>
            d.salesOrderItemId === item.id &&
            d.isCancelled !== true &&
            d.quantity > 0
        )
        .reduce((s, d) => s + d.quantity, 0);
      const invoicedSum = [...nfeQtyById.values()].reduce((s, q) => s + q, 0);
      const gap = Math.max(
        0,
        commerciallyClosedQty - Math.max(documentedSum, invoicedSum)
      );
      if (gap > 0.000_001) {
        const validNfes = pack.nfes.filter(
          (n) => n.isValidForBilling && !n.isCanceled
        );
        for (const nfe of validNfes) {
          if (nfeQtyById.has(nfe.externalId)) continue;
          const docsForNfe = pack.stockDocuments.filter(
            (d) =>
              d.idNfe === nfe.externalId &&
              !isStockDocumentCanceled(pack, d.externalId)
          );
          const qtyFromResolved = itemLinks
            .filter((l) =>
              docsForNfe.some((d) => d.externalId === l.stockDocumentExternalId)
            )
            .reduce((s, l) => s + l.quantity, 0);
          const allocateQty =
            qtyFromResolved > 0
              ? Math.min(gap, qtyFromResolved)
              : docsForNfe.length > 0 || validNfes.length > 0
                ? gap
                : 0;
          if (allocateQty <= 0) continue;
          nfeQtyById.set(nfe.externalId, allocateQty);
          if (
            docsForNfe.length > 0 &&
            documentedSum + 0.000_001 < commerciallyClosedQty
          ) {
            const primaryDoc = docsForNfe[0]!;
            const key = `ds-nfe-fallback:${primaryDoc.externalId}:item:${item.id}`;
            if (!seenDocKeys.has(key)) {
              seenDocKeys.add(key);
              const link = makeOperationalLinkEdge({
                sourceType: "NFE_REFERENCE",
                sourceSystem: "DERIVED",
                sourceRecordId: key,
                sourceExternalId: primaryDoc.externalId,
                targetRecordId: item.id,
                targetExternalId: item.nomusItemExternalId,
                salesOrderId: pack.orderId,
                salesOrderItemId: item.id,
                productionOrderId: null,
                outputDocumentId: primaryDoc.id,
                nfeId: nfe.nomusNfeId,
                reason: "Fallback item encerrado comercialmente + DS/NF do pedido",
                sourceUpdatedAt: null,
                syncedAt: null,
                quantity: allocateQty,
              });
              edgeLinks.push(link);
              documents.push({
                outputDocumentId: primaryDoc.id,
                outputDocumentExternalId: primaryDoc.externalId,
                salesOrderItemId: item.id,
                quantity: allocateQty,
                isCancelled: false,
                statusRaw: primaryDoc.statusRaw,
                tipoDocumentoEstoque: primaryDoc.tipoDocumentoEstoque,
                idNfe: nfe.externalId,
                link,
              });
            }
          }
          break;
        }
      }
    }

    for (const [nfeExternalId, quantity] of nfeQtyById) {
      const nfe = nfeById.get(nfeExternalId);
      const hasDocument =
        pack.stockDocuments.some(
          (d) =>
            d.idNfe === nfeExternalId &&
            !isStockDocumentCanceled(pack, d.externalId)
        ) ||
        itemAllocations.some(
          (a) =>
            a.nfeExternalId === nfeExternalId &&
            a.stockDocumentExternalId != null &&
            !isStockDocumentCanceled(pack, a.stockDocumentExternalId)
        );
      const link = makeOperationalLinkEdge({
        sourceType: nfe?.sources.includes("SALES_ORDER_NFE_LINK")
          ? "SALES_ORDER_NFE_LINK"
          : "NFE_REFERENCE",
        sourceSystem: "INDUSCOST",
        sourceRecordId: nfe?.nomusNfeId ?? `nfe:${nfeExternalId}`,
        sourceExternalId: nfeExternalId,
        targetRecordId: item.id,
        targetExternalId: item.nomusItemExternalId,
        salesOrderId: pack.orderId,
        salesOrderItemId: item.id,
        productionOrderId: null,
        outputDocumentId: null,
        nfeId: nfe?.nomusNfeId ?? null,
        reason: "NF vinculada ao item (KAN-LINK-04/07)",
        sourceUpdatedAt: null,
        syncedAt: null,
        quantity,
      });
      edgeLinks.push(link);
      nfes.push({
        nfeId: nfe?.nomusNfeId ?? null,
        nfeExternalId,
        salesOrderItemId: item.id,
        quantity,
        statusNormalized: nfe?.statusNormalized.statusNormalized ?? null,
        isCanceled: nfe?.isCanceled === true,
        isValidForBilling:
          nfe?.isValidForBilling !== false && nfe?.isCanceled !== true,
        hasDocument,
        link,
      });
    }

    // Ambiguous DS lines for this item (diagnostics)
    for (const resolved of resolvedLinks) {
      if (
        resolved.salesOrderItemId === item.id &&
        resolved.sourceType === "AMBIGUOUS"
      ) {
        edgeLinks.push(
          makeOperationalLinkEdge({
            sourceType: "AMBIGUOUS",
            sourceSystem: "DERIVED",
            sourceRecordId: `ds-amb:${resolved.stockDocumentItemId}`,
            sourceExternalId: resolved.stockDocumentExternalId,
            targetRecordId: item.id,
            targetExternalId: null,
            salesOrderId: pack.orderId,
            salesOrderItemId: item.id,
            productionOrderId: null,
            outputDocumentId: null,
            nfeId: null,
            reason: "Linha DS ambígua no resolvedor canônico",
            sourceUpdatedAt: null,
            syncedAt: null,
            quantity: resolved.quantity,
          })
        );
      }
    }
  }

  return { documents, nfes, links: edgeLinks };
}

/**
 * Constrói o grafo canônico a partir do pack (sem I/O).
 */
export function buildSalesOrderOperationalEvidenceGraphFromPack(
  pack: SalesOrderFlowEvidencePack
): SalesOrderOperationalEvidenceGraph {
  const { documents, nfes, links: docLinks } =
    resolveDocumentAndNfeCoverageRows(pack);

  const productionLinks: Array<{
    salesOrderItemId: string;
    productionOrderId: string | null;
    productionOrderExternalId: number | null;
    linkedQuantity: number;
    isCurrent?: boolean;
    link: SalesOrderOperationalLinkEdge;
  }> = [];
  const productionEdges: SalesOrderOperationalLinkEdge[] = [];

  for (const item of pack.items) {
    const { resolved } = buildProductionOrderLinksForItemFlow(pack, item.id);
    for (const r of resolved) {
      const link = makeOperationalLinkEdge({
        sourceType: r.sourceType,
        sourceSystem: "NOMUS",
        sourceRecordId: r.productionOrderId,
        sourceExternalId: r.productionOrderExternalId,
        targetRecordId: r.salesOrderItemId,
        targetExternalId: null,
        salesOrderId: r.salesOrderId,
        salesOrderItemId: r.salesOrderItemId,
        productionOrderId: r.productionOrderId,
        outputDocumentId: null,
        nfeId: null,
        reason: r.reason,
        sourceUpdatedAt: null,
        syncedAt: null,
        quantity: r.linkedQuantity,
      });
      productionEdges.push(link);
      if (r.advancesKanban && r.itemCoverage === "RESOLVED") {
        productionLinks.push({
          salesOrderItemId: item.id,
          productionOrderId: r.productionOrderId,
          productionOrderExternalId: r.productionOrderExternalId,
          linkedQuantity: r.linkedQuantity,
          isCurrent: r.isCurrent,
          link,
        });
      } else if (r.sourceType === "AMBIGUOUS" || r.sourceType === "UNRESOLVED") {
        // aresta diagnóstica já em productionEdges / links
      }
    }
  }

  const obligations = pack.items.map(obligationFromPackItem);

  return buildSalesOrderOperationalEvidenceGraph({
    salesOrderId: pack.orderId,
    orderCode: pack.order.orderCode,
    externalSalesOrderId: pack.order.externalSalesOrderId,
    obligations,
    links: [...docLinks, ...productionEdges],
    documents,
    nfes,
    productionLinks,
  });
}

/** Grafo por pack com cache (recompute chama N itens). */
export function getSalesOrderOperationalEvidenceGraphFromPack(
  pack: SalesOrderFlowEvidencePack
): SalesOrderOperationalEvidenceGraph {
  const cached = graphCache.get(pack);
  if (cached) return cached;
  const built = buildSalesOrderOperationalEvidenceGraphFromPack(pack);
  graphCache.set(pack, built);
  return built;
}

/** Alocações do motor exclusivamente via grafo canônico. */
export function adaptPackItemToMotorAllocations(
  pack: SalesOrderFlowEvidencePack,
  salesOrderItemId: string
): OperationalEvidenceMotorAllocations {
  const graph = getSalesOrderOperationalEvidenceGraphFromPack(pack);
  return adaptOperationalEvidenceItemToMotorAllocations(
    graph,
    salesOrderItemId
  );
}

export function clearSalesOrderOperationalEvidenceGraphPackCacheForTests(): void {
  // WeakMap não tem clear; noop — packs de teste são objetos novos.
}
