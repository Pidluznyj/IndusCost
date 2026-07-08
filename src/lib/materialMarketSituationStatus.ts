/**
 * Classificação automática da situação de mercado por matéria-prima monitorada.
 * Usa histórico de cotações em BRL (preço líquido / netPrice).
 */

import type { MaterialMarketQuoteSourceRow } from "./materialMarketQuote.js";
import { sortMaterialMarketQuotesChronologically } from "./materialMarketQuote.js";

export const MATERIAL_MARKET_SITUATION_STATUS_VALUES = [
  "OPORTUNIDADE",
  "NORMAL",
  "ATENCAO",
  "CRITICO",
  "INSUFFICIENT_DATA",
] as const;

export type MaterialMarketSituationStatus =
  (typeof MATERIAL_MARKET_SITUATION_STATUS_VALUES)[number];

/** Limiares documentados — alterações devem refletir nos testes. */
export const MATERIAL_MARKET_SITUATION_THRESHOLDS = {
  /** Mínimo de cotações BRL para classificar. */
  MIN_QUOTES: 2,
  /** Faixa ±% em torno da média histórica → NORMAL. */
  NORMAL_BAND_PERCENT: 5,
  /** Acima da média em mais de % → ATENCAO (se não for CRITICO). */
  ATTENTION_ABOVE_AVG_PERCENT: 5,
  /** Abaixo da média em mais de % → OPORTUNIDADE. */
  OPPORTUNITY_BELOW_AVG_PERCENT: 5,
  /** Acima da média em mais de % → CRITICO. */
  CRITICAL_ABOVE_AVG_PERCENT: 20,
  /** Preço atual a até % do máximo histórico → CRITICO. */
  CRITICAL_NEAR_MAX_PERCENT: 5,
} as const;

export const MATERIAL_MARKET_SITUATION_STATUS_LABELS: Record<
  MaterialMarketSituationStatus,
  string
> = {
  OPORTUNIDADE: "Oportunidade",
  NORMAL: "Normal",
  ATENCAO: "Atenção",
  CRITICO: "Crítico",
  INSUFFICIENT_DATA: "Sem histórico suficiente",
};

export type MaterialMarketSituationResult = {
  status: MaterialMarketSituationStatus;
  statusLabel: string;
  reason: string;
  currentPrice: number | null;
  historicalAverage: number | null;
  historicalMin: number | null;
  historicalMax: number | null;
  deviationPercent: number | null;
  quoteCount: number;
};

export type MaterialMarketQuotePriceInput = {
  netPrice: number | string | { toString(): string };
  currency?: string | null;
  status?: string | null;
};

function toPrice(value: number | string | { toString(): string }): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function roundPercent(value: number): number {
  return Math.round(value * 100) / 100;
}

