/**
 * B5 — alocação do pedido por item × NF-e (faturamento parcial em várias NF-e).
 *
 * Fonte oficial: linhas do documento de saída do Nomus (NomusStockDocumentItem) da
 * NF-e, resolvidas para o item do pedido pelo resolvedor canônico
 * (`resolveOutputDocumentLineLinks`). Só conta como evidência a referência oficial do
 * item (`idItemPedido` / sequência do item no pedido) — nunca produto, cliente, valor
 * ou descrição — e só quando nenhum outro pedido da mesma NF-e reivindica a linha.
 *
 * Decisão por NF-e do pedido:
 *   - NF-e de saída autorizada, com evidência oficial completa → INVOICED_ALLOCATION:
 *     o snapshot (pedido, NF-e) leva só os itens/quantidades faturados nela;
 *   - pedido com UMA NF-e válida e nenhuma evidência por item → FULL_ORDER_LEGACY
 *     (comportamento histórico: a única NF-e mede o pedido inteiro) SÓ quando o
 *     faturamento integral está comprovado (cobertura por item do motor operacional ou
 *     valor de produtos da NF-e); parcial comprovado ou sem comprovação → retido;
 *   - qualquer outra situação (pedido em mais de uma NF-e sem evidência, linha sem item
 *     oficial, linha reivindicada por outro pedido, faturado acumulado acima do pedido,
 *     NF-e cancelada/não autorizada) → ALLOCATION_PENDING: comissão retida, nunca
 *     integral. Reversão econômica de devolução/cancelamento posterior não está
 *     definida no sistema: proteção conservadora (retém), decisão documentada.
 *
 * Lógica pura. O valor de cada parcela é proporcional à quantidade do item, com
 * arredondamento por acumulado (Σ das parcelas = valor do item, sem perda nem sobra).
 */
import { roundMoney } from "./commission-money.shared.js";
import type { ItemizedBillingCoverage } from "../sales/salesOrderItemizedBillingCoverage.js";

export type InvoiceAllocationBasis = "FULL_ORDER_LEGACY" | "INVOICED_ALLOCATION" | "ALLOCATION_PENDING";

export type InvoiceAllocationEvidence = {
  stockDocumentItemId: string;
  stockDocumentExternalId: number;
  quantity: number;
  sourceType: string;
};

export type InvoiceAllocationItem = {
  orderedQuantity: number;
  invoicedQuantity: number;
  /** Faturado acumulado nas NF-e anteriores (ordem de processamento). */
  cumulativeBefore: number;
  cumulativeAfter: number;
  evidence: InvoiceAllocationEvidence[];
};

export type OrderInvoiceAllocationForNfe = {
  basis: InvoiceAllocationBasis;
  nfeExternalId: number;
  reason: string | null;
  /** Itens faturados nesta NF-e (INVOICED_ALLOCATION). */
  items: Map<string, InvoiceAllocationItem>;
};

export type InvoiceAllocationOrderItemInput = {
  salesOrderItemId: string;
  /** Quantidade válida do item (sem cancelados/cortados). */
  orderedQuantity: number;
};

export type InvoiceAllocationNfeInput = {
  nfeExternalId: number;
  processedAt: Date | null;
  /** NF-e de saída autorizada e não cancelada. */
  valid: boolean;
};

export type InvoiceAllocationLineInput = {
  stockDocumentItemId: string;
  stockDocumentExternalId: number;
  nfeExternalId: number | null;
  /** Documento de saída válido (não cancelado). */
  documentValid: boolean;
  /** Linha resolvida para ESTE pedido (item ou só o pedido). */
  belongsToOrder: boolean;
  salesOrderItemId: string | null;
  quantity: number;
  sourceType: string;
  itemCoverage: string;
  /** Outro pedido da mesma NF-e também resolveu esta linha para um item dele. */
  claimedByOtherOrders: boolean;
};

export type OrderInvoiceAllocation = {
  byNfe: Map<number, OrderInvoiceAllocationForNfe>;
  /** Por item: pedido, faturado acumulado (com evidência) e saldo pendente. */
  items: Map<string, { orderedQuantity: number; invoicedQuantity: number; pendingQuantity: number }>;
  conflicts: string[];
  /** Linhas de documento de saída deste pedido em NF-e válidas (auditoria de evidência). */
  evidence: { strongLines: number; weakLines: number; claimedLines: number };
  /** Prova usada quando o pedido tem uma única NF-e válida (null nos demais casos). */
  singleNfeBillingProof: SingleNfeBillingProof | null;
};

