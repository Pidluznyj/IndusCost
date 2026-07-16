/**
 * Classificação pura de vínculos Documento de Saída ↔ NF-e ↔ Pedido (DS-02.5).
 * Não altera vínculos. Não acessa banco.
 */

export const NOMUS_NFE_CANCELLED_STATUS = 7;

export type LinkClassification =
  | "persistido"
  | "derivado"
  | "inferido"
  | "conflitante"
  | "nao_resolvido";

export type LinkSourceKind =
  | "stock_document_idNfe"
  | "sales_order_nfe_link"
  | "order_to_cash_fact"
  | "raw_json"
  | "stock_document_item";

export type DocumentNfeLinkEvidence = {
  documentExternalId: number;
  persistedIdNfe: number | null;
  nfeExistsLocally: boolean;
  nfeStatus: number | null;
  /** IDs de NF observados no rawJson do documento (amostra/hipótese). */
  rawJsonNfeIds: number[];
  /** IDs de NF vindos de OrderToCashAuditFact para o documento. */
  o2cNfeIds: number[];
};

export type DocumentSalesOrderLinkEvidence = {
  documentExternalId: number;
  persistedIdNfe: number | null;
  /** Pedidos ligados via SalesOrderNfeLink.nfeExternalId = idNfe. */
  ordersViaNfeLink: string[];
  /** Pedidos ligados via OrderToCashAuditFact. */
  ordersViaO2c: string[];
  /** Pedidos mencionados no rawJson (hipótese). */
  ordersViaRawJson: string[];
  /** Há fact O2C com salesOrderItemId preenchido para o documento. */
  hasO2cItemResolution: boolean;
};

export type ClassifiedLink = {
  classification: LinkClassification;
  sources: LinkSourceKind[];
  reasons: string[];
};

export type NfeLinksSection = {
  metrics: {
    documentsTotal: number;
    documentsWithIdNfe: number;
    documentsWithoutIdNfe: number;
    nfeFoundLocally: number;
    nfeMissingLocally: number;
    nfeValid: number;
    nfeCancelled: number;
    nfeWithMultipleDocuments: number;
    classificationCounts: Record<LinkClassification, number>;
  };
  samples: {
    missingNfeExternalIds: number[];
    cancelledNfeExternalIds: number[];
    multiDocumentNfeIds: number[];
    conflictingDocumentExternalIds: number[];
  };
  notes: string[];
};

export type SalesOrderLinksSection = {
  metrics: {
    documentsTotal: number;
    documentsWithZeroOrders: number;
    documentsWithOneOrder: number;
    documentsWithMultipleOrders: number;
    ordersWithMultipleDocuments: number;
    resolvedByItem: number;
    resolvedByNfeOnly: number;
    dependentOnO2c: number;
    conflictsBetweenSources: number;
    classificationCounts: Record<LinkClassification, number>;
  };
  samples: {
    multiOrderDocumentExternalIds: number[];
    multiDocumentOrderCodes: string[];
    conflictingDocumentExternalIds: number[];
  };
  notes: string[];
};

export function emptyClassificationCounts(): Record<LinkClassification, number> {
  return {
    persistido: 0,
    derivado: 0,
    inferido: 0,
    conflitante: 0,
    nao_resolvido: 0,
  };
}

export function isNomusNfeCancelledStatus(status: number | null | undefined): boolean {
  return status === NOMUS_NFE_CANCELLED_STATUS;
}

function uniquePositiveInts(values: Iterable<number | null | undefined>): number[] {
  const set = new Set<number>();
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value) && value > 0) {
      set.add(Math.trunc(value));
    }
  }
  return [...set].sort((a, b) => a - b);
}

function uniqueStrings(values: Iterable<string | null | undefined>): string[] {
  const set = new Set<string>();
  for (const value of values) {
    const trimmed = typeof value === "string" ? value.trim() : "";
    if (trimmed) set.add(trimmed);
  }
  return [...set].sort((a, b) => a.localeCompare(b));
}

/**
 * Extrai possíveis IDs de NF a partir de rawJson (hipótese por chave/valor).
 * Não afirma significado definitivo.
 */
export function extractNfeIdsFromRawJsonHypothesis(raw: unknown): number[] {
  const found = new Set<number>();

  function considerKeyValue(key: string, value: unknown): void {
    if (/idNfe|nfeExternalId|idNota|notaFiscalId/i.test(key)) {
      if (typeof value === "number" && Number.isFinite(value) && value > 0) {
        found.add(Math.trunc(value));
      } else if (typeof value === "string" && /^\d+$/.test(value.trim())) {
        found.add(Number.parseInt(value.trim(), 10));
      }
    }
  }

  function walk(node: unknown, depth: number): void {
    if (depth > 6 || node == null) return;
    if (Array.isArray(node)) {
      for (const item of node.slice(0, 20)) walk(item, depth + 1);
      return;
    }
    if (typeof node !== "object") return;
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      considerKeyValue(key, value);
      if (value && typeof value === "object") walk(value, depth + 1);
    }
  }

  walk(raw, 0);
  return [...found].sort((a, b) => a - b);
}

