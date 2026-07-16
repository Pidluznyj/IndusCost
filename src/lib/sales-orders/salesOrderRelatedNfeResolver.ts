/**
 * TRIB-03 — Resolver único de NF-es relacionadas a um Pedido de Venda.
 *
 * Fontes oficiais (somente leitura; sem Nomus HTTP; sem criar vínculos):
 * 1. SalesOrderNfeLink
 * 2. Pedido → Documento de Saída → idNfe (via fatos O2C materializados / DS)
 * 3. OrderToCashAuditFact.nfeExternalId
 * 4. Referências oficiais por item (quando existentes)
 *
 * Não usa coincidência aproximada por cliente, valor ou data.
 */

import { isNomusNfeCancelled } from "@/src/lib/finance/nfeStatus.js";

export const SALES_ORDER_RELATED_NFE_ORIGINS = [
  "SALES_ORDER_NFE_LINK",
  "STOCK_DOCUMENT",
  "ORDER_TO_CASH",
  "ITEM_REF",
] as const;

export type SalesOrderRelatedNfeOrigin =
  (typeof SALES_ORDER_RELATED_NFE_ORIGINS)[number];

/** Prioridade para `primaryOrigin` (mais específico primeiro). */
const ORIGIN_PRIORITY: Record<SalesOrderRelatedNfeOrigin, number> = {
  ITEM_REF: 0,
  SALES_ORDER_NFE_LINK: 1,
  STOCK_DOCUMENT: 2,
  ORDER_TO_CASH: 3,
};

export type SalesOrderRelatedNfeLinkEvidence = {
  nfeExternalId: number;
  nfeNumber?: string | null;
  nfeKey?: string | null;
  nfeStatus?: number | null;
  presentInLastPayload?: boolean | null;
  linkId?: string | null;
};

export type SalesOrderRelatedNfeO2cEvidence = {
  nfeExternalId?: number | null;
  nfeNumber?: string | null;
  nfeKey?: string | null;
  stockDocumentExternalId?: number | null;
  stockDocumentIdNfe?: number | null;
  salesOrderItemId?: string | null;
  nfeItemMatchedOrderItem?: boolean | null;
};

export type SalesOrderRelatedNfeStockDocumentEvidence = {
  stockDocumentExternalId: number;
  idNfe: number | null;
};

/** Referência estrutural Pedido-item → NF (ids oficiais; sem heurística). */
export type SalesOrderRelatedNfeItemRefEvidence = {
  salesOrderItemId: string;
  nfeExternalId: number;
  nfeNumber?: string | null;
};

/** Links da mesma NF em outros pedidos (auditoria de conflito). */
export type SalesOrderRelatedNfeForeignLink = {
  salesOrderId: string;
  orderCode?: string | null;
  nfeExternalId: number;
};

export type SalesOrderRelatedNfeStatusHint = {
  nfeExternalId: number;
  status?: number | string | null;
  isCanceled?: boolean | null;
};

export type SalesOrderRelatedNfeResolveInput = {
  salesOrderId: string;
  links?: readonly SalesOrderRelatedNfeLinkEvidence[] | null;
  o2cFacts?: readonly SalesOrderRelatedNfeO2cEvidence[] | null;
  stockDocuments?: readonly SalesOrderRelatedNfeStockDocumentEvidence[] | null;
  itemRefs?: readonly SalesOrderRelatedNfeItemRefEvidence[] | null;
  foreignLinks?: readonly SalesOrderRelatedNfeForeignLink[] | null;
  nfeStatusHints?: readonly SalesOrderRelatedNfeStatusHint[] | null;
};

export type SalesOrderRelatedNfeSourceHit = {
  origin: SalesOrderRelatedNfeOrigin;
  nfeNumber: string | null;
  nfeKey: string | null;
  stockDocumentExternalId: number | null;
  salesOrderItemId: string | null;
  linkId: string | null;
};

export type SalesOrderRelatedNfeConflict = {
  kind: "FOREIGN_ORDER_LINK" | "IDENTITY_MISMATCH";
  message: string;
  conflictingSalesOrderIds: string[];
  conflictingOrderCodes: string[];
  identityValues?: {
    nfeNumbers: string[];
    nfeKeys: string[];
  };
};

