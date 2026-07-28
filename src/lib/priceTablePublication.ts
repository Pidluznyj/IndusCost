/**
 * Helpers puros para cálculo de preço comercial a partir de custo de produção congelado.
 *
 * Fórmula oficial:
 *   PV = (custoFabril + freteR$) / (1 − imposto − comissão − outros − frete% − margem)
 *
 * - freteR$ (`freight`): legado absoluto no numerador (ProductPricing.freightOut)
 * - frete% (`freightRate`): percentual no denominador (geração comercial moderna)
 * Em gerações com frete%, o frete absoluto deve ser 0 para não duplicar.
 */
export type PriceTableItemRates = {
  taxRate: number;
  commissionRate: number;
  otherRate: number;
  marginRate: number;
  /** Frete absoluto em R$ (legado / numerador). */
  freight: number;
  /** Frete estimado como fração do PV (0.03 = 3%). Opcional; ausente = 0. */
  freightRate?: number;
};

export type PriceTableItemCalculation = {
  salePrice: number;
  frozenTaxCost: number;
  totalCommission: number;
  totalOther: number;
  totalFreightPercent: number;
  frozenOtherCost: number;
  divisor: number;
};

export const DEFAULT_COMMERCIAL_GENERATION_FREIGHT_PERCENT = 3;

export function normalizePricingPercentInput(
  value: unknown,
  fieldLabel: string
): { ok: true; value: number } | { ok: false; message: string } {
  if (value == null || value === "") {
    return { ok: false, message: `${fieldLabel} é obrigatório.` };
  }
  const n = typeof value === "number" ? value : Number(String(value).replace(",", "."));
  if (!Number.isFinite(n)) {
    return { ok: false, message: `${fieldLabel} inválido.` };
  }
  if (n < 0) {
    return { ok: false, message: `${fieldLabel} não pode ser negativo.` };
  }
  return { ok: true, value: n };
}

export function calculatePriceTableItemFromFrozenCost(
  frozenTotalCost: number,
  rates: PriceTableItemRates
): { ok: true; result: PriceTableItemCalculation } | { ok: false; code: string; message: string; divisor?: number } {
  if (!Number.isFinite(frozenTotalCost) || frozenTotalCost <= 0) {
    return {
      ok: false,
      code: "NO_COST_AVAILABLE",
      message: "Item sem custo de produção publicado (> 0).",
    };
  }

  const freightAbs = Number.isFinite(rates.freight) ? rates.freight : 0;
  if (freightAbs < 0) {
    return {
      ok: false,
      code: "INVALID_FREIGHT",
      message: "Frete absoluto não pode ser negativo.",
    };
  }

  const freightRate =
    rates.freightRate != null && Number.isFinite(rates.freightRate) ? rates.freightRate : 0;
  if (freightRate < 0) {
    return {
      ok: false,
      code: "INVALID_FREIGHT_RATE",
      message: "Frete percentual não pode ser negativo.",
    };
  }

  if (
    rates.taxRate < 0 ||
    rates.commissionRate < 0 ||
    rates.otherRate < 0 ||
    rates.marginRate < 0
  ) {
    return {
      ok: false,
      code: "INVALID_PRICING_RATE",
      message: "Percentuais de formação não podem ser negativos.",
    };
  }

  const divisor =
    1 -
    rates.taxRate -
    rates.commissionRate -
    rates.otherRate -
    freightRate -
    rates.marginRate;
  if (divisor <= 0) {
    return {
      ok: false,
      code: "INVALID_PRICING_DIVISOR",
      message:
        "Soma de impostos/comissão/outros/frete/margem maior ou igual a 100%.",
      divisor,
    };
  }

  const salePrice = (frozenTotalCost + freightAbs) / divisor;
  if (!Number.isFinite(salePrice) || salePrice <= 0) {
    return {
      ok: false,
      code: "INVALID_PRICE_RESULT",
      message: "Preço calculado inválido (<= 0).",
    };
  }

  const frozenTaxCost = salePrice * rates.taxRate;
  const totalCommission = salePrice * rates.commissionRate;
  const totalOther = salePrice * rates.otherRate;
  const totalFreightPercent = salePrice * freightRate;
  const frozenOtherCost = totalCommission + totalOther + freightAbs + totalFreightPercent;

  return {
    ok: true,
    result: {
      salePrice,
      frozenTaxCost,
      totalCommission,
      totalOther,
      totalFreightPercent,
      frozenOtherCost,
      divisor,
    },
  };
}

export function buildPriceTableFormulaSnapshot(input: {
  priceTableId: string;
  priceTableVersionId: string;
  productionCostTableVersionId: string;
  productionCostTableVersionCode: string;
  productionCostRevision: number;
  taxRuleId: string | null;
  marginPct: number;
  freightPercent?: number | null;
  rates: Omit<PriceTableItemRates, "marginRate"> & { marginRate: number };
  divisor: number;
  outputs: {
    frozenTotalCost: number;
    frozenTaxCost: number;
    frozenOtherCost: number;
    salePrice: number;
    totalFreightPercent?: number;
  };
}) {
  const freightRate =
    input.rates.freightRate != null && Number.isFinite(input.rates.freightRate)
      ? input.rates.freightRate
      : 0;
  const freightPercent =
    input.freightPercent != null && Number.isFinite(input.freightPercent)
      ? input.freightPercent
      : freightRate * 100;

  return {
    priceTableId: input.priceTableId,
    priceTableVersionId: input.priceTableVersionId,
    productionCostTableVersionId: input.productionCostTableVersionId,
    productionCostTableVersionCode: input.productionCostTableVersionCode,
    productionCostRevision: input.productionCostRevision,
    taxRuleId: input.taxRuleId,
    marginPct: input.marginPct,
    freightPercent,
    rates: {
      taxRate: input.rates.taxRate,
      commissionRate: input.rates.commissionRate,
      otherRate: input.rates.otherRate,
      freightRate,
    },
    freight: input.rates.freight,
    divisor: input.divisor,
    outputs: input.outputs,
    costSource: "VERSIONED_PRODUCTION_COST_TABLE",
  };
}