/**
 * Extrai possíveis códigos/IDs de pedido a partir de rawJson (hipótese).
 */
export function extractOrderRefsFromRawJsonHypothesis(raw: unknown): string[] {
  const found = new Set<string>();

  function considerKeyValue(key: string, value: unknown): void {
    if (!/pedido|salesOrder|orderCode|idPedido|codigoPedido/i.test(key)) return;
    if (typeof value === "string" && value.trim()) {
      found.add(value.trim());
      return;
    }
    if (typeof value === "number" && Number.isFinite(value) && value > 0) {
      found.add(String(Math.trunc(value)));
    }
  }

  function walk(node: unknown, depth: number): void {
    if (depth > 6 || node == null) return;
    if (Array.isArray(node)) {
      for (const item of node.slice(0, 20)) walk(item, depth + 1);
      return;
    }
    if (typeof node !== "object") return;
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      considerKeyValue(key, value);
      if (value && typeof value === "object") walk(value, depth + 1);
    }
  }

  walk(raw, 0);
  return [...found].sort((a, b) => a.localeCompare(b));
}

/**
 * Classifica o vínculo Documento → NF-e com base nas fontes disponíveis.
 */
export function classifyDocumentNfeLink(
  evidence: DocumentNfeLinkEvidence
): ClassifiedLink {
  const sources: LinkSourceKind[] = [];
  const reasons: string[] = [];
  const persisted = evidence.persistedIdNfe;
  const rawIds = uniquePositiveInts(evidence.rawJsonNfeIds);
  const o2cIds = uniquePositiveInts(evidence.o2cNfeIds);

  if (persisted != null) sources.push("stock_document_idNfe");
  if (o2cIds.length > 0) sources.push("order_to_cash_fact");
  if (rawIds.length > 0) sources.push("raw_json");

  const allIds = uniquePositiveInts([
    persisted,
    ...rawIds,
    ...o2cIds,
  ]);

  if (allIds.length > 1) {
    reasons.push(
      `Fontes discordam sobre idNfe: persistido=${persisted ?? "null"}, raw=${rawIds.join(",") || "—"}, o2c=${o2cIds.join(",") || "—"}`
    );
    return { classification: "conflitante", sources, reasons };
  }

  if (persisted != null) {
    reasons.push("NomusStockDocument.idNfe preenchido (vínculo persistido no stage).");
    if (!evidence.nfeExistsLocally) {
      reasons.push("NF local ausente em NomusNfe para este idNfe.");
    } else if (isNomusNfeCancelledStatus(evidence.nfeStatus)) {
      reasons.push("NF local encontrada com status cancelado (7).");
    }
    return { classification: "persistido", sources, reasons };
  }

  if (o2cIds.length === 1) {
    reasons.push("Vínculo observado apenas em OrderToCashAuditFact (derivado/reconstruível).");
    return { classification: "derivado", sources, reasons };
  }

  if (rawIds.length === 1) {
    reasons.push("Vínculo observado apenas em rawJson (inferência por chave; hipótese).");
    return { classification: "inferido", sources, reasons };
  }

  reasons.push("Nenhuma fonte resolveu idNfe para o documento.");
  return { classification: "nao_resolvido", sources, reasons };
}

/**
 * Classifica o vínculo Documento → Pedido(s).
 */
