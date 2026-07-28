/**
 * Margem comercial da venda (Pedido de Venda) — domínio puro.
 * Reutiliza a inversa da formação (`calculateCommercialMarginRateFromNegotiatedPrice`).
 */
import { roundPricingMoney, roundPricingPercent } from "./pricingCalculations.js";
import { calculateCommercialMarginRateFromNegotiatedPrice } from "./priceTablePublication.js";
import type { CommercialPriceTierCode } from "./commissions/commission-commercial-tier.js";

export type SalesOrderCommercialMarginSource =
  | "EXACT_PROPOSAL_SNAPSHOT"
  | "EXACT_PRICE_TABLE_VERSION"
  | "RECONSTRUCTED_AT_ORDER_DATE"
  | "UNAVAILABLE";

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
  priceTableVersionId: string | null;
  referenceDate: string | null;
  warnings: string[];
  isComplete: boolean;
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
};

export type CommercialMarginFormationRates = {
  taxRate: number;
  commissionRate: number;
  otherRate: number;
  freightRate: number;
  freight: number;
};

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

export function calculateSalesOrderItemCommercialMargin(input: {
  soldQuantity: number;
  negotiatedUnitPrice: number;
  frozenTotalCost: number;
  rates: CommercialMarginFormationRates;
  calculationSource: Exclude<SalesOrderCommercialMarginSource, "UNAVAILABLE">;
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

  if (soldQuantity <= 0 || !Number.isFinite(negotiatedUnitPrice) || negotiatedUnitPrice <= 0) {
    return unavailableCommercialMarginItem({
      soldQuantity,
      negotiatedUnitPrice: Number.isFinite(negotiatedUnitPrice) ? negotiatedUnitPrice : 0,
      soldValue,
      referenceDate: input.referenceDate ?? null,
      warnings: ["Quantidade ativa ou preço negociado inválidos."],
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
    calculationSource: input.calculationSource,
    priceTableVersionId: input.priceTableVersionId ?? null,
    referenceDate: input.referenceDate ?? null,
    warnings: [...(input.warnings ?? [])],
    isComplete: true,
  };
}

export function unavailableCommercialMarginItem(input: {
  soldQuantity?: number;
  negotiatedUnitPrice?: number;
  soldValue?: number;
  referenceDate?: string | null;
  warnings?: string[];
}): SalesOrderCommercialMarginItemPayload {
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
    priceTableVersionId: null,
    referenceDate: input.referenceDate ?? null,
    warnings: input.warnings?.length
      ? input.warnings
      : [
          "Margem comercial indisponível. Não foi possível identificar a formação de preço utilizada nesta venda.",
        ],
    isComplete: false,
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
    commercialMarginTotalValue:
      itemsCalculated > 0 ? commercialMarginTotalValue : null,
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
