/**
 * Alocações documentais e fiscais por item — vínculo canônico Pedido → DS → NF-e.
 *
 * KAN-LINK-04: resolvedor oficial de linhas DS → item (idItemPedido / sequência /
 * NfeLink / produto inequívoco). Sem fuzzy por cliente/valor/data.
 *
 * Fontes (precedência):
 * - OrderToCashAuditFact (quantityUsedForOrder por salesOrderItemId)
 * - Linhas DS resolvidas por refs oficiais (salesOrderOutputDocumentLinkResolver)
 * - NF via DS.idNfe / SalesOrderNfeLink (mesmo qty documental — sem somar 2×)
 * - Fallback: item comercialmente encerrado + NF/DS do pedido
 */

import type { SalesOrderFlowEvidencePack } from "./salesOrderFlowEvidence.js";
import type {
  SalesOrderItemFlowDocumentAllocationInput,
  SalesOrderItemFlowNfeAllocationInput,
} from "./salesOrderItemFlowEngine.js";
import {
  nfeValidityFromStatus,
  normalizeOutputDocumentOrderCode,
  resolveOutputDocumentLineLinks,
  sumDocumentedQuantityBySalesOrderItem,
  type OutputDocumentLinkDocumentInput,
  type OutputDocumentLinkLineInput,
  type OutputDocumentOrderRefExtract,
} from "./salesOrderOutputDocumentLinkResolver.js";

function isStockDocumentCanceled(
  pack: SalesOrderFlowEvidencePack,
  stockDocumentExternalId: number
): boolean {
  const doc = pack.stockDocuments.find((d) => d.externalId === stockDocumentExternalId);
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

function buildCanonicalDocumentLinks(pack: SalesOrderFlowEvidencePack) {
  const nfeLinked = new Set(
    pack.nfes
      .filter((n) => n.linkedSalesOrderIds.includes(pack.orderId))
      .map((n) => n.externalId)
  );
  // Também considera NF presentes no pack (descobertas via O2C/idNfe).
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

export type SalesOrderItemFlowAllocationBuildResult = {
  documentAllocations: SalesOrderItemFlowDocumentAllocationInput[];
  nfeAllocations: SalesOrderItemFlowNfeAllocationInput[];
};

/**
 * Monta alocações DS/NF para um item a partir do pack OP-49.
 * Não infere qty total do item quando falta alocação por linha.
 */
export function buildSalesOrderItemFlowAllocationsFromEvidence(
  pack: SalesOrderFlowEvidencePack,
  item: SalesOrderFlowEvidencePack["items"][number]
): SalesOrderItemFlowAllocationBuildResult {
  const itemAllocations = pack.allocations.filter(
    (a) => a.salesOrderItemId === item.id
  );
  const nfeById = new Map(pack.nfes.map((n) => [n.externalId, n] as const));
  const { links, documentedByItem, nfeLinked } =
    buildCanonicalDocumentLinks(pack);

  const documentAllocations: SalesOrderItemFlowDocumentAllocationInput[] = [];
  const seenDocKeys = new Set<string>();
  const o2cStockDocExternalIds = new Set<number>();

  // 1) O2C — alocação documental preferencial.
  for (const a of itemAllocations) {
    if (a.stockDocumentExternalId != null) {
      o2cStockDocExternalIds.add(a.stockDocumentExternalId);
    }
    if (a.stockDocumentExternalId == null) continue;
    const key = a.auditKey.trim();
    if (!key || seenDocKeys.has(key)) continue;
    seenDocKeys.add(key);
    const canceled = isStockDocumentCanceled(pack, a.stockDocumentExternalId);
    documentAllocations.push({
      allocationKey: key,
      quantity: a.quantityUsedForOrder ?? 0,
      isCanceled: canceled,
      isValid: !canceled,
    });
  }

  // 2) Linhas DS resolvidas canonicamente para este item.
  const itemLinks = links.filter(
    (l) =>
      l.salesOrderItemId === item.id &&
      l.advancesKanban &&
      l.itemCoverage === "RESOLVED"
  );
  for (const link of itemLinks) {
    if (o2cStockDocExternalIds.has(link.stockDocumentExternalId)) continue;
    const key = `ds-line:${link.stockDocumentItemId}`;
    if (seenDocKeys.has(key)) continue;
    seenDocKeys.add(key);
    documentAllocations.push({
      allocationKey: key,
      quantity: link.quantity,
      isValid: true,
      isCanceled: false,
    });
  }

  // Fallback de cobertura agregada do resolvedor (protege joins 1:N).
  const resolvedQty = documentedByItem.get(item.id) ?? 0;
  const allocatedSum = documentAllocations
    .filter((d) => d.isCanceled !== true && d.isValid !== false)
    .reduce((s, d) => s + (Number(d.quantity) || 0), 0);
  if (resolvedQty > allocatedSum + 0.000_001) {
    const key = `ds-resolved:${item.id}`;
    if (!seenDocKeys.has(key)) {
      seenDocKeys.add(key);
      documentAllocations.push({
        allocationKey: key,
        quantity: resolvedQty - allocatedSum,
        isValid: true,
        isCanceled: false,
      });
    }
  }

  // 3) NF — O2C preferencial; complemento via DS.idNfe (mesma qty do documento, sem 2×).
  const nfeQtyById = new Map<number, number>();
  for (const a of itemAllocations) {
    if (a.nfeExternalId == null) continue;
    const q = a.quantityUsedForOrder ?? 0;
    if (q <= 0) continue;
    nfeQtyById.set(a.nfeExternalId, (nfeQtyById.get(a.nfeExternalId) ?? 0) + q);
  }

  for (const link of itemLinks) {
    const doc = pack.stockDocuments.find(
      (d) => d.externalId === link.stockDocumentExternalId
    );
    if (!doc?.idNfe) continue;
    if (nfeQtyById.has(doc.idNfe)) continue;
    if (isStockDocumentCanceled(pack, doc.externalId)) continue;
    const nfe = nfeById.get(doc.idNfe);
    if (nfe?.isCanceled === true) continue;
    if (nfe && !nfe.isValidForBilling) continue;
    nfeQtyById.set(doc.idNfe, (nfeQtyById.get(doc.idNfe) ?? 0) + link.quantity);
  }

  // 4) Fallback canônico — item já encerrado no Nomus + NF/DS do pedido.
  const commerciallyClosedQty = resolveCommerciallyClosedCoverageQty(item);
  if (commerciallyClosedQty > 0) {
    const documentedSum = documentAllocations
      .filter((d) => d.isCanceled !== true && d.isValid !== false)
      .reduce((s, d) => s + (Number(d.quantity) || 0), 0);
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
            documentAllocations.push({
              allocationKey: key,
              quantity: allocateQty,
              isValid: true,
              isCanceled: false,
            });
          }
        }
        break;
      }
    }
  }

  const nfeAllocations: SalesOrderItemFlowNfeAllocationInput[] = [];
  const seenNfe = new Set<number>();

  for (const [nfeExternalId, quantity] of nfeQtyById) {
    if (seenNfe.has(nfeExternalId)) continue;
    seenNfe.add(nfeExternalId);
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
    nfeAllocations.push({
      nfeExternalId,
      quantity,
      isCanceled: nfe?.isCanceled === true,
      isValidForBilling:
        nfe?.isValidForBilling !== false && nfe?.isCanceled !== true,
      hasDocument,
      hasShipDate: false,
    });
  }

  return { documentAllocations, nfeAllocations };
}

/** Qty coberta quando o Nomus já encerrou comercialmente o item. */
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
