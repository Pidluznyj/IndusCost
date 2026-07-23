/**
 * KAN-LINK-05 — Resolvedor canônico Ordem de Produção → Pedido / item.
 *
 * Puro (sem I/O). Fontes oficiais: itensPedido (idPedido/id), SalesOrder link
 * persistido, etiqueta/identificação inequívoca. Sem match por produto/cliente/
 * quantidade/data/máquina/molde.
 *
 * Cobertura de OP no Kanban considera apenas remainingFulfillment (residual).
 */

import type { SalesOrderFlowEvidencePack } from "./salesOrderFlowEvidence.js";
import type { SalesOrderItemFlowProductionLinkInput } from "./salesOrderItemFlowEngine.js";
import type { SalesOrderOperationalLinkSourceType } from "./salesOrderOperationalEvidenceContract.js";
import { normalizeOutputDocumentOrderCode } from "./salesOrderOutputDocumentLinkResolver.js";

export type ProductionOrderLinkSalesOrderItem = {
  id: string;
  salesOrderId: string;
  externalSalesOrderId: number | null;
  orderCodeNormalized: string | null;
  nomusItemExternalId: number | null;
  nomusItemSequence: string | null;
  externalProductId: number | null;
};

export type ProductionOrderLinkCandidate = {
  id: string;
  productionOrderId: string;
  productionOrderExternalId: number;
  salesOrderId: string | null;
  salesOrderItemId: string | null;
  externalSalesOrderId: number;
  externalSalesOrderItemId: number;
  itemNumber: string | null;
  linkedQuantity: number | null;
  isCurrent: boolean;
  /** Status da OP (cabeçalho NomusProductionOrder). */
  productionOrderStatus: string | null;
  /** Nome / identificação da OP (para etiqueta). */
  productionOrderName: string | null;
  /** raw tipado opcional (etiqueta/obs). */
  rawJson?: unknown;
};

export type ResolvedProductionOrderLink = {
  productionOrderExternalId: number;
  productionOrderId: string;
  salesOrderId: string | null;
  salesOrderItemId: string | null;
  linkedQuantity: number;
  sourceType: SalesOrderOperationalLinkSourceType;
  itemCoverage: "RESOLVED" | "ORDER_LEVEL_ONLY" | "AMBIGUOUS" | "UNRESOLVED";
  reason: string;
  advancesKanban: boolean;
  isCanceled: boolean;
  isCurrent: boolean;
};

export type ProductionOrderAuditAlertKind =
  | "SAME_PRODUCT"
  | "SAME_QUANTITY"
  | "SAME_CUSTOMER"
  | "TEMPORAL_PROXIMITY"
  | "SAME_MACHINE"
  | "SAME_MOLD";

export type ProductionOrderAuditAlert = {
  kind: ProductionOrderAuditAlertKind;
  detail: string;
  provesLink: false;
};

export function isProductionOrderStatusCanceled(
  status: string | null | undefined
): boolean {
  if (status == null) return false;
  const folded = status.trim().toLowerCase();
  return folded.includes("cancel");
}

/**
 * Extrai códigos PD da identificação/nome/obs da OP.
 * Hint controlado: só PD\d+; ambíguo se >1 código distinto.
 */
export function extractProductionOrderLabelOrderCodes(
  input: {
    name?: string | null;
    rawJson?: unknown;
  }
): { codes: string[]; unambiguous: string | null; ambiguous: boolean } {
  const texts: string[] = [];
  if (input.name?.trim()) texts.push(input.name);
  const raw = input.rawJson;
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const obj = raw as Record<string, unknown>;
    for (const key of [
      "nome",
      "name",
      "identificacao",
      "identificação",
      "etiqueta",
      "observacao",
      "observacaoExtra",
      "observacoes",
    ]) {
      const v = obj[key];
      if (typeof v === "string" && v.trim()) texts.push(v);
    }
  }
  const codes = new Set<string>();
  for (const text of texts) {
    for (const m of text.toUpperCase().matchAll(/\bPD\s*[-_]?(\d+)\b/g)) {
      codes.add(`PD${m[1]}`);
    }
  }
  const list = [...codes].sort();
  return {
    codes: list,
    unambiguous: list.length === 1 ? list[0]! : null,
    ambiguous: list.length > 1,
  };
}

