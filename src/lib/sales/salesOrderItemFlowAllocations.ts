/**
 * Alocações documentais e fiscais por item — vínculo canônico Pedido → DS → NF-e.
 *
 * Fontes (sem fuzzy matching):
 * - OrderToCashAuditFact (quantityUsedForOrder por salesOrderItemId) — preferencial
 * - NomusStockDocumentItem.externalProductId ↔ SalesOrderItem.externalProductId
 * - NomusStockDocument.idNfe (NF ligada ao DS, mesmo sem SalesOrderNfeLink)
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
