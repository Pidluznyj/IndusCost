/**
 * Metas (OKR) — fórmulas de progresso. Puro, determinístico, sem I/O.
 *
 * Valores chegam como STRINGS decimais (Decimal 20,6 no banco — nunca float
 * na persistência). A conversão para Number acontece só aqui, para o cálculo
 * do PERCENTUAL derivado — precisão de double é suficiente para uma razão
 * exibida com 1 casa; os valores monetários originais nunca são mutados.
 *
 * Progresso do KR (RN-002, INCREASE e DECREASE com a MESMA expressão):
 *   ratio = clamp((achieved − baseline) / (target − baseline), 0, 1)
 *   — em DECREASE, target < baseline inverte o sinal do numerador e do
 *   denominador naturalmente. target == baseline é meta mal configurada:
 *   ratio 0 + flag `invalidTargets`.
 *
 * Roll-up do Objetivo (RN-010):
 *   Σ(ratio × weight) / Σ(weight dos KRs ATIVOS) — arquivados ficam fora.
 */

export type GoalKeyResultProgressInput = {
  baseline: string;
  target: string;
  achievedValue: string;
};

export type GoalKeyResultProgress = {
  /** 0..1 (clampado). */
  ratio: number;
  /** true quando target == baseline (meta sem intervalo — sinalizar na UI). */
  invalidTargets: boolean;
};

function toFiniteNumber(value: string): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function computeGoalKeyResultProgress(
  input: GoalKeyResultProgressInput
): GoalKeyResultProgress {
  const baseline = toFiniteNumber(input.baseline);
  const target = toFiniteNumber(input.target);
  const achieved = toFiniteNumber(input.achievedValue);

  const span = target - baseline;
  if (span === 0) {
    return { ratio: 0, invalidTargets: true };
  }
  const raw = (achieved - baseline) / span;
  const ratio = Math.min(1, Math.max(0, raw));
  return { ratio, invalidTargets: false };
}

export type GoalRollupKeyResult = {
  status: string;
  weight: string;
  baseline: string;
  target: string;
  achievedValue: string;
};

export type GoalRollupResult = {
  /** 0..1 — média ponderada dos KRs ativos; 0 quando não há KR ativo. */
  ratio: number;
  activeKeyResults: number;
  /** KRs ativos com target == baseline (não entram no denominador). */
  invalidKeyResults: number;
};

export function computeGoalRollup(
  keyResults: readonly GoalRollupKeyResult[]
): GoalRollupResult {
  let weightedSum = 0;
  let weightTotal = 0;
  let active = 0;
  let invalid = 0;

  for (const kr of keyResults) {
    if (kr.status !== "ACTIVE") continue;
    active += 1;
    const progress = computeGoalKeyResultProgress(kr);
    if (progress.invalidTargets) {
      invalid += 1;
      continue; // meta sem intervalo não dilui nem infla o objetivo
    }
    const weight = Math.max(0, toFiniteNumber(kr.weight));
    if (weight === 0) continue;
    weightedSum += progress.ratio * weight;
    weightTotal += weight;
  }

  return {
    ratio: weightTotal > 0 ? Math.min(1, Math.max(0, weightedSum / weightTotal)) : 0,
    activeKeyResults: active,
    invalidKeyResults: invalid,
  };
}

/** Razão 0..1 → percentual inteiro 0..100 para exibição. */
export function progressRatioToPercent(ratio: number): number {
  return Math.round(Math.min(1, Math.max(0, ratio)) * 100);
}
