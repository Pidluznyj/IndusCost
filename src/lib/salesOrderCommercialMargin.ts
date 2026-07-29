/**
 * Margem comercial do Pedido de Venda — domínio puro.
 * Usa apenas dados do Pedido + formação histórica (sem Proposta).
 */
import { roundPricingMoney, roundPricingPercent } from "./pricingCalculations.js";
import { calculateCommercialMarginRateFromNegotiatedPrice } from "./priceTablePublication.js";
import type { CommercialPriceTierCode } from "./commissions/commission-commercial-tier.js";

export type SalesOrderCommercialMarginSource =
  | "HISTORICAL_PRICE_FORMATION"
  | "UNAVAILABLE";

export type SalesOrderCommercialMarginReasonCode =
  | "PRODUCT_WITHOUT_PRICE_FORMATION"
  | "HISTORICAL_FORMATION_NOT_FOUND"
  | "HISTORICAL_FORMATION_AMBIGUOUS"
  | "INCOMPLETE_MARGIN_TIERS"
  | "COST_NOT_FOUND"
  | "TAX_NOT_FOUND"
  | "FREIGHT_NOT_DEFINED"
  | "COMMISSION_NOT_DEFINED"
  | "OTHER_VARIABLES_NOT_DEFINED"
  | "INVALID_NEGOTIATED_PRICE"
  | "INCONSISTENT_PRICE_FORMATION_SET"
  | "MISSING_PRODUCT"
  | "MISSING_ORDER_DATE"
  | "ITEM_CANCELED"
  | "INVALID_ACTIVE_QUANTITY";

export const SALES_ORDER_COMMERCIAL_MARGIN_REASON_LABEL: Record<
  SalesOrderCommercialMarginReasonCode,
  string
> = {
  PRODUCT_WITHOUT_PRICE_FORMATION: "Produto sem formação de preço cadastrada.",
  HISTORICAL_FORMATION_NOT_FOUND:
    "Não encontramos formação de preço válida para a data do Pedido.",
  HISTORICAL_FORMATION_AMBIGUOUS:
    "Existem duas formações possíveis para essa data.",
  INCOMPLETE_MARGIN_TIERS: "A formação de preço está incompleta (faixas).",
  COST_NOT_FOUND: "Não encontramos custo válido para a data do Pedido.",
  TAX_NOT_FOUND: "Não encontramos o imposto da formação de preço.",
  FREIGHT_NOT_DEFINED: "O frete da formação de preço não está definido.",
  COMMISSION_NOT_DEFINED: "Não encontramos a regra de comissão.",
  OTHER_VARIABLES_NOT_DEFINED:
    "As outras variáveis da formação de preço não estão definidas.",
  INVALID_NEGOTIATED_PRICE: "O preço do item é inválido.",
  INCONSISTENT_PRICE_FORMATION_SET:
    "As faixas comerciais da data do Pedido estão inconsistentes.",
  MISSING_PRODUCT: "Item sem produto vinculado.",
  MISSING_ORDER_DATE: "Pedido sem data de emissão.",
  ITEM_CANCELED: "Item cancelado — excluído da margem comercial.",
  INVALID_ACTIVE_QUANTITY: "Quantidade ativa inválida.",
};

export type SalesOrderCommercialMarginItemPayload = {
  soldQuantity: number;
  negotiatedUnitPrice: number;
  soldValue: number;
  costUnit: number | null;
  costValue: number | null;
  taxRate: number | null;
  taxValue: number | null;
  commissionRate: number | null;
  commissionValue: number | null;
  freightRate: number | null;
  freightRateValue: number | null;
  freightAbsoluteUnit: number | null;
  freightAbsoluteValue: number | null;
  otherVariablesRate: number | null;
  otherVariablesValue: number | null;
  commercialMarginRate: number | null;
  commercialMarginPercent: number | null;
  commercialMarginUnitValue: number | null;
  commercialMarginValue: number | null;
  lowerMarginBand: CommercialPriceTierCode | string | null;
  upperMarginBand: CommercialPriceTierCode | string | null;
  lowerBandPrice: number | null;
  upperBandPrice: number | null;
  calculationSource: SalesOrderCommercialMarginSource;
  historicalContextId: string | null;
  priceTableVersionId: string | null;
  referenceDate: string | null;
  isComplete: boolean;
  reasonCode: SalesOrderCommercialMarginReasonCode | null;
  warnings: string[];
};

export type SalesOrderCommercialMarginSummaryPayload = {
  commercialMarginTotalValue: number | null;
  commercialMarginTotalPercent: number | null;
  commercialSoldTotalValue: number;
  totalActiveSoldValue: number;
  commercialMarginCoveragePercent: number | null;
  itemsCalculated: number;
  itemsUnavailable: number;
  itemsActive: number;
  isComplete: boolean;
  warnings: string[];
  /**
   * Composição bruto/desconto/líquido para exibição (tooltip/listagem).
   * Não altera a fórmula da margem.
   */
  commercialComposition?: {
    grossActiveTotalValue: number;
    discountTotalValue: number;
    discountRate: number;
    additionTotalValue: number;
    additionRate: number;
    netActiveTotalValue: number;
  } | null;
};