export type SalesOrderRelatedNfeResolved = {
  nfeExternalId: number;
  origins: SalesOrderRelatedNfeOrigin[];
  primaryOrigin: SalesOrderRelatedNfeOrigin;
  sources: SalesOrderRelatedNfeSourceHit[];
  nfeNumber: string | null;
  nfeKey: string | null;
  isCanceled: boolean;
  /** Cancelada pode ir para auditoria, mas não para totais tributários. */
  includeInTaxTotals: boolean;
  hasConflict: boolean;
  conflict: SalesOrderRelatedNfeConflict | null;
};

export type SalesOrderRelatedNfeResolveResult = {
  salesOrderId: string;
  nfes: SalesOrderRelatedNfeResolved[];
  /** Ids positivos únicos, ordenados. */
  nfeExternalIds: number[];
  /** Subconjunto elegível a totais tributários. */
  nfeExternalIdsForTaxTotals: number[];
};

type MutableBucket = {
  nfeExternalId: number;
  origins: Set<SalesOrderRelatedNfeOrigin>;
  sources: SalesOrderRelatedNfeSourceHit[];
  nfeNumbers: Set<string>;
  nfeKeys: Set<string>;
  statusHints: Array<number | string | boolean>;
};

function positiveInt(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.trunc(value);
  }
  if (typeof value === "string" && value.trim()) {
    const n = Number(value.trim());
    if (Number.isFinite(n) && n > 0) return Math.trunc(n);
  }
  return null;
}

function normalizeText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const t = value.trim();
  return t ? t : null;
}

function ensureBucket(
  map: Map<number, MutableBucket>,
  nfeExternalId: number
): MutableBucket {
  let bucket = map.get(nfeExternalId);
  if (!bucket) {
    bucket = {
      nfeExternalId,
      origins: new Set(),
      sources: [],
      nfeNumbers: new Set(),
      nfeKeys: new Set(),
      statusHints: [],
    };
    map.set(nfeExternalId, bucket);
  }
  return bucket;
}

function addHit(
  bucket: MutableBucket,
  hit: {
    origin: SalesOrderRelatedNfeOrigin;
    nfeNumber?: string | null;
    nfeKey?: string | null;
    stockDocumentExternalId?: number | null;
    salesOrderItemId?: string | null;
    linkId?: string | null;
    nfeStatus?: number | string | null;
  }
): void {
  bucket.origins.add(hit.origin);
  const nfeNumber = normalizeText(hit.nfeNumber);
  const nfeKey = normalizeText(hit.nfeKey);
  if (nfeNumber) bucket.nfeNumbers.add(nfeNumber);
  if (nfeKey) bucket.nfeKeys.add(nfeKey);
  if (hit.nfeStatus != null && hit.nfeStatus !== "") {
    bucket.statusHints.push(hit.nfeStatus);
  }
  bucket.sources.push({
    origin: hit.origin,
    nfeNumber,
    nfeKey,
    stockDocumentExternalId: hit.stockDocumentExternalId ?? null,
    salesOrderItemId: hit.salesOrderItemId ?? null,
    linkId: hit.linkId ?? null,
  });
}

function pickPrimaryOrigin(
  origins: Iterable<SalesOrderRelatedNfeOrigin>
): SalesOrderRelatedNfeOrigin {
  let best: SalesOrderRelatedNfeOrigin | null = null;
  let bestRank = Number.POSITIVE_INFINITY;
  for (const origin of origins) {
    const rank = ORIGIN_PRIORITY[origin];
    if (rank < bestRank) {
      best = origin;
      bestRank = rank;
    }
  }
  return best ?? "ORDER_TO_CASH";
}

function sortOrigins(
  origins: Iterable<SalesOrderRelatedNfeOrigin>
): SalesOrderRelatedNfeOrigin[] {
  return [...origins].sort(
    (a, b) => ORIGIN_PRIORITY[a] - ORIGIN_PRIORITY[b] || a.localeCompare(b)
  );
}

/**
 * Extrai id de NF estrutural de `SalesOrderItem.nomusRawItem` (chaves oficiais).
 * Não usa nome de produto, valor ou data.
 */
