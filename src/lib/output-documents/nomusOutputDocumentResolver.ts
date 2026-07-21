/**
 * DS-03.7 — Resolver canônico read-only de Documento de Saída.
 *
 * Parte de NomusStockDocument + NomusStockDocumentItem (stage).
 * Relaciona NF / Pedido / CR / O2C somente com evidência oficial.
 * Não usa fuzzy matching. Não cria vínculos. Não consulta Nomus HTTP.
 */

import {
  type LinkClassification,
  type LinkSourceKind,
} from "@/src/lib/output-documents/auditOutputDocumentsLinks.js";

/** Classificações oficiais do resolver (sem `inferido` / rawJson). */
export type OutputDocumentLinkClassification = Exclude<
  LinkClassification,
  "inferido"
>;

export type OutputDocumentResolvedLink = {
  classification: OutputDocumentLinkClassification;
  sources: LinkSourceKind[];
  reasons: string[];
};

export type OutputDocumentStageHeader = {
  id: string;
  externalId: number;
  idNfe: number | null;
  tipoDocumentoEstoque: string | null;
  dataDocumento: Date | null;
  documentNumber: string | null;
  statusRaw: string | null;
  isCancelled: boolean;
  totalValue: string | null;
  personExternalId: number | null;
  personName: string | null;
  companyExternalId: number | null;
  companyName: string | null;
  movementDate: Date | null;
  paymentTermsRaw: string | null;
};

export type OutputDocumentStageItem = {
  id: string;
  externalItemId: number | null;
  externalProductId: number | null;
  quantity: string;
  unitValue: string;
  estimatedTotalValue: string;
};

export type OutputDocumentNfeEvidence = {
  externalId: number;
  id: string | null;
  numero: string | null;
  chave: string | null;
  status: number | null;
  foundLocally: boolean;
};

export type OutputDocumentSalesOrderNfeLinkEvidence = {
  linkId: string;
  salesOrderId: string;
  orderCode: string | null;
  nfeExternalId: number;
};

export type OutputDocumentSalesOrderEvidence = {
  id: string;
  orderCode: string | null;
  status: string | null;
};

export type OutputDocumentSalesOrderItemEvidence = {
  id: string;
  salesOrderId: string;
  externalProductId: number | null;
  nomusItemExternalId: number | null;
};

export type OutputDocumentO2cFactEvidence = {
  runId: string;
  salesOrderId: string | null;
  orderCode: string | null;
  salesOrderItemId: string | null;
  nfeExternalId: number | null;
  stockDocumentExternalId: number | null;
  stockDocumentIdNfe: number | null;
  stockDocumentItemId: string | null;
  allocatedValueByDocumentPrice: string | null;
  quantityUsedForOrder: string | null;
  receivableIds: number[];
};

export type OutputDocumentReceivableEvidence = {
  id: string;
  externalId: number;
  sourceInvoiceId: number | null;
  amountReceivable: string | null;
  balanceReceivable: string | null;
  status: boolean | null;
};

export type OutputDocumentResolveEvidence = {
  document: OutputDocumentStageHeader;
  items: OutputDocumentStageItem[];
  nfe: OutputDocumentNfeEvidence | null;
  salesOrderNfeLinks: OutputDocumentSalesOrderNfeLinkEvidence[];
  salesOrders: OutputDocumentSalesOrderEvidence[];
  salesOrderItems: OutputDocumentSalesOrderItemEvidence[];
  o2cFacts: OutputDocumentO2cFactEvidence[];
  receivables: OutputDocumentReceivableEvidence[];
};

export type ResolvedOutputDocumentNfe = {
  externalId: number | null;
  link: OutputDocumentResolvedLink;
  record: OutputDocumentNfeEvidence | null;
};

export type ResolvedOutputDocumentOrder = {
  salesOrderId: string;
  orderCode: string | null;
  status: string | null;
  linkIds: string[];
  sources: Array<"sales_order_nfe_link" | "order_to_cash_fact">;
  items: OutputDocumentSalesOrderItemEvidence[];
};