/**
 * Prova de faturamento integral de um pedido de NF-e única sem evidência por item no
 * documento de saída. FULL mantém o snapshot histórico; PARTIAL/UNPROVEN retêm.
 */
export type SingleNfeBillingProof = {
  status: "FULL" | "PARTIAL" | "UNPROVEN";
  source: "ITEMIZED_COVERAGE" | "NFE_PRODUCTS_VALUE" | "NONE";
  reason: string;
};

/** Mesma tolerância da regra de faturamento do pedido (`salesOrderLinkedNfe.ts`). */
const BILLING_VALUE_TOLERANCE_ABSOLUTE = 1;
const BILLING_VALUE_TOLERANCE_PERCENT = 0.01;

/**
 * Decide se a única NF-e válida do pedido o faturou por inteiro, na ordem:
 *   1. cobertura por item do motor operacional (`resolveItemizedBillingCoverage`,
 *      a mesma regra do status de Faturamento do pedido): FULL ou PARTIAL decidem;
 *   2. sem cobertura por item conclusiva: valor de PRODUTOS da NF-e (sem frete/IPI)
 *      contra o valor líquido de todos os pedidos da NF-e — cobre (com a tolerância
 *      do faturamento) → FULL; abaixo → PARTIAL;
 *   3. sem nenhum dos dois → UNPROVEN (nunca presume faturamento integral).
 */
export function resolveSingleNfeBillingProof(input: {
  itemizedCoverage: ItemizedBillingCoverage;
  itemizedReason: string;
  nfeProductsValue: number | null;
  ordersNetTotal: number | null;
}): SingleNfeBillingProof {
  if (input.itemizedCoverage === "FULL") {
    return { status: "FULL", source: "ITEMIZED_COVERAGE", reason: `cobertura por item: ${input.itemizedReason}` };
  }
  if (input.itemizedCoverage === "PARTIAL") {
    return { status: "PARTIAL", source: "ITEMIZED_COVERAGE", reason: `cobertura por item: ${input.itemizedReason}` };
  }
  const products = input.nfeProductsValue;
  const orders = input.ordersNetTotal;
  if (products == null || !Number.isFinite(products) || products <= 0 || orders == null || !Number.isFinite(orders) || orders <= 0) {
    return {
      status: "UNPROVEN",
      source: "NONE",
      reason: `cobertura por item inconclusiva (${input.itemizedReason}) e NF-e sem valor de produtos comparável`,
    };
  }
  const tolerance = Math.max(BILLING_VALUE_TOLERANCE_ABSOLUTE, orders * BILLING_VALUE_TOLERANCE_PERCENT);
  const label = `produtos da NF-e R$ ${roundMoney(products).toFixed(2)} × pedido(s) R$ ${roundMoney(orders).toFixed(2)}`;
  return products >= orders - tolerance
    ? { status: "FULL", source: "NFE_PRODUCTS_VALUE", reason: label }
    : { status: "PARTIAL", source: "NFE_PRODUCTS_VALUE", reason: label };
}

const QTY_EPSILON = 1e-6;
const STRONG_SOURCE = "DIRECT_ORDER_ITEM_REFERENCE";

