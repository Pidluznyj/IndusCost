/**
 * Indicadores de mercado a partir do histórico de cotações manuais.
 * Todos os cálculos ficam centralizados aqui — o frontend apenas exibe.
 */

import type { MaterialMarketQuoteSourceRow } from "./materialMarketQuote.js";
import {
  computeMaterialQuotePriceBRL,
  formatYmdLocal,
} from "./materialMarketPriceHistory.js";

export const MATERIAL_MARKET_QUOTE_ANALYTICS_PERIODS = [
  "7d",
  "30d",
  "90d",
  "365d",
  "all",
] as const;

export type MaterialMarketQuoteAnalyticsPeriod =
  (typeof MATERIAL_MARKET_QUOTE_ANALYTICS_PERIODS)[number];

export const MATERIAL_MARKET_QUOTE_ANALYTICS_PERIOD_LABELS: Record<
  MaterialMarketQuoteAnalyticsPeriod,
  string
> = {
  "7d": "7 dias",
  "30d": "30 dias",
  "90d": "90 dias",
  "365d": "1 ano",
  all: "Todo o histórico",
};

export type MaterialMarketQuoteTrend = "UP" | "DOWN" | "STABLE";

export const MATERIAL_MARKET_QUOTE_TREND_LABELS: Record<MaterialMarketQuoteTrend, string> = {
  UP: "Alta",
  DOWN: "Baixa",
  STABLE: "Estável",
};

/** Limiar de variação percentual para classificar tendência (recente vs. período anterior). */
export const MATERIAL_MARKET_QUOTE_TREND_THRESHOLD_PERCENT = 2;

export type MaterialMarketQuoteVariationResult = {
  percent: number | null;
  reason: string | null;
};

export type MaterialMarketQuoteAnalyticsResult = {
  empty: boolean;
  period: MaterialMarketQuoteAnalyticsPeriod;
  periodLabel: string;
  quoteCount: number;
  currentPrice: number | null;
  average: number | null;
  median: number | null;
  minPrice: number | null;
  maxPrice: number | null;
  amplitude: number | null;
  standardDeviation: number | null;
  /** Coeficiente de variação: (desvio padrão / média) × 100. */
  volatility: number | null;
  weeklyVariation: MaterialMarketQuoteVariationResult;
  monthlyVariation: MaterialMarketQuoteVariationResult;
  annualVariation: MaterialMarketQuoteVariationResult;
  trend: MaterialMarketQuoteTrend | null;
  trendLabel: string | null;
  trendReason: string | null;
};

export type MaterialMarketQuoteAnalyticsInput = {
  quoteDate: string | Date;
  netPrice: number | string | { toString(): string };
  currency?: string;
};

const INSUFFICIENT_DATA_REASON = "Dados insuficientes para comparação.";
const SINGLE_QUOTE_REASON = "Apenas uma cotação no período.";

const PERIOD_DAYS: Record<Exclude<MaterialMarketQuoteAnalyticsPeriod, "all">, number> = {
  "7d": 7,
  "30d": 30,
  "90d": 90,
  "365d": 365,
};

