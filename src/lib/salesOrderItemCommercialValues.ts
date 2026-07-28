/**
 * Composição comercial canônica do item do Pedido de Venda.
 *
 * Função pura — sem Prisma, sem Proposta, sem I/O.
 * Fonte oficial para valor bruto/líquido ativo, desconto efetivo e unitário líquido
 * (antes de comissão/margem). Não reaplica desconto sobre preço já líquido.
 *
 * Regra de líquido (audit Nomus → SalesOrderItem.totalNetValue):
 * - Por padrão o líquido persistido refere-se à quantidade pedida (orderedQuantity).
 * - netActiveValue = (netTotalValue / orderedQuantity) × activeQuantity
 * - Se netValueQuantityBasis = "ACTIVE", o líquido já corresponde à quantidade ativa
 *   e não é proporcionalizado de novo.
 */
import { roundPricingMoney, roundPricingPercent } from "./pricingCalculations.js";
import { resolveActiveSoldQuantity } from "./salesOrderCommercialMargin.js";

const MONEY_EPS = 0.005;
const RATE_EPS = 0.00015; // ~0,015 p.p. sobre fração
const GROSS_COHERENCE_EPS = 0.02;

export type SalesOrderItemNetValueQuantityBasis = "ORDERED" | "ACTIVE";

export type SalesOrderItemCommercialDiscountStatus =
  | "NO_DISCOUNT"
  | "DISCOUNT"
  | "ADDITION"
  | "NO_ACTIVE_VALUE"
  | "INCOMPLETE";

export type SalesOrderItemCommercialValuesReasonCode =
  | "NET_SOLD_VALUE_NOT_FOUND"
  | "INVALID_GROSS_UNIT_PRICE"
  | "INVALID_ORDERED_QUANTITY"
  | "GROSS_TOTAL_INCOHERENT"
  | null;

export type ResolveSalesOrderItemCommercialValuesInput = {
  orderedQuantity: number;
  canceledQuantity?: number | null;
  /** Unitário bruto — SalesOrderItem.negotiatedPrice ← Nomus valorUnitario. */
  grossUnitPrice: number;
  /**
   * Valor líquido da linha — SalesOrderItem.totalNetValue
   * (mapeado do total com desconto / fórmula Nomus).
   */
  netTotalValue: number | null | undefined;
  /** Bruto oficial da linha (qtd pedida × unitário), quando disponível — só validação. */
  grossTotalValue?: number | null;
  /** Percentual informado (0–1 ou 0–100). */
  informedDiscountRate?: number | null;
  /** Valor R$ de desconto informado (base quantidade pedida, se houver). */
  informedDiscountValue?: number | null;
  /**
   * Base da quantidade do netTotalValue.
   * Default ORDERED (sync Nomus grava líquido da linha pedida).
   */
  netValueQuantityBasis?: SalesOrderItemNetValueQuantityBasis;
  isFullyCanceled?: boolean;
};

export type SalesOrderItemCommercialValues = {
  activeQuantity: number;
  orderedQuantity: number;
  canceledQuantity: number;

  grossUnitPrice: number;
  grossActiveValue: number;

  netActiveValue: number | null;
  effectiveNetUnitPrice: number | null;

  informedDiscountRate: number | null;
  informedDiscountValue: number | null;

  effectiveDiscountRate: number;
  effectiveDiscountValue: number;

  commercialAdditionRate: number;
  commercialAdditionValue: number;

  discountStatus: SalesOrderItemCommercialDiscountStatus;
  warnings: string[];
  reasonCode: SalesOrderItemCommercialValuesReasonCode;
  isComplete: boolean;
};