function roundQty(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

function compareNfe(a: InvoiceAllocationNfeInput, b: InvoiceAllocationNfeInput): number {
  const at = a.processedAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
  const bt = b.processedAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
  return at - bt || a.nfeExternalId - b.nfeExternalId;
}

export function isStrongInvoiceAllocationLine(line: InvoiceAllocationLineInput): boolean {
  return (
    line.belongsToOrder &&
    line.documentValid &&
    line.salesOrderItemId != null &&
    line.itemCoverage === "RESOLVED" &&
    line.sourceType === STRONG_SOURCE &&
    !line.claimedByOtherOrders &&
    line.quantity > 0
  );
}

export function resolveOrderInvoiceAllocation(input: {
  items: readonly InvoiceAllocationOrderItemInput[];
  nfes: readonly InvoiceAllocationNfeInput[];
  lines: readonly InvoiceAllocationLineInput[];
  /**
   * Prova de faturamento integral da NF-e única sem evidência por item. Ausente =
   * comportamento histórico (pedido inteiro); o carregador oficial sempre informa.
   */
  singleNfeBillingProof?: SingleNfeBillingProof | null;
}): OrderInvoiceAllocation {
  const byNfe = new Map<number, OrderInvoiceAllocationForNfe>();
  const conflicts: string[] = [];
  const ordered = new Map(input.items.map((item) => [item.salesOrderItemId, roundQty(Math.max(0, item.orderedQuantity))]));
  const validNfes = input.nfes.filter((nfe) => nfe.valid).sort(compareNfe);

  for (const nfe of input.nfes) {
    if (!nfe.valid) {
      byNfe.set(nfe.nfeExternalId, {
        basis: "ALLOCATION_PENDING",
        nfeExternalId: nfe.nfeExternalId,
        reason: "NF-e cancelada, não autorizada ou que não é de saída: nada a comissionar por ela.",
        items: new Map(),
      });
    }
  }

  // Linhas por NF-e, deduplicadas pela linha do documento.
  const linesByNfe = new Map<number, InvoiceAllocationLineInput[]>();
  const seen = new Set<string>();
  for (const line of input.lines) {
    if (line.nfeExternalId == null || !line.belongsToOrder || !line.documentValid) continue;
    if (seen.has(line.stockDocumentItemId)) continue;
    seen.add(line.stockDocumentItemId);
    const list = linesByNfe.get(line.nfeExternalId) ?? [];
    list.push(line);
    linesByNfe.set(line.nfeExternalId, list);
  }

  const anyStrong = validNfes.some((nfe) => (linesByNfe.get(nfe.nfeExternalId) ?? []).some(isStrongInvoiceAllocationLine));
  const anyLine = validNfes.some((nfe) => (linesByNfe.get(nfe.nfeExternalId) ?? []).length > 0);

  if (validNfes.length === 1 && !anyStrong) {
    const nfe = validNfes[0]!;
    const proof = input.singleNfeBillingProof ?? null;
    if (proof && proof.status !== "FULL") {
      // Nunca antecipa: sem comprovação do faturamento integral, a NF-e única não
      // mede o pedido inteiro — comissão retida (justificada) até haver evidência.
      byNfe.set(nfe.nfeExternalId, {
        basis: "ALLOCATION_PENDING",
        nfeExternalId: nfe.nfeExternalId,
        reason:
          proof.status === "PARTIAL"
            ? `NF-e única fatura só parte do pedido (${proof.reason}) e o documento de saída não traz o item oficial: comissão retida até a evidência por item.`
            : `NF-e única sem comprovação de faturamento integral (${proof.reason}): comissão retida até a evidência por item.`,
        items: new Map(),
      });
    } else {
      byNfe.set(nfe.nfeExternalId, {
        basis: "FULL_ORDER_LEGACY",
        nfeExternalId: nfe.nfeExternalId,
        reason: proof
          ? `NF-e única fatura o pedido inteiro (${proof.reason}).`
          : anyLine
            ? "NF-e única do pedido; documento de saída sem referência oficial do item — mede o pedido inteiro."
            : null,
        items: new Map(),
      });
    }
  } else {
    const cumulative = new Map<string, number>();
    let blockedFromHere = false;
    for (const nfe of validNfes) {
      const lines = linesByNfe.get(nfe.nfeExternalId) ?? [];
      const strong = lines.filter(isStrongInvoiceAllocationLine);
      const weak = lines.filter((line) => !isStrongInvoiceAllocationLine(line));
      let reason: string | null = null;
      if (blockedFromHere) {
        reason = "NF-e posterior a uma alocação inconsistente do mesmo pedido.";
      } else if (strong.length === 0) {
        reason = "Pedido em mais de uma NF-e sem linha de documento de saída com o item oficial do pedido nesta NF-e.";
      } else if (weak.length > 0) {
        const claimed = weak.some((line) => line.claimedByOtherOrders);
        reason = claimed
          ? "Linha do documento de saída reivindicada por mais de um pedido da NF-e."
          : "Linha do documento de saída do pedido sem item oficial (só pedido/produto): alocação incompleta.";
      }
      if (reason) {
        byNfe.set(nfe.nfeExternalId, { basis: "ALLOCATION_PENDING", nfeExternalId: nfe.nfeExternalId, reason, items: new Map() });
        continue;
      }
      const items = new Map<string, InvoiceAllocationItem>();
      for (const line of strong) {
        const itemId = line.salesOrderItemId!;
        const current = items.get(itemId) ?? {
          orderedQuantity: ordered.get(itemId) ?? 0,
          invoicedQuantity: 0,
          cumulativeBefore: roundQty(cumulative.get(itemId) ?? 0),
          cumulativeAfter: 0,
          evidence: [],
        };
        current.invoicedQuantity = roundQty(current.invoicedQuantity + line.quantity);
        current.evidence.push({
          stockDocumentItemId: line.stockDocumentItemId,
          stockDocumentExternalId: line.stockDocumentExternalId,
          quantity: line.quantity,
          sourceType: line.sourceType,
        });
        items.set(itemId, current);
      }
      let overInvoiced: string | null = null;
      for (const [itemId, item] of items) {
        if (!ordered.has(itemId)) {
          overInvoiced = "Item faturado que não está entre os itens válidos do pedido.";
          break;
        }
        item.cumulativeAfter = roundQty(item.cumulativeBefore + item.invoicedQuantity);
        if (item.cumulativeAfter > item.orderedQuantity + QTY_EPSILON) {
          overInvoiced = "Faturado acumulado do item acima da quantidade válida do pedido (I3).";
          break;
        }
      }
      if (overInvoiced) {
        conflicts.push(`NF-e ${nfe.nfeExternalId}: ${overInvoiced}`);
        blockedFromHere = true;
        byNfe.set(nfe.nfeExternalId, { basis: "ALLOCATION_PENDING", nfeExternalId: nfe.nfeExternalId, reason: overInvoiced, items: new Map() });
        continue;
      }
      for (const [itemId, item] of items) cumulative.set(itemId, item.cumulativeAfter);
      byNfe.set(nfe.nfeExternalId, { basis: "INVOICED_ALLOCATION", nfeExternalId: nfe.nfeExternalId, reason: null, items });
    }
    // NF-e única que fatura o pedido inteiro (a evidência por item confere com todas as
    // quantidades): o snapshot é exatamente o histórico — mantém FULL_ORDER_LEGACY e o
    // mesmo hash, sem rematerialização em massa na implantação.
    const only = validNfes.length === 1 ? byNfe.get(validNfes[0]!.nfeExternalId) : undefined;
    if (
      only?.basis === "INVOICED_ALLOCATION" &&
      [...ordered].every(([itemId, quantity]) => Math.abs((only.items.get(itemId)?.cumulativeAfter ?? 0) - quantity) <= QTY_EPSILON)
    ) {
      byNfe.set(only.nfeExternalId, {
        basis: "FULL_ORDER_LEGACY",
        nfeExternalId: only.nfeExternalId,
        reason: "NF-e única fatura o pedido inteiro (evidência por item confere).",
        items: new Map(),
      });
    }
  }

  const items = new Map<string, { orderedQuantity: number; invoicedQuantity: number; pendingQuantity: number }>();
  for (const [itemId, orderedQuantity] of ordered) {
    let invoiced = 0;
    for (const allocation of byNfe.values()) invoiced += allocation.items.get(itemId)?.invoicedQuantity ?? 0;
    invoiced = roundQty(invoiced);
    items.set(itemId, { orderedQuantity, invoicedQuantity: invoiced, pendingQuantity: roundQty(Math.max(0, orderedQuantity - invoiced)) });
  }
  const ownLines = [...linesByNfe.entries()].filter(([nfeId]) => validNfes.some((nfe) => nfe.nfeExternalId === nfeId)).flatMap(([, list]) => list);
  const weak = ownLines.filter((line) => !isStrongInvoiceAllocationLine(line));
  return {
    byNfe,
    items,
    conflicts,
    evidence: {
      strongLines: ownLines.length - weak.length,
      weakLines: weak.length,
      claimedLines: weak.filter((line) => line.claimedByOtherOrders).length,
    },
    singleNfeBillingProof: validNfes.length === 1 ? (input.singleNfeBillingProof ?? null) : null,
  };
}

/**
 * Parcela de um valor do item correspondente às quantidades (antes, depois] por
 * acumulado: round(v·depois/pedido) − round(v·antes/pedido). Σ das parcelas de todas
 * as NF-e = valor do item quando o item é faturado por inteiro.
 */
export function allocateItemAmountByQuantity(input: {
  fullAmount: number;
  orderedQuantity: number;
  cumulativeBefore: number;
  cumulativeAfter: number;
}): number {
  if (input.orderedQuantity <= 0) return 0;
  const at = (quantity: number) =>
    roundMoney((input.fullAmount * Math.min(quantity, input.orderedQuantity)) / input.orderedQuantity);
  return roundMoney(at(input.cumulativeAfter) - at(input.cumulativeBefore));
}