export type ResolvedOutputDocumentOrders = {
  link: OutputDocumentResolvedLink;
  orders: ResolvedOutputDocumentOrder[];
};

export type ResolvedOutputDocumentAllocationLine = {
  stockDocumentItemId: string | null;
  salesOrderId: string | null;
  salesOrderItemId: string | null;
  allocatedValueByDocumentPrice: string | null;
  quantityUsedForOrder: string | null;
  runId: string;
};

export type ResolvedOutputDocumentO2c = {
  present: boolean;
  runIds: string[];
  allocationLines: ResolvedOutputDocumentAllocationLine[];
  /** Pedidos observados só em O2C (já deduplicados no bloco de pedidos). */
  usedForAllocationOnly: true;
};

export type ResolvedOutputDocumentReceivables = {
  link: OutputDocumentResolvedLink;
  receivables: OutputDocumentReceivableEvidence[];
};

export type ResolvedOutputDocument = {
  document: OutputDocumentStageHeader;
  items: OutputDocumentStageItem[];
  /** Sempre true quando o stage devolveu o documento — independente de O2C. */
  listedFromStage: true;
  dependsOnO2cForListing: false;
  nfe: ResolvedOutputDocumentNfe;
  orders: ResolvedOutputDocumentOrders;
  o2c: ResolvedOutputDocumentO2c;
  receivables: ResolvedOutputDocumentReceivables;
};

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

function setsDisagree(a: string[], b: string[]): boolean {
  if (a.length === 0 || b.length === 0) return false;
  if (a.length !== b.length) return true;
  const setA = new Set(a);
  return b.some((v) => !setA.has(v));
}

function decimalToString(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "object" && value !== null && "toString" in value) {
    return String((value as { toString: () => string }).toString());
  }
  return null;
}

export function parseReceivableIdsJson(raw: unknown): number[] {
  if (raw == null) return [];
  if (Array.isArray(raw)) {
    return uniquePositiveInts(
      raw.map((v) => (typeof v === "number" ? v : Number(v)))
    );
  }
  if (typeof raw === "string") {
    try {
      return parseReceivableIdsJson(JSON.parse(raw));
    } catch {
      return [];
    }
  }
  return [];
}

/**
 * Classifica vínculo Documento → NF com fontes oficiais apenas.
 */
export function classifyOutputDocumentNfeLink(args: {
  persistedIdNfe: number | null;
  o2cNfeIds: number[];
  nfeFoundLocally: boolean;
}): OutputDocumentResolvedLink {
  const sources: LinkSourceKind[] = [];
  const reasons: string[] = [];
  const persisted = args.persistedIdNfe;
  const o2cIds = uniquePositiveInts(args.o2cNfeIds);

  if (persisted != null) sources.push("stock_document_idNfe");
  if (o2cIds.length > 0) sources.push("order_to_cash_fact");

  if (persisted != null && o2cIds.length > 0 && !o2cIds.includes(persisted)) {
    reasons.push(
      `Conflito idNfe: stage=${persisted}, o2c=[${o2cIds.join(",")}]`
    );
    return { classification: "conflitante", sources, reasons };
  }

  if (o2cIds.length > 1) {
    reasons.push(`O2C aponta múltiplas NF distintas: [${o2cIds.join(",")}]`);
    return { classification: "conflitante", sources, reasons };
  }

  if (persisted != null) {
    reasons.push("NomusStockDocument.idNfe persistido no stage.");
    if (!args.nfeFoundLocally) {
      reasons.push("NomusNfe local ausente para este idNfe.");
    }
    return { classification: "persistido", sources, reasons };
  }

  if (o2cIds.length === 1) {
    reasons.push("NF observada apenas em OrderToCashAuditFact (derivado).");
    return { classification: "derivado", sources, reasons };
  }

  reasons.push("Nenhuma evidência oficial de NF para o documento.");
  return { classification: "nao_resolvido", sources, reasons };
}

/**
 * Classifica vínculo Documento → Pedido(s). Sem fuzzy / rawJson.
 */