export function classifyDocumentSalesOrderLink(
  evidence: DocumentSalesOrderLinkEvidence
): ClassifiedLink {
  const sources: LinkSourceKind[] = [];
  const reasons: string[] = [];

  const viaLink = uniqueStrings(evidence.ordersViaNfeLink);
  const viaO2c = uniqueStrings(evidence.ordersViaO2c);
  const viaRaw = uniqueStrings(evidence.ordersViaRawJson);

  if (evidence.persistedIdNfe != null && viaLink.length > 0) {
    sources.push("sales_order_nfe_link");
    sources.push("stock_document_idNfe");
  }
  if (viaO2c.length > 0) sources.push("order_to_cash_fact");
  if (evidence.hasO2cItemResolution) sources.push("stock_document_item");
  if (viaRaw.length > 0) sources.push("raw_json");

  const union = uniqueStrings([...viaLink, ...viaO2c, ...viaRaw]);

  // Conflito: conjuntos não vazios e sem interseção, ou múltiplas fontes com conjuntos diferentes.
  const nonEmptySets = [viaLink, viaO2c, viaRaw].filter((s) => s.length > 0);
  if (nonEmptySets.length >= 2) {
    const first = new Set(nonEmptySets[0]);
    const disagree = nonEmptySets.some((set) => {
      if (set.length !== first.size) return true;
      return set.some((v) => !first.has(v));
    });
    if (disagree) {
      reasons.push(
        `Fontes discordam sobre pedidos: nfeLink=[${viaLink.join(",") || "—"}], o2c=[${viaO2c.join(",") || "—"}], raw=[${viaRaw.join(",") || "—"}]`
      );
      return { classification: "conflitante", sources, reasons };
    }
  }

  if (viaLink.length > 0 && evidence.persistedIdNfe != null) {
    reasons.push(
      "Pedido(s) resolvidos via NomusStockDocument.idNfe + SalesOrderNfeLink (composição de vínculos persistidos)."
    );
    // A relação doc→pedido não é FK direta; é derivada da composição.
    return { classification: "derivado", sources, reasons };
  }

  if (viaO2c.length > 0) {
    reasons.push(
      evidence.hasO2cItemResolution
        ? "Pedido(s) resolvidos por OrderToCashAuditFact com evidência de item."
        : "Pedido(s) resolvidos por OrderToCashAuditFact (derivado)."
    );
    return { classification: "derivado", sources, reasons };
  }

  if (viaRaw.length > 0) {
    reasons.push("Pedido(s) observados apenas em rawJson (inferência; hipótese).");
    return { classification: "inferido", sources, reasons };
  }

  if (union.length === 0) {
    reasons.push("Nenhum pedido resolvido para o documento.");
    return { classification: "nao_resolvido", sources, reasons };
  }

  reasons.push("Estado de vínculo não classificado de forma mais específica.");
  return { classification: "nao_resolvido", sources, reasons };
}

export function summarizeOrderCardinality(orderIds: string[]): "zero" | "one" | "many" {
  if (orderIds.length <= 0) return "zero";
  if (orderIds.length === 1) return "one";
  return "many";
}

export function isResolvedByNfeOnly(evidence: DocumentSalesOrderLinkEvidence): boolean {
  const viaLink = uniqueStrings(evidence.ordersViaNfeLink);
  const viaO2c = uniqueStrings(evidence.ordersViaO2c);
  return viaLink.length > 0 && viaO2c.length === 0 && !evidence.hasO2cItemResolution;
}

export function isResolvedByItem(evidence: DocumentSalesOrderLinkEvidence): boolean {
  return evidence.hasO2cItemResolution && uniqueStrings(evidence.ordersViaO2c).length > 0;
}

export function isDependentOnO2c(evidence: DocumentSalesOrderLinkEvidence): boolean {
  const viaLink = uniqueStrings(evidence.ordersViaNfeLink);
  const viaO2c = uniqueStrings(evidence.ordersViaO2c);
  return viaO2c.length > 0 && viaLink.length === 0;
}

export function buildEmptyNfeLinksSection(): NfeLinksSection {
  return {
    metrics: {
      documentsTotal: 0,
      documentsWithIdNfe: 0,
      documentsWithoutIdNfe: 0,
      nfeFoundLocally: 0,
      nfeMissingLocally: 0,
      nfeValid: 0,
      nfeCancelled: 0,
      nfeWithMultipleDocuments: 0,
      classificationCounts: emptyClassificationCounts(),
    },
    samples: {
      missingNfeExternalIds: [],
      cancelledNfeExternalIds: [],
      multiDocumentNfeIds: [],
      conflictingDocumentExternalIds: [],
    },
    notes: [
      "Vínculo Documento→NF via NomusStockDocument.idNfe é persistido (sem FK Prisma).",
      "Cancelamento oficial da NF usa NomusNfe.status === 7.",
      "Referências só em rawJson permanecem hipótese (inferido).",
    ],
  };
}

export function buildEmptySalesOrderLinksSection(): SalesOrderLinksSection {
  return {
    metrics: {
      documentsTotal: 0,
      documentsWithZeroOrders: 0,
      documentsWithOneOrder: 0,
      documentsWithMultipleOrders: 0,
      ordersWithMultipleDocuments: 0,
      resolvedByItem: 0,
      resolvedByNfeOnly: 0,
      dependentOnO2c: 0,
      conflictsBetweenSources: 0,
      classificationCounts: emptyClassificationCounts(),
    },
    samples: {
      multiOrderDocumentExternalIds: [],
      multiDocumentOrderCodes: [],
      conflictingDocumentExternalIds: [],
    },
    notes: [
      "Não existe FK Documento↔Pedido; SalesOrderNfeLink liga Pedido↔NF.",
      "OrderToCashAuditFact é derivado/reconstruível — não é master de vínculo.",
      "Este auditor não cria nem corrige vínculos.",
    ],
  };
}
