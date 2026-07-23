/**
 * KAN-LINK-04 — Resolvedor canônico Documento de Saída → Pedido / item.
 *
 * Puro (sem I/O). Usa precedência KAN-LINK-02 e validade oficial.
 * Não cria vínculo por cliente/valor/data/produto ambíguo.
 */

import {
  canOperationalLinkAdvanceKanban,
  classifyNfeValidity,
  classifyOutputDocumentValidity,
  type SalesOrderOperationalLinkSourceType,
  type SalesOrderOperationalNfeValidity,
  type SalesOrderOperationalOutputDocumentValidity,
} from "./salesOrderOperationalEvidenceContract.js";

export type OutputDocumentOrderRefExtract = {
  externalSalesOrderId: number | null;
  orderCode: string | null;
  orderCodeNormalized: string | null;
  externalSalesOrderItemId: number | null;
  salesOrderItemSequence: string | null;
  externalProductId: number | null;
  unitCode: string | null;
  descriptionHintOrderCode: string | null;
};

type JsonObject = Record<string, unknown>;

function asObject(value: unknown): JsonObject | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as JsonObject;
}

function toInt(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    const n = Math.trunc(value);
    return n > 0 ? n : null;
  }
  if (typeof value === "string" && value.trim()) {
    const n = Number(value.trim().replace(/\./g, "").replace(",", "."));
    if (!Number.isFinite(n)) {
      const asInt = Number.parseInt(value.trim(), 10);
      return Number.isFinite(asInt) && asInt > 0 ? asInt : null;
    }
    const t = Math.trunc(n);
    return t > 0 ? t : null;
  }
  return null;
}

function asTrimmed(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const t = value.trim();
  return t.length > 0 ? t : null;
}

/** Normaliza PD 02757 / PD02757 / pd-02757 → PD02757. */
export function normalizeOutputDocumentOrderCode(
  value: string | null | undefined
): string | null {
  if (value == null) return null;
  const compact = value.trim().toUpperCase().replace(/\s+/g, "");
  const match = /^PD[-_]?(\d+)$/.exec(compact);
  if (!match) return null;
  return `PD${match[1]}`;
}

function normalizeItemSequence(value: unknown): string | null {
  const raw = asTrimmed(value) ?? (typeof value === "number" ? String(value) : null);
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  if (!digits) return null;
  return digits.padStart(5, "0");
}

/**
 * Extrai refs oficiais de pedido/item do raw Nomus (chaves tipadas).
 * Não faz walk fuzzy por cliente/valor.
 */