export function classifyOutputDocumentSalesOrderLink(args: {
  persistedIdNfe: number | null;
  orderIdsViaNfeLink: string[];
  orderIdsViaO2c: string[];
}): OutputDocumentResolvedLink {
  const sources: LinkSourceKind[] = [];
  const reasons: string[] = [];
  const viaLink = uniqueStrings(args.orderIdsViaNfeLink);
  const viaO2c = uniqueStrings(args.orderIdsViaO2c);

  if (args.persistedIdNfe != null && viaLink.length > 0) {
    sources.push("stock_document_idNfe", "sales_order_nfe_link");
  } else if (viaLink.length > 0) {
    sources.push("sales_order_nfe_link");
  }
  if (viaO2c.length > 0) sources.push("order_to_cash_fact");

  if (setsDisagree(viaLink, viaO2c)) {
    reasons.push(
      `Fontes discordam sobre pedidos: nfeLink=[${viaLink.join(",") || "—"}], o2c=[${viaO2c.join(",") || "—"}]`
    );
    return { classification: "conflitante", sources, reasons };
  }

  if (viaLink.length > 0) {
    reasons.push(
      "Pedido(s) via NomusStockDocument.idNfe + SalesOrderNfeLink (composição oficial)."
    );
    return { classification: "derivado", sources, reasons };
  }

  if (viaO2c.length > 0) {
    reasons.push("Pedido(s) observados apenas em OrderToCashAuditFact (alocação/auditoria).");
    return { classification: "derivado", sources, reasons };
  }

  reasons.push("Nenhum pedido resolvido por evidência oficial.");
  return { classification: "nao_resolvido", sources, reasons };
}

export function classifyOutputDocumentReceivablesLink(args: {
  resolvedNfeExternalId: number | null;
  receivableCount: number;
}): OutputDocumentResolvedLink {
  const sources: LinkSourceKind[] = [];
  const reasons: string[] = [];

  if (args.resolvedNfeExternalId == null) {
    reasons.push("Sem NF resolvida — CR não pode ser ligado pelo stage.");
    return { classification: "nao_resolvido", sources, reasons };
  }

  sources.push("stock_document_idNfe");
  if (args.receivableCount > 0) {
    reasons.push(
      "CR via NomusAccountsReceivable.sourceInvoiceId = idNfe (derivado da NF)."
    );
    return { classification: "derivado", sources, reasons };
  }

  reasons.push("NF resolvida, mas nenhum CR com sourceInvoiceId correspondente.");
  return { classification: "nao_resolvido", sources, reasons };
}

function dedupeSalesOrderNfeLinks(
  links: OutputDocumentSalesOrderNfeLinkEvidence[]
): OutputDocumentSalesOrderNfeLinkEvidence[] {
  const byKey = new Map<string, OutputDocumentSalesOrderNfeLinkEvidence>();
  for (const link of links) {
    const key = `${link.salesOrderId}:${link.nfeExternalId}`;
    if (!byKey.has(key)) byKey.set(key, link);
  }
  return [...byKey.values()].sort((a, b) =>
    a.salesOrderId.localeCompare(b.salesOrderId)
  );
}