export type CommercialMarginFormationRates = {
  taxRate: number;
  commissionRate: number;
  otherRate: number;
  freightRate: number;
  freight: number;
};

/** Lê fração explícita: ausente ≠ zero. Aceita percentuais > 1 convertendo /100. */
export function readExplicitRate(
  value: unknown
): { present: true; value: number } | { present: false } {
  if (value == null || value === "") return { present: false };
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n < 0) return { present: false };
  return { present: true, value: n > 1 ? n / 100 : n };
}

/** Lê valor absoluto explícito (inclui 0). */
export function readExplicitAbsolute(
  value: unknown
): { present: true; value: number } | { present: false } {
  if (value == null || value === "") return { present: false };
  if (typeof value === "object" && value !== null && "toNumber" in value) {
    const n = (value as { toNumber: () => number }).toNumber();
    if (!Number.isFinite(n) || n < 0) return { present: false };
    return { present: true, value: n };
  }
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n < 0) return { present: false };
  return { present: true, value: n };
}

export function resolveActiveSoldQuantity(input: {
  orderedQuantity: number;
  canceledQuantity?: number | null;
  isFullyCanceled?: boolean;
}): number {
  if (input.isFullyCanceled) return 0;
  const ordered = Math.max(0, Number(input.orderedQuantity) || 0);
  const canceled = Math.max(0, Number(input.canceledQuantity) || 0);
  return Math.max(0, ordered - canceled);
}

export function unavailableCommercialMarginItem(input: {
  soldQuantity?: number;
  negotiatedUnitPrice?: number;
  soldValue?: number;
  referenceDate?: string | null;
  reasonCode: SalesOrderCommercialMarginReasonCode;
  warnings?: string[];
}): SalesOrderCommercialMarginItemPayload {
  const reasonLabel = SALES_ORDER_COMMERCIAL_MARGIN_REASON_LABEL[input.reasonCode];
  return {
    soldQuantity: input.soldQuantity ?? 0,
    negotiatedUnitPrice: input.negotiatedUnitPrice ?? 0,
    soldValue: input.soldValue ?? 0,
    costUnit: null,
    costValue: null,
    taxRate: null,
    taxValue: null,
    commissionRate: null,
    commissionValue: null,
    freightRate: null,
    freightRateValue: null,
    freightAbsoluteUnit: null,
    freightAbsoluteValue: null,
    otherVariablesRate: null,
    otherVariablesValue: null,
    commercialMarginRate: null,
    commercialMarginPercent: null,
    commercialMarginUnitValue: null,
    commercialMarginValue: null,
    lowerMarginBand: null,
    upperMarginBand: null,
    lowerBandPrice: null,
    upperBandPrice: null,
    calculationSource: "UNAVAILABLE",
    historicalContextId: null,
    priceTableVersionId: null,
    referenceDate: input.referenceDate ?? null,
    isComplete: false,
    reasonCode: input.reasonCode,
    warnings: input.warnings?.length ? input.warnings : [reasonLabel],
  };
}

