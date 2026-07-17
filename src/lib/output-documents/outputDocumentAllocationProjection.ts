/**
 * DS-03.8 — Consolidação de alocações e projeção de itens de Documento de Saída.
 *
 * Regras:
 * - total do documento aparece uma vez (stage header ou soma dos itens);
 * - cada pedido recebe só o valor alocado a ele;
 * - soma das alocações é separada do total do documento;
 * - não repetir total integral do documento em cada pedido;
 * - agregar todos os facts por item (nunca só o primeiro);
 * - item sem vínculo permanece visível como não resolvido;
 * - conflito de vínculo é auditável;
 * - dinheiro em centavos inteiros; tolerância de 1 centavo só para classificação.
 *
 * Não altera o builder O2C.
 */

import {
  classifyAllocationCoverage,
  moneyCentsToNumber,
  toMoneyCents,
  type AllocationCoverageStatus,
} from "@/src/lib/output-documents/auditOutputDocumentsFinancial.js";
import type { ResolvedOutputDocumentAllocationLine } from "@/src/lib/output-documents/nomusOutputDocumentResolver.js";

/* -------------------------------------------------------------------- */
/*  DTOs                                                                  */
/* -------------------------------------------------------------------- */

export type OutputDocumentLinkOrigin =
  | "ITEM_EVIDENCE"
  | "HEADER_ONLY"
  | "SALES_ORDER_NFE_LINK"
  | "ORDER_TO_CASH"
  | "UNRESOLVED"
  | "CONFLICT"
  | "UNKNOWN";

export type OutputDocumentItemLinkStatus =
  | "resolved"
  | "unresolved"
  | "partial"
  | "conflict";

/** Documento — total único + cobertura. */
export type OutputDocumentAllocationDocumentDto = {
  stockDocumentId: string | null;
  stockDocumentExternalId: number;
  idNfe: number | null;
  /** Valor total do documento (uma vez). Centavos. */
  totalValueCents: number;
  totalValue: number;
  totalValueSource: "stage_header" | "items_sum" | "zero";
  /** Soma de todas as alocações a pedidos (todas as ordens). */
  allocatedToAllOrdersCents: number;
  allocatedToAllOrders: number;
  /** Saldo não alocado = max(0, total − alocado). */
  unallocatedBalanceCents: number;
  unallocatedBalance: number;
  /** Superalocação = max(0, alocado − total). */
  overAllocationCents: number;
  overAllocation: number;
  /** Cobertura = alocado / total (0–100+; >100 se superalocado). */
  coveragePercent: number | null;
  coverageStatus: AllocationCoverageStatus;
  coverageReasons: string[];
  linkOrigin: OutputDocumentLinkOrigin;
  productLineCount: number;
};

/** Pedido vinculado com valor alocado exclusivo. */
export type OutputDocumentAllocationLinkedOrderDto = {
  salesOrderId: string;
  orderCode: string | null;
  /** Valor alocado somente a este pedido (não é o total do documento). */
  allocatedValueCents: number;
  allocatedValue: number;
  quantityUsedForOrder: number;
  linkOrigin: OutputDocumentLinkOrigin;
  stockDocumentItemIds: string[];
  salesOrderItemIds: string[];
};

/** Valor alocado por pedido (visão agregada). */
export type OutputDocumentAllocationOrderShareDto = {
  salesOrderId: string;
  orderCode: string | null;
  allocatedValueCents: number;
  allocatedValue: number;
  shareOfDocumentPercent: number | null;
};

/** Candidato de vínculo item→pedido (para auditoria de conflito). */
export type OutputDocumentItemLinkCandidateDto = {
  salesOrderId: string | null;
  salesOrderItemId: string | null;
  orderCode: string | null;
  allocatedValueCents: number;
  quantityUsedForOrder: number;
  source: "order_to_cash_fact" | "product_match";
};

/** Item do documento com todos os vínculos válidos. */
export type OutputDocumentAllocationItemDto = {
  stockDocumentItemId: string;
  stockDocumentExternalId: number;
  externalItemId: number | null;
  externalProductId: number | null;
  quantityDocument: number;
  unitValue: number;
  /** Total do item do stage (uma vez). */
  totalValueCents: number;
  totalValue: number;
  /** Soma alocada deste item a todos os pedidos. */
  allocatedValueCents: number;
  allocatedValue: number;
  quantityUsedForOrder: number;
  unallocatedBalanceCents: number;
  overAllocationCents: number;
  linkStatus: OutputDocumentItemLinkStatus;
  linkOrigin: OutputDocumentLinkOrigin;
  /** Todos os vínculos válidos (não só o primeiro). */
  links: OutputDocumentItemLinkCandidateDto[];
  /** Compat: primeiro vínculo resolvido, se houver. */
  primarySalesOrderItemId: string | null;
  primarySalesOrderId: string | null;
  alerts: string[];
};

