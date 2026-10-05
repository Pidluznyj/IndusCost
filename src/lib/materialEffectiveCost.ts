/**
 * Regra canônica (pura) de custo efetivo de matéria-prima — a mesma do motor oficial
 * (productCostAnalysisEngine.server.ts):
 *
 *   custo posto     = custo atual + frete
 *   custo efetivo   = custo posto / (1 − perda padrão do material)
 *   quantidade req. = quantidade / (1 − perda da linha de BOM)
 *
 * São duas perdas distintas e não se duplicam: a perda padrão pertence ao MATERIAL
 * (entra no custo unitário); a perda de BOM pertence à LINHA (entra na quantidade).
 */

export type MaterialEffectiveCost = {
  landedCost: number;
  effectiveCost: number;
  standardLossPct: number;
  /** false quando a perda informada é ≥ 100% (ou inválida) e o custo posto foi usado sem divisão. */
  lossApplied: boolean;
};

function nonNegativeFinite(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

/** Perdas em pontos percentuais (10 = 10%). Perda ≥ 100% não divide (evita Infinity/negativo). */
export function computeMaterialEffectiveCost(input: {
  currentCost: unknown;
  freight?: unknown;
  standardLossPct?: unknown;
}): MaterialEffectiveCost {
  const landedCost = nonNegativeFinite(input.currentCost) + nonNegativeFinite(input.freight);
  const lossPct = Number(input.standardLossPct ?? 0);
  const safeLoss = Number.isFinite(lossPct) ? lossPct : 0;
  const denom = 1 - safeLoss / 100;
  if (!(denom > 0) || !Number.isFinite(denom)) {
    return { landedCost, effectiveCost: landedCost, standardLossPct: safeLoss, lossApplied: false };
  }
  return { landedCost, effectiveCost: landedCost / denom, standardLossPct: safeLoss, lossApplied: true };
}

/** Quantidade requerida com perda de BOM (regra do motor: q / (1 − perda)). */
export function requiredQuantityWithBomLoss(
  quantity: unknown,
  bomLossPct: unknown
): { requiredQuantity: number; lossApplied: boolean } {
  const q = Number(quantity);
  const base = Number.isFinite(q) ? q : 0;
  const loss = Number(bomLossPct ?? 0);
  const denom = 1 - (Number.isFinite(loss) ? loss : 0) / 100;
  if (!(denom > 0) || !Number.isFinite(denom)) return { requiredQuantity: base, lossApplied: false };
  return { requiredQuantity: base / denom, lossApplied: true };
}
