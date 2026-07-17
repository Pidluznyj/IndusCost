/**
 * FIN-04 — Cálculo financeiro por item do Pedido (puro).
 *
 * Usa o classificador FIN-03 e `Prisma.Decimal` para todo dinheiro.
 * Política: `docs/finance/effective-schedule-policy.md`.
 *
 * Não altera telas. Sem I/O.
 */

import { Prisma } from "@prisma/client";
import {
  classifySalesOrderItemFinancialFulfillment,
  type ClassifySalesOrderItemFinancialFulfillmentResult,
  type SalesOrderItemFinancialFulfillmentClassification,
} from "./salesOrderItemFinancialFulfillmentClassifier.js";

export type MoneyDecimal = Prisma.Decimal;

const ZERO = new Prisma.Decimal(0);
const MONEY_DP = 2;
const ROUND = Prisma.Decimal.ROUND_HALF_UP;

/** Entrada de alocação Documento → item (dedupe por `allocationKey`). */
export type SalesOrderItemDocumentAllocationInput = {
  /**
   * Chave estável da alocação (ex.: stockDocumentItemId + salesOrderItemId).
   * Mesma chave não soma duas vezes.
   */
  allocationKey: string;
  /** Valor alocado ao item a preço do pedido (cobertura comercial). */
  allocatedByOrderPrice: Prisma.Decimal | string;
  /** Valor real no Documento (preservado; não redefine residual comercial). */
  allocatedByDocumentPrice?: Prisma.Decimal | string | null;
  /** false = documento inválido/cancelado — ignorado na cobertura. Default true. */
  isValid?: boolean;
};

/** Entrada de CR ligado ao item/NF (preservado; não altera residual comercial via diff Doc). */
export type SalesOrderItemCrAllocationInput = {
  allocationKey: string;
  amountReceivable: Prisma.Decimal | string;
  amountReceived?: Prisma.Decimal | string | null;
  balanceReceivable?: Prisma.Decimal | string | null;
};

export type ComputeSalesOrderItemFinancialAmountsInput = {
  salesOrderItemId: string;
  /** Valor líquido oficial do item (`SalesOrderItem.totalNetValue`). */
  plannedNetValue: Prisma.Decimal | string;
  status?: unknown;
  statusNormalized?: string | null;
  statusRaw?: string | null;
  orderedQuantity?: Prisma.Decimal | string | number | null;
  fulfilledQuantity?: Prisma.Decimal | string | number | null;
  nomusIsCut?: boolean | null;
  nomusIsCanceled?: boolean | null;
  documentAllocations?: readonly SalesOrderItemDocumentAllocationInput[];
  crAllocations?: readonly SalesOrderItemCrAllocationInput[];
};

export type SalesOrderItemFinancialAmounts = {
  salesOrderItemId: string;
  classification: SalesOrderItemFinancialFulfillmentClassification;
  fulfillment: ClassifySalesOrderItemFinancialFulfillmentResult;
  /** Valor líquido planejado do item. */
  plannedNetValue: Prisma.Decimal;
  /**
   * Cobertura por Documentos válidos a preço do pedido, limitada ao planejado
   * (base do residual comercial).
   */
  coveredByValidDocuments: Prisma.Decimal;
  /** Soma bruta alocada a preço do pedido (antes do cap), sem duplicar keys. */
  documentAllocatedByOrderPriceRaw: Prisma.Decimal;
  /** Soma bruta a preço do Documento (preservada; pode divergir do pedido). */
  documentAllocatedByDocumentPriceRaw: Prisma.Decimal;
  /** Soma CR amountReceivable (preservada). */
  crReceivableRaw: Prisma.Decimal;
  /** Soma CR amountReceived (preservada). */
  crReceivedRaw: Prisma.Decimal;
  /** Soma CR balanceReceivable (preservada). */
  crOpenRaw: Prisma.Decimal;
  /** Valor ainda ativo (previsão comercial residual). */
  activeResidual: Prisma.Decimal;
  /** Valor de corte comercial. */
  cutAmount: Prisma.Decimal;
  /** Valor cancelado. */
  canceledAmount: Prisma.Decimal;
  /** Residual provisório (UNKNOWN) — valor não coberto. */
  unresolvedResidual: Prisma.Decimal;
  evidence: {
    orderedQuantity: Prisma.Decimal | null;
    fulfilledQuantity: Prisma.Decimal | null;
    remainingQuantity: Prisma.Decimal | null;
    quantityShareActive: Prisma.Decimal | null;
    documentAllocationKeysUsed: string[];
    crAllocationKeysUsed: string[];
    classificationPendingAlert: boolean;
  };
};