function toFiniteNumber(value: unknown): number | null {
  if (value == null || value === "") return null;
  if (typeof value === "object" && value !== null && "toNumber" in value) {
    const n = (value as { toNumber: () => number }).toNumber();
    return Number.isFinite(n) ? n : null;
  }
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Normaliza percentual informado: 5 → 0.05; 0.05 → 0.05. */
export function normalizeInformedDiscountRate(
  value: unknown
): number | null {
  const n = toFiniteNumber(value);
  if (n == null || n < 0) return null;
  return n > 1 ? n / 100 : n;
}

function nearlyEqual(a: number, b: number, eps: number): boolean {
  return Math.abs(a - b) <= eps;
}

function emptyCanceledResult(input: {
  orderedQuantity: number;
  canceledQuantity: number;
  grossUnitPrice: number;
  informedDiscountRate: number | null;
  informedDiscountValue: number | null;
}): SalesOrderItemCommercialValues {
  return {
    activeQuantity: 0,
    orderedQuantity: input.orderedQuantity,
    canceledQuantity: input.canceledQuantity,
    grossUnitPrice: roundPricingMoney(Math.max(0, input.grossUnitPrice)),
    grossActiveValue: 0,
    netActiveValue: 0,
    effectiveNetUnitPrice: null,
    informedDiscountRate: input.informedDiscountRate,
    informedDiscountValue: input.informedDiscountValue,
    effectiveDiscountRate: 0,
    effectiveDiscountValue: 0,
    commercialAdditionRate: 0,
    commercialAdditionValue: 0,
    discountStatus: "NO_ACTIVE_VALUE",
    warnings: [],
    reasonCode: null,
    isComplete: true,
  };
}

/**
 * Resolve composição comercial do item (bruto/líquido/desconto/acréscimo ativos).
 * Não arredonda o unitário líquido além da precisão oficial de pricing (6 casas),
 * para preservar 4,1040 / 5,6715 antes de comissão e margem.
 */
export function resolveSalesOrderItemCommercialValues(
  input: ResolveSalesOrderItemCommercialValuesInput
): SalesOrderItemCommercialValues {
  const orderedQuantity = Math.max(0, toFiniteNumber(input.orderedQuantity) ?? 0);
  const canceledQuantity = Math.max(0, toFiniteNumber(input.canceledQuantity) ?? 0);
  const activeQuantity = resolveActiveSoldQuantity({
    orderedQuantity,
    canceledQuantity,
    isFullyCanceled: input.isFullyCanceled,
  });

  const grossUnitPriceRaw = toFiniteNumber(input.grossUnitPrice);
  const informedDiscountRate = normalizeInformedDiscountRate(input.informedDiscountRate);
  const informedDiscountValueRaw = toFiniteNumber(input.informedDiscountValue);
  const informedDiscountValue =
    informedDiscountValueRaw != null && informedDiscountValueRaw >= 0
      ? roundPricingMoney(informedDiscountValueRaw)
      : null;

  if (activeQuantity <= 0) {
    return emptyCanceledResult({
      orderedQuantity,
      canceledQuantity,
      grossUnitPrice: grossUnitPriceRaw ?? 0,
      informedDiscountRate,
      informedDiscountValue,
    });
  }

  const warnings: string[] = [];

  if (orderedQuantity <= 0) {
    return {
      activeQuantity,
      orderedQuantity,
      canceledQuantity,
      grossUnitPrice: roundPricingMoney(grossUnitPriceRaw ?? 0),
      grossActiveValue: 0,
      netActiveValue: null,
      effectiveNetUnitPrice: null,
      informedDiscountRate,
      informedDiscountValue,
      effectiveDiscountRate: 0,
      effectiveDiscountValue: 0,
      commercialAdditionRate: 0,
      commercialAdditionValue: 0,
      discountStatus: "INCOMPLETE",
      warnings,
      reasonCode: "INVALID_ORDERED_QUANTITY",
      isComplete: false,
    };
  }

  if (grossUnitPriceRaw == null || grossUnitPriceRaw <= 0) {
    return {
      activeQuantity,
      orderedQuantity,
      canceledQuantity,
      grossUnitPrice: 0,
      grossActiveValue: 0,
      netActiveValue: null,
      effectiveNetUnitPrice: null,
      informedDiscountRate,
      informedDiscountValue,
      effectiveDiscountRate: 0,
      effectiveDiscountValue: 0,
      commercialAdditionRate: 0,
      commercialAdditionValue: 0,
      discountStatus: "INCOMPLETE",
      warnings,
      reasonCode: "INVALID_GROSS_UNIT_PRICE",
      isComplete: false,
    };
  }

  const grossUnitPrice = roundPricingMoney(grossUnitPriceRaw);
  const grossActiveValue = roundPricingMoney(activeQuantity * grossUnitPrice);

  const grossTotalOfficial = toFiniteNumber(input.grossTotalValue);
  if (grossTotalOfficial != null && grossTotalOfficial > 0) {
    const expectedOrderedGross = roundPricingMoney(orderedQuantity * grossUnitPrice);
    if (!nearlyEqual(grossTotalOfficial, expectedOrderedGross, GROSS_COHERENCE_EPS)) {
      warnings.push(
        `Bruto oficial (${grossTotalOfficial}) diverge de quantidade × unitário (${expectedOrderedGross}).`
      );
    }
  }

  const netTotalRaw = toFiniteNumber(input.netTotalValue);
  // Zero ou ausente com quantidade ativa > 0 → incompleto (não usar bruto como fallback).
  if (netTotalRaw == null || netTotalRaw <= 0) {
    return {
      activeQuantity,
      orderedQuantity,
      canceledQuantity,
      grossUnitPrice,
      grossActiveValue,
      netActiveValue: null,
      effectiveNetUnitPrice: null,
      informedDiscountRate,
      informedDiscountValue,
      effectiveDiscountRate: 0,
      effectiveDiscountValue: 0,
      commercialAdditionRate: 0,
      commercialAdditionValue: 0,
      discountStatus: "INCOMPLETE",
      warnings,
      reasonCode: "NET_SOLD_VALUE_NOT_FOUND",
      isComplete: false,
    };
  }

  const basis: SalesOrderItemNetValueQuantityBasis =
    input.netValueQuantityBasis === "ACTIVE" ? "ACTIVE" : "ORDERED";

  let netActiveValue: number;
  if (basis === "ACTIVE") {
    netActiveValue = roundPricingMoney(netTotalRaw);
  } else {
    // Líquido do sync refere-se à quantidade pedida → proporcionaliza pela qtd ativa.
    const originalNetUnitPrice = netTotalRaw / orderedQuantity;
    netActiveValue = roundPricingMoney(originalNetUnitPrice * activeQuantity);
  }

  const effectiveNetUnitPrice = roundPricingMoney(netActiveValue / activeQuantity);

  let effectiveDiscountValue = 0;
  let effectiveDiscountRate = 0;
  let commercialAdditionValue = 0;
  let commercialAdditionRate = 0;
  let discountStatus: SalesOrderItemCommercialDiscountStatus = "NO_DISCOUNT";

  const delta = roundPricingMoney(grossActiveValue - netActiveValue);
  if (nearlyEqual(grossActiveValue, netActiveValue, MONEY_EPS)) {
    discountStatus = "NO_DISCOUNT";
  } else if (grossActiveValue > netActiveValue) {
    effectiveDiscountValue = roundPricingMoney(Math.max(0, delta));
    effectiveDiscountRate =
      grossActiveValue > 0
        ? roundPricingMoney(effectiveDiscountValue / grossActiveValue)
        : 0;
    discountStatus = "DISCOUNT";
  } else {
    commercialAdditionValue = roundPricingMoney(netActiveValue - grossActiveValue);
    commercialAdditionRate =
      grossActiveValue > 0
        ? roundPricingMoney(commercialAdditionValue / grossActiveValue)
        : 0;
    discountStatus = "ADDITION";
  }

  // Compara desconto informado (escala da quantidade pedida) com efetivo (qtd ativa).
  if (informedDiscountValue != null && discountStatus === "DISCOUNT") {
    const informedActiveDiscount =
      orderedQuantity > 0
        ? roundPricingMoney((informedDiscountValue / orderedQuantity) * activeQuantity)
        : informedDiscountValue;
    if (!nearlyEqual(informedActiveDiscount, effectiveDiscountValue, MONEY_EPS)) {
      warnings.push(
        `DISCOUNT_VALUE_MISMATCH: informado ${informedActiveDiscount} ≠ efetivo ${effectiveDiscountValue}.`
      );
    }
  }

  if (informedDiscountRate != null && discountStatus === "DISCOUNT") {
    if (!nearlyEqual(informedDiscountRate, effectiveDiscountRate, RATE_EPS)) {
      warnings.push(
        `DISCOUNT_RATE_MISMATCH: informado ${roundPricingPercent(informedDiscountRate * 100)}% ≠ efetivo ${roundPricingPercent(effectiveDiscountRate * 100)}%.`
      );
    }
  } else if (informedDiscountRate != null && discountStatus === "NO_DISCOUNT") {
    if (informedDiscountRate > RATE_EPS) {
      warnings.push(
        `DISCOUNT_RATE_MISMATCH: informado ${roundPricingPercent(informedDiscountRate * 100)}% mas efetivo 0%.`
      );
    }
  }

  return {
    activeQuantity,
    orderedQuantity,
    canceledQuantity,
    grossUnitPrice,
    grossActiveValue,
    netActiveValue,
    effectiveNetUnitPrice,
    informedDiscountRate,
    informedDiscountValue,
    effectiveDiscountRate,
    effectiveDiscountValue,
    commercialAdditionRate,
    commercialAdditionValue,
    discountStatus,
    warnings,
    reasonCode: null,
    isComplete: true,
  };
}
