/**
 * Resolução confiável de SalesOrder a partir de NF/CR — sem heurística cliente+valor/produto.
 * Quando uma NF liga a múltiplos pedidos, o vínculo é AMBÍGUO e não deve ser atribuído.
 */

export const COMMISSION_ORDER_LINK_RESOLUTION_SOURCES = [
  "DIRECT_AR_SALES_ORDER",
  "INVOICE_SALES_ORDER",
  "SCHEDULE",
  "EXTERNAL_ID",
  "INFERRED_UNIQUE",
  "AMBIGUOUS",
  "UNRESOLVED",
] as const;

export type CommissionOrderLinkResolutionSource =
  (typeof COMMISSION_ORDER_LINK_RESOLUTION_SOURCES)[number];

export const COMMISSION_ORDER_LINK_RESOLUTION_STATUSES = [
  "OK",
  "AMBIGUOUS",
  "UNRESOLVED",
] as const;

export type CommissionOrderLinkResolutionStatus =
  (typeof COMMISSION_ORDER_LINK_RESOLUTION_STATUSES)[number];

/** Motivo padrão quando a NF do título aponta para mais de um pedido. */
export const COMMISSION_RECEIPT_AMBIGUOUS_SALES_LINK_REASON =
  "Vínculo ambíguo: há múltiplos pedidos do mesmo cliente com mesmo valor/produto (ou a mesma NF ligada a mais de um pedido).";

export type SalesOrderNfeLinkCandidate = {
  salesOrderId: string;
  orderCode?: string | null;
};

export type UniqueSalesOrderNfeLinkResolution =
  | {
      status: "OK";
      source: "INVOICE_SALES_ORDER";
      salesOrderId: string;
      orderCode: string | null;
      candidateCount: 1;
    }
  | {
      status: "AMBIGUOUS";
      source: "AMBIGUOUS";
      salesOrderId: null;
      orderCode: null;
      candidateCount: number;
      candidateOrderIds: string[];
      candidateOrderCodes: string[];
    }
  | {
      status: "UNRESOLVED";
      source: "UNRESOLVED";
      salesOrderId: null;
      orderCode: null;
      candidateCount: 0;
    };

/**
 * Resolve pedido a partir de candidatos de SalesOrderNfeLink.
 * Nunca escolhe “o primeiro” quando há mais de um.
 */
export function resolveUniqueSalesOrderFromNfeLinkCandidates(
  candidates: SalesOrderNfeLinkCandidate[]
): UniqueSalesOrderNfeLinkResolution {
  const uniqueById = new Map<string, SalesOrderNfeLinkCandidate>();
  for (const candidate of candidates) {
    if (!candidate.salesOrderId) continue;
    if (!uniqueById.has(candidate.salesOrderId)) {
      uniqueById.set(candidate.salesOrderId, candidate);
    }
  }
  const unique = [...uniqueById.values()];
  if (unique.length === 0) {
    return {
      status: "UNRESOLVED",
      source: "UNRESOLVED",
      salesOrderId: null,
      orderCode: null,
      candidateCount: 0,
    };
  }
  if (unique.length === 1) {
    const only = unique[0]!;
    return {
      status: "OK",
      source: "INVOICE_SALES_ORDER",
      salesOrderId: only.salesOrderId,
      orderCode: only.orderCode?.trim() || null,
      candidateCount: 1,
    };
  }
  return {
    status: "AMBIGUOUS",
    source: "AMBIGUOUS",
    salesOrderId: null,
    orderCode: null,
    candidateCount: unique.length,
    candidateOrderIds: unique.map((c) => c.salesOrderId),
    candidateOrderCodes: unique
      .map((c) => c.orderCode?.trim() || null)
      .filter((code): code is string => Boolean(code)),
  };
}

export type OrderBundleNfeIndexResult<T extends { localOrderId: string }> = {
  /** Apenas NFEs com exatamente um pedido candidato. */
  byNfeId: Map<number, T>;
  /** NFEs ligadas a 2+ pedidos distintos — não devem resolver automaticamente. */
  ambiguousNfeIds: Set<number>;
};

/**
 * Indexa bundles por NF externa.
 * Se a mesma NF aparecer em mais de um pedido, a NF entra em ambiguousNfeIds e NÃO no mapa.
 */
export function indexUniqueOrderBundlesByNfeId<
  T extends {
    localOrderId: string;
    linkedNfes: Array<{ nfeExternalId: number }>;
  },
>(bundles: T[]): OrderBundleNfeIndexResult<T> {
  const buckets = new Map<number, T[]>();
  for (const bundle of bundles) {
    for (const nfe of bundle.linkedNfes) {
      const nfeId = nfe.nfeExternalId;
      if (!Number.isFinite(nfeId) || nfeId <= 0) continue;
      const list = buckets.get(nfeId) ?? [];
      if (!list.some((b) => b.localOrderId === bundle.localOrderId)) {
        list.push(bundle);
      }
      buckets.set(nfeId, list);
    }
  }

  const byNfeId = new Map<number, T>();
  const ambiguousNfeIds = new Set<number>();
  for (const [nfeId, list] of buckets) {
    if (list.length === 1) {
      byNfeId.set(nfeId, list[0]!);
    } else if (list.length > 1) {
      ambiguousNfeIds.add(nfeId);
    }
  }
  return { byNfeId, ambiguousNfeIds };
}

/**
 * @deprecated Prefer indexUniqueOrderBundlesByNfeId — mantido como alias que descarta ambíguos.
 * Não escolhe o primeiro pedido quando a NF é compartilhada.
 */
export function indexOrderBundlesByNfeId<
  T extends {
    localOrderId: string;
    linkedNfes: Array<{ nfeExternalId: number }>;
  },
>(bundles: T[]): Map<number, T> {
  return indexUniqueOrderBundlesByNfeId(bundles).byNfeId;
}