function money(value: Prisma.Decimal | string | number | null | undefined): Prisma.Decimal {
  if (value == null || value === "") return ZERO;
  if (value instanceof Prisma.Decimal) {
    if (value.isNaN() || !value.isFinite()) return ZERO;
    return value.toDecimalPlaces(MONEY_DP, ROUND);
  }
  try {
    const d = new Prisma.Decimal(value);
    if (d.isNaN() || !d.isFinite()) return ZERO;
    return d.toDecimalPlaces(MONEY_DP, ROUND);
  } catch {
    return ZERO;
  }
}

function qtyDecimal(
  value: Prisma.Decimal | string | number | null | undefined
): Prisma.Decimal | null {
  if (value == null || value === "") return null;
  try {
    const d = value instanceof Prisma.Decimal ? value : new Prisma.Decimal(value);
    if (d.isNaN() || !d.isFinite() || d.lt(0)) return null;
    return d;
  } catch {
    return null;
  }
}

/**
 * saldo = planejado × restante ÷ pedida (Decimal, 2 casas).
 * Retorna null se denominador inválido.
 */
export function computeQuantityProportionalAmount(
  plannedNetValue: Prisma.Decimal | string,
  remainingQuantity: Prisma.Decimal | string | number | null | undefined,
  orderedQuantity: Prisma.Decimal | string | number | null | undefined
): Prisma.Decimal | null {
  const planned = money(plannedNetValue);
  const remaining = qtyDecimal(remainingQuantity);
  const ordered = qtyDecimal(orderedQuantity);
  if (remaining == null || ordered == null || ordered.lte(0)) return null;
  return planned.mul(remaining).div(ordered).toDecimalPlaces(MONEY_DP, ROUND);
}

function minMoney(a: Prisma.Decimal, b: Prisma.Decimal): Prisma.Decimal {
  return a.lte(b) ? a : b;
}

function maxMoney(a: Prisma.Decimal, b: Prisma.Decimal): Prisma.Decimal {
  return a.gte(b) ? a : b;
}

function sumDeduped(
  rows: readonly { allocationKey: string; amount: Prisma.Decimal | string }[],
  keysOut: string[]
): Prisma.Decimal {
  const seen = new Set<string>();
  let total = ZERO;
  for (const row of rows) {
    const key = row.allocationKey.trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    keysOut.push(key);
    total = total.add(money(row.amount));
  }
  return total.toDecimalPlaces(MONEY_DP, ROUND);
}

function qtyToClassifierNumber(q: Prisma.Decimal | null): number | null {
  if (q == null) return null;
  // Fronteira com FIN-03 (classificador usa number só para qty/status).
  return Number(q.toString());
}

/**
 * Calcula valores financeiros comerciais do item + preserva Doc/CR brutos.
 */