function roundMoney(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function roundPercent(value: number): number {
  return Math.round(value * 100) / 100;
}

function toNumber(value: number | string | { toString(): string }): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function toDate(value: string | Date): Date {
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? new Date(0) : d;
}

function extractPriceBRL(quote: MaterialMarketQuoteAnalyticsInput): number {
  return toNumber(quote.netPrice);
}

export function isMaterialMarketQuoteAnalyticsPeriod(
  value: unknown
): value is MaterialMarketQuoteAnalyticsPeriod {
  return (
    typeof value === "string" &&
    (MATERIAL_MARKET_QUOTE_ANALYTICS_PERIODS as readonly string[]).includes(value)
  );
}

export function parseMaterialMarketQuoteAnalyticsPeriod(
  value: unknown,
  fallback: MaterialMarketQuoteAnalyticsPeriod = "30d"
): MaterialMarketQuoteAnalyticsPeriod {
  return isMaterialMarketQuoteAnalyticsPeriod(value) ? value : fallback;
}

export function resolveMaterialMarketQuoteAnalyticsDateRange(input: {
  period: MaterialMarketQuoteAnalyticsPeriod;
  referenceDate?: Date;
  from?: unknown;
  to?: unknown;
}): { fromIso: string | null; toIso: string | null } {
  const toParsed = parseOptionalDateIso(input.to);
  const fromParsed = parseOptionalDateIso(input.from);

  if (fromParsed || toParsed) {
    return { fromIso: fromParsed, toIso: toParsed };
  }

  if (input.period === "all") {
    return { fromIso: null, toIso: null };
  }

  const ref = input.referenceDate ?? new Date();
  ref.setHours(0, 0, 0, 0);
  const toIso = formatYmdLocal(ref);
  const start = new Date(ref);
  start.setDate(start.getDate() - PERIOD_DAYS[input.period]);
  return { fromIso: formatYmdLocal(start), toIso };
}

function parseOptionalDateIso(value: unknown): string | null {
  if (value == null || value === "") return null;
  const iso = toIsoDateOnly(String(value));
  return iso || null;
}

function toIsoDateOnly(value: string | Date): string {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

export function filterMaterialMarketQuotesForAnalytics<
  T extends MaterialMarketQuoteAnalyticsInput,
>(quotes: T[], range: { fromIso: string | null; toIso: string | null }): T[] {
  return quotes.filter((quote) => {
    const iso = toIsoDateOnly(quote.quoteDate);
    if (!iso) return false;
    if (range.fromIso && iso < range.fromIso) return false;
    if (range.toIso && iso > range.toIso) return false;
    return true;
  });
}

function sortQuotesChronologicallyDesc<T extends MaterialMarketQuoteAnalyticsInput>(
  quotes: T[]
): T[] {
  return [...quotes].sort(
    (a, b) => toDate(b.quoteDate).getTime() - toDate(a.quoteDate).getTime()
  );
}

function computeMean(values: number[]): number | null {
  if (values.length === 0) return null;
  return roundMoney(values.reduce((sum, v) => sum + v, 0) / values.length);
}

function computeMedian(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return roundMoney((sorted[mid - 1] + sorted[mid]) / 2);
  }
  return roundMoney(sorted[mid]);
}

function computeStandardDeviation(values: number[], mean: number): number {
  if (values.length <= 1) return 0;
  const variance =
    values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
  return roundMoney(Math.sqrt(variance));
}

function computePercentVariation(
  current: number,
  previous: number
): number | null {
  if (!Number.isFinite(current) || !Number.isFinite(previous) || previous === 0) {
    return null;
  }
  const percent = ((current - previous) / previous) * 100;
  return Number.isFinite(percent) ? roundPercent(percent) : null;
}

function findQuoteNearestDaysAgo(
  sortedDesc: { quoteDate: Date; price: number }[],
  daysAgo: number
): { price: number; quoteDate: Date } | null {
  if (sortedDesc.length < 2) return null;

  const reference = sortedDesc[0].quoteDate;
  const targetMs = reference.getTime() - daysAgo * 24 * 60 * 60 * 1000;

  const candidates = sortedDesc.slice(1);
  let best: { price: number; quoteDate: Date } | null = null;
  let bestDiff = Infinity;

  for (const candidate of candidates) {
    const diff = Math.abs(candidate.quoteDate.getTime() - targetMs);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = candidate;
    }
  }

  return best;
}

function buildVariation(
  sortedDesc: { quoteDate: Date; price: number }[],
  daysAgo: number,
  singleQuote: boolean
): MaterialMarketQuoteVariationResult {
  if (singleQuote) {
    return { percent: null, reason: SINGLE_QUOTE_REASON };
  }

  const past = findQuoteNearestDaysAgo(sortedDesc, daysAgo);
  if (!past) {
    return { percent: null, reason: INSUFFICIENT_DATA_REASON };
  }

  const current = sortedDesc[0].price;
  const percent = computePercentVariation(current, past.price);
  if (percent == null) {
    return { percent: null, reason: INSUFFICIENT_DATA_REASON };
  }

  return { percent, reason: null };
}

function computeTrend(
  sortedDesc: { quoteDate: Date; price: number }[],
  singleQuote: boolean
): { trend: MaterialMarketQuoteTrend | null; reason: string | null } {
  if (singleQuote || sortedDesc.length < 2) {
    return { trend: null, reason: SINGLE_QUOTE_REASON };
  }

  const reference = sortedDesc[0].quoteDate;
  const weekMs = 7 * 24 * 60 * 60 * 1000;
  const recent: number[] = [];
  const older: number[] = [];

  for (const quote of sortedDesc) {
    if (reference.getTime() - quote.quoteDate.getTime() <= weekMs) {
      recent.push(quote.price);
    } else {
      older.push(quote.price);
    }
  }

  if (recent.length === 0 || older.length === 0) {
    return { trend: null, reason: INSUFFICIENT_DATA_REASON };
  }

  const recentAvg = computeMean(recent);
  const olderAvg = computeMean(older);
  if (recentAvg == null || olderAvg == null || olderAvg === 0) {
    return { trend: null, reason: INSUFFICIENT_DATA_REASON };
  }

  const changePercent = ((recentAvg - olderAvg) / olderAvg) * 100;
  if (!Number.isFinite(changePercent)) {
    return { trend: null, reason: INSUFFICIENT_DATA_REASON };
  }

  if (changePercent > MATERIAL_MARKET_QUOTE_TREND_THRESHOLD_PERCENT) {
    return { trend: "UP", reason: null };
  }
  if (changePercent < -MATERIAL_MARKET_QUOTE_TREND_THRESHOLD_PERCENT) {
    return { trend: "DOWN", reason: null };
  }
  return { trend: "STABLE", reason: null };
}