export type OutputDocumentAllocationProjection = {
  document: OutputDocumentAllocationDocumentDto;
  items: OutputDocumentAllocationItemDto[];
  linkedOrders: OutputDocumentAllocationLinkedOrderDto[];
  orderShares: OutputDocumentAllocationOrderShareDto[];
  /** Soma das alocações (igual a document.allocatedToAllOrders). */
  allocationsSumCents: number;
  allocationsSum: number;
};

/* -------------------------------------------------------------------- */
/*  Inputs                                                                */
/* -------------------------------------------------------------------- */

export type OutputDocumentAllocationStageItemInput = {
  id: string;
  externalItemId?: number | null;
  externalProductId?: number | null;
  quantity: unknown;
  unitValue: unknown;
  estimatedTotalValue?: unknown;
};

export type OutputDocumentAllocationStageDocumentInput = {
  id?: string | null;
  externalId: number;
  idNfe?: number | null;
  totalValue?: unknown;
  items: OutputDocumentAllocationStageItemInput[];
};

export type OutputDocumentAllocationOrderItemHint = {
  salesOrderItemId: string;
  salesOrderId: string;
  orderCode?: string | null;
  externalProductId?: number | null;
};

export type OutputDocumentAllocationLineInput = {
  stockDocumentItemId: string | null;
  salesOrderId: string | null;
  salesOrderItemId: string | null;
  orderCode?: string | null;
  allocatedValueByDocumentPrice: unknown;
  quantityUsedForOrder: unknown;
  /** Quando o fact não traz stockDocumentItemId, permite match por produto. */
  externalProductId?: number | null;
};

export type ProjectOutputDocumentAllocationInput = {
  document: OutputDocumentAllocationStageDocumentInput;
  /** Linhas de alocação (ex.: ResolvedOutputDocument.o2c.allocationLines). */
  allocationLines: ReadonlyArray<
    OutputDocumentAllocationLineInput | ResolvedOutputDocumentAllocationLine
  >;
  /** Hints de itens do(s) pedido(s) para match por produto e conflitos. */
  orderItemHints?: ReadonlyArray<OutputDocumentAllocationOrderItemHint>;
  /**
   * Quando informado, `linkedOrders` prioriza este pedido no share
   * (visão pedido-scoped); o total do documento permanece global.
   */
  focusSalesOrderId?: string | null;
};

/* -------------------------------------------------------------------- */
/*  Helpers                                                               */
/* -------------------------------------------------------------------- */

function toQty(value: unknown): number {
  const centsLike = toMoneyCents(value);
  // quantidades usam escala 1e6 no Decimal; toMoneyCents assume dinheiro.
  // Preferir parse numérico direto para qty.
  if (value == null) return 0;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const n = Number(value.replace(",", "."));
    return Number.isFinite(n) ? n : 0;
  }
  if (typeof value === "object" && value !== null && "toNumber" in value) {
    try {
      const n = (value as { toNumber: () => number }).toNumber();
      return Number.isFinite(n) ? n : 0;
    } catch {
      return 0;
    }
  }
  return Number.isFinite(centsLike) ? centsLike / 100 : 0;
}

function uniqueStrings(values: Iterable<string | null | undefined>): string[] {
  const set = new Set<string>();
  for (const v of values) {
    const t = typeof v === "string" ? v.trim() : "";
    if (t) set.add(t);
  }
  return [...set].sort((a, b) => a.localeCompare(b));
}

function coveragePercent(
  documentCents: number,
  allocatedCents: number
): number | null {
  if (documentCents <= 0) return allocatedCents > 0 ? 100 : null;
  return Math.round((allocatedCents / documentCents) * 10000) / 100;
}