export function computeSalesOrderItemFinancialAmounts(
  input: ComputeSalesOrderItemFinancialAmountsInput
): SalesOrderItemFinancialAmounts {
  const plannedNetValue = money(input.plannedNetValue);
  const orderedQty = qtyDecimal(input.orderedQuantity);
  const fulfilledQty = qtyDecimal(input.fulfilledQuantity);

  const fulfillment = classifySalesOrderItemFinancialFulfillment({
    status: input.status,
    statusNormalized: input.statusNormalized,
    statusRaw: input.statusRaw,
    orderedQuantity: qtyToClassifierNumber(orderedQty),
    fulfilledQuantity: qtyToClassifierNumber(fulfilledQty),
    nomusIsCut: input.nomusIsCut,
    nomusIsCanceled: input.nomusIsCanceled,
  });

  const remainingQty = qtyDecimal(fulfillment.remainingQuantity);

  const docKeys: string[] = [];
  const validDocs = (input.documentAllocations ?? []).filter(
    (d) => d.isValid !== false
  );
  const documentAllocatedByOrderPriceRaw = sumDeduped(
    validDocs.map((d) => ({
      allocationKey: d.allocationKey,
      amount: d.allocatedByOrderPrice,
    })),
    docKeys
  );
  const documentAllocatedByDocumentPriceRaw = sumDeduped(
    validDocs.map((d) => ({
      allocationKey: d.allocationKey,
      amount: d.allocatedByDocumentPrice ?? d.allocatedByOrderPrice,
    })),
    []
  );

  const coveredByValidDocuments = minMoney(
    documentAllocatedByOrderPriceRaw,
    plannedNetValue
  );

  const crKeys: string[] = [];
  const crRows = input.crAllocations ?? [];
  const crReceivableRaw = sumDeduped(
    crRows.map((c) => ({
      allocationKey: c.allocationKey,
      amount: c.amountReceivable,
    })),
    crKeys
  );
  const crReceivedRaw = sumDeduped(
    crRows.map((c) => ({
      allocationKey: c.allocationKey,
      amount: c.amountReceived ?? ZERO,
    })),
    []
  );
  const crOpenRaw = sumDeduped(
    crRows.map((c) => ({
      allocationKey: c.allocationKey,
      amount: c.balanceReceivable ?? ZERO,
    })),
    []
  );

  const quantityShareActive = computeQuantityProportionalAmount(
    plannedNetValue,
    remainingQty,
    orderedQty
  );

  const uncoveredByDocs = maxMoney(
    ZERO,
    plannedNetValue.sub(coveredByValidDocuments)
  ).toDecimalPlaces(MONEY_DP, ROUND);

  let activeResidual = ZERO;
  let cutAmount = ZERO;
  let canceledAmount = ZERO;
  let unresolvedResidual = ZERO;

  switch (fulfillment.classification) {
    case "FULLY_FULFILLED": {
      activeResidual = ZERO;
      cutAmount = ZERO;
      canceledAmount = ZERO;
      unresolvedResidual = ZERO;
      break;
    }
    case "FULFILLED_WITH_CUT": {
      activeResidual = ZERO;
      canceledAmount = ZERO;
      unresolvedResidual = ZERO;
      const fulfilledShare = computeQuantityProportionalAmount(
        plannedNetValue,
        fulfilledQty,
        orderedQty
      );
      if (fulfilledShare != null) {
        cutAmount = maxMoney(ZERO, plannedNetValue.sub(fulfilledShare)).toDecimalPlaces(
          MONEY_DP,
          ROUND
        );
      } else {
        // Sem qty: corte = planejado − coberturadoc (cap), determinístico.
        cutAmount = uncoveredByDocs;
      }
      break;
    }
    case "CANCELED": {
      canceledAmount = plannedNetValue;
      activeResidual = ZERO;
      cutAmount = ZERO;
      unresolvedResidual = ZERO;
      break;
    }
    case "NOT_FULFILLED": {
      // Valor planejado menos cobertura documental (cap).
      activeResidual = uncoveredByDocs;
      break;
    }
    case "PARTIALLY_FULFILLED": {
      const qtyActive = quantityShareActive ?? uncoveredByDocs;
      // Residual = min(saldo por qty, saldo não coberto por Doc no planejado).
      activeResidual = minMoney(qtyActive, uncoveredByDocs);
      break;
    }
    case "UNKNOWN": {
      // Nunca zerar: só o não coberto, em unresolvedResidual.
      const qtyActive = quantityShareActive ?? plannedNetValue;
      unresolvedResidual = minMoney(qtyActive, uncoveredByDocs);
      activeResidual = ZERO;
      break;
    }
  }

  return {
    salesOrderItemId: input.salesOrderItemId,
    classification: fulfillment.classification,
    fulfillment,
    plannedNetValue,
    coveredByValidDocuments,
    documentAllocatedByOrderPriceRaw,
    documentAllocatedByDocumentPriceRaw,
    crReceivableRaw,
    crReceivedRaw,
    crOpenRaw,
    activeResidual,
    cutAmount,
    canceledAmount,
    unresolvedResidual,
    evidence: {
      orderedQuantity: orderedQty,
      fulfilledQuantity: fulfilledQty,
      remainingQuantity: remainingQty,
      quantityShareActive,
      documentAllocationKeysUsed: docKeys,
      crAllocationKeysUsed: crKeys,
      classificationPendingAlert: fulfillment.evidence.classificationPendingAlert,
    },
  };
}