function formatBrl(value: number): string {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function formatPercent(value: number): string {
  const sign = value > 0 ? "+" : "";
  return `${sign}${roundPercent(value).toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}%`;
}

/** Extrai preços líquidos BRL de cotações ativas (ou sem status inválido). */
export function extractBrlNetPricesFromQuotes(
  quotes: MaterialMarketQuotePriceInput[] | undefined
): number[] {
  if (!quotes?.length) return [];
  return quotes
    .filter((q) => {
      const currency = (q.currency ?? "BRL").toUpperCase();
      if (currency !== "BRL") return false;
      const status = q.status ?? "ACTIVE";
      return status !== "CANCELLED" && status !== "DRAFT";
    })
    .map((q) => toPrice(q.netPrice))
    .filter((p): p is number => p != null);
}

export function computeHistoricalQuoteStats(prices: number[]): {
  average: number;
  min: number;
  max: number;
} | null {
  if (prices.length === 0) return null;
  const sum = prices.reduce((acc, p) => acc + p, 0);
  return {
    average: sum / prices.length,
    min: Math.min(...prices),
    max: Math.max(...prices),
  };
}

export function classifyMaterialMarketSituation(input: {
  prices: number[];
  currentPrice: number | null;
}): MaterialMarketSituationResult {
  const { prices, currentPrice } = input;
  const quoteCount = prices.length;

  if (quoteCount < MATERIAL_MARKET_SITUATION_THRESHOLDS.MIN_QUOTES || currentPrice == null) {
    return {
      status: "INSUFFICIENT_DATA",
      statusLabel: MATERIAL_MARKET_SITUATION_STATUS_LABELS.INSUFFICIENT_DATA,
      reason:
        quoteCount < MATERIAL_MARKET_SITUATION_THRESHOLDS.MIN_QUOTES
          ? `Menos de ${MATERIAL_MARKET_SITUATION_THRESHOLDS.MIN_QUOTES} cotações em BRL registradas (${quoteCount}).`
          : "Sem preço atual disponível nas cotações.",
      currentPrice,
      historicalAverage: null,
      historicalMin: null,
      historicalMax: null,
      deviationPercent: null,
      quoteCount,
    };
  }

  const stats = computeHistoricalQuoteStats(prices)!;
  const deviationPercent = roundPercent(
    ((currentPrice - stats.average) / stats.average) * 100
  );
  const nearMaxThreshold =
    stats.max * (1 - MATERIAL_MARKET_SITUATION_THRESHOLDS.CRITICAL_NEAR_MAX_PERCENT / 100);
  const isNearMax = currentPrice >= nearMaxThreshold;
  const isCriticalAboveAvg =
    deviationPercent > MATERIAL_MARKET_SITUATION_THRESHOLDS.CRITICAL_ABOVE_AVG_PERCENT;

  const base = {
    currentPrice,
    historicalAverage: Math.round(stats.average * 1_000_000) / 1_000_000,
    historicalMin: stats.min,
    historicalMax: stats.max,
    deviationPercent,
    quoteCount,
  };

  if (isNearMax || isCriticalAboveAvg) {
    const reason = isNearMax
      ? `Preço atual ${formatBrl(currentPrice)} está a até ${MATERIAL_MARKET_SITUATION_THRESHOLDS.CRITICAL_NEAR_MAX_PERCENT}% do máximo histórico (${formatBrl(stats.max)}).`
      : `Preço atual ${formatBrl(currentPrice)} está ${formatPercent(deviationPercent)} acima da média histórica (${formatBrl(stats.average)}), acima do limite de ${MATERIAL_MARKET_SITUATION_THRESHOLDS.CRITICAL_ABOVE_AVG_PERCENT}%.`;
    return {
      ...base,
      status: "CRITICO",
      statusLabel: MATERIAL_MARKET_SITUATION_STATUS_LABELS.CRITICO,
      reason,
    };
  }

  if (deviationPercent < -MATERIAL_MARKET_SITUATION_THRESHOLDS.OPPORTUNITY_BELOW_AVG_PERCENT) {
    return {
      ...base,
      status: "OPORTUNIDADE",
      statusLabel: MATERIAL_MARKET_SITUATION_STATUS_LABELS.OPORTUNIDADE,
      reason: `Preço atual ${formatBrl(currentPrice)} está ${formatPercent(deviationPercent)} abaixo da média histórica (${formatBrl(stats.average)}), abaixo do limite de −${MATERIAL_MARKET_SITUATION_THRESHOLDS.OPPORTUNITY_BELOW_AVG_PERCENT}%.`,
    };
  }

  if (deviationPercent > MATERIAL_MARKET_SITUATION_THRESHOLDS.ATTENTION_ABOVE_AVG_PERCENT) {
    return {
      ...base,
      status: "ATENCAO",
      statusLabel: MATERIAL_MARKET_SITUATION_STATUS_LABELS.ATENCAO,
      reason: `Preço atual ${formatBrl(currentPrice)} está ${formatPercent(deviationPercent)} acima da média histórica (${formatBrl(stats.average)}), acima do limite de +${MATERIAL_MARKET_SITUATION_THRESHOLDS.ATTENTION_ABOVE_AVG_PERCENT}%.`,
    };
  }

  return {
    ...base,
    status: "NORMAL",
    statusLabel: MATERIAL_MARKET_SITUATION_STATUS_LABELS.NORMAL,
    reason: `Preço atual ${formatBrl(currentPrice)} está dentro da faixa normal (±${MATERIAL_MARKET_SITUATION_THRESHOLDS.NORMAL_BAND_PERCENT}%) em relação à média histórica (${formatBrl(stats.average)}): ${formatPercent(deviationPercent)}.`,
  };
}

export function classifyMaterialMarketSituationFromQuotes(
  quotes: MaterialMarketQuoteSourceRow[] | MaterialMarketQuotePriceInput[] | undefined
): MaterialMarketSituationResult {
  const sorted = sortMaterialMarketQuotesChronologically(
    (quotes ?? []).map((q) => ({
      quoteDate: "quoteDate" in q ? q.quoteDate : "",
      createdAt: "createdAt" in q ? q.createdAt : "",
      netPrice: q.netPrice,
      currency: q.currency,
      status: q.status,
    }))
  );
  const prices = extractBrlNetPricesFromQuotes(sorted);
  const currentPrice = prices[0] ?? null;
  return classifyMaterialMarketSituation({ prices, currentPrice });
}

export function materialMarketSituationBadgeClass(
  status: MaterialMarketSituationStatus
): string {
  switch (status) {
    case "OPORTUNIDADE":
      return "bg-green-500/10 text-green-700";
    case "NORMAL":
      return "bg-slate-500/10 text-slate-700";
    case "ATENCAO":
      return "bg-amber-500/10 text-amber-800";
    case "CRITICO":
      return "bg-red-500/10 text-red-700";
    case "INSUFFICIENT_DATA":
    default:
      return "bg-muted text-muted-foreground";
  }
}
