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
 *   denominador naturalmente.
 *
 * Configuração inválida (ratio 0 + `configurationIssue`, fora do roll-up):
 *   NO_INTERVAL         — target == baseline (meta sem intervalo);
 *   DIRECTION_MISMATCH  — direção incoerente com base/alvo (INCREASE exige
 *                         alvo > base; DECREASE exige alvo < base). Sem esta
 *                         checagem, um INCREASE com alvo abaixo da base
 *                         mostraria "progresso" ao PIORAR o número.
 *
 * Roll-up do Objetivo (RN-010):
 *   Σ(ratio × weight) / Σ(weight dos KRs ATIVOS) — arquivados ficam fora.
 */

export type GoalProgressConfigurationIssue = "NO_INTERVAL" | "DIRECTION_MISMATCH";

export type GoalKeyResultProgressInput = {
  baseline: string;
  target: string;
  achievedValue: string;
  /** Direção da meta — quando presente, habilita a checagem de coerência. */
  trackingType?: string | null;
};

export type GoalKeyResultProgress = {
  /** 0..1 (clampado). */
  ratio: number;
  /** true quando a configuração é inválida (sem intervalo OU direção errada). */
  invalidTargets: boolean;
  /** Qual problema de configuração existe — null quando a meta é coerente. */
  configurationIssue: GoalProgressConfigurationIssue | null;
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
    return { ratio: 0, invalidTargets: true, configurationIssue: "NO_INTERVAL" };
  }
  // KR legado com direção semanticamente falsa não pode fingir progresso: a
  // fórmula sozinha aceitaria (o sinal do span "funciona"), mas o número
  // exibido seria mentira gerencial. Ratio 0 + sinal explícito para a UI.
  if (
    (input.trackingType === "INCREASE" && span < 0) ||
    (input.trackingType === "DECREASE" && span > 0)
  ) {
    return { ratio: 0, invalidTargets: true, configurationIssue: "DIRECTION_MISMATCH" };
  }
  const raw = (achieved - baseline) / span;
  const ratio = Math.min(1, Math.max(0, raw));
  return { ratio, invalidTargets: false, configurationIssue: null };
}

export type GoalRollupKeyResult = {
  status: string;
  weight: string;
  baseline: string;
  target: string;
  achievedValue: string;
  /** Direção da meta — repassada para a checagem de coerência do KR. */
  trackingType?: string | null;
};

export type GoalRollupResult = {
  /** 0..1 — média ponderada dos KRs ativos; 0 quando não há KR ativo. */
  ratio: number;
  activeKeyResults: number;
  /** KRs ativos com configuração inválida (não entram no denominador). */
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
      continue; // configuração inválida não dilui nem infla o objetivo
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
