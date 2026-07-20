/**
 * Adapter fino: ResolvedOutputDocument (resolver canônico) → DTOs da Auditoria 360º.
 * Não redesenha regras de Pedido/NF-e/CR — só projeta e escolhe o CR principal.
 */

import type { ResolvedOutputDocument } from "@/src/lib/output-documents/nomusOutputDocumentResolver.js";
import {
  allocatedValueForSalesOrder,
  allocationLinesFromResolvedO2c,
  projectOutputDocumentAllocation,
  type OutputDocumentAllocationProjection,
} from "@/src/lib/output-documents/outputDocumentAllocationProjection.js";
import { emptyOrderFullAuditStockDocument } from "./orderFullAuditDocuments.js";
import type { OrderFullAuditStockDocument } from "./orderFullAuditClient.js";

export type OutputDocumentReceivablePick = {
  externalId: number;
  sourceInvoiceId: number | null;
  balanceReceivable: string | null;
  status: boolean | null;
};

/**
 * Escolhe um CR representativo para a coluna da grade:
 * preferir título em aberto (balance > 0); senão o de menor externalId.
 */
export function pickPrimaryReceivableExternalId(
  receivables: ReadonlyArray<OutputDocumentReceivablePick>
): number | null {
  if (receivables.length === 0) return null;
  const sorted = [...receivables].sort((a, b) => a.externalId - b.externalId);
  const open = sorted.find((r) => {
    if (r.balanceReceivable == null) return false;
    const balance = Number(r.balanceReceivable);
    return Number.isFinite(balance) && balance > 0.000001;
  });
  return (open ?? sorted[0])?.externalId ?? null;
}

/**
 * Mapa idNfe → receivableExternalId a partir dos documentos resolvidos.
 * Evita coluna CR sempre nula quando o stage/resolver já trouxe títulos.
 */
export function buildReceivableExternalIdByNfeMap(
  resolvedDocs: ReadonlyArray<
    Pick<ResolvedOutputDocument, "document" | "nfe" | "receivables">
  >
): Map<number, number> {
  const map = new Map<number, number>();
  for (const resolved of resolvedDocs) {
    const idNfe =
      resolved.document.idNfe ??
      resolved.nfe.externalId ??
      resolved.nfe.record?.externalId ??
      null;
    if (idNfe == null || idNfe <= 0) continue;
    if (map.has(idNfe)) continue;
    const picked = pickPrimaryReceivableExternalId(
      resolved.receivables.receivables
    );
    if (picked != null) map.set(idNfe, picked);
  }
  return map;
}

export function resolveAuditDocumentReceivableExternalId(
  idNfe: number | null | undefined,
  receivableByNfeId: ReadonlyMap<number, number>
): number | null {
  if (idNfe == null || idNfe <= 0) return null;
  return receivableByNfeId.get(idNfe) ?? null;
}

export function resolveAuditDocumentNfeNumber(
  idNfe: number | null | undefined,
  nfeByExternalId: ReadonlyMap<number, { numero: string | null }>,
  fallback: string | null = null
): string | null {
  if (idNfe == null || idNfe <= 0) return fallback;
  const numero = nfeByExternalId.get(idNfe)?.numero?.trim();
  return numero || fallback;
}

/**
 * Stub de cabeçalho a partir do documento resolvido (sem depender de fact O2C).
 */
export function stockDocumentEntryFromResolved(
  resolved: ResolvedOutputDocument,
  partial: Partial<OrderFullAuditStockDocument> = {}
): OrderFullAuditStockDocument {
  const doc = resolved.document;
  const linkOrigin = resolved.o2c.present
    ? "ORDER_TO_CASH"
    : resolved.orders.orders.length > 0
      ? "SALES_ORDER_NFE_LINK"
      : "HEADER_ONLY";
  return emptyOrderFullAuditStockDocument(doc.externalId, {
    stockDocumentId: doc.id,
    documentNumber: doc.documentNumber?.trim() || null,
    tipoDocumentoEstoque: doc.tipoDocumentoEstoque,
    dataDocumento:
      doc.dataDocumento instanceof Date
        ? doc.dataDocumento.toISOString()
        : doc.dataDocumento
          ? String(doc.dataDocumento)
          : null,
    dataMovimentacao:
      doc.movementDate instanceof Date
        ? doc.movementDate.toISOString()
        : doc.movementDate
          ? String(doc.movementDate)
          : null,
    customerName: doc.personName,
    companyName: doc.companyName,
    idNfe: doc.idNfe,
    status: doc.statusRaw,
    isCancelled: doc.isCancelled === true,
    linkOrigin,
    alerts: doc.isCancelled === true ? ["DOCUMENT_CANCELLED"] : [],
    ...partial,
  });
}

/**
 * Projeta alocação do documento resolvido (fonte canônica) para o pedido em foco.
 */
export function projectResolvedOutputDocumentForOrder(
  resolved: ResolvedOutputDocument,
  focusSalesOrderId: string,
  orderItemHints: ReadonlyArray<{
    salesOrderItemId: string;
    salesOrderId: string;
    orderCode: string | null;
    externalProductId: number | null;
  }> = []
): {
  projection: OutputDocumentAllocationProjection;
  forThisOrder: { allocatedValue: number; allocatedValueCents: number };
} {
  const allocationLines = allocationLinesFromResolvedO2c(
    resolved.o2c.allocationLines,
    resolved.items.map((item) => ({
      stockDocumentItemId: item.id,
      externalProductId: item.externalProductId,
    }))
  );
  const projection = projectOutputDocumentAllocation({
    document: {
      id: resolved.document.id,
      externalId: resolved.document.externalId,
      idNfe: resolved.document.idNfe,
      totalValue: resolved.document.totalValue,
      items: resolved.items.map((item) => ({
        id: item.id,
        externalItemId: item.externalItemId,
        externalProductId: item.externalProductId,
        quantity: item.quantity,
        unitValue: item.unitValue,
        estimatedTotalValue: item.estimatedTotalValue,
      })),
    },
    allocationLines,
    orderItemHints,
    focusSalesOrderId,
  });
  return {
    projection,
    forThisOrder: allocatedValueForSalesOrder(projection, focusSalesOrderId),
  };
}

/**
 * Dedup estável por externalId — preserva a primeira ocorrência (ordem do resolver).
 */
export function dedupeResolvedOutputDocumentsByExternalId(
  docs: ReadonlyArray<ResolvedOutputDocument>
): ResolvedOutputDocument[] {
  const seen = new Set<number>();
  const out: ResolvedOutputDocument[] = [];
  for (const doc of docs) {
    const id = doc.document.externalId;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(doc);
  }
  return out;
}