function resolveDocumentTotalCents(
  document: OutputDocumentAllocationStageDocumentInput
): {
  totalValueCents: number;
  totalValueSource: OutputDocumentAllocationDocumentDto["totalValueSource"];
} {
  const headerCents = toMoneyCents(document.totalValue);
  if (headerCents > 0 || document.totalValue != null) {
    // header explícito (inclui zero explícito se totalValue presente e 0)
    if (document.totalValue != null && headerCents >= 0) {
      return { totalValueCents: headerCents, totalValueSource: "stage_header" };
    }
  }

  let sum = 0;
  for (const item of document.items) {
    const itemTotal = toMoneyCents(item.estimatedTotalValue);
    if (itemTotal > 0) {
      sum += itemTotal;
      continue;
    }
    const qty = toQty(item.quantity);
    const unit = toMoneyCents(item.unitValue);
    sum += Math.round(qty * unit);
  }
  if (sum > 0) return { totalValueCents: sum, totalValueSource: "items_sum" };
  return { totalValueCents: 0, totalValueSource: "zero" };
}

function normalizeLine(
  line: OutputDocumentAllocationLineInput | ResolvedOutputDocumentAllocationLine
): OutputDocumentAllocationLineInput {
  return {
    stockDocumentItemId: line.stockDocumentItemId ?? null,
    salesOrderId: line.salesOrderId ?? null,
    salesOrderItemId: line.salesOrderItemId ?? null,
    orderCode: "orderCode" in line ? line.orderCode ?? null : null,
    allocatedValueByDocumentPrice: line.allocatedValueByDocumentPrice,
    quantityUsedForOrder: line.quantityUsedForOrder,
    externalProductId:
      "externalProductId" in line ? line.externalProductId ?? null : null,
  };
}

/* -------------------------------------------------------------------- */
/*  Core                                                                  */
/* -------------------------------------------------------------------- */

/**
 * Consolida alocações e projeta itens a partir do stage + linhas oficiais.
 */
