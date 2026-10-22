/**
 * Histórico diário de PTAX e Brent a partir de snapshots já persistidos.
 * Não consulta Banco Central, Yahoo Finance nem dispara coleta.
 *
 * A variação acumulada compara a primeira e a última cotação válida da janela.
 * A variação diária de cada ponto usa a cotação válida anterior, mesmo que ela
 * esteja fora da janela ou que o intervalo tenha fim de semana ou feriado.
 * Essa cotação anterior não entra na série desenhada.
 */

import {
  formatBrentSourceLabel,
  PTAX_DEFAULT_SOURCE_LABEL,
} from "@/src/lib/marketGlobalIndicators.js";

export const MARKET_HISTORY_TIMEZONE = "America/Sao_Paulo" as const;

export const MARKET_GLOBAL_INDICATORS_HISTORY_API =
  "/api/market-intelligence/global-indicators/history" as const;

export const MARKET_HISTORY_RANGES = ["7d", "30d", "90d"] as const;

export type MarketHistoryRange = (typeof MARKET_HISTORY_RANGES)[number];

export const MARKET_HISTORY_RANGE_OPTIONS: Array<{ id: MarketHistoryRange; label: string }> = [
  { id: "7d", label: "7 dias" },
  { id: "30d", label: "30 dias" },
  { id: "90d", label: "90 dias" },
];

export const MARKET_HISTORY_ACCUMULATED_METHOD = "first_to_last_in_window" as const;

export const MARKET_HISTORY_ACCUMULATED_NOTE =
  "A variação acumulada compara a primeira e a última cotação válida exibidas no período. A variação diária do primeiro ponto usa a cotação válida imediatamente anterior, quando ela existe, e esse ponto anterior não entra no gráfico.";

export const BRENT_PRICE_KIND = "last_recorded_in_day" as const;

export const BRENT_PRICE_KIND_LABEL = "Última cotação registrada no dia";

export const MARKET_TRENDS_EMPTY_MESSAGE =
  "Ainda não há histórico suficiente para exibir a tendência deste período.";

export const MARKET_TRENDS_SINGLE_POINT_MESSAGE =
  "Há apenas uma cotação neste período. O valor é exibido, mas ainda não há observações suficientes para calcular uma tendência.";

export const MARKET_TRENDS_ERROR_MESSAGE =
  "Não foi possível carregar o histórico de mercado. Tente novamente.";

export const MARKET_TRENDS_PARTIAL_NOTE =
  "Somente dias com cotação válida. Fins de semana, feriados e falhas de coleta não são preenchidos.";

const RANGE_DAYS: Record<MarketHistoryRange, number> = {
  "7d": 7,
  "30d": 30,
  "90d": 90,
};

export type MarketHistoryExtreme = {
  value: number;
  quoteDate: string;
};

export type MarketHistorySummary = {
  observationCount: number;
  firstQuoteDate: string | null;
  lastQuoteDate: string | null;
  lastValue: number | null;
  dailyChangePct: number | null;
  accumulatedChangePct: number | null;
  accumulatedMethod: typeof MARKET_HISTORY_ACCUMULATED_METHOD;
  min: MarketHistoryExtreme | null;
  max: MarketHistoryExtreme | null;
  amplitudePct: number | null;
};

export type MarketPtaxHistoryPoint = {
  quoteDate: string;
  sellRate: number;
  buyRate: number;
  sellDailyChangePct: number | null;
  buyDailyChangePct: number | null;
  source: string;
  collectedAt: string;
};

export type MarketBrentHistoryPoint = {
  quoteDate: string;
  priceUsd: number;
  dailyChangePct: number | null;
  source: string;
  collectedAt: string;
  priceKind: typeof BRENT_PRICE_KIND;
};