export function computeMaterialMarketQuoteAnalytics(input: {
  quotes: MaterialMarketQuoteAnalyticsInput[];
  period?: MaterialMarketQuoteAnalyticsPeriod;
  from?: unknown;
  to?: unknown;
  referenceDate?: Date;
}): MaterialMarketQuoteAnalyticsResult {
  const period = parseMaterialMarketQuoteAnalyticsPeriod(input.period);
  const range = resolveMaterialMarketQuoteAnalyticsDateRange({
    period,
    referenceDate: input.referenceDate,
    from: input.from,
    to: input.to,
  });

  const filtered = filterMaterialMarketQuotesForAnalytics(input.quotes, range);
  const sorted = sortQuotesChronologicallyDesc(filtered);
  const prices = sorted.map((q) => extractPriceBRL(q));
  const normalized = sorted.map((q) => ({
    quoteDate: toDate(q.quoteDate),
    price: extractPriceBRL(q),
  }));

  const empty = prices.length === 0;
  const singleQuote = prices.length === 1;

  if (empty) {
    return {
      empty: true,
      period,
      periodLabel: MATERIAL_MARKET_QUOTE_ANALYTICS_PERIOD_LABELS[period],
      quoteCount: 0,
      currentPrice: null,
      average: null,
      median: null,
      minPrice: null,
      maxPrice: null,
      amplitude: null,
      standardDeviation: null,
      volatility: null,
      weeklyVariation: { percent: null, reason: INSUFFICIENT_DATA_REASON },
      monthlyVariation: { percent: null, reason: INSUFFICIENT_DATA_REASON },
      annualVariation: { percent: null, reason: INSUFFICIENT_DATA_REASON },
      trend: null,
      trendLabel: null,
      trendReason: INSUFFICIENT_DATA_REASON,
    };
  }

  const currentPrice = prices[0];
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);
  const average = computeMean(prices)!;
  const median = computeMedian(prices)!;
  const amplitude = roundMoney(maxPrice - minPrice);
  const standardDeviation = computeStandardDeviation(prices, average);
  const volatility =
    average !== 0 ? roundPercent((standardDeviation / average) * 100) : null;

  const weeklyVariation = buildVariation(normalized, 7, singleQuote);
  const monthlyVariation = buildVariation(normalized, 30, singleQuote);
  const annualVariation = buildVariation(normalized, 365, singleQuote);
  const trendResult = computeTrend(normalized, singleQuote);

  return {
    empty: false,
    period,
    periodLabel: MATERIAL_MARKET_QUOTE_ANALYTICS_PERIOD_LABELS[period],
    quoteCount: prices.length,
    currentPrice: roundMoney(currentPrice),
    average,
    median,
    minPrice: roundMoney(minPrice),
    maxPrice: roundMoney(maxPrice),
    amplitude,
    standardDeviation,
    volatility,
    weeklyVariation,
    monthlyVariation,
    annualVariation,
    trend: trendResult.trend,
    trendLabel: trendResult.trend
      ? MATERIAL_MARKET_QUOTE_TREND_LABELS[trendResult.trend]
      : null,
    trendReason: trendResult.reason,
  };
}

export function buildMaterialMarketQuoteAnalyticsFromRows(
  rows: MaterialMarketQuoteSourceRow[],
  options?: {
    period?: MaterialMarketQuoteAnalyticsPeriod;
    from?: unknown;
    to?: unknown;
    referenceDate?: Date;
    exchangeRatesByDate?: Map<string, number | null>;
  }
): MaterialMarketQuoteAnalyticsResult {
  const rates = options?.exchangeRatesByDate ?? new Map<string, number | null>();
  const quotes: MaterialMarketQuoteAnalyticsInput[] = [];

  for (const row of rows) {
    if (row.status === "CANCELLED") continue;
    const dateIso = toIsoDateOnly(row.quoteDate);
    if (!dateIso) continue;

    const currency = String(row.currency).trim().toUpperCase();
    const netPrice = toNumber(row.netPrice);
    const rate =
      currency === "USD" || currency !== "BRL" ? (rates.get(dateIso) ?? null) : null;
    const { priceBRL } = computeMaterialQuotePriceBRL({
      netPrice,
      currency,
      exchangeRateUsed: rate,
    });

    quotes.push({ quoteDate: dateIso, netPrice: priceBRL, currency: "BRL" });
  }

  return computeMaterialMarketQuoteAnalytics({
    quotes,
    period: options?.period,
    from: options?.from,
    to: options?.to,
    referenceDate: options?.referenceDate,
  });
}
