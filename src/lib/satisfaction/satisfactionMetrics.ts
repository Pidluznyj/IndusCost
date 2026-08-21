/**
 * Satisfação — fórmulas oficiais. Camada PURA e única fonte da semântica.
 *
 * Regras que não se negociam:
 *  - Só rating válido (inteiro 1..5) entra em qualquer conta.
 *  - DRAFT nunca entra em métrica de satisfação; só SUBMITTED.
 *  - Sem denominador confiável, a taxa é `null` — nunca 0, nunca inventada.
 *  - NÃO existe NPS aqui: o V1 não tem pergunta 0–10 de recomendação, e
 *    converter 1–5 em NPS seria inventar metodologia. Idem CES.
 */

import { isValidRating, SATISFACTION_RATING_MAX } from "./satisfactionContracts.js";

/** Nota a partir da qual a avaliação é considerada positiva. */
export const SATISFACTION_POSITIVE_MIN = 4 as const;
/** Nota até a qual a avaliação é considerada crítica (e gera alerta). */
export const SATISFACTION_CRITICAL_MAX = 2 as const;

export function isPositiveRating(value: number): boolean {
  return isValidRating(value) && value >= SATISFACTION_POSITIVE_MIN;
}

export function isCriticalRating(value: number): boolean {
  return isValidRating(value) && value <= SATISFACTION_CRITICAL_MAX;
}

export function isTopBoxRating(value: number): boolean {
  return isValidRating(value) && value === SATISFACTION_RATING_MAX;
}

/** Mantém apenas ratings válidos — descarta null/0/decimal/string silenciosamente. */
export function keepValidRatings(values: readonly unknown[]): number[] {
  return values.filter(isValidRating);
}

/** Arredonda para N casas sem acumular erro de ponto flutuante visível na UI. */
export function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

// ─── Distribuição e agregados de um conjunto de notas ───────────────────────

export type SatisfactionRatingDistribution = {
  1: number;
  2: number;
  3: number;
  4: number;
  5: number;
};

export type SatisfactionRatingStats = {
  /** Quantidade de notas VÁLIDAS consideradas. */
  count: number;
  /** Média simples; `null` quando não há nenhuma nota válida. */
  average: number | null;
  positiveCount: number;
  criticalCount: number;
  topBoxCount: number;
  /** Percentuais 0–100; `null` quando count = 0. */
  positivePercent: number | null;
  criticalPercent: number | null;
  topBoxPercent: number | null;
  distribution: SatisfactionRatingDistribution;
  lowestRating: number | null;
};