export function calculateSalesOrderItemCommercialMargin(input: {
  soldQuantity: number;
  negotiatedUnitPrice: number;
  frozenTotalCost: number;
  rates: CommercialMarginFormationRates;
  historicalContextId: string;
  priceTableVersionId?: string | null;
  referenceDate?: string | null;
  lowerMarginBand?: string | null;
  upperMarginBand?: string | null;
  lowerBandPrice?: number | null;
  upperBandPrice?: number | null;
  warnings?: string[];
}): SalesOrderCommercialMarginItemPayload {
  const soldQuantity = Math.max(0, Number(input.soldQuantity) || 0);
  const negotiatedUnitPrice = Number(input.negotiatedUnitPrice);
  const soldValue = roundPricingMoney(soldQuantity * negotiatedUnitPrice);

  if (soldQuantity <= 0) {
    return unavailableCommercialMarginItem({
      soldQuantity,
      negotiatedUnitPrice: Number.isFinite(negotiatedUnitPrice) ? negotiatedUnitPrice : 0,
      soldValue,
      referenceDate: input.referenceDate ?? null,
      reasonCode: "INVALID_ACTIVE_QUANTITY",
    });
  }

  if (!Number.isFinite(negotiatedUnitPrice) || negotiatedUnitPrice <= 0) {
    return unavailableCommercialMarginItem({
      soldQuantity,
      negotiatedUnitPrice: Number.isFinite(negotiatedUnitPrice) ? negotiatedUnitPrice : 0,
      soldValue: 0,
      referenceDate: input.referenceDate ?? null,
      reasonCode: "INVALID_NEGOTIATED_PRICE",
    });
  }

  const calc = calculateCommercialMarginRateFromNegotiatedPrice({
    negotiatedUnitPrice,
    frozenTotalCost: input.frozenTotalCost,
    rates: input.rates,
  });

  if (!calc.ok) {
    return unavailableCommercialMarginItem({
      soldQuantity,
      negotiatedUnitPrice,
      soldValue,
      referenceDate: input.referenceDate ?? null,
      reasonCode:
        calc.code === "INVALID_PRICE" || calc.code === "INVALID_COST"
          ? calc.code === "INVALID_PRICE"
            ? "INVALID_NEGOTIATED_PRICE"
            : "COST_NOT_FOUND"
          : "INCONSISTENT_PRICE_FORMATION_SET",
      warnings: [calc.message],
    });
  }

  const commercialMarginPercent = roundPricingPercent(calc.marginPercent);
  const commercialMarginUnitValue = roundPricingMoney(calc.commercialMarginUnitValue);
  const commercialMarginValue = roundPricingMoney(soldQuantity * commercialMarginUnitValue);

  return {
    soldQuantity,
    negotiatedUnitPrice: roundPricingMoney(negotiatedUnitPrice),
    soldValue,
    costUnit: roundPricingMoney(calc.costUnit),
    costValue: roundPricingMoney(soldQuantity * calc.costUnit),
    taxRate: input.rates.taxRate,
    taxValue: roundPricingMoney(soldQuantity * calc.taxValueUnit),
    commissionRate: input.rates.commissionRate,
    commissionValue: roundPricingMoney(soldQuantity * calc.commissionValueUnit),
    freightRate: input.rates.freightRate,
    freightRateValue: roundPricingMoney(soldQuantity * calc.freightRateValueUnit),
    freightAbsoluteUnit: roundPricingMoney(calc.freightAbsoluteUnit),
    freightAbsoluteValue: roundPricingMoney(soldQuantity * calc.freightAbsoluteUnit),
    otherVariablesRate: input.rates.otherRate,
    otherVariablesValue: roundPricingMoney(soldQuantity * calc.otherValueUnit),
    commercialMarginRate: calc.marginRate,
    commercialMarginPercent,
    commercialMarginUnitValue,
    commercialMarginValue,
    lowerMarginBand: input.lowerMarginBand ?? null,
    upperMarginBand: input.upperMarginBand ?? null,
    lowerBandPrice: input.lowerBandPrice ?? null,
    upperBandPrice: input.upperBandPrice ?? null,
    calculationSource: "HISTORICAL_PRICE_FORMATION",
    historicalContextId: input.historicalContextId,
    priceTableVersionId: input.priceTableVersionId ?? null,
    referenceDate: input.referenceDate ?? null,
    isComplete: true,
    reasonCode: null,
    warnings: [...(input.warnings ?? [])],
  };
}

export function summarizeSalesOrderCommercialMargins(
  items: ReadonlyArray<SalesOrderCommercialMarginItemPayload>,
  options?: { totalActiveSoldValue?: number }
): SalesOrderCommercialMarginSummaryPayload {
  let commercialMarginTotalValue = 0;
  let commercialSoldTotalValue = 0;
  let itemsCalculated = 0;
  let itemsUnavailable = 0;
  let itemsActive = 0;
  const warnings: string[] = [];

  for (const item of items) {
    if (item.soldQuantity <= 0 || item.soldValue <= 0) continue;
    itemsActive += 1;
    if (item.isComplete && item.commercialMarginValue != null && item.commercialMarginPercent != null) {
      itemsCalculated += 1;
      commercialMarginTotalValue += item.commercialMarginValue;
      commercialSoldTotalValue += item.soldValue;
    } else {
      itemsUnavailable += 1;
      for (const w of item.warnings) {
        if (!warnings.includes(w)) warnings.push(w);
      }
    }
  }

  commercialMarginTotalValue = roundPricingMoney(commercialMarginTotalValue);
  commercialSoldTotalValue = roundPricingMoney(commercialSoldTotalValue);
  const totalActiveSoldValue = roundPricingMoney(
    options?.totalActiveSoldValue != null
      ? Math.max(0, options.totalActiveSoldValue)
      : items.reduce((acc, row) => acc + (row.soldQuantity > 0 ? row.soldValue : 0), 0)
  );

  const commercialMarginTotalPercent =
    commercialSoldTotalValue > 0
      ? roundPricingPercent((commercialMarginTotalValue / commercialSoldTotalValue) * 100)
      : null;
  const commercialMarginCoveragePercent =
    totalActiveSoldValue > 0
      ? roundPricingPercent((commercialSoldTotalValue / totalActiveSoldValue) * 100)
      : null;

  const isComplete =
    itemsActive > 0 && itemsUnavailable === 0 && commercialMarginTotalPercent != null;

  if (!isComplete && itemsUnavailable > 0) {
    warnings.unshift(
      `Margem comercial parcial: ${itemsCalculated} de ${itemsActive} itens calculados.`
    );
  }

  return {
    commercialMarginTotalValue: itemsCalculated > 0 ? commercialMarginTotalValue : null,
    commercialMarginTotalPercent,
    commercialSoldTotalValue,
    totalActiveSoldValue,
    commercialMarginCoveragePercent,
    itemsCalculated,
    itemsUnavailable,
    itemsActive,
    isComplete,
    warnings,
  };
}
