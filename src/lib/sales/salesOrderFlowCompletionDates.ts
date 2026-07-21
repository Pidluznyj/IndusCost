/**
 * OP-04 — Datas estáveis de conclusão do fluxo (pedido).
 * Puro: sem I/O. Não usa horário de avaliação/auditoria.
 */

import type { SalesOrderFlowEvidencePack } from "./salesOrderFlowEvidence.js";

export type SalesOrderFlowItemTemporalAt = {
  salesOrderItemId: string;
  at: Date | string;
};

export type SalesOrderFlowItemShippedAtRef = {
  salesOrderItemId: string;
  shippedAt: Date | string;
};

function toValidDate(value: Date | string | null | undefined): Date | null {
  if (value == null) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function toIso(value: Date | string | null | undefined): string | null {
  const d = toValidDate(value ?? null);
  return d ? d.toISOString() : null;
}

/** Máximo ISO entre datas válidas (conclusão = última evidência). */
export function maxIsoTimestamp(
  values: readonly (Date | string | null | undefined)[]
): string | null {
  let best: number | null = null;
  for (const value of values) {
    const d = toValidDate(value ?? null);
    if (!d) continue;
    const t = d.getTime();
    if (best == null || t > best) best = t;
  }
  return best == null ? null : new Date(best).toISOString();
}

/** Mínimo ISO entre datas válidas (primeiro envio). */
export function minIsoTimestamp(
  values: readonly (Date | string | null | undefined)[]
): string | null {
  let best: number | null = null;
  for (const value of values) {
    const d = toValidDate(value ?? null);
    if (!d) continue;
    const t = d.getTime();
    if (best == null || t < best) best = t;
  }
  return best == null ? null : new Date(best).toISOString();
}

/**
 * Precedência oficial de completedAt para SHIPPED_COMPLETED:
 * 1) última data de envio/saída normalizada
 * 2) última data de documento de saída válido
 * 3) última data confiável de NF-e válida (issuedAt)
 * 4) completedAt persistido (mesmo estágio terminal, sem nova evidência)
 * 5) null
 *
 * Nunca usa referenceDate / agora / horário de auditoria.
 */
export function resolveSalesOrderFlowCompletedAt(input: {
  isShippedCompleted: boolean;
  lastNormalizedShippedAt: string | null;
  lastDocumentAt: string | null;
  lastNfeIssuedAt: string | null;
  persistedCompletedAt?: Date | string | null;
}): string | null {
  if (!input.isShippedCompleted) return null;
  return (
    input.lastNormalizedShippedAt ??
    input.lastDocumentAt ??
    input.lastNfeIssuedAt ??
    toIso(input.persistedCompletedAt) ??
    null
  );
}

/**
 * Extrai evidências temporais por item a partir do pack OP-49.
 * - documento: última dataDocumento não cancelada alocada ao item
 * - NF-e: última issuedAt de NF válida vinculada ao item
 */
export function collectSalesOrderFlowItemTemporalEvidence(
  pack: Pick<
    SalesOrderFlowEvidencePack,
    "items" | "allocations" | "stockDocuments" | "nfes" | "validNfes"
  >
): {
  itemDocumentAt: SalesOrderFlowItemTemporalAt[];
  itemNfeIssuedAt: SalesOrderFlowItemTemporalAt[];
} {
  const canceledDocIds = new Set(
    pack.stockDocuments
      .filter((d) => {
        if (d.isCancelled === true) return true;
        const raw = (d.statusRaw ?? "").toLowerCase();
        return raw.includes("cancel");
      })
      .map((d) => d.externalId)
  );

  const docsByExternalId = new Map(
    pack.stockDocuments.map((d) => [d.externalId, d] as const)
  );
  const nfeById = new Map(
    [...pack.nfes, ...pack.validNfes].map((n) => [n.externalId, n] as const)
  );

  const itemDocumentAt: SalesOrderFlowItemTemporalAt[] = [];
  const itemNfeIssuedAt: SalesOrderFlowItemTemporalAt[] = [];

  for (const item of pack.items) {
    const allocations = pack.allocations.filter(
      (a) => a.salesOrderItemId === item.id
    );

    const docDates: Date[] = [];
    for (const a of allocations) {
      if (a.stockDocumentExternalId == null) continue;
      if (canceledDocIds.has(a.stockDocumentExternalId)) continue;
      const doc = docsByExternalId.get(a.stockDocumentExternalId);
      if (!doc) continue;
      const d = toValidDate(doc.dataDocumento);
      if (d) docDates.push(d);
    }
    const lastDoc = maxIsoTimestamp(docDates);
    if (lastDoc) {
      itemDocumentAt.push({ salesOrderItemId: item.id, at: lastDoc });
    }

    const nfeDates: Date[] = [];
    const seenNfe = new Set<number>();
    for (const a of allocations) {
      if (a.nfeExternalId == null || seenNfe.has(a.nfeExternalId)) continue;
      seenNfe.add(a.nfeExternalId);
      const nfe = nfeById.get(a.nfeExternalId);
      if (!nfe || nfe.isCanceled === true || nfe.isValidForBilling === false) {
        continue;
      }
      const d = toValidDate(nfe.issuedAt);
      if (d) nfeDates.push(d);
    }
    const lastNfe = maxIsoTimestamp(nfeDates);
    if (lastNfe) {
      itemNfeIssuedAt.push({ salesOrderItemId: item.id, at: lastNfe });
    }
  }

  return { itemDocumentAt, itemNfeIssuedAt };
}

/** Monta o pedaço de contexto de datas para o motor OP-51 a partir do pack. */
export function buildSalesOrderFlowCompletionContextFromPack(
  pack: SalesOrderFlowEvidencePack,
  options?: {
    itemShippedAt?: readonly SalesOrderFlowItemShippedAtRef[];
    persistedCompletedAt?: Date | string | null;
  }
): {
  itemShippedAt?: readonly SalesOrderFlowItemShippedAtRef[];
  itemDocumentAt: SalesOrderFlowItemTemporalAt[];
  itemNfeIssuedAt: SalesOrderFlowItemTemporalAt[];
  persistedCompletedAt: Date | string | null;
} {
  const temporal = collectSalesOrderFlowItemTemporalEvidence(pack);
  return {
    itemShippedAt: options?.itemShippedAt,
    itemDocumentAt: temporal.itemDocumentAt,
    itemNfeIssuedAt: temporal.itemNfeIssuedAt,
    persistedCompletedAt: options?.persistedCompletedAt ?? null,
  };
}