export function extractOfficialItemNfeExternalId(
  nomusRawItem: unknown
): number | null {
  if (nomusRawItem == null || typeof nomusRawItem !== "object") return null;
  const obj = nomusRawItem as Record<string, unknown>;
  const keys = [
    "idNfe",
    "idNotaFiscal",
    "idNota",
    "nfeId",
    "idNFe",
    "notaFiscalId",
  ] as const;
  for (const key of keys) {
    const id = positiveInt(obj[key]);
    if (id != null) return id;
  }
  const nested = obj.nfe;
  if (nested != null && typeof nested === "object" && !Array.isArray(nested)) {
    const nfeObj = nested as Record<string, unknown>;
    for (const key of ["id", "idNfe", "externalId"] as const) {
      const id = positiveInt(nfeObj[key]);
      if (id != null) return id;
    }
  }
  return null;
}

/**
 * Resolve NF-es relacionadas a um pedido a partir de evidências já carregadas.
 * Idempotente, sem I/O.
 */
export function resolveSalesOrderRelatedNfes(
  input: SalesOrderRelatedNfeResolveInput
): SalesOrderRelatedNfeResolveResult {
  const salesOrderId = input.salesOrderId;
  const buckets = new Map<number, MutableBucket>();

  for (const link of input.links ?? []) {
    const id = positiveInt(link.nfeExternalId);
    if (id == null) continue;
    // Ausente do último payload ainda conta para auditoria (histórico).
    addHit(ensureBucket(buckets, id), {
      origin: "SALES_ORDER_NFE_LINK",
      nfeNumber: link.nfeNumber,
      nfeKey: link.nfeKey,
      linkId: link.linkId ?? null,
      nfeStatus: link.nfeStatus,
    });
  }

  for (const fact of input.o2cFacts ?? []) {
    const nfeFromFact = positiveInt(fact.nfeExternalId);
    const nfeFromStockField = positiveInt(fact.stockDocumentIdNfe);
    const stockDocExt = positiveInt(fact.stockDocumentExternalId);

    if (nfeFromFact != null) {
      addHit(ensureBucket(buckets, nfeFromFact), {
        origin: "ORDER_TO_CASH",
        nfeNumber: fact.nfeNumber,
        nfeKey: fact.nfeKey,
        stockDocumentExternalId: stockDocExt,
        salesOrderItemId: fact.salesOrderItemId ?? null,
      });
    }

    if (nfeFromStockField != null) {
      addHit(ensureBucket(buckets, nfeFromStockField), {
        origin: "STOCK_DOCUMENT",
        nfeNumber: fact.nfeNumber,
        nfeKey: fact.nfeKey,
        stockDocumentExternalId: stockDocExt,
        salesOrderItemId: fact.salesOrderItemId ?? null,
      });
    }

    // Item × NF materializado no O2C (referência oficial por item).
    if (
      fact.nfeItemMatchedOrderItem === true &&
      fact.salesOrderItemId &&
      (nfeFromFact != null || nfeFromStockField != null)
    ) {
      const itemNfeId = nfeFromFact ?? nfeFromStockField!;
      addHit(ensureBucket(buckets, itemNfeId), {
        origin: "ITEM_REF",
        nfeNumber: fact.nfeNumber,
        nfeKey: fact.nfeKey,
        stockDocumentExternalId: stockDocExt,
        salesOrderItemId: fact.salesOrderItemId,
      });
    }
  }

  for (const doc of input.stockDocuments ?? []) {
    const id = positiveInt(doc.idNfe);
    const stockExt = positiveInt(doc.stockDocumentExternalId);
    if (id == null || stockExt == null) continue;
    addHit(ensureBucket(buckets, id), {
      origin: "STOCK_DOCUMENT",
      stockDocumentExternalId: stockExt,
    });
  }

  for (const ref of input.itemRefs ?? []) {
    const id = positiveInt(ref.nfeExternalId);
    if (id == null || !ref.salesOrderItemId) continue;
    addHit(ensureBucket(buckets, id), {
      origin: "ITEM_REF",
      nfeNumber: ref.nfeNumber,
      salesOrderItemId: ref.salesOrderItemId,
    });
  }

  const statusById = new Map<number, SalesOrderRelatedNfeStatusHint>();
  for (const hint of input.nfeStatusHints ?? []) {
    const id = positiveInt(hint.nfeExternalId);
    if (id == null) continue;
    statusById.set(id, hint);
  }

  const foreignByNfe = new Map<number, SalesOrderRelatedNfeForeignLink[]>();
  for (const foreign of input.foreignLinks ?? []) {
    const id = positiveInt(foreign.nfeExternalId);
    if (id == null) continue;
    if (foreign.salesOrderId === salesOrderId) continue;
    const list = foreignByNfe.get(id) ?? [];
    list.push(foreign);
    foreignByNfe.set(id, list);
  }

  const nfes: SalesOrderRelatedNfeResolved[] = [];

  for (const bucket of buckets.values()) {
    const origins = sortOrigins(bucket.origins);
    const primaryOrigin = pickPrimaryOrigin(origins);
    const nfeNumbers = [...bucket.nfeNumbers].sort();
    const nfeKeys = [...bucket.nfeKeys].sort();

    const statusHint = statusById.get(bucket.nfeExternalId);
    let isCanceled = false;
    if (statusHint?.isCanceled === true) {
      isCanceled = true;
    } else if (statusHint?.status != null) {
      isCanceled = isNomusNfeCancelled(statusHint.status);
    } else {
      for (const hint of bucket.statusHints) {
        if (typeof hint === "boolean") {
          if (hint) isCanceled = true;
          continue;
        }
        if (isNomusNfeCancelled(hint)) {
          isCanceled = true;
          break;
        }
      }
    }

    const foreign = foreignByNfe.get(bucket.nfeExternalId) ?? [];
    const uniqueForeignOrders = new Map<string, SalesOrderRelatedNfeForeignLink>();
    for (const row of foreign) {
      if (!uniqueForeignOrders.has(row.salesOrderId)) {
        uniqueForeignOrders.set(row.salesOrderId, row);
      }
    }

    let conflict: SalesOrderRelatedNfeConflict | null = null;
    if (uniqueForeignOrders.size > 0) {
      const rows = [...uniqueForeignOrders.values()];
      conflict = {
        kind: "FOREIGN_ORDER_LINK",
        message: `NF ${bucket.nfeExternalId} também está vinculada a outro(s) pedido(s) via SalesOrderNfeLink.`,
        conflictingSalesOrderIds: rows.map((r) => r.salesOrderId),
        conflictingOrderCodes: rows
          .map((r) => normalizeText(r.orderCode))
          .filter((c): c is string => c != null),
      };
    } else if (nfeNumbers.length > 1 || nfeKeys.length > 1) {
      conflict = {
        kind: "IDENTITY_MISMATCH",
        message: `Fontes divergem na identidade da NF ${bucket.nfeExternalId} (número/chave).`,
        conflictingSalesOrderIds: [],
        conflictingOrderCodes: [],
        identityValues: { nfeNumbers, nfeKeys },
      };
    }

    nfes.push({
      nfeExternalId: bucket.nfeExternalId,
      origins,
      primaryOrigin,
      sources: bucket.sources,
      nfeNumber: nfeNumbers[0] ?? null,
      nfeKey: nfeKeys[0] ?? null,
      isCanceled,
      includeInTaxTotals: !isCanceled,
      hasConflict: conflict != null,
      conflict,
    });
  }

  nfes.sort(
    (a, b) =>
      a.nfeExternalId - b.nfeExternalId ||
      ORIGIN_PRIORITY[a.primaryOrigin] - ORIGIN_PRIORITY[b.primaryOrigin]
  );

  const nfeExternalIds = nfes.map((n) => n.nfeExternalId);
  const nfeExternalIdsForTaxTotals = nfes
    .filter((n) => n.includeInTaxTotals)
    .map((n) => n.nfeExternalId);

  return {
    salesOrderId,
    nfes,
    nfeExternalIds,
    nfeExternalIdsForTaxTotals,
  };
}

/**
 * Mapeia origem do resolver para `OrderFullAuditNfe.linkOrigin` existente.
 */
export function mapRelatedNfeOriginToAuditLinkOrigin(
  origin: SalesOrderRelatedNfeOrigin
): "ITEM_EVIDENCE" | "SALES_ORDER_NFE_LINK" | "HEADER_ONLY" {
  if (origin === "SALES_ORDER_NFE_LINK") return "SALES_ORDER_NFE_LINK";
  if (origin === "ITEM_REF" || origin === "STOCK_DOCUMENT" || origin === "ORDER_TO_CASH") {
    return "ITEM_EVIDENCE";
  }
  return "HEADER_ONLY";
}
