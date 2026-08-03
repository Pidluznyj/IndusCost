/**
 * Helpers puros para cálculo de preço comercial a partir de custo de produção congelado.
 *
 * Fórmula oficial:
 *   freteRate$ = custoFabril × frete%
 *   PV = (custoFabril + freteR$ + freteRate$) / (1 − imposto − comissão − outros − margem)
 *
 * - freteR$ (`freight`): legado absoluto no numerador (ProductPricing.freightOut)
 * - frete% (`freightRate`): representa o peso/volume da peça — é sempre uma fração do
 *   CUSTO (não do preço de venda), por isso fica fora do divisor. Se ficasse no divisor
 *   (junto da margem), o frete em R$ inflaria junto com o preço a cada faixa comercial
 *   de margem maior, mesmo o custo físico de envio sendo o mesmo.
 * Em gerações com frete%, o frete absoluto legado deve ser 0 para não duplicar.
 *
 * A inversa de margem comercial delega ao núcleo neutro (`commercialMarginCore`), mas
 * pré-resolve o frete% em R$ (sobre o custo) antes de delegar, para não alterar o
 * comportamento do núcleo compartilhado com Propostas.
 */
import { calculateCommercialMarginFromNetUnitPrice } from "./commercialMarginCore.js";

export type PriceTableItemRates = {
  taxRate: number;
  commissionRate: number;
  otherRate: number;
  marginRate: number;
  /** Frete absoluto em R$ (legado / numerador). */
  freight: number;
  /** Frete estimado como fração do CUSTO (0.03 = 3% do custo, não do PV). Opcional; ausente = 0. */
  freightRate?: number;
};

export type PriceTableItemCalculation = {
  salePrice: number;
  frozenTaxCost: number;
  totalCommission: number;
  totalOther: number;
  /** Frete% resolvido em R$ = frozenTotalCost × freightRate (não escala com salePrice). */
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

/**
 * Inversa de `calculatePriceTableItemFromFrozenCost`:
 *   freteRate$ = custo × f%
 *   m = 1 − i − c − o − (custo + freteR$ + freteRate$) / PV
 *
 * Frete% é resolvido em R$ sobre o CUSTO aqui (não no núcleo compartilhado) e enviado
 * ao núcleo como `freightAbsoluteUnit` adicional com `freightRate: 0` — assim o
 * comportamento do `commercialMarginCore` (usado também por Propostas) não muda.
 */
export function calculateCommercialMarginRateFromNegotiatedPrice(input: {
  negotiatedUnitPrice: number;
  frozenTotalCost: number;
  rates: Omit<PriceTableItemRates, "marginRate">;
}):
  | {
      ok: true;
      marginRate: number;
      marginPercent: number;
      taxValueUnit: number;
      commissionValueUnit: number;
      otherValueUnit: number;
      freightRateValueUnit: number;
      freightAbsoluteUnit: number;
      costUnit: number;
      commercialMarginUnitValue: number;
    }
  | { ok: false; code: string; message: string } {
  const frozenTotalCost = Number(input.frozenTotalCost);
  const freightAbs = Number.isFinite(input.rates.freight) ? Number(input.rates.freight) : 0;
  const freightRate =
    input.rates.freightRate != null && Number.isFinite(input.rates.freightRate)
      ? Number(input.rates.freightRate)
      : 0;
  const freightFromRate = Number.isFinite(frozenTotalCost) ? frozenTotalCost * freightRate : 0;

  const core = calculateCommercialMarginFromNetUnitPrice({
    netUnitPrice: Number(input.negotiatedUnitPrice),
    quantity: 1,
    frozenCostUnit: frozenTotalCost,
    taxRate: Number(input.rates.taxRate),
    commissionRate: Number(input.rates.commissionRate),
    freightRate: 0,
    freightAbsoluteUnit: freightAbs + freightFromRate,
    otherVariablesRate: Number(input.rates.otherRate),
  });
  if (!core.ok) {
    return { ok: false, code: core.code, message: core.message };
  }

  return {
    ok: true,
    marginRate: core.commercialMarginRate,
    marginPercent: core.commercialMarginPercent,
    taxValueUnit: core.taxValueUnit,
    commissionValueUnit: core.commissionValueUnit,
    otherValueUnit: core.otherValueUnit,
    freightRateValueUnit: freightFromRate,
    freightAbsoluteUnit: freightAbs,
    costUnit: core.costUnit,
    commercialMarginUnitValue: core.commercialMarginUnitValue,
  };
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
    rates.marginRate;
  if (divisor <= 0) {
    return {
      ok: false,
      code: "INVALID_PRICING_DIVISOR",
      message:
        "Soma de impostos/comissão/outros/margem maior ou igual a 100%.",
      divisor,
    };
  }

  // Frete% representa peso/volume da peça → é fração do CUSTO, não do preço final.
  // Fica fora do divisor para não inflar junto com a margem de cada faixa comercial.
  const totalFreightPercent = frozenTotalCost * freightRate;
  const salePrice = (frozenTotalCost + freightAbs + totalFreightPercent) / divisor;
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
