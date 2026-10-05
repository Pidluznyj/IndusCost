/**
 * Fórmula comercial canônica de preço/margem/markup (pura, sem I/O).
 *
 *   preço = (custo + frete) / (1 − impostos − comissão − outras − margem)
 *
 * Mesma álgebra de `calculatePriceTableItemFromFrozenCost` (priceTablePublication.ts)
 * com frete percentual = 0 — a publicação de tabela de preço continua com a função dela;
 * a equivalência é coberta por teste. Percentuais aqui são em pontos (18 = 18%).
 *
 * Premissas impossíveis (divisor ≤ 0) NUNCA viram preço 0: retornam erro explícito.
 */

export type CommercialPricePremises = {
  taxRatePct: number;
  commissionRatePct: number;
  otherRatePct: number;
  /** Frete absoluto (R$/un) somado ao custo. */
  freight: number;
};

export type CommercialPriceErrorCode =
  | "INVALID_COST"
  | "INVALID_PREMISES"
  | "INVALID_MARGIN"
  | "INVALID_PRICE"
  | "IMPOSSIBLE_PREMISES";

export type CommercialPriceError = {
  ok: false;
  code: CommercialPriceErrorCode;
  message: string;
  divisor?: number;
};

export type CommercialPriceSuccess = {
  ok: true;
  price: number;
  divisor: number;
  marginRatePct: number;
};

export type CommercialMarginSuccess = {
  ok: true;
  marginRatePct: number;
  price: number;
};

function finite(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Valida impostos/comissão/outras/frete: finitos e não negativos. */
export function validatePricingPremises(
  premises: CommercialPricePremises
): { ok: true } | CommercialPriceError {
  const tax = finite(premises.taxRatePct);
  const comm = finite(premises.commissionRatePct);
  const other = finite(premises.otherRatePct);
  const freight = finite(premises.freight);
  if (tax == null || comm == null || other == null || freight == null) {
    return { ok: false, code: "INVALID_PREMISES", message: "Premissas comerciais inválidas (valor não numérico)." };
  }
  if (tax < 0 || comm < 0 || other < 0 || freight < 0) {
    return { ok: false, code: "INVALID_PREMISES", message: "Premissas comerciais não podem ser negativas." };
  }
  return { ok: true };
}

export function pricingDivisor(premises: CommercialPricePremises, marginRatePct: number): number {
  return (
    1 -
    Number(premises.taxRatePct) / 100 -
    Number(premises.commissionRatePct) / 100 -
    Number(premises.otherRatePct) / 100 -
    Number(marginRatePct) / 100
  );
}

/** Preço a partir de custo + margem desejada (% sobre o preço). */
export function priceFromCostAndMargin(
  cost: number,
  premises: CommercialPricePremises,
  marginRatePct: number
): CommercialPriceSuccess | CommercialPriceError {
  const c = finite(cost);
  if (c == null || c < 0) {
    return { ok: false, code: "INVALID_COST", message: "Custo inválido para formação de preço." };
  }
  const valid = validatePricingPremises(premises);
  if (valid.ok === false) return valid;
  const margin = finite(marginRatePct);
  if (margin == null) {
    return { ok: false, code: "INVALID_MARGIN", message: "Margem inválida." };
  }
  const divisor = pricingDivisor(premises, margin);
  if (!Number.isFinite(divisor) || divisor <= 0) {
    return {
      ok: false,
      code: "IMPOSSIBLE_PREMISES",
      message: "Soma de impostos, comissão, outras variáveis e margem é maior ou igual a 100% do preço.",
      divisor,
    };
  }
  const price = (c + Number(premises.freight)) / divisor;
  if (!Number.isFinite(price)) {
    return { ok: false, code: "INVALID_PRICE", message: "Preço calculado inválido." };
  }
  return { ok: true, price, divisor, marginRatePct: margin };
}

/** Margem (% sobre o preço) a partir de custo + preço praticado. Margem negativa é resultado válido. */
export function marginFromCostAndPrice(
  cost: number,
  premises: CommercialPricePremises,
  price: number
): CommercialMarginSuccess | CommercialPriceError {
  const c = finite(cost);
  if (c == null || c < 0) {
    return { ok: false, code: "INVALID_COST", message: "Custo inválido para cálculo de margem." };
  }
  const valid = validatePricingPremises(premises);
  if (valid.ok === false) return valid;
  const p = finite(price);
  if (p == null || p <= 0) {
    return { ok: false, code: "INVALID_PRICE", message: "Preço deve ser maior que zero." };
  }
  const marginRate =
    1 -
    Number(premises.taxRatePct) / 100 -
    Number(premises.commissionRatePct) / 100 -
    Number(premises.otherRatePct) / 100 -
    (c + Number(premises.freight)) / p;
  if (!Number.isFinite(marginRate)) {
    return { ok: false, code: "INVALID_MARGIN", message: "Margem calculada inválida." };
  }
  return { ok: true, marginRatePct: marginRate * 100, price: p };
}

/** Fator de markup = preço / custo (ex.: 1,69). `null` quando custo ≤ 0 ou valores inválidos. */
export function markupFactor(price: number, cost: number): number | null {
  const p = finite(price);
  const c = finite(cost);
  if (p == null || c == null || c <= 0) return null;
  return p / c;
}

/** Markup percentual = (preço / custo − 1) × 100 (ex.: 69%). `null` quando custo ≤ 0. */
export function markupPct(price: number, cost: number): number | null {
  const factor = markupFactor(price, cost);
  return factor == null ? null : (factor - 1) * 100;
}
