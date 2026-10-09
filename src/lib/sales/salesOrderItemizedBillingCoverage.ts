/**
 * Cobertura de faturamento do pedido por item (obrigação ativa × quantidade faturada).
 *
 * Separa duas perguntas que a regra por valor misturava:
 *   A) evidência fiscal — existe NF-e válida vinculada? (`salesOrderLinkedNfe.ts`)
 *   B) cobertura da obrigação — os itens ativos estão integralmente faturados?
 *
 * B é respondida aqui, sobre os fatos por item do motor operacional
 * (`SalesOrderItemFlowSnapshot`): `shipTargetQuantity` é a obrigação ativa
 * (pedido − corte − cancelado) e `invoicedQuantity` a quantidade faturada por
 * NF válida. O cabeçalho da NF (`xmlVNF`) não entra: ele inclui frete/IPI e,
 * em NF de vários pedidos, itens de outros pedidos.
 *
 * Conservador: qualquer dado ausente ou inconsistente devolve `UNKNOWN`, e o
 * chamador mantém a regra legada por valor.
 *
 * Frontend-safe: sem Prisma, sem I/O.
 */

export type ItemizedBillingCoverage = "FULL" | "PARTIAL" | "NONE" | "UNKNOWN";

export type ItemizedBillingCoverageReason =
  | "ACTIVE_ITEMS_FULLY_INVOICED"
  | "ACTIVE_ITEMS_PARTIALLY_INVOICED"
  | "ACTIVE_ITEMS_NOT_INVOICED"
  | "NO_ITEM_SNAPSHOT"
  | "ITEM_SNAPSHOT_INCOMPLETE"
  | "ITEM_SNAPSHOT_INCONSISTENT"
  | "NO_ACTIVE_OBLIGATION";

/** Fatos de um `SalesOrderItemFlowSnapshot` usados na cobertura. */
export type ItemizedBillingItemInput = {
  salesOrderItemId: string;
  /** Falso para item cancelado/obsoleto — não gera obrigação. */
  isActiveForKanban: boolean;
  currentStage?: string | null;
  orderedQuantity: number | null | undefined;
  /** Obrigação ativa: pedido − corte − cancelado. */
  shipTargetQuantity: number | null | undefined;
  invoicedQuantity: number | null | undefined;
};

export type ItemizedBillingCoverageResult = {
  coverage: ItemizedBillingCoverage;
  reason: ItemizedBillingCoverageReason;
  /** Itens com obrigação ativa > 0. */
  activeItems: number;
  fullyInvoicedItems: number;
  partiallyInvoicedItems: number;
  notInvoicedItems: number;
};

/** Precisão das quantidades persistidas (`Decimal(20, 6)`). */
export const ITEMIZED_BILLING_QUANTITY_EPSILON = 0.000001;

function unknown(
  reason: ItemizedBillingCoverageReason
): ItemizedBillingCoverageResult {
  return {
    coverage: "UNKNOWN",
    reason,
    activeItems: 0,
    fullyInvoicedItems: 0,
    partiallyInvoicedItems: 0,
    notInvoicedItems: 0,
  };
}