export function extractOutputDocumentOrderRefsFromRaw(
  raw: unknown
): OutputDocumentOrderRefExtract {
  const root = asObject(raw);
  if (!root) {
    return {
      externalSalesOrderId: null,
      orderCode: null,
      orderCodeNormalized: null,
      externalSalesOrderItemId: null,
      salesOrderItemSequence: null,
      externalProductId: null,
      unitCode: null,
      descriptionHintOrderCode: null,
    };
  }

  const pedido = asObject(root.pedido) ?? asObject(root.pedidoVenda);
  const itemPedido =
    asObject(root.itemPedido) ??
    asObject(root.itemDoPedido) ??
    asObject(root.itensPedido);

  const externalSalesOrderId =
    toInt(root.idPedido) ??
    toInt(root.idPedidoVenda) ??
    toInt(root.pedidoId) ??
    toInt(root.idSalesOrder) ??
    toInt(pedido?.id) ??
    toInt(pedido?.idPedido) ??
    toInt(itemPedido?.idPedido);

  const orderCode =
    asTrimmed(root.codigoPedido) ??
    asTrimmed(root.codigo_pedido) ??
    asTrimmed(root.orderCode) ??
    asTrimmed(pedido?.codigo) ??
    asTrimmed(pedido?.codigoPedido) ??
    asTrimmed(itemPedido?.codigoPedido);

  const externalSalesOrderItemId =
    toInt(root.idItemPedido) ??
    toInt(root.idItemDoPedido) ??
    toInt(root.itemPedidoId) ??
    toInt(root.idPedidoItem) ??
    toInt(itemPedido?.id) ??
    toInt(itemPedido?.idItemPedido);

  const salesOrderItemSequence =
    normalizeItemSequence(root.numeroItem) ??
    normalizeItemSequence(root.numeroItemPedido) ??
    normalizeItemSequence(root.item) ??
    normalizeItemSequence(root.sequencia) ??
    normalizeItemSequence(itemPedido?.item) ??
    normalizeItemSequence(itemPedido?.numero);

  const product = asObject(root.produto);
  const externalProductId =
    toInt(root.idProduto) ??
    toInt(root.produtoId) ??
    toInt(product?.id);

  const unitCode =
    asTrimmed(root.unidade) ??
    asTrimmed(root.und) ??
    asTrimmed(root.unidadeMedida) ??
    asTrimmed(product?.unidade);

  // Hint controlado: só se a descrição contiver exatamente um PD\d+ inequívoco.
  let descriptionHintOrderCode: string | null = null;
  const desc =
    asTrimmed(root.descricao) ??
    asTrimmed(root.observacao) ??
    asTrimmed(root.observacoes);
  if (desc) {
    const matches = [...desc.toUpperCase().matchAll(/\bPD\s*[-_]?(\d+)\b/g)];
    const codes = [
      ...new Set(matches.map((m) => `PD${m[1]}`)),
    ];
    if (codes.length === 1) descriptionHintOrderCode = codes[0]!;
  }

  return {
    externalSalesOrderId,
    orderCode,
    orderCodeNormalized: normalizeOutputDocumentOrderCode(orderCode),
    externalSalesOrderItemId,
    salesOrderItemSequence,
    externalProductId,
    unitCode,
    descriptionHintOrderCode,
  };
}

export type OutputDocumentLinkSalesOrderItem = {
  id: string;
  salesOrderId: string;
  externalSalesOrderId: number | null;
  orderCodeNormalized: string | null;
  nomusItemExternalId: number | null;
  nomusItemSequence: string | null;
  externalProductId: number | null;
};

export type OutputDocumentLinkDocumentInput = {
  id: string;
  externalId: number;
  idNfe: number | null;
  isCancelled?: boolean | null;
  statusRaw?: string | null;
  tipoDocumentoEstoque?: string | null;
  /** Refs oficiais no cabeçalho (quando existirem). */
  headerRefs?: OutputDocumentOrderRefExtract | null;
  nfeValidity?: SalesOrderOperationalNfeValidity | null;
  linkedViaSalesOrderNfeLink?: boolean;
};

export type OutputDocumentLinkLineInput = {
  id: string;
  stockDocumentId: string;
  stockDocumentExternalId: number;
  externalProductId: number | null;
  quantity: number | null;
  unitValue?: number | null;
  estimatedTotalValue?: number | null;
  refs: OutputDocumentOrderRefExtract;
};

export type OutputDocumentLinkO2cInput = {
  salesOrderItemId: string | null;
  stockDocumentExternalId: number | null;
  stockDocumentItemId: string | null;
  quantityUsedForOrder: number | null;
  auditKey: string;
};

export type ResolvedOutputDocumentLineLink = {
  stockDocumentItemId: string;
  stockDocumentExternalId: number;
  salesOrderId: string | null;
  salesOrderItemId: string | null;
  externalProductId: number | null;
  salesOrderItemSequence: string | null;
  unitCode: string | null;
  quantity: number;
  estimatedTotalValue: number | null;
  sourceType: SalesOrderOperationalLinkSourceType;
  itemCoverage: "RESOLVED" | "ORDER_LEVEL_ONLY" | "AMBIGUOUS" | "UNRESOLVED";
  reason: string;
  advancesKanban: boolean;
  documentValidity: SalesOrderOperationalOutputDocumentValidity;
};