export type MarketGlobalIndicatorsHistoryDto = {
  range: MarketHistoryRange;
  rangeDays: number;
  timezone: typeof MARKET_HISTORY_TIMEZONE;
  windowStart: string;
  windowEnd: string;
  generatedAt: string;
  accumulatedMethod: typeof MARKET_HISTORY_ACCUMULATED_METHOD;
  accumulatedNote: string;
  ptax: {
    points: MarketPtaxHistoryPoint[];
    sell: MarketHistorySummary;
    buy: MarketHistorySummary;
  };
  brent: {
    points: MarketBrentHistoryPoint[];
    summary: MarketHistorySummary;
    priceKind: typeof BRENT_PRICE_KIND;
    priceKindLabel: string;
  };
};

type RateLike = number | string | null | { toString(): string };

export type MarketHistoryPtaxInput = {
  id: string;
  status: string;
  quoteDate: Date | string;
  buyRate: RateLike;
  sellRate: RateLike;
  source?: string | null;
  collectedAt: Date | string;
};

export type MarketHistoryBrentInput = {
  id: string;
  status: string;
  quoteDate: Date | string;
  priceUSD: RateLike;
  source?: string | null;
  collectedAt: Date | string;
};

type DatedRow = {
  id: string;
  quoteDate: string;
  collectedAt: string;
};

export function parseMarketHistoryRange(
  value: unknown
): { ok: true; range: MarketHistoryRange } | { ok: false; error: "INVALID_RANGE" } {
  if (value == null || value === "") return { ok: true, range: "30d" };
  if (typeof value !== "string") return { ok: false, error: "INVALID_RANGE" };
  if ((MARKET_HISTORY_RANGES as readonly string[]).includes(value)) {
    return { ok: true, range: value as MarketHistoryRange };
  }
  return { ok: false, error: "INVALID_RANGE" };
}

export function civilDateInSaoPaulo(instant: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: MARKET_HISTORY_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instant);
}

export function addCivilDays(isoDate: string, days: number): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!match) throw new Error("Data civil inválida.");
  const utc = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  utc.setUTCDate(utc.getUTCDate() + days);
  return utc.toISOString().slice(0, 10);
}

export function historyWindow(
  range: MarketHistoryRange,
  now: Date
): { start: string; end: string; days: number } {
  const days = RANGE_DAYS[range];
  const end = civilDateInSaoPaulo(now);
  const start = addCivilDays(end, -(days - 1));
  return { start, end, days };
}

/** Limites para coluna `@db.Date`, incluindo o dia civil nas duas pontas. */
export function historyQuoteDateBounds(start: string, end: string): {
  gte: Date;
  lte: Date;
  priorBefore: Date;
} {
  return {
    gte: new Date(`${start}T00:00:00.000Z`),
    lte: new Date(`${end}T23:59:59.999Z`),
    priorBefore: new Date(`${start}T00:00:00.000Z`),
  };
}

/**
 * Data econômica gravada em `@db.Date`. Meia-noite ou meio-dia UTC permanecem
 * no mesmo dia civil. Não converte para America/Sao_Paulo, porque isso jogaria
 * a cotação para o dia anterior.
 */
export function quoteDateKey(value: Date | string | null | undefined): string | null {
  if (value == null) return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return value.toISOString().slice(0, 10);
  }
  const trimmed = String(value).trim();
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(trimmed);
  if (match) return match[1] ?? null;
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

export function percentChange(current: number, previous: number | null): number | null {
  if (previous == null || !(previous > 0) || !Number.isFinite(current) || !(current > 0)) return null;
  return (current / previous - 1) * 100;
}

export function formatMarketFixedPt(value: number, decimals: number): string {
  return new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
}

export function formatMarketPercentPt(value: number | null | undefined): string | null {
  if (value == null || !Number.isFinite(value)) return null;
  const body = formatMarketFixedPt(value, 2);
  return value > 0 ? `+${body}%` : `${body}%`;
}

export function formatPtaxRatePt(value: number): string {
  return `R$ ${formatMarketFixedPt(value, 4)}`;
}

export function formatBrentPricePt(value: number): string {
  return `US$ ${formatMarketFixedPt(value, 2)}`;
}