function isValidQuantity(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

/**
 * Classifica a cobertura da obrigação ativa do pedido.
 *
 * `expectedItemCount` é a quantidade de `SalesOrderItem` do pedido: o motor
 * grava um snapshot por item, então contagem diferente = snapshot incompleto.
 */
export function resolveItemizedBillingCoverage(input: {
  items: readonly ItemizedBillingItemInput[] | null | undefined;
  expectedItemCount?: number | null;
}): ItemizedBillingCoverageResult {
  const items = input.items ?? [];
  if (items.length === 0) return unknown("NO_ITEM_SNAPSHOT");
  if (input.expectedItemCount == null || input.expectedItemCount !== items.length) {
    return unknown("ITEM_SNAPSHOT_INCOMPLETE");
  }
  if (new Set(items.map((item) => item.salesOrderItemId)).size !== items.length) {
    return unknown("ITEM_SNAPSHOT_INCONSISTENT");
  }

  let activeItems = 0;
  let fullyInvoicedItems = 0;
  let partiallyInvoicedItems = 0;
  let notInvoicedItems = 0;

  for (const item of items) {
    // Item cancelado não gera saldo pendente nem impede o faturamento total.
    if (!item.isActiveForKanban || item.currentStage === "CANCELED") continue;

    const { orderedQuantity, shipTargetQuantity, invoicedQuantity } = item;
    if (
      !isValidQuantity(orderedQuantity) ||
      !isValidQuantity(shipTargetQuantity) ||
      !isValidQuantity(invoicedQuantity) ||
      shipTargetQuantity > orderedQuantity + ITEMIZED_BILLING_QUANTITY_EPSILON
    ) {
      return unknown("ITEM_SNAPSHOT_INCONSISTENT");
    }
    // Item totalmente cortado: corte não é saldo.
    if (shipTargetQuantity <= ITEMIZED_BILLING_QUANTITY_EPSILON) continue;

    activeItems += 1;
    if (invoicedQuantity >= shipTargetQuantity - ITEMIZED_BILLING_QUANTITY_EPSILON) {
      fullyInvoicedItems += 1;
    } else if (invoicedQuantity > ITEMIZED_BILLING_QUANTITY_EPSILON) {
      partiallyInvoicedItems += 1;
    } else {
      notInvoicedItems += 1;
    }
  }

  const counts = { activeItems, fullyInvoicedItems, partiallyInvoicedItems, notInvoicedItems };
  if (activeItems === 0) return { ...unknown("NO_ACTIVE_OBLIGATION") };
  if (fullyInvoicedItems === activeItems) {
    return { coverage: "FULL", reason: "ACTIVE_ITEMS_FULLY_INVOICED", ...counts };
  }
  if (fullyInvoicedItems + partiallyInvoicedItems > 0) {
    return { coverage: "PARTIAL", reason: "ACTIVE_ITEMS_PARTIALLY_INVOICED", ...counts };
  }
  return { coverage: "NONE", reason: "ACTIVE_ITEMS_NOT_INVOICED", ...counts };
}

export type SalesOrderBillingDecisionReason =
  | "NO_VALID_NFE"
  | "ITEMIZED_FULL"
  | "SHARED_NFE_ITEMIZED_FULL"
  | "ITEMIZED_PARTIAL"
  | "ITEMIZED_NONE_WITH_VALID_NFE"
  | "ITEMIZED_UNKNOWN_FALLBACK_VALUE";

export type SalesOrderBillingDecision = {
  isFullyInvoiced: boolean;
  isPartiallyInvoiced: boolean;
  reason: SalesOrderBillingDecisionReason;
  /** A classificação final veio da regra legada por valor. */
  usedLegacyFallback: boolean;
};

/**
 * Decide os flags finais de faturamento.
 *
 * A regra por valor nunca sobrepõe uma conclusão por item confiável; ela só
 * vale quando a cobertura é `UNKNOWN`.
 *
 * - Sem NF válida: nunca fatura (a cobertura por item não substitui a NF).
 * - `FULL`: faturado, qualquer que seja o cabeçalho da NF.
 * - `PARTIAL`: parcial, mesmo que o valor da NF feche com o pedido.
 * - `NONE`: há NF válida, mas nenhuma quantidade atribuída aos itens ativos —
 *   parcial (existe faturamento, a obrigação não está coberta); nunca faturado.
 * - `UNKNOWN`: regra legada por valor.
 */
export function resolveSalesOrderBillingDecision(input: {
  hasValidNfe: boolean;
  legacyIsFullyInvoiced: boolean;
  legacyIsPartiallyInvoiced: boolean;
  hasNfeSharedAcrossOrders: boolean;
  itemizedCoverage: ItemizedBillingCoverage;
}): SalesOrderBillingDecision {
  const legacy = {
    isFullyInvoiced: input.legacyIsFullyInvoiced,
    isPartiallyInvoiced: input.legacyIsPartiallyInvoiced,
    usedLegacyFallback: true,
  };
  if (!input.hasValidNfe) return { ...legacy, reason: "NO_VALID_NFE" };

  switch (input.itemizedCoverage) {
    case "FULL":
      return {
        isFullyInvoiced: true,
        isPartiallyInvoiced: false,
        usedLegacyFallback: false,
        reason: input.hasNfeSharedAcrossOrders ? "SHARED_NFE_ITEMIZED_FULL" : "ITEMIZED_FULL",
      };
    case "PARTIAL":
      return {
        isFullyInvoiced: false,
        isPartiallyInvoiced: true,
        usedLegacyFallback: false,
        reason: "ITEMIZED_PARTIAL",
      };
    case "NONE":
      return {
        isFullyInvoiced: false,
        isPartiallyInvoiced: true,
        usedLegacyFallback: false,
        reason: "ITEMIZED_NONE_WITH_VALID_NFE",
      };
    default:
      return { ...legacy, reason: "ITEMIZED_UNKNOWN_FALLBACK_VALUE" };
  }
}