export type ResolveOutputDocumentLinksInput = {
  /** Pedido em escopo (pack do Kanban é por pedido). */
  salesOrderId: string;
  externalSalesOrderId: number | null;
  orderCodeNormalized: string | null;
  items: readonly OutputDocumentLinkSalesOrderItem[];
  documents: readonly OutputDocumentLinkDocumentInput[];
  lines: readonly OutputDocumentLinkLineInput[];
  o2c?: readonly OutputDocumentLinkO2cInput[];
  nfeExternalIdsLinked?: ReadonlySet<number>;
};

function productAmbiguousInOrder(
  items: readonly OutputDocumentLinkSalesOrderItem[],
  externalProductId: number | null
): boolean {
  if (externalProductId == null) return true;
  const matches = items.filter((i) => i.externalProductId === externalProductId);
  return matches.length !== 1;
}

function findItemByExternalId(
  items: readonly OutputDocumentLinkSalesOrderItem[],
  externalSalesOrderItemId: number
): OutputDocumentLinkSalesOrderItem | null {
  const matches = items.filter(
    (i) => i.nomusItemExternalId === externalSalesOrderItemId
  );
  return matches.length === 1 ? matches[0]! : null;
}

function findItemBySequence(
  items: readonly OutputDocumentLinkSalesOrderItem[],
  sequence: string
): OutputDocumentLinkSalesOrderItem | null {
  const normalized = normalizeItemSequence(sequence);
  if (!normalized) return null;
  const matches = items.filter(
    (i) => normalizeItemSequence(i.nomusItemSequence) === normalized
  );
  return matches.length === 1 ? matches[0]! : null;
}

function orderMatchesRefs(
  input: ResolveOutputDocumentLinksInput,
  refs: OutputDocumentOrderRefExtract,
  doc: OutputDocumentLinkDocumentInput
): {
  matches: boolean;
  sourceType: SalesOrderOperationalLinkSourceType;
  reason: string;
} {
  if (
    refs.externalSalesOrderId != null &&
    input.externalSalesOrderId != null &&
    refs.externalSalesOrderId === input.externalSalesOrderId
  ) {
    return {
      matches: true,
      sourceType: "DIRECT_EXTERNAL_ID",
      reason: "idPedido oficial no documento/linha",
    };
  }
  if (
    refs.orderCodeNormalized &&
    input.orderCodeNormalized &&
    refs.orderCodeNormalized === input.orderCodeNormalized
  ) {
    return {
      matches: true,
      sourceType: "DIRECT_ORDER_REFERENCE",
      reason: "codigoPedido oficial",
    };
  }
  if (doc.headerRefs) {
    const header = orderMatchesRefs(input, doc.headerRefs, {
      ...doc,
      headerRefs: null,
    });
    if (header.matches) return header;
  }
  if (
    doc.idNfe != null &&
    (doc.linkedViaSalesOrderNfeLink === true ||
      input.nfeExternalIdsLinked?.has(doc.idNfe))
  ) {
    return {
      matches: true,
      sourceType: "SALES_ORDER_NFE_LINK",
      reason: "DS.idNfe ∈ SalesOrderNfeLink",
    };
  }
  if (
    doc.idNfe != null &&
    doc.nfeValidity === "AUTHORIZED" &&
    input.nfeExternalIdsLinked?.has(doc.idNfe)
  ) {
    return {
      matches: true,
      sourceType: "NFE_REFERENCE",
      reason: "DS → NF autorizada do pedido",
    };
  }
  if (
    refs.descriptionHintOrderCode &&
    input.orderCodeNormalized &&
    refs.descriptionHintOrderCode === input.orderCodeNormalized
  ) {
    return {
      matches: true,
      sourceType: "DESCRIPTION_HINT",
      reason: "hint textual inequívoco do código do pedido",
    };
  }
  return {
    matches: false,
    sourceType: "UNRESOLVED",
    reason: "sem vínculo oficial com o pedido",
  };
}