function buildResolvedOrders(args: {
  links: OutputDocumentSalesOrderNfeLinkEvidence[];
  salesOrders: OutputDocumentSalesOrderEvidence[];
  salesOrderItems: OutputDocumentSalesOrderItemEvidence[];
  o2cFacts: OutputDocumentO2cFactEvidence[];
}): ResolvedOutputDocumentOrder[] {
  const orderById = new Map(args.salesOrders.map((o) => [o.id, o]));
  const itemsByOrder = new Map<string, OutputDocumentSalesOrderItemEvidence[]>();
  for (const item of args.salesOrderItems) {
    const list = itemsByOrder.get(item.salesOrderId) ?? [];
    list.push(item);
    itemsByOrder.set(item.salesOrderId, list);
  }

  type OrderBucket = {
    salesOrderId: string;
    orderCode: string | null;
    status: string | null;
    linkIds: Set<string>;
    sources: Set<"sales_order_nfe_link" | "order_to_cash_fact">;
  };

  const buckets = new Map<string, OrderBucket>();

  const ensure = (salesOrderId: string, orderCode: string | null): OrderBucket => {
    let bucket = buckets.get(salesOrderId);
    if (!bucket) {
      const so = orderById.get(salesOrderId);
      bucket = {
        salesOrderId,
        orderCode: so?.orderCode ?? orderCode,
        status: so?.status ?? null,
        linkIds: new Set(),
        sources: new Set(),
      };
      buckets.set(salesOrderId, bucket);
    } else if (!bucket.orderCode && orderCode) {
      bucket.orderCode = orderCode;
    }
    return bucket;
  };

  for (const link of dedupeSalesOrderNfeLinks(args.links)) {
    const bucket = ensure(link.salesOrderId, link.orderCode);
    bucket.linkIds.add(link.linkId);
    bucket.sources.add("sales_order_nfe_link");
  }

  for (const fact of args.o2cFacts) {
    if (!fact.salesOrderId) continue;
    const bucket = ensure(fact.salesOrderId, fact.orderCode);
    bucket.sources.add("order_to_cash_fact");
  }

  return [...buckets.values()]
    .map((bucket) => ({
      salesOrderId: bucket.salesOrderId,
      orderCode: bucket.orderCode,
      status: bucket.status,
      linkIds: [...bucket.linkIds].sort((a, b) => a.localeCompare(b)),
      sources: [...bucket.sources].sort((a, b) => a.localeCompare(b)) as Array<
        "sales_order_nfe_link" | "order_to_cash_fact"
      >,
      items: itemsByOrder.get(bucket.salesOrderId) ?? [],
    }))
    .sort((a, b) => a.salesOrderId.localeCompare(b.salesOrderId));
}

/**
 * Monta o grafo canônico a partir de evidências já carregadas (puro).
 */
