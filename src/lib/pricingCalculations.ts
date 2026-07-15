/**
 * Motor compartilhado de formação de preço de venda.
 * Mesma regra da Calculadora de Preço de Venda (imposto + margem sobre preço).
 */

export type SalePriceFromCostInput = {
  cost: number;
  taxPercent: number;
  targetMarginPercent: number;
};

export type SalePriceFromCostResult =
  | {
      ok: true;
      suggestedPrice: number;
      taxAmount: number;
      marginAmount: number;
      divisor: number;
    }
  | {
      ok: false;
      error: string;
    };

export function roundPricingMoney(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round((value + Number.EPSILON) * 1000000) / 1000000;
}

export function roundPricingPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function sumTaxRuleComponentPercents(
  components: Array<{ percentage: number | string | { toNumber?: () => number } }>
): number {
  let total = 0;
  for (const component of components) {
    const raw = component.percentage;
    const n =
      typeof raw === "object" && raw !== null && "toNumber" in raw
        ? (raw as { toNumber: () => number }).toNumber()
        : Number(raw);
    if (Number.isFinite(n)) total += n;
  }
  return roundPricingPercent(total);
}

/**
 * Preço sugerido = custo / (1 - imposto% - margem%).
 * Imposto e margem são percentuais sobre o preço de venda (não markup).
 */
export function calculateSalePriceFromCost(
  input: SalePriceFromCostInput
): SalePriceFromCostResult {
  const cost = Number(input.cost);
  const taxPercent = Number(input.taxPercent);
  const targetMarginPercent = Number(input.targetMarginPercent);

  if (!Number.isFinite(cost) || cost < 0) {
    return { ok: false, error: "Custo inválido." };
  }
  if (!Number.isFinite(taxPercent) || taxPercent < 0) {
    return { ok: false, error: "Percentual de impostos inválido." };
  }
  if (!Number.isFinite(targetMarginPercent) || targetMarginPercent < 0) {
    return { ok: false, error: "Margem desejada inválida." };
  }

  const taxRate = taxPercent / 100;
  const marginRate = targetMarginPercent / 100;
  const divisor = 1 - taxRate - marginRate;

  if (divisor <= 0) {
    return {
      ok: false,
      error: "A soma de impostos e margem precisa ser menor que 100%.",
    };
  }

  const suggestedPrice = roundPricingMoney(cost / divisor);
  const taxAmount = roundPricingMoney(suggestedPrice * taxRate);
  const marginAmount = roundPricingMoney(suggestedPrice * marginRate);

  if (
    !Number.isFinite(suggestedPrice) ||
    !Number.isFinite(taxAmount) ||
    !Number.isFinite(marginAmount)
  ) {
    return { ok: false, error: "Cálculo retornou valor inválido." };
  }

  return {
    ok: true,
    suggestedPrice,
    taxAmount,
    marginAmount,
    divisor,
  };
}

export type MarginPercentFromSalePriceInput = {
  /** Preço de venda da formação (produto, antes do repasse FINAL_PRICE). */
  salePrice: number;
  cost: number;
  taxPercent: number;
};

export type MarginPercentFromSalePriceResult =
  | {
      ok: true;
      targetMarginPercent: number;
      taxAmount: number;
      marginAmount: number;
    }
  | {
      ok: false;
      error: string;
    };

/**
 * Engenharia reversa de `calculateSalePriceFromCost`:
 * preço = custo / (1 - imposto% - margem%)
 * ⇒ margem% = (1 - imposto% - custo/preço) × 100
 */
export function calculateMarginPercentFromSalePrice(
  input: MarginPercentFromSalePriceInput
): MarginPercentFromSalePriceResult {
  const salePrice = Number(input.salePrice);
  const cost = Number(input.cost);
  const taxPercent = Number(input.taxPercent);

  if (!Number.isFinite(salePrice) || salePrice <= 0) {
    return { ok: false, error: "Preço inválido." };
  }
  if (!Number.isFinite(cost) || cost < 0) {
    return { ok: false, error: "Custo inválido." };
  }
  if (!Number.isFinite(taxPercent) || taxPercent < 0) {
    return { ok: false, error: "Percentual de impostos inválido." };
  }

  const taxRate = taxPercent / 100;
  const marginRate = 1 - taxRate - cost / salePrice;
  const targetMarginPercent = roundPricingPercent(marginRate * 100);

  if (!Number.isFinite(targetMarginPercent)) {
    return { ok: false, error: "Cálculo de margem retornou valor inválido." };
  }
  if (targetMarginPercent < 0) {
    return {
      ok: false,
      error: "Preço abaixo do necessário para cobrir custo e impostos.",
    };
  }
  if (taxRate + targetMarginPercent / 100 >= 1) {
    return {
      ok: false,
      error: "A soma de impostos e margem precisa ser menor que 100%.",
    };
  }

  const taxAmount = roundPricingMoney(salePrice * taxRate);
  const marginAmount = roundPricingMoney(salePrice * (targetMarginPercent / 100));

  return {
    ok: true,
    targetMarginPercent,
    taxAmount,
    marginAmount,
  };
}

/**
 * Margem a partir do preço acordado com o cliente (preço final c/ repasse no preço).
 * productPrice = acordado − priceAddOn; margem sobre o custo de precificação (finalUnitCost).
 */
export function calculateMarginPercentFromAgreedCustomerPrice(input: {
  agreedCustomerPrice: number;
  pricingCost: number;
  taxPercent: number;
  priceAddOnUnit?: number | null;
}): MarginPercentFromSalePriceResult {
  const addOn = Number(input.priceAddOnUnit ?? 0);
  const agreed = Number(input.agreedCustomerPrice);
  if (!Number.isFinite(agreed) || agreed <= 0) {
    return { ok: false, error: "Preço acordado inválido." };
  }
  if (!Number.isFinite(addOn) || addOn < 0) {
    return { ok: false, error: "Repasse no preço inválido." };
  }
  const productPrice = roundPricingMoney(agreed - addOn);
  if (productPrice <= 0) {
    return {
      ok: false,
      error: "Preço acordado precisa ser maior que o repasse no preço.",
    };
  }
  return calculateMarginPercentFromSalePrice({
    salePrice: productPrice,
    cost: input.pricingCost,
    taxPercent: input.taxPercent,
  });
}

export function pricingCalculationMetricsAreFinite(result: SalePriceFromCostResult): boolean {
  if (!result.ok) return true;
  return [result.suggestedPrice, result.taxAmount, result.marginAmount, result.divisor].every(
    (v) => Number.isFinite(v)
  );
}
