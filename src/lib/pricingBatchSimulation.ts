/**
 * Motor puro de simulação em lote — Formação de Preço.
 * PV = (CIU + frete fixo) / (1 - imposto - comissão - outros - margem)
 */

export type PricingBatchRateParams = {
  taxRate: number;
  commRate: number;
  marginRate: number;
  otherRate: number;
  freight: number;
};

export type PricingBatchSimulateItemSuccess = {
  productId: string;
  sku?: string;
  name?: string;
  itemType: "PRODUCT" | "COMPONENT";
  ciu: number;
  suggestedPrice: number;
  marginRate: number;
  markup: number;
  status: "SUCCESS";
};

export type PricingBatchSimulateItemError = {
  productId: string;
  sku?: string;
  name?: string;
  itemType?: "PRODUCT" | "COMPONENT";
  status: "ERROR";
  message: string;
};

export type PricingBatchSimulateItemResult =
  | PricingBatchSimulateItemSuccess
  | PricingBatchSimulateItemError;

export function buildPricingBatchRateParams(input: {
  taxPercent: number;
  commission?: number | null;
  desiredMargin?: number | null;
  otherVariables?: number | null;
  freightOut?: number | null;
}): PricingBatchRateParams {
  return {
    taxRate: Number(input.taxPercent || 0) / 100,
    commRate: Number(input.commission || 0) / 100,
    marginRate: Number(input.desiredMargin || 0) / 100,
    otherRate: Number(input.otherVariables || 0) / 100,
    freight: Number(input.freightOut || 0),
  };
}

export function computePricingBatchSuggestedPrice(
  ciu: number,
  params: PricingBatchRateParams
): { ok: true; suggestedPrice: number; markup: number } | { ok: false; message: string } {
  const divisor = 1 - params.taxRate - params.commRate - params.otherRate - params.marginRate;
  if (divisor <= 0) {
    return { ok: false, message: "Margem e impostos excedem 100%." };
  }
  const suggestedPrice = (ciu + params.freight) / divisor;
  return {
    ok: true,
    suggestedPrice,
    markup: ciu > 0 ? suggestedPrice / ciu : 0,
  };
}

export function resolvePricingBatchCostErrorMessage(costData: unknown): string {
  if (!costData || typeof costData !== "object") {
    return "Custo não resolvido.";
  }
  if ("error" in costData) {
    const message = (costData as { message?: string }).message;
    return typeof message === "string" && message.trim()
      ? message.trim()
      : "Custo inconclusivo ou sem roteiro.";
  }
  return "Custo não resolvido.";
}