/**
 * Resolve cada linha do DS para o pedido/item em escopo.
 * Multi-pedido: linhas de outros pedidos ficam UNRESOLVED neste escopo.
 */
export function resolveOutputDocumentLineLinks(
  input: ResolveOutputDocumentLinksInput
): ResolvedOutputDocumentLineLink[] {
  const docsById = new Map(input.documents.map((d) => [d.id, d] as const));
  const docsByExternal = new Map(
    input.documents.map((d) => [d.externalId, d] as const)
  );
  const results: ResolvedOutputDocumentLineLink[] = [];

  for (const line of input.lines) {
    const doc =
      docsById.get(line.stockDocumentId) ??
      docsByExternal.get(line.stockDocumentExternalId);
    if (!doc) continue;

    const validity = classifyOutputDocumentValidity(doc);
    const qty = Math.max(0, line.quantity ?? 0);
    const orderMatch = orderMatchesRefs(input, line.refs, doc);

    // Item oficial primeiro.
    if (line.refs.externalSalesOrderItemId != null) {
      const byId = findItemByExternalId(
        input.items,
        line.refs.externalSalesOrderItemId
      );
      if (byId && byId.salesOrderId === input.salesOrderId) {
        const sourceType: SalesOrderOperationalLinkSourceType =
          "DIRECT_ORDER_ITEM_REFERENCE";
        results.push({
          stockDocumentItemId: line.id,
          stockDocumentExternalId: line.stockDocumentExternalId,
          salesOrderId: input.salesOrderId,
          salesOrderItemId: byId.id,
          externalProductId: line.externalProductId ?? line.refs.externalProductId,
          salesOrderItemSequence:
            normalizeItemSequence(byId.nomusItemSequence) ??
            line.refs.salesOrderItemSequence,
          unitCode: line.refs.unitCode,
          quantity: qty,
          estimatedTotalValue: line.estimatedTotalValue ?? null,
          sourceType,
          itemCoverage: "RESOLVED",
          reason: "idItemPedido oficial",
          advancesKanban:
            canOperationalLinkAdvanceKanban(sourceType) &&
            (validity === "VALID" || validity === "WITHOUT_NFE") &&
            qty > 0,
          documentValidity: validity,
        });
        continue;
      }
      if (line.refs.externalSalesOrderItemId != null && !byId) {
        // Item de outro pedido / órfão — não aloca neste escopo.
        results.push({
          stockDocumentItemId: line.id,
          stockDocumentExternalId: line.stockDocumentExternalId,
          salesOrderId: orderMatch.matches ? input.salesOrderId : null,
          salesOrderItemId: null,
          externalProductId: line.externalProductId ?? line.refs.externalProductId,
          salesOrderItemSequence: line.refs.salesOrderItemSequence,
          unitCode: line.refs.unitCode,
          quantity: qty,
          estimatedTotalValue: line.estimatedTotalValue ?? null,
          sourceType: orderMatch.matches ? orderMatch.sourceType : "UNRESOLVED",
          itemCoverage: orderMatch.matches ? "ORDER_LEVEL_ONLY" : "UNRESOLVED",
          reason: orderMatch.matches
            ? "pedido comprovado; item oficial não encontrado neste pedido"
            : "idItemPedido sem match no pedido em escopo",
          advancesKanban: false,
          documentValidity: validity,
        });
        continue;
      }
    }

    if (line.refs.salesOrderItemSequence) {
      const bySeq = findItemBySequence(
        input.items,
        line.refs.salesOrderItemSequence
      );
      if (bySeq && orderMatch.matches) {
        const sourceType: SalesOrderOperationalLinkSourceType =
          "DIRECT_ORDER_ITEM_REFERENCE";
        results.push({
          stockDocumentItemId: line.id,
          stockDocumentExternalId: line.stockDocumentExternalId,
          salesOrderId: input.salesOrderId,
          salesOrderItemId: bySeq.id,
          externalProductId: line.externalProductId ?? line.refs.externalProductId,
          salesOrderItemSequence: line.refs.salesOrderItemSequence,
          unitCode: line.refs.unitCode,
          quantity: qty,
          estimatedTotalValue: line.estimatedTotalValue ?? null,
          sourceType,
          itemCoverage: "RESOLVED",
          reason: "número/sequência oficial do item do pedido",
          advancesKanban:
            canOperationalLinkAdvanceKanban(sourceType) &&
            (validity === "VALID" || validity === "WITHOUT_NFE") &&
            qty > 0,
          documentValidity: validity,
        });
        continue;
      }
    }

    if (!orderMatch.matches) {
      results.push({
        stockDocumentItemId: line.id,
        stockDocumentExternalId: line.stockDocumentExternalId,
        salesOrderId: null,
        salesOrderItemId: null,
        externalProductId: line.externalProductId ?? line.refs.externalProductId,
        salesOrderItemSequence: line.refs.salesOrderItemSequence,
        unitCode: line.refs.unitCode,
        quantity: qty,
        estimatedTotalValue: line.estimatedTotalValue ?? null,
        sourceType: "UNRESOLVED",
        itemCoverage: "UNRESOLVED",
        reason: orderMatch.reason,
        advancesKanban: false,
        documentValidity: validity,
      });
      continue;
    }

    // Pedido comprovado — tentar produto só se inequívoco no pedido.
    const productId = line.externalProductId ?? line.refs.externalProductId;
    if (productId != null && !productAmbiguousInOrder(input.items, productId)) {
      const item = input.items.find((i) => i.externalProductId === productId)!;
      const sourceType = orderMatch.sourceType;
      const advances =
        canOperationalLinkAdvanceKanban(sourceType) &&
        (validity === "VALID" || validity === "WITHOUT_NFE") &&
        qty > 0;
      results.push({
        stockDocumentItemId: line.id,
        stockDocumentExternalId: line.stockDocumentExternalId,
        salesOrderId: input.salesOrderId,
        salesOrderItemId: item.id,
        externalProductId: productId,
        salesOrderItemSequence: normalizeItemSequence(item.nomusItemSequence),
        unitCode: line.refs.unitCode,
        quantity: qty,
        estimatedTotalValue: line.estimatedTotalValue ?? null,
        sourceType,
        itemCoverage: "RESOLVED",
        reason: `${orderMatch.reason}; produto inequívoco no pedido`,
        advancesKanban: advances,
        documentValidity: validity,
      });
      continue;
    }

    if (productId != null && productAmbiguousInOrder(input.items, productId)) {
      results.push({
        stockDocumentItemId: line.id,
        stockDocumentExternalId: line.stockDocumentExternalId,
        salesOrderId: input.salesOrderId,
        salesOrderItemId: null,
        externalProductId: productId,
        salesOrderItemSequence: line.refs.salesOrderItemSequence,
        unitCode: line.refs.unitCode,
        quantity: qty,
        estimatedTotalValue: line.estimatedTotalValue ?? null,
        sourceType: "AMBIGUOUS",
        itemCoverage: "AMBIGUOUS",
        reason:
          "pedido comprovado; produto aparece em mais de um item — não distribui qty",
        advancesKanban: false,
        documentValidity: validity,
      });
      continue;
    }

    results.push({
      stockDocumentItemId: line.id,
      stockDocumentExternalId: line.stockDocumentExternalId,
      salesOrderId: input.salesOrderId,
      salesOrderItemId: null,
      externalProductId: productId,
      salesOrderItemSequence: line.refs.salesOrderItemSequence,
      unitCode: line.refs.unitCode,
      quantity: qty,
      estimatedTotalValue: line.estimatedTotalValue ?? null,
      sourceType: orderMatch.sourceType,
      itemCoverage: "ORDER_LEVEL_ONLY",
      reason: `${orderMatch.reason}; sem item inequívoco`,
      advancesKanban: false,
      documentValidity: validity,
    });
  }

  return results;
}