function normalizeItemSequence(value: string | null | undefined): string | null {
  if (value == null) return null;
  const digits = value.replace(/\D/g, "");
  if (!digits) return null;
  return digits.padStart(5, "0");
}

export function buildProductionOrderAuditAlert(
  kind: ProductionOrderAuditAlertKind,
  detail: string
): ProductionOrderAuditAlert {
  return { kind, detail, provesLink: false };
}

export type ResolveProductionOrderLinksInput = {
  salesOrderId: string;
  externalSalesOrderId: number | null;
  orderCodeNormalized: string | null;
  items: readonly ProductionOrderLinkSalesOrderItem[];
  /** Item alvo (cobertura por item). */
  targetItemId: string;
  candidates: readonly ProductionOrderLinkCandidate[];
};

/**
 * Resolve vínculos OP → item para um pedido/item em escopo.
 */
export function resolveSalesOrderProductionOrderLinks(
  input: ResolveProductionOrderLinksInput
): ResolvedProductionOrderLink[] {
  const target = input.items.find((i) => i.id === input.targetItemId);
  if (!target) return [];

  const results: ResolvedProductionOrderLink[] = [];

  for (const candidate of input.candidates) {
    const isCanceled = isProductionOrderStatusCanceled(
      candidate.productionOrderStatus
    );
    const qty = Math.max(0, candidate.linkedQuantity ?? 0);

    // 1–2) IDs oficiais itensPedido
    const orderIdMatch =
      input.externalSalesOrderId != null &&
      candidate.externalSalesOrderId === input.externalSalesOrderId;
    const orderIdConflict =
      input.externalSalesOrderId != null &&
      candidate.externalSalesOrderId !== input.externalSalesOrderId;
    const itemIdMatch =
      target.nomusItemExternalId != null &&
      candidate.externalSalesOrderItemId === target.nomusItemExternalId;

    if (itemIdMatch && orderIdConflict) {
      results.push({
        productionOrderExternalId: candidate.productionOrderExternalId,
        productionOrderId: candidate.productionOrderId,
        salesOrderId: null,
        salesOrderItemId: null,
        linkedQuantity: qty,
        sourceType: "AMBIGUOUS",
        itemCoverage: "AMBIGUOUS",
        reason:
          "idItemPedido presente, porém idPedido diverge do pedido em escopo",
        advancesKanban: false,
        isCanceled,
        isCurrent: candidate.isCurrent !== false,
      });
      continue;
    }

    if (itemIdMatch) {
      results.push({
        productionOrderExternalId: candidate.productionOrderExternalId,
        productionOrderId: candidate.productionOrderId,
        salesOrderId: input.salesOrderId,
        salesOrderItemId: target.id,
        linkedQuantity: qty,
        sourceType: "DIRECT_ORDER_ITEM_REFERENCE",
        itemCoverage: "RESOLVED",
        reason: orderIdMatch
          ? "itensPedido.id + idPedido oficiais"
          : "itensPedido.id oficial do item",
        advancesKanban:
          !isCanceled && candidate.isCurrent !== false && qty > 0,
        isCanceled,
        isCurrent: candidate.isCurrent !== false,
      });
      continue;
    }

    if (orderIdMatch && !itemIdMatch) {
      // 5) sequência/itemNumber inequívoco no pedido
      const seq = normalizeItemSequence(candidate.itemNumber);
      const bySeq =
        seq != null
          ? input.items.filter(
              (i) => normalizeItemSequence(i.nomusItemSequence) === seq
            )
          : [];
      if (bySeq.length === 1 && bySeq[0]!.id === target.id) {
        results.push({
          productionOrderExternalId: candidate.productionOrderExternalId,
          productionOrderId: candidate.productionOrderId,
          salesOrderId: input.salesOrderId,
          salesOrderItemId: target.id,
          linkedQuantity: qty,
          sourceType: "PRODUCTION_ORDER_REFERENCE",
          itemCoverage: "RESOLVED",
          reason: "idPedido oficial + número de item inequívoco",
          advancesKanban:
            !isCanceled && candidate.isCurrent !== false && qty > 0,
          isCanceled,
          isCurrent: candidate.isCurrent !== false,
        });
        continue;
      }

      // 4) FK local persistida no item
      if (
        candidate.salesOrderItemId === target.id &&
        candidate.salesOrderId === input.salesOrderId
      ) {
        results.push({
          productionOrderExternalId: candidate.productionOrderExternalId,
          productionOrderId: candidate.productionOrderId,
          salesOrderId: input.salesOrderId,
          salesOrderItemId: target.id,
          linkedQuantity: qty,
          sourceType: "PRODUCTION_ORDER_REFERENCE",
          itemCoverage: "RESOLVED",
          reason: "vínculo persistido canônico (SalesOrderItem FK)",
          advancesKanban:
            !isCanceled && candidate.isCurrent !== false && qty > 0,
          isCanceled,
          isCurrent: candidate.isCurrent !== false,
        });
        continue;
      }

      results.push({
        productionOrderExternalId: candidate.productionOrderExternalId,
        productionOrderId: candidate.productionOrderId,
        salesOrderId: input.salesOrderId,
        salesOrderItemId: null,
        linkedQuantity: qty,
        sourceType: "DIRECT_ORDER_REFERENCE",
        itemCoverage: "ORDER_LEVEL_ONLY",
        reason: "idPedido oficial sem item inequívoco neste alvo",
        advancesKanban: false,
        isCanceled,
        isCurrent: candidate.isCurrent !== false,
      });
      continue;
    }

    // 3) Etiqueta / identificação
    const label = extractProductionOrderLabelOrderCodes({
      name: candidate.productionOrderName,
      rawJson: candidate.rawJson,
    });
    if (label.ambiguous) {
      results.push({
        productionOrderExternalId: candidate.productionOrderExternalId,
        productionOrderId: candidate.productionOrderId,
        salesOrderId: null,
        salesOrderItemId: null,
        linkedQuantity: qty,
        sourceType: "AMBIGUOUS",
        itemCoverage: "AMBIGUOUS",
        reason: "etiqueta/identificação com mais de um código de pedido",
        advancesKanban: false,
        isCanceled,
        isCurrent: candidate.isCurrent !== false,
      });
      continue;
    }
    if (
      label.unambiguous &&
      input.orderCodeNormalized &&
      label.unambiguous === input.orderCodeNormalized
    ) {
      // Etiqueta só prova pedido — item exige id/sequência; sem isso ORDER_LEVEL
      const seq = normalizeItemSequence(candidate.itemNumber);
      const bySeq =
        seq != null
          ? input.items.filter(
              (i) => normalizeItemSequence(i.nomusItemSequence) === seq
            )
          : [];
      if (bySeq.length === 1 && bySeq[0]!.id === target.id) {
        // Etiqueta inequívoca + item → referência normalizada (avança Kanban).
        results.push({
          productionOrderExternalId: candidate.productionOrderExternalId,
          productionOrderId: candidate.productionOrderId,
          salesOrderId: input.salesOrderId,
          salesOrderItemId: target.id,
          linkedQuantity: qty,
          sourceType: "PRODUCTION_ORDER_REFERENCE",
          itemCoverage: "RESOLVED",
          reason: "etiqueta inequívoca do pedido + número de item",
          advancesKanban:
            !isCanceled && candidate.isCurrent !== false && qty > 0,
          isCanceled,
          isCurrent: candidate.isCurrent !== false,
        });
        continue;
      }
      if (candidate.salesOrderItemId === target.id) {
        results.push({
          productionOrderExternalId: candidate.productionOrderExternalId,
          productionOrderId: candidate.productionOrderId,
          salesOrderId: input.salesOrderId,
          salesOrderItemId: target.id,
          linkedQuantity: qty,
          sourceType: "PRODUCTION_ORDER_REFERENCE",
          itemCoverage: "RESOLVED",
          reason: "etiqueta inequívoca + FK local do item",
          advancesKanban:
            !isCanceled && candidate.isCurrent !== false && qty > 0,
          isCanceled,
          isCurrent: candidate.isCurrent !== false,
        });
        continue;
      }
      // Só etiqueta (sem item) — não avança cobertura do Kanban.
      results.push({
        productionOrderExternalId: candidate.productionOrderExternalId,
        productionOrderId: candidate.productionOrderId,
        salesOrderId: input.salesOrderId,
        salesOrderItemId: null,
        linkedQuantity: qty,
        sourceType: "PRODUCTION_LABEL_REFERENCE",
        itemCoverage: "ORDER_LEVEL_ONLY",
        reason: "etiqueta inequívoca do pedido sem item resolvido",
        advancesKanban: false,
        isCanceled,
        isCurrent: candidate.isCurrent !== false,
      });
      continue;
    }

    // 4) Persistido local apontando este item (mesmo sem external match — órfão reconciliado)
    if (
      candidate.salesOrderItemId === target.id &&
      candidate.salesOrderId === input.salesOrderId &&
      candidate.isCurrent !== false
    ) {
      results.push({
        productionOrderExternalId: candidate.productionOrderExternalId,
        productionOrderId: candidate.productionOrderId,
        salesOrderId: input.salesOrderId,
        salesOrderItemId: target.id,
        linkedQuantity: qty,
        sourceType: "PRODUCTION_ORDER_REFERENCE",
        itemCoverage: "RESOLVED",
        reason: "vínculo persistido canônico",
        advancesKanban: !isCanceled && qty > 0,
        isCanceled,
        isCurrent: true,
      });
      continue;
    }

    // Produto igual ≠ prova (candidato de auditoria, não vínculo)
    if (
      target.externalProductId != null &&
      candidate.rawJson &&
      typeof candidate.rawJson === "object"
    ) {
      // não cria link
    }

    results.push({
      productionOrderExternalId: candidate.productionOrderExternalId,
      productionOrderId: candidate.productionOrderId,
      salesOrderId: null,
      salesOrderItemId: null,
      linkedQuantity: qty,
      sourceType: "UNRESOLVED",
      itemCoverage: "UNRESOLVED",
      reason: "sem vínculo oficial com o item em escopo",
      advancesKanban: false,
      isCanceled,
      isCurrent: candidate.isCurrent !== false,
    });
  }

  return results;
}