export function resolveOutputDocument(
  evidence: OutputDocumentResolveEvidence
): ResolvedOutputDocument {
  const o2cForDoc = evidence.o2cFacts.filter(
    (f) =>
      f.stockDocumentExternalId == null ||
      f.stockDocumentExternalId === evidence.document.externalId
  );

  const o2cNfeIds = uniquePositiveInts(
    o2cForDoc.flatMap((f) => [f.nfeExternalId, f.stockDocumentIdNfe])
  );

  const nfeLink = classifyOutputDocumentNfeLink({
    persistedIdNfe: evidence.document.idNfe,
    o2cNfeIds,
    nfeFoundLocally: evidence.nfe?.foundLocally === true,
  });

  const resolvedNfeExternalId =
    evidence.document.idNfe ??
    (nfeLink.classification === "derivado" || nfeLink.classification === "persistido"
      ? o2cNfeIds[0] ?? null
      : null);

  // Se conflitante com persistido, ainda reporta o idNfe do stage como referência.
  const nfeExternalIdForRecord =
    evidence.document.idNfe ??
    (nfeLink.classification !== "conflitante" ? resolvedNfeExternalId : null);

  // Loader já escopa os links ao documento (idNfe stage ∪ NF do O2C ∪ chave).
  // Não descartar link da mesma NF com nfeExternalId divergente (match por chave).
  const allowedNfeIds = new Set<number>([
    ...(evidence.document.idNfe != null ? [evidence.document.idNfe] : []),
    ...o2cNfeIds,
    ...evidence.salesOrderNfeLinks.map((l) => l.nfeExternalId),
  ]);
  const dedupedLinks = dedupeSalesOrderNfeLinks(evidence.salesOrderNfeLinks).filter(
    (link) => allowedNfeIds.has(link.nfeExternalId)
  );

  const orderIdsViaNfeLink = uniqueStrings(dedupedLinks.map((l) => l.salesOrderId));
  const orderIdsViaO2c = uniqueStrings(
    o2cForDoc.map((f) => f.salesOrderId).filter((id): id is string => Boolean(id))
  );

  const ordersLink = classifyOutputDocumentSalesOrderLink({
    persistedIdNfe: evidence.document.idNfe,
    orderIdsViaNfeLink,
    orderIdsViaO2c,
  });

  const orders = buildResolvedOrders({
    links: dedupedLinks,
    salesOrders: evidence.salesOrders,
    salesOrderItems: evidence.salesOrderItems,
    o2cFacts: o2cForDoc,
  });

  const receivablesDeduped = (() => {
    const byExt = new Map<number, OutputDocumentReceivableEvidence>();
    for (const row of evidence.receivables) {
      if (!byExt.has(row.externalId)) byExt.set(row.externalId, row);
    }
    return [...byExt.values()].sort((a, b) => a.externalId - b.externalId);
  })();

  const receivablesLink = classifyOutputDocumentReceivablesLink({
    resolvedNfeExternalId: nfeExternalIdForRecord,
    receivableCount: receivablesDeduped.length,
  });

  const runIds = uniqueStrings(o2cForDoc.map((f) => f.runId));
  const allocationLines: ResolvedOutputDocumentAllocationLine[] = o2cForDoc.map(
    (f) => ({
      stockDocumentItemId: f.stockDocumentItemId,
      salesOrderId: f.salesOrderId,
      salesOrderItemId: f.salesOrderItemId,
      allocatedValueByDocumentPrice: f.allocatedValueByDocumentPrice,
      quantityUsedForOrder: f.quantityUsedForOrder,
      runId: f.runId,
    })
  );

  return {
    document: evidence.document,
    items: evidence.items,
    listedFromStage: true,
    dependsOnO2cForListing: false,
    nfe: {
      externalId: nfeExternalIdForRecord,
      link: nfeLink,
      record:
        evidence.nfe ??
        (nfeExternalIdForRecord != null
          ? {
              externalId: nfeExternalIdForRecord,
              id: null,
              numero: null,
              chave: null,
              status: null,
              foundLocally: false,
            }
          : null),
    },
    orders: {
      link: ordersLink,
      orders,
    },
    o2c: {
      present: o2cForDoc.length > 0,
      runIds,
      allocationLines,
      usedForAllocationOnly: true,
    },
    receivables: {
      link: receivablesLink,
      receivables: receivablesDeduped,
    },
  };
}

export function mapStageDocumentHeader(row: {
  id: string;
  externalId: number;
  idNfe: number | null;
  tipoDocumentoEstoque: string | null;
  dataDocumento: Date | null;
  documentNumber: string | null;
  statusRaw: string | null;
  isCancelled: boolean;
  totalValue: { toString(): string } | string | null;
  personExternalId: number | null;
  personName: string | null;
  companyExternalId: number | null;
  companyName: string | null;
  movementDate: Date | null;
  paymentTermsRaw: string | null;
}): OutputDocumentStageHeader {
  return {
    id: row.id,
    externalId: row.externalId,
    idNfe: row.idNfe,
    tipoDocumentoEstoque: row.tipoDocumentoEstoque,
    dataDocumento: row.dataDocumento,
    documentNumber: row.documentNumber,
    statusRaw: row.statusRaw,
    isCancelled: row.isCancelled,
    totalValue: decimalToString(row.totalValue),
    personExternalId: row.personExternalId,
    personName: row.personName,
    companyExternalId: row.companyExternalId,
    companyName: row.companyName,
    movementDate: row.movementDate,
    paymentTermsRaw: row.paymentTermsRaw,
  };
}

export function mapStageDocumentItem(row: {
  id: string;
  externalItemId: number | null;
  externalProductId: number | null;
  quantity: { toString(): string } | string;
  unitValue: { toString(): string } | string;
  estimatedTotalValue: { toString(): string } | string;
}): OutputDocumentStageItem {
  return {
    id: row.id,
    externalItemId: row.externalItemId,
    externalProductId: row.externalProductId,
    quantity: decimalToString(row.quantity) ?? "0",
    unitValue: decimalToString(row.unitValue) ?? "0",
    estimatedTotalValue: decimalToString(row.estimatedTotalValue) ?? "0",
  };
}