/**
 * Quantidade documentada por item: soma linhas válidas resolvidas,
 * dedupe por stockDocumentItemId, sem misturar NF como fato documental extra.
 */
export function sumDocumentedQuantityBySalesOrderItem(
  links: readonly ResolvedOutputDocumentLineLink[],
  o2c: readonly OutputDocumentLinkO2cInput[] = []
): Map<string, number> {
  const byItem = new Map<string, number>();
  const seenLine = new Set<string>();
  const o2cDocExternalIds = new Set<number>();

  for (const a of o2c) {
    if (a.salesOrderItemId == null) continue;
    if (a.stockDocumentExternalId != null) {
      o2cDocExternalIds.add(a.stockDocumentExternalId);
    }
    const q = Math.max(0, a.quantityUsedForOrder ?? 0);
    if (q <= 0) continue;
    const key = `o2c:${a.auditKey}`;
    if (seenLine.has(key)) continue;
    seenLine.add(key);
    byItem.set(a.salesOrderItemId, (byItem.get(a.salesOrderItemId) ?? 0) + q);
  }

  for (const link of links) {
    if (!link.advancesKanban || link.salesOrderItemId == null) continue;
    if (link.itemCoverage !== "RESOLVED") continue;
    // Evita somar a mesma linha DS já coberta por O2C do mesmo documento.
    if (o2cDocExternalIds.has(link.stockDocumentExternalId)) {
      const already = [...o2c].some(
        (a) =>
          a.salesOrderItemId === link.salesOrderItemId &&
          a.stockDocumentExternalId === link.stockDocumentExternalId
      );
      if (already) continue;
    }
    const dedupe = `line:${link.stockDocumentItemId}`;
    if (seenLine.has(dedupe)) continue;
    seenLine.add(dedupe);
    const q = Math.max(0, link.quantity);
    if (q <= 0) continue;
    byItem.set(
      link.salesOrderItemId,
      (byItem.get(link.salesOrderItemId) ?? 0) + q
    );
  }

  return byItem;
}