/**
 * Soma cobertura de OP que avança o Kanban para o item (várias OPs).
 */
export function sumProductionCoverageQuantity(
  links: readonly ResolvedProductionOrderLink[]
): number {
  let total = 0;
  const seen = new Set<number>();
  for (const link of links) {
    if (!link.advancesKanban) continue;
    if (link.itemCoverage !== "RESOLVED") continue;
    if (seen.has(link.productionOrderExternalId)) continue;
    seen.add(link.productionOrderExternalId);
    total += Math.max(0, link.linkedQuantity);
  }
  return total;
}

export type ProductionCoverageAssessment = {
  activeObligation: number;
  remainingFulfillment: number;
  productionCoveredQuantity: number;
  coverage: "NONE" | "PARTIAL" | "SUFFICIENT" | "NOT_REQUIRED";
  waitingProductionOrder: boolean;
};

/**
 * Avalia cobertura de OP sobre o residual (não sobre o pedido inteiro).
 */
export function assessProductionOrderCoverage(input: {
  orderedQuantity: number;
  cutQuantity: number;
  canceledQuantity: number;
  fulfilledQuantity: number;
  productionCoveredQuantity: number;
  requiresProduction: boolean;
}): ProductionCoverageAssessment {
  const activeObligation = Math.max(
    0,
    input.orderedQuantity - input.cutQuantity - input.canceledQuantity
  );
  const remainingFulfillment = Math.max(
    0,
    activeObligation - Math.max(0, input.fulfilledQuantity)
  );
  const covered = Math.max(0, input.productionCoveredQuantity);

  if (!input.requiresProduction || remainingFulfillment <= 1e-9) {
    return {
      activeObligation,
      remainingFulfillment,
      productionCoveredQuantity: covered,
      coverage: "NOT_REQUIRED",
      waitingProductionOrder: false,
    };
  }
  if (covered <= 1e-9) {
    return {
      activeObligation,
      remainingFulfillment,
      productionCoveredQuantity: covered,
      coverage: "NONE",
      waitingProductionOrder: true,
    };
  }
  if (covered + 1e-9 < remainingFulfillment) {
    return {
      activeObligation,
      remainingFulfillment,
      productionCoveredQuantity: covered,
      coverage: "PARTIAL",
      waitingProductionOrder: true,
    };
  }
  return {
    activeObligation,
    remainingFulfillment,
    productionCoveredQuantity: covered,
    coverage: "SUFFICIENT",
    waitingProductionOrder: false,
  };
}