export function projectOutputDocumentAllocation(
  input: ProjectOutputDocumentAllocationInput
): OutputDocumentAllocationProjection {
  const { document, focusSalesOrderId } = input;
  const lines = input.allocationLines.map(normalizeLine);
  const hints = input.orderItemHints ?? [];

  const { totalValueCents, totalValueSource } = resolveDocumentTotalCents(document);

  const hintBySoi = new Map(hints.map((h) => [h.salesOrderItemId, h]));
  const hintsByProduct = new Map<number, OutputDocumentAllocationOrderItemHint[]>();
  for (const h of hints) {
    if (h.externalProductId == null) continue;
    const arr = hintsByProduct.get(h.externalProductId) ?? [];
    arr.push(h);
    hintsByProduct.set(h.externalProductId, arr);
  }

  // Index lines by stockDocumentItemId (and orphan product lines).
  const linesByItemId = new Map<string, OutputDocumentAllocationLineInput[]>();
  const orphanLines: OutputDocumentAllocationLineInput[] = [];
  for (const line of lines) {
    if (line.stockDocumentItemId) {
      const arr = linesByItemId.get(line.stockDocumentItemId) ?? [];
      arr.push(line);
      linesByItemId.set(line.stockDocumentItemId, arr);
    } else {
      orphanLines.push(line);
    }
  }

  const items: OutputDocumentAllocationItemDto[] = [];
  type OrderAgg = {
    salesOrderId: string;
    orderCode: string | null;
    allocatedValueCents: number;
    quantityUsedForOrder: number;
    stockDocumentItemIds: Set<string>;
    salesOrderItemIds: Set<string>;
    hasItemEvidence: boolean;
  };

  const orderAgg = new Map<string, OrderAgg>();

  const ensureOrder = (salesOrderId: string, orderCode: string | null): OrderAgg => {
    let cur = orderAgg.get(salesOrderId);
    if (!cur) {
      cur = {
        salesOrderId,
        orderCode,
        allocatedValueCents: 0,
        quantityUsedForOrder: 0,
        stockDocumentItemIds: new Set(),
        salesOrderItemIds: new Set(),
        hasItemEvidence: false,
      };
      orderAgg.set(salesOrderId, cur);
    } else if (!cur.orderCode && orderCode) {
      cur.orderCode = orderCode;
    }
    return cur;
  };

  const consumedOrphanIndexes = new Set<number>();

  for (const stageItem of document.items) {
    const qty = toQty(stageItem.quantity);
    const unitCents = toMoneyCents(stageItem.unitValue);
    let itemTotalCents = toMoneyCents(stageItem.estimatedTotalValue);
    if (itemTotalCents <= 0 && qty > 0 && unitCents > 0) {
      itemTotalCents = Math.round(qty * unitCents);
    }

    let itemLines = linesByItemId.get(stageItem.id) ?? [];

    // Facts sem stockDocumentItemId: amarrar por produto se houver match.
    if (itemLines.length === 0 && stageItem.externalProductId != null) {
      const matched: OutputDocumentAllocationLineInput[] = [];
      orphanLines.forEach((line, idx) => {
        if (consumedOrphanIndexes.has(idx)) return;
        if (line.externalProductId === stageItem.externalProductId) {
          matched.push(line);
          consumedOrphanIndexes.add(idx);
        }
      });
      if (matched.length > 0) itemLines = matched;
    }

    const links: OutputDocumentItemLinkCandidateDto[] = [];
    for (const line of itemLines) {
      const allocatedCents = toMoneyCents(line.allocatedValueByDocumentPrice);
      const usedQty = toQty(line.quantityUsedForOrder);
      const hint = line.salesOrderItemId
        ? hintBySoi.get(line.salesOrderItemId)
        : undefined;
      links.push({
        salesOrderId: line.salesOrderId ?? hint?.salesOrderId ?? null,
        salesOrderItemId: line.salesOrderItemId ?? null,
        orderCode: line.orderCode ?? hint?.orderCode ?? null,
        allocatedValueCents: allocatedCents,
        quantityUsedForOrder: usedQty,
        source: "order_to_cash_fact",
      });
    }

    // Candidatos por produto sem fact (auditoria de conflito / não resolvido).
    const productCandidates =
      stageItem.externalProductId != null
        ? hintsByProduct.get(stageItem.externalProductId) ?? []
        : [];
    const linkedSoiIds = new Set(
      links.map((l) => l.salesOrderItemId).filter((id): id is string => Boolean(id))
    );

    if (links.length === 0 && productCandidates.length > 0) {
      for (const cand of productCandidates) {
        links.push({
          salesOrderId: cand.salesOrderId,
          salesOrderItemId: cand.salesOrderItemId,
          orderCode: cand.orderCode ?? null,
          allocatedValueCents: 0,
          quantityUsedForOrder: 0,
          source: "product_match",
        });
      }
    } else if (productCandidates.length > 1) {
      // Facts existem, mas há vários candidatos de produto — marcar extras não cobertos.
      for (const cand of productCandidates) {
        if (linkedSoiIds.has(cand.salesOrderItemId)) continue;
        links.push({
          salesOrderId: cand.salesOrderId,
          salesOrderItemId: cand.salesOrderItemId,
          orderCode: cand.orderCode ?? null,
          allocatedValueCents: 0,
          quantityUsedForOrder: 0,
          source: "product_match",
        });
      }
    }

    const allocatedValueCents = links
      .filter((l) => l.source === "order_to_cash_fact")
      .reduce((s, l) => s + l.allocatedValueCents, 0);
    const quantityUsedForOrder = links
      .filter((l) => l.source === "order_to_cash_fact")
      .reduce((s, l) => s + l.quantityUsedForOrder, 0);

    const factSoiIds = uniqueStrings(
      links
        .filter((l) => l.source === "order_to_cash_fact")
        .map((l) => l.salesOrderItemId)
    );
    const productMatchIds = uniqueStrings(
      links
        .filter((l) => l.source === "product_match")
        .map((l) => l.salesOrderItemId)
    );

    let linkStatus: OutputDocumentItemLinkStatus = "unresolved";
    let linkOrigin: OutputDocumentLinkOrigin = "UNRESOLVED";
    const alerts: string[] = [];

    if (factSoiIds.length === 0 && productMatchIds.length === 0) {
      linkStatus = "unresolved";
      linkOrigin = "UNRESOLVED";
      alerts.push("DOCUMENT_ITEM_UNRESOLVED");
    } else if (factSoiIds.length === 0 && productMatchIds.length === 1) {
      linkStatus = "unresolved";
      linkOrigin = "HEADER_ONLY";
      alerts.push("DOCUMENT_ALLOCATED_BY_HEADER_ONLY");
    } else if (factSoiIds.length === 0 && productMatchIds.length > 1) {
      linkStatus = "conflict";
      linkOrigin = "CONFLICT";
      alerts.push("DOCUMENT_ITEM_LINK_CONFLICT");
    } else if (factSoiIds.length >= 1) {
      linkStatus = "resolved";
      linkOrigin = "ITEM_EVIDENCE";
      if (productMatchIds.length > 0) {
        // Candidatos extras além dos facts → conflito auditável, mas preserva vínculos válidos.
        linkStatus = "conflict";
        linkOrigin = "CONFLICT";
        alerts.push("DOCUMENT_ITEM_LINK_CONFLICT");
      }
      if (
        allocatedValueCents > 0 &&
        allocatedValueCents < itemTotalCents &&
        itemTotalCents - allocatedValueCents > 1
      ) {
        // partial allocation on item — still resolved links
        if (linkStatus === "resolved") linkStatus = "partial";
      }
    }

    const unallocatedBalanceCents = Math.max(0, itemTotalCents - allocatedValueCents);
    const overAllocationCents = Math.max(0, allocatedValueCents - itemTotalCents);
    if (overAllocationCents > 1) alerts.push("DOCUMENT_ITEM_OVER_ALLOCATED");

    for (const link of links) {
      if (!link.salesOrderId) continue;
      if (link.source !== "order_to_cash_fact" && link.allocatedValueCents <= 0) {
        continue;
      }
      const ord = ensureOrder(link.salesOrderId, link.orderCode);
      if (link.source === "order_to_cash_fact") {
        ord.allocatedValueCents += link.allocatedValueCents;
        ord.quantityUsedForOrder += link.quantityUsedForOrder;
        ord.hasItemEvidence = true;
      }
      ord.stockDocumentItemIds.add(stageItem.id);
      if (link.salesOrderItemId) ord.salesOrderItemIds.add(link.salesOrderItemId);
    }

    const primaryFact = links.find(
      (l) => l.source === "order_to_cash_fact" && l.salesOrderItemId
    );

    items.push({
      stockDocumentItemId: stageItem.id,
      stockDocumentExternalId: document.externalId,
      externalItemId: stageItem.externalItemId ?? null,
      externalProductId: stageItem.externalProductId ?? null,
      quantityDocument: qty,
      unitValue: moneyCentsToNumber(unitCents),
      totalValueCents: itemTotalCents,
      totalValue: moneyCentsToNumber(itemTotalCents),
      allocatedValueCents,
      allocatedValue: moneyCentsToNumber(allocatedValueCents),
      quantityUsedForOrder,
      unallocatedBalanceCents,
      overAllocationCents,
      linkStatus,
      linkOrigin,
      links,
      primarySalesOrderItemId: primaryFact?.salesOrderItemId ?? null,
      primarySalesOrderId: primaryFact?.salesOrderId ?? null,
      alerts,
    });
  }

  // Linhas órfãs restantes (sem item stage correspondente) — agregam só no pedido.
  orphanLines.forEach((line, idx) => {
    if (consumedOrphanIndexes.has(idx)) return;
    if (!line.salesOrderId) return;
    const allocatedCents = toMoneyCents(line.allocatedValueByDocumentPrice);
    const usedQty = toQty(line.quantityUsedForOrder);
    if (allocatedCents <= 0 && usedQty <= 0) return;
    const ord = ensureOrder(line.salesOrderId, line.orderCode ?? null);
    ord.allocatedValueCents += allocatedCents;
    ord.quantityUsedForOrder += usedQty;
    if (line.salesOrderItemId) {
      ord.salesOrderItemIds.add(line.salesOrderItemId);
      ord.hasItemEvidence = true;
    }
  });

  const allocatedToAllOrdersCents = [...orderAgg.values()].reduce(
    (s, o) => s + o.allocatedValueCents,
    0
  );

  const coverage = classifyAllocationCoverage({
    documentValueCents: totalValueCents,
    allocatedToOrdersCents: allocatedToAllOrdersCents,
  });

  const unallocatedBalanceCents = Math.max(
    0,
    totalValueCents - allocatedToAllOrdersCents
  );
  const overAllocationCents = Math.max(
    0,
    allocatedToAllOrdersCents - totalValueCents
  );

  let documentLinkOrigin: OutputDocumentLinkOrigin = "UNRESOLVED";
  if (items.some((i) => i.linkOrigin === "CONFLICT")) {
    documentLinkOrigin = "CONFLICT";
  } else if (items.some((i) => i.linkOrigin === "ITEM_EVIDENCE" || i.linkStatus === "partial")) {
    documentLinkOrigin = "ITEM_EVIDENCE";
  } else if (orderAgg.size > 0) {
    documentLinkOrigin = "ORDER_TO_CASH";
  } else if (document.idNfe != null) {
    documentLinkOrigin = "SALES_ORDER_NFE_LINK";
  }

  const linkedOrders: OutputDocumentAllocationLinkedOrderDto[] = [...orderAgg.values()]
    .map((o) => ({
      salesOrderId: o.salesOrderId,
      orderCode: o.orderCode,
      allocatedValueCents: o.allocatedValueCents,
      allocatedValue: moneyCentsToNumber(o.allocatedValueCents),
      quantityUsedForOrder: o.quantityUsedForOrder,
      linkOrigin: o.hasItemEvidence
        ? ("ITEM_EVIDENCE" as const)
        : ("ORDER_TO_CASH" as const),
      stockDocumentItemIds: [...o.stockDocumentItemIds].sort(),
      salesOrderItemIds: [...o.salesOrderItemIds].sort(),
    }))
    .sort((a, b) => {
      if (focusSalesOrderId) {
        if (a.salesOrderId === focusSalesOrderId) return -1;
        if (b.salesOrderId === focusSalesOrderId) return 1;
      }
      return a.salesOrderId.localeCompare(b.salesOrderId);
    });

  const orderShares: OutputDocumentAllocationOrderShareDto[] = linkedOrders.map(
    (o) => ({
      salesOrderId: o.salesOrderId,
      orderCode: o.orderCode,
      allocatedValueCents: o.allocatedValueCents,
      allocatedValue: o.allocatedValue,
      shareOfDocumentPercent: coveragePercent(totalValueCents, o.allocatedValueCents),
    })
  );

  return {
    document: {
      stockDocumentId: document.id ?? null,
      stockDocumentExternalId: document.externalId,
      idNfe: document.idNfe ?? null,
      totalValueCents,
      totalValue: moneyCentsToNumber(totalValueCents),
      totalValueSource,
      allocatedToAllOrdersCents,
      allocatedToAllOrders: moneyCentsToNumber(allocatedToAllOrdersCents),
      unallocatedBalanceCents,
      unallocatedBalance: moneyCentsToNumber(unallocatedBalanceCents),
      overAllocationCents,
      overAllocation: moneyCentsToNumber(overAllocationCents),
      coveragePercent: coveragePercent(totalValueCents, allocatedToAllOrdersCents),
      coverageStatus: coverage.status,
      coverageReasons: coverage.reasons,
      linkOrigin: documentLinkOrigin,
      productLineCount: document.items.length,
    },
    items,
    linkedOrders,
    orderShares,
    allocationsSumCents: allocatedToAllOrdersCents,
    allocationsSum: moneyCentsToNumber(allocatedToAllOrdersCents),
  };
}

