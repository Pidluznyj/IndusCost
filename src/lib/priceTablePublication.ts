/**
 * Helpers puros para cálculo de preço comercial a partir de custo de produção congelado.
 */
export type PriceTableItemRates = {
  taxRate: number;
  commissionRate: number;
  otherRate: number;
  marginRate: number;
  freight: number;
};

export type PriceTableItemCalculation = {
  salePrice: number;
  frozenTaxCost: number;
  totalCommission: number;
  totalOther: number;
  frozenOtherCost: number;
  divisor: number;
};

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

  const divisor =
    1 - rates.taxRate - rates.commissionRate - rates.otherRate - rates.marginRate;
  if (divisor <= 0) {
    return {
      ok: false,
      code: "INVALID_PRICING_DIVISOR",
      message: "Soma de impostos/comissão/outros/margem maior ou igual a 100%.",
      divisor,
    };
  }

  const salePrice = (frozenTotalCost + rates.freight) / divisor;
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
  const frozenOtherCost = totalCommission + totalOther + rates.freight;

  return {
    ok: true,
    result: {
      salePrice,
      frozenTaxCost,
      totalCommission,
      totalOther,
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
  rates: Omit<PriceTableItemRates, "marginRate"> & { marginRate: number };
  divisor: number;
  outputs: {
    frozenTotalCost: number;
    frozenTaxCost: number;
    frozenOtherCost: number;
    salePrice: number;
  };
}) {
  return {
    priceTableId: input.priceTableId,
    priceTableVersionId: input.priceTableVersionId,
    productionCostTableVersionId: input.productionCostTableVersionId,
    productionCostTableVersionCode: input.productionCostTableVersionCode,
    productionCostRevision: input.productionCostRevision,
    taxRuleId: input.taxRuleId,
    marginPct: input.marginPct,
    rates: {
      taxRate: input.rates.taxRate,
      commissionRate: input.rates.commissionRate,
      otherRate: input.rates.otherRate,
    },
    freight: input.rates.freight,
    divisor: input.divisor,
    outputs: input.outputs,
    costSource: "VERSIONED_PRODUCTION_COST_TABLE",
  };
}
