/**
 * Alocações documentais e fiscais por item — vínculo canônico Pedido → DS → NF-e.
 *
 * Fontes (sem fuzzy matching):
 * - OrderToCashAuditFact (quantityUsedForOrder por salesOrderItemId) — preferencial
 * - NomusStockDocumentItem.externalProductId ↔ SalesOrderItem.externalProductId
 * - NomusStockDocument.idNfe (NF ligada ao DS, mesmo sem SalesOrderNfeLink)
 * - Fallback: item comercialmente encerrado (FULLY_FULFILLED / FULFILLED_WITH_CUT)
 *   + SalesOrderNfeLink / NF válida do pedido + DS por idNfe
 *
 * O pack OP-49 já é escoped por pedido; documentos nele são evidência canônica
 * do pedido (O2C ou DS cujo idNfe pertence ao pedido).
 */

import type { SalesOrderFlowEvidencePack } from "./salesOrderFlowEvidence.js";
import type {
  SalesOrderItemFlowDocumentAllocationInput,
  SalesOrderItemFlowNfeAllocationInput,
} from "./salesOrderItemFlowEngine.js";

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

function sumStockDocumentItemQtyForProduct(
  pack: SalesOrderFlowEvidencePack,
  stockDocumentExternalId: number,
  externalProductId: number | null
): number {
  if (externalProductId == null) return 0;
  let total = 0;
  for (const row of pack.stockDocumentItems) {
    if (row.stockDocumentExternalId !== stockDocumentExternalId) continue;
    if (row.externalProductId !== externalProductId) continue;
    total += row.quantity ?? 0;
  }
  return total;
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
  const itemAllocations = pack.allocations.filter((a) => a.salesOrderItemId === item.id);
  const nfeById = new Map(pack.nfes.map((n) => [n.externalId, n] as const));

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

  // 2) DS do pack por produto (sem NF obrigatória; evita duplicar O2C).
  for (const doc of pack.stockDocuments) {
    if (o2cStockDocExternalIds.has(doc.externalId)) continue;
    if (isStockDocumentCanceled(pack, doc.externalId)) continue;

    const qtyFromItems = sumStockDocumentItemQtyForProduct(
      pack,
      doc.externalId,
      item.externalProductId
    );
    if (qtyFromItems <= 0) continue;

    const key = `ds:${doc.externalId}:product:${item.externalProductId ?? "na"}`;
    if (seenDocKeys.has(key)) continue;
    seenDocKeys.add(key);
    documentAllocations.push({
      allocationKey: key,
      quantity: qtyFromItems,
      isValid: true,
      isCanceled: false,
    });
  }

  // 3) NF — O2C preferencial; complemento via DS.idNfe → linhas do produto.
  const nfeQtyById = new Map<number, number>();
  for (const a of itemAllocations) {
    if (a.nfeExternalId == null) continue;
    const q = a.quantityUsedForOrder ?? 0;
    if (q <= 0) continue;
    nfeQtyById.set(a.nfeExternalId, (nfeQtyById.get(a.nfeExternalId) ?? 0) + q);
  }

  for (const doc of pack.stockDocuments) {
    if (doc.idNfe == null) continue;
    if (nfeQtyById.has(doc.idNfe)) continue;
    if (isStockDocumentCanceled(pack, doc.externalId)) continue;

    const qtyFromItems = sumStockDocumentItemQtyForProduct(
      pack,
      doc.externalId,
      item.externalProductId
    );
    if (qtyFromItems <= 0) continue;
    nfeQtyById.set(doc.idNfe, (nfeQtyById.get(doc.idNfe) ?? 0) + qtyFromItems);
  }

  // 4) Fallback canônico — item já encerrado no Nomus + NF/DS do pedido.
  // Garante que SalesOrderNfeLink / DS.idNfe sejam visíveis ao Kanban mesmo
  // quando OrderToCashAuditFact ou match por produto estiverem incompletos.
  const commerciallyClosedQty = resolveCommerciallyClosedCoverageQty(item);
  if (commerciallyClosedQty > 0) {
    const documentedSum = documentAllocations
      .filter((d) => d.isCanceled !== true && d.isValid !== false)
      .reduce((s, d) => s + (Number(d.quantity) || 0), 0);
    const invoicedSum = [...nfeQtyById.values()].reduce((s, q) => s + q, 0);
    const gap = Math.max(0, commerciallyClosedQty - Math.max(documentedSum, invoicedSum));

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
        const qtyFromDocs = docsForNfe.reduce((sum, doc) => {
          const byProduct = sumStockDocumentItemQtyForProduct(
            pack,
            doc.externalId,
            item.externalProductId
          );
          return sum + byProduct;
        }, 0);
        // Sem linha de produto: usa o gap comercial (pedido já encerrado no Nomus).
        const allocateQty =
          qtyFromDocs > 0
            ? Math.min(gap, qtyFromDocs)
            : docsForNfe.length > 0 || validNfes.length > 0
              ? gap
              : 0;
        if (allocateQty <= 0) continue;

        nfeQtyById.set(nfe.externalId, allocateQty);

        if (docsForNfe.length > 0 && documentedSum + 0.000_001 < commerciallyClosedQty) {
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
        (d) => d.idNfe === nfeExternalId && !isStockDocumentCanceled(pack, d.externalId)
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
      isValidForBilling: nfe?.isValidForBilling !== false && nfe?.isCanceled !== true,
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
  // Atendido integral por qty mesmo se status ainda não normalizado.
  if (ordered > 0 && fulfilled + 0.000_001 >= ordered) {
    return Math.max(0, fulfilled);
  }
  return 0;
}