/**
 * Valor alocado a um pedido específico (nunca o total do documento).
 */
export function allocatedValueForSalesOrder(
  projection: OutputDocumentAllocationProjection,
  salesOrderId: string
): { allocatedValueCents: number; allocatedValue: number } {
  const row = projection.linkedOrders.find((o) => o.salesOrderId === salesOrderId);
  return {
    allocatedValueCents: row?.allocatedValueCents ?? 0,
    allocatedValue: row?.allocatedValue ?? 0,
  };
}

/**
 * Mapeia linhas do resolver DS-03.7 para o input da projeção.
 */
export function allocationLinesFromResolvedO2c(
  lines: ReadonlyArray<ResolvedOutputDocumentAllocationLine>,
  extras?: ReadonlyArray<{ stockDocumentItemId: string | null; externalProductId?: number | null }>
): OutputDocumentAllocationLineInput[] {
  const productByItem = new Map<string, number | null>();
  for (const e of extras ?? []) {
    if (e.stockDocumentItemId) {
      productByItem.set(e.stockDocumentItemId, e.externalProductId ?? null);
    }
  }
  return lines.map((line) => ({
    stockDocumentItemId: line.stockDocumentItemId,
    salesOrderId: line.salesOrderId,
    salesOrderItemId: line.salesOrderItemId,
    allocatedValueByDocumentPrice: line.allocatedValueByDocumentPrice,
    quantityUsedForOrder: line.quantityUsedForOrder,
    externalProductId: line.stockDocumentItemId
      ? productByItem.get(line.stockDocumentItemId) ?? null
      : null,
  }));
}