export function emptyDistribution(): SatisfactionRatingDistribution {
  return { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
}

/**
 * Agregado oficial de um conjunto de notas.
 * Entrada suja é tolerada: só o que passa em `isValidRating` conta.
 */
export function summarizeRatings(values: readonly unknown[]): SatisfactionRatingStats {
  const ratings = keepValidRatings(values);
  const distribution = emptyDistribution();
  let sum = 0;
  let positiveCount = 0;
  let criticalCount = 0;
  let topBoxCount = 0;
  let lowestRating: number | null = null;

  for (const rating of ratings) {
    distribution[rating as 1 | 2 | 3 | 4 | 5] += 1;
    sum += rating;
    if (isPositiveRating(rating)) positiveCount += 1;
    if (isCriticalRating(rating)) criticalCount += 1;
    if (isTopBoxRating(rating)) topBoxCount += 1;
    if (lowestRating == null || rating < lowestRating) lowestRating = rating;
  }

  const count = ratings.length;
  const pct = (n: number): number | null => (count === 0 ? null : roundTo((n / count) * 100, 1));

  return {
    count,
    average: count === 0 ? null : roundTo(sum / count, 2),
    positiveCount,
    criticalCount,
    topBoxCount,
    positivePercent: pct(positiveCount),
    criticalPercent: pct(criticalCount),
    topBoxPercent: pct(topBoxCount),
    distribution,
    lowestRating,
  };
}

/**
 * Média a partir de soma/contagem já agregadas no banco (caminho do dashboard).
 * `null` quando a contagem é zero — jamais divide por zero nem devolve 0.
 */
export function averageFromTotals(sum: number, count: number): number | null {
  if (!Number.isFinite(sum) || !Number.isFinite(count) || count <= 0) return null;
  return roundTo(sum / count, 2);
}

// ─── Taxas do funil ─────────────────────────────────────────────────────────

/**
 * Taxa de resposta = concluídos / convites ativos (revogados saem das DUAS pontas).
 *
 * Devolve `null` quando não há denominador confiável — é o caso da importação
 * histórica, em que não sabemos quantos clientes foram convidados no Google
 * Forms. Inventar denominador falsearia a série.
 */
export function calculateResponseRate(input: {
  activeInvitations: number;
  completedInvitations: number;
}): number | null {
  const { activeInvitations, completedInvitations } = input;
  if (!Number.isFinite(activeInvitations) || activeInvitations <= 0) return null;
  const bounded = Math.min(completedInvitations, activeInvitations);
  return roundTo((bounded / activeInvitations) * 100, 1);
}

/** Abandono = (iniciados − concluídos) / iniciados. `null` se ninguém iniciou. */
export function calculateAbandonmentRate(input: {
  startedCount: number;
  completedCount: number;
}): number | null {
  const { startedCount, completedCount } = input;
  if (!Number.isFinite(startedCount) || startedCount <= 0) return null;
  const abandoned = Math.max(0, startedCount - completedCount);
  return roundTo((abandoned / startedCount) * 100, 1);
}

/** Taxa genérica do funil (abertura/início/conclusão) sobre convites ativos. */
export function calculateFunnelRate(numerator: number, denominator: number): number | null {
  if (!Number.isFinite(denominator) || denominator <= 0) return null;
  const bounded = Math.min(Math.max(numerator, 0), denominator);
  return roundTo((bounded / denominator) * 100, 1);
}

// ─── Alerta / cliente crítico ───────────────────────────────────────────────

/**
 * Versão inicial da regra de alerta: QUALQUER nota <= 2 na resposta.
 * Só expõe o alerta — não altera Customer, não bloqueia pedido, não cria
 * tarefa comercial automática.
 */
export function hasCriticalAlert(ratings: readonly unknown[]): boolean {
  return keepValidRatings(ratings).some(isCriticalRating);
}

export type SatisfactionAlertLevel = "NONE" | "ATTENTION" | "CRITICAL";

/**
 * Nível de alerta de uma resposta:
 *  CRITICAL  — há nota 1 ou 2.
 *  ATTENTION — sem nota crítica, mas média abaixo de 3,5.
 *  NONE      — demais casos.
 */
export function resolveAlertLevel(ratings: readonly unknown[]): SatisfactionAlertLevel {
  const valid = keepValidRatings(ratings);
  if (valid.length === 0) return "NONE";
  if (valid.some(isCriticalRating)) return "CRITICAL";
  const stats = summarizeRatings(valid);
  if (stats.average != null && stats.average < 3.5) return "ATTENTION";
  return "NONE";
}

// ─── Satisfação por critério ────────────────────────────────────────────────

export type SatisfactionCriterionInput = {
  questionCode: string;
  label: string;
  sortOrder: number;
  ratings: readonly unknown[];
};

export type SatisfactionCriterionStats = SatisfactionRatingStats & {
  questionCode: string;
  label: string;
  sortOrder: number;
};

/** Critérios ordenados da PIOR para a MELHOR média — o que exige ação primeiro. */
export function summarizeCriteria(
  inputs: readonly SatisfactionCriterionInput[]
): SatisfactionCriterionStats[] {
  return inputs
    .map((input) => ({
      questionCode: input.questionCode,
      label: input.label,
      sortOrder: input.sortOrder,
      ...summarizeRatings(input.ratings),
    }))
    .sort((a, b) => {
      // Sem nota vai para o fim; entre os que têm, a menor média primeiro.
      if (a.average == null && b.average == null) return a.sortOrder - b.sortOrder;
      if (a.average == null) return 1;
      if (b.average == null) return -1;
      if (a.average !== b.average) return a.average - b.average;
      return a.sortOrder - b.sortOrder;
    });
}

// ─── Tendência entre campanhas ──────────────────────────────────────────────

export type SatisfactionTrend = "UP" | "DOWN" | "STABLE" | "UNKNOWN";

/** Variação < 0,05 é ruído de arredondamento, não tendência. */
export const SATISFACTION_TREND_EPSILON = 0.05;

export function resolveTrend(
  current: number | null,
  previous: number | null
): { trend: SatisfactionTrend; delta: number | null } {
  if (current == null || previous == null) return { trend: "UNKNOWN", delta: null };
  const delta = roundTo(current - previous, 2);
  if (Math.abs(delta) < SATISFACTION_TREND_EPSILON) return { trend: "STABLE", delta };
  return { trend: delta > 0 ? "UP" : "DOWN", delta };
}