export function nfeValidityFromStatus(input: {
  status?: number | null;
  isCanceled?: boolean | null;
  isValidForBilling?: boolean | null;
  statusNormalized?: string | null;
}): SalesOrderOperationalNfeValidity {
  return classifyNfeValidity({
    statusRaw: input.status,
    isCanceled: input.isCanceled,
    isValidForBilling: input.isValidForBilling,
    statusNormalized: input.statusNormalized,
  });
}

/** Paths JSON Prisma para descoberta read-only sem migration. */
export function buildStockDocumentOrderRefJsonPathFilters(input: {
  externalSalesOrderIds: readonly number[];
  externalSalesOrderItemIds: readonly number[];
}): Array<Record<string, unknown>> {
  const filters: Array<Record<string, unknown>> = [];
  for (const id of input.externalSalesOrderIds) {
    filters.push({ rawJson: { path: ["idPedido"], equals: id } });
    filters.push({ rawJson: { path: ["idPedidoVenda"], equals: id } });
    filters.push({ rawJson: { path: ["pedido", "id"], equals: id } });
    filters.push({ rawJson: { path: ["pedidoVenda", "id"], equals: id } });
  }
  for (const id of input.externalSalesOrderItemIds) {
    filters.push({ rawJson: { path: ["idItemPedido"], equals: id } });
    filters.push({ rawJson: { path: ["idItemDoPedido"], equals: id } });
    filters.push({ rawJson: { path: ["itemPedido", "id"], equals: id } });
  }
  return filters;
}