export function formatQuoteDatePt(iso: string | null | undefined): string {
  if (!iso) return "—";
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return "—";
  return `${match[3]}/${match[2]}/${match[1]}`;
}

export function formatCollectedAtPt(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("pt-BR", {
    timeZone: MARKET_HISTORY_TIMEZONE,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function positiveRate(value: RateLike | undefined): number | null {
  if (value == null) return null;
  const numeric = typeof value === "number" ? value : Number(value.toString());
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  return numeric;
}

function collectedAtIso(value: Date | string): string | null {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function preferLatest<T extends DatedRow>(current: T | undefined, candidate: T): T {
  if (!current) return candidate;
  const candidateMs = Date.parse(candidate.collectedAt);
  const currentMs = Date.parse(current.collectedAt);
  if (candidateMs !== currentMs) return candidateMs > currentMs ? candidate : current;
  return candidate.id.localeCompare(current.id) > 0 ? candidate : current;
}

function emptySummary(): MarketHistorySummary {
  return {
    observationCount: 0,
    firstQuoteDate: null,
    lastQuoteDate: null,
    lastValue: null,
    dailyChangePct: null,
    accumulatedChangePct: null,
    accumulatedMethod: MARKET_HISTORY_ACCUMULATED_METHOD,
    min: null,
    max: null,
    amplitudePct: null,
  };
}

function summarize(values: Array<{ quoteDate: string; value: number; dailyChangePct: number | null }>): MarketHistorySummary {
  if (values.length === 0) return emptySummary();
  const first = values[0]!;
  const last = values[values.length - 1]!;
  let min = { value: first.value, quoteDate: first.quoteDate };
  let max = { value: first.value, quoteDate: first.quoteDate };
  for (const point of values) {
    if (point.value < min.value) min = { value: point.value, quoteDate: point.quoteDate };
    if (point.value > max.value) max = { value: point.value, quoteDate: point.quoteDate };
  }
  const accumulatedChangePct =
    values.length >= 2 ? percentChange(last.value, first.value) : null;
  const amplitudePct =
    values.length >= 2 && min.value > 0 ? percentChange(max.value, min.value) : null;
  return {
    observationCount: values.length,
    firstQuoteDate: first.quoteDate,
    lastQuoteDate: last.quoteDate,
    lastValue: last.value,
    dailyChangePct: last.dailyChangePct,
    accumulatedChangePct,
    accumulatedMethod: MARKET_HISTORY_ACCUMULATED_METHOD,
    min,
    max,
    amplitudePct,
  };
}

function inWindow(quoteDate: string, start: string, end: string): boolean {
  return quoteDate >= start && quoteDate <= end;
}

export function buildMarketGlobalIndicatorsHistory(input: {
  range: MarketHistoryRange;
  now: Date;
  ptaxRows: MarketHistoryPtaxInput[];
  brentRows: MarketHistoryBrentInput[];
}): MarketGlobalIndicatorsHistoryDto {
  const window = historyWindow(input.range, input.now);
  const ptaxDays = new Map<string, MarketPtaxHistoryPoint & { id: string }>();
  for (const row of input.ptaxRows) {
    if (row.status !== "SUCCESS") continue;
    const quoteDate = quoteDateKey(row.quoteDate);
    const collectedAt = collectedAtIso(row.collectedAt);
    const sellRate = positiveRate(row.sellRate);
    const buyRate = positiveRate(row.buyRate);
    if (!quoteDate || !collectedAt || sellRate == null || buyRate == null) continue;
    const candidate = {
      id: row.id,
      quoteDate,
      sellRate,
      buyRate,
      sellDailyChangePct: null,
      buyDailyChangePct: null,
      source: row.source?.trim() || PTAX_DEFAULT_SOURCE_LABEL,
      collectedAt,
    };
    ptaxDays.set(quoteDate, preferLatest(ptaxDays.get(quoteDate), candidate));
  }

  const brentDays = new Map<string, MarketBrentHistoryPoint & { id: string }>();
  for (const row of input.brentRows) {
    if (row.status !== "SUCCESS") continue;
    const quoteDate = quoteDateKey(row.quoteDate);
    const collectedAt = collectedAtIso(row.collectedAt);
    const priceUsd = positiveRate(row.priceUSD);
    if (!quoteDate || !collectedAt || priceUsd == null) continue;
    const candidate = {
      id: row.id,
      quoteDate,
      priceUsd,
      dailyChangePct: null,
      source: formatBrentSourceLabel(row.source),
      collectedAt,
      priceKind: BRENT_PRICE_KIND,
    };
    brentDays.set(quoteDate, preferLatest(brentDays.get(quoteDate), candidate));
  }

  const ptaxOrdered = [...ptaxDays.values()].sort((a, b) => a.quoteDate.localeCompare(b.quoteDate));
  const brentOrdered = [...brentDays.values()].sort((a, b) => a.quoteDate.localeCompare(b.quoteDate));

  const ptaxPoints = withPtaxChanges(ptaxOrdered, window.start, window.end);
  const brentPoints = withBrentChanges(brentOrdered, window.start, window.end);

  return {
    range: input.range,
    rangeDays: window.days,
    timezone: MARKET_HISTORY_TIMEZONE,
    windowStart: window.start,
    windowEnd: window.end,
    generatedAt: input.now.toISOString(),
    accumulatedMethod: MARKET_HISTORY_ACCUMULATED_METHOD,
    accumulatedNote: MARKET_HISTORY_ACCUMULATED_NOTE,
    ptax: {
      points: ptaxPoints,
      sell: summarize(ptaxPoints.map((point) => ({
        quoteDate: point.quoteDate,
        value: point.sellRate,
        dailyChangePct: point.sellDailyChangePct,
      }))),
      buy: summarize(ptaxPoints.map((point) => ({
        quoteDate: point.quoteDate,
        value: point.buyRate,
        dailyChangePct: point.buyDailyChangePct,
      }))),
    },
    brent: {
      points: brentPoints,
      summary: summarize(brentPoints.map((point) => ({
        quoteDate: point.quoteDate,
        value: point.priceUsd,
        dailyChangePct: point.dailyChangePct,
      }))),
      priceKind: BRENT_PRICE_KIND,
      priceKindLabel: BRENT_PRICE_KIND_LABEL,
    },
  };
}

function withPtaxChanges(
  ordered: Array<MarketPtaxHistoryPoint & { id: string }>,
  start: string,
  end: string
): MarketPtaxHistoryPoint[] {
  let previous: { sellRate: number; buyRate: number } | null = null;
  const points: MarketPtaxHistoryPoint[] = [];
  for (const row of ordered) {
    const sellDailyChangePct = percentChange(row.sellRate, previous?.sellRate ?? null);
    const buyDailyChangePct = percentChange(row.buyRate, previous?.buyRate ?? null);
    previous = { sellRate: row.sellRate, buyRate: row.buyRate };
    if (!inWindow(row.quoteDate, start, end)) continue;
    points.push({
      quoteDate: row.quoteDate,
      sellRate: row.sellRate,
      buyRate: row.buyRate,
      sellDailyChangePct,
      buyDailyChangePct,
      source: row.source,
      collectedAt: row.collectedAt,
    });
  }
  return points;
}

function withBrentChanges(
  ordered: Array<MarketBrentHistoryPoint & { id: string }>,
  start: string,
  end: string
): MarketBrentHistoryPoint[] {
  let previous: number | null = null;
  const points: MarketBrentHistoryPoint[] = [];
  for (const row of ordered) {
    const dailyChangePct = percentChange(row.priceUsd, previous);
    previous = row.priceUsd;
    if (!inWindow(row.quoteDate, start, end)) continue;
    points.push({
      quoteDate: row.quoteDate,
      priceUsd: row.priceUsd,
      dailyChangePct,
      source: row.source,
      collectedAt: row.collectedAt,
      priceKind: BRENT_PRICE_KIND,
    });
  }
  return points;
}