/** Adapta pack OP-49 → inputs do motor (só vínculos que avançam). */
export function buildProductionOrderLinksForItemFlow(
  pack: SalesOrderFlowEvidencePack,
  salesOrderItemId: string
): {
  motorLinks: SalesOrderItemFlowProductionLinkInput[];
  resolved: ResolvedProductionOrderLink[];
} {
  const item = pack.items.find((i) => i.id === salesOrderItemId);
  if (!item) return { motorLinks: [], resolved: [] };

  const orderCodeNormalized = normalizeOutputDocumentOrderCode(
    pack.order.orderCode
  );
  const items: ProductionOrderLinkSalesOrderItem[] = pack.items.map((i) => ({
    id: i.id,
    salesOrderId: pack.orderId,
    externalSalesOrderId: pack.order.externalSalesOrderId,
    orderCodeNormalized,
    nomusItemExternalId: i.nomusItemExternalId,
    nomusItemSequence: i.nomusItemSequence,
    externalProductId: i.externalProductId,
  }));

  const opByExternal = new Map(
    pack.productionOrders.map((o) => [o.externalId, o] as const)
  );

  const candidates: ProductionOrderLinkCandidate[] = pack.productionLinks.map(
    (l) => {
      const op = opByExternal.get(l.productionOrderExternalId);
      return {
        id: l.id,
        productionOrderId: l.productionOrderId,
        productionOrderExternalId: l.productionOrderExternalId,
        salesOrderId: l.salesOrderId,
        salesOrderItemId: l.salesOrderItemId,
        externalSalesOrderId: l.externalSalesOrderId,
        externalSalesOrderItemId: l.externalSalesOrderItemId,
        itemNumber: l.itemNumber ?? null,
        linkedQuantity: l.linkedQuantity,
        isCurrent: l.isCurrent,
        productionOrderStatus: op?.status ?? null,
        productionOrderName: null,
        rawJson: undefined,
      };
    }
  );

  const resolved = resolveSalesOrderProductionOrderLinks({
    salesOrderId: pack.orderId,
    externalSalesOrderId: pack.order.externalSalesOrderId,
    orderCodeNormalized,
    items,
    targetItemId: salesOrderItemId,
    candidates,
  });

  const motorLinks: SalesOrderItemFlowProductionLinkInput[] = resolved
    .filter((r) => r.advancesKanban && r.itemCoverage === "RESOLVED")
    .map((r) => ({
      linkedQuantity: r.linkedQuantity,
      isCurrent: r.isCurrent,
    }));

  return { motorLinks, resolved };
}
