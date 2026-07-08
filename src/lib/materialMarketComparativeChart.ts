/**
 * Série comparativa — matéria-prima (BRL), PTAX venda e Brent (USD) — visão 360º.
 *
 * Alinhamento diário (dateFrom → dateTo):
 * - materialBRL: apenas nas datas de cotação (última cotação do dia).
 * - ptaxSell: PTAX gravado na cotação quando existir; senão mapa global (BCB);
 *   forward-fill do último valor conhecido em dias sem cotação PTAX.
 * - brentUSD: snapshots SUCCESS por dia; forward-fill opcional nos intervalos sem dado.
 */
import type { MaterialMarketQuoteSourceRow } from "./materialMarketQuote.js";
import {
  computeMaterialQuotePriceBRL,
  formatYmdLocal,
  isQuoteDateWithinRange,
  resolveMaterialMarketPriceHistoryPeriodRange,
  type MaterialMarketPriceHistoryPeriodRange,
} from "./materialMarketPriceHistory.js";

export const MATERIAL_MARKET_COMPARATIVE_CHART_PERIOD_VALUES = [
  "30d",
  "90d",
  "6m",
  "12m",
  "24m",
] as const;

export type MaterialMarketComparativeChartPeriod =
  (typeof MATERIAL_MARKET_COMPARATIVE_CHART_PERIOD_VALUES)[number];

export const MATERIAL_MARKET_COMPARATIVE_CHART_PERIOD_OPTIONS: {
  value: MaterialMarketComparativeChartPeriod;
  label: string;
}[] = [
  { value: "30d", label: "30 dias" },
  { value: "90d", label: "90 dias" },
  { value: "6m", label: "6 meses" },
  { value: "12m", label: "12 meses" },
  { value: "24m", label: "24 meses" },
];

export type ComparativeChartSeriesPoint = {
  date: string;
  value: number | null;
};

export type MaterialMarketComparativeChartResponse = {
  period: MaterialMarketPriceHistoryPeriodRange;
  hasFewDataPoints: boolean;
  normalizationApplied: boolean;
  series: {
    materialBRL: ComparativeChartSeriesPoint[];
    ptaxSell: ComparativeChartSeriesPoint[];
    brentUSD: ComparativeChartSeriesPoint[];
  };
  warnings: string[];
};

export type ComparativeChartQuoteRow = MaterialMarketQuoteSourceRow & {
  ptaxVenda?: number | string | null | { toString(): string };
  netPriceBrl?: number | string | null | { toString(): string };
  ptaxFetchStatus?: string | null;
};

export type BrentSnapshotSourceRow = {
  quoteDate: Date | string;
  price: number | string | null | { toString(): string };
  status: string;
  collectedAt?: Date | string;
};

const NORMALIZATION_RATIO_THRESHOLD = 2;
const FEW_DATA_POINTS_THRESHOLD = 3;

function toIsoDateOnly(value: Date | string): string {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

function toNumber(value: number | string | null | undefined | { toString(): string }): number {
  if (value == null) return 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function isMaterialMarketComparativeChartPeriod(
  value: unknown
): value is MaterialMarketComparativeChartPeriod {
  return (
    typeof value === "string" &&
    (MATERIAL_MARKET_COMPARATIVE_CHART_PERIOD_VALUES as readonly string[]).includes(value)
  );
}

export function parseMaterialMarketComparativeChartQuery(
  query: { period?: unknown },
  referenceDate = new Date()
):
  | { ok: true; range: MaterialMarketPriceHistoryPeriodRange }
  | { ok: false; message: string } {
  const periodRaw = typeof query.period === "string" ? query.period.trim() : "90d";
  const preset = isMaterialMarketComparativeChartPeriod(periodRaw) ? periodRaw : "90d";
  const range = resolveMaterialMarketPriceHistoryPeriodRange(
    preset,
    undefined,
    undefined,
    referenceDate
  );
  if (!range) {
    return { ok: false, message: "Período inválido." };
  }
  return { ok: true, range };
}

export function enumerateIsoDatesInRange(
  range: MaterialMarketPriceHistoryPeriodRange
): string[] {
  const dates: string[] = [];
  const cursor = new Date(`${range.dateFrom}T12:00:00`);
  const end = new Date(`${range.dateTo}T12:00:00`);
  while (cursor <= end) {
    dates.push(formatYmdLocal(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return dates;
}

function sortKeyForQuote(row: ComparativeChartQuoteRow): string {
  const created =
    row.createdAt instanceof Date
      ? row.createdAt.toISOString()
      : String(row.createdAt ?? "");
  return `${created}:${row.id}`;
}

export function buildMaterialBrlByQuoteDate(
  rows: ComparativeChartQuoteRow[],
  range: MaterialMarketPriceHistoryPeriodRange
): Map<string, number> {
  const byDate = new Map<string, { value: number; sortKey: string }>();

  for (const row of rows) {
    if (row.status === "CANCELLED") continue;
    const date = toIsoDateOnly(row.quoteDate);
    if (!date || !isQuoteDateWithinRange(date, range)) continue;

    const storedBrl = row.netPriceBrl != null ? toNumber(row.netPriceBrl) : null;
    let priceBRL: number;
    if (storedBrl != null && storedBrl > 0) {
      priceBRL = storedBrl;
    } else {
      const ptax =
        row.ptaxVenda != null && toNumber(row.ptaxVenda) > 0
          ? toNumber(row.ptaxVenda)
          : null;
      priceBRL = computeMaterialQuotePriceBRL({
        netPrice: toNumber(row.netPrice),
        currency: row.currency,
        exchangeRateUsed: ptax,
      }).priceBRL;
    }

    const sortKey = sortKeyForQuote(row);
    const prev = byDate.get(date);
    if (!prev || sortKey > prev.sortKey) {
      byDate.set(date, { value: priceBRL, sortKey });
    }
  }

  return new Map([...byDate.entries()].map(([date, entry]) => [date, entry.value]));
}

export function buildQuotePtaxByDate(
  rows: ComparativeChartQuoteRow[],
  range: MaterialMarketPriceHistoryPeriodRange
): Map<string, number> {
  const byDate = new Map<string, number>();
  for (const row of rows) {
    if (row.status === "CANCELLED") continue;
    const date = toIsoDateOnly(row.quoteDate);
    if (!date || !isQuoteDateWithinRange(date, range)) continue;
    const ptax = toNumber(row.ptaxVenda);
    if (ptax > 0) {
      byDate.set(date, ptax);
    }
  }
  return byDate;
}

export function buildBrentPriceByDate(
  snapshots: BrentSnapshotSourceRow[],
  range: MaterialMarketPriceHistoryPeriodRange
): Map<string, number> {
  const byDate = new Map<string, { price: number; collectedAt: number }>();

  for (const snapshot of snapshots) {
    if (snapshot.status !== "SUCCESS") continue;
    const date = toIsoDateOnly(snapshot.quoteDate);
    if (!date || !isQuoteDateWithinRange(date, range)) continue;
    const price = toNumber(snapshot.price);
    if (price <= 0) continue;

    const collectedAt = snapshot.collectedAt
      ? new Date(snapshot.collectedAt).getTime()
      : 0;
    const prev = byDate.get(date);
    if (!prev || collectedAt >= prev.collectedAt) {
      byDate.set(date, { price, collectedAt });
    }
  }

  return new Map([...byDate.entries()].map(([date, entry]) => [date, entry.price]));
}

function forwardFillDailySeries(
  dates: string[],
  rawByDate: Map<string, number>
): ComparativeChartSeriesPoint[] {
  let last: number | null = null;
  return dates.map((date) => {
    const hit = rawByDate.get(date);
    if (hit != null && hit > 0) {
      last = hit;
      return { date, value: hit };
    }
    return { date, value: last };
  });
}

function sparseDailySeries(
  dates: string[],
  rawByDate: Map<string, number>
): ComparativeChartSeriesPoint[] {
  return dates.map((date) => {
    const hit = rawByDate.get(date);
    return { date, value: hit != null && hit > 0 ? hit : null };
  });
}

export function firstNonNullSeriesValue(
  points: ComparativeChartSeriesPoint[]
): number | null {
  for (const point of points) {
    if (point.value != null && point.value > 0) return point.value;
  }
  return null;
}

export function shouldApplyComparativeChartNormalization(
  bases: Array<number | null>
): boolean {
  const positives = bases.filter((v): v is number => v != null && v > 0);
  if (positives.length < 2) return false;
  const max = Math.max(...positives);
  const min = Math.min(...positives);
  if (min <= 0) return false;
  return max / min >= NORMALIZATION_RATIO_THRESHOLD;
}

export function indexSeriesToBase100(
  points: ComparativeChartSeriesPoint[],
  baseValue: number | null
): Array<number | null> {
  if (baseValue == null || baseValue <= 0) {
    return points.map(() => null);
  }
  return points.map((point) =>
    point.value != null && point.value > 0
      ? Math.round((point.value / baseValue) * 10_000) / 100
      : null
  );
}

export function buildMaterialMarketComparativeChartResponse(input: {
  rows: ComparativeChartQuoteRow[];
  brentSnapshots: BrentSnapshotSourceRow[];
  range: MaterialMarketPriceHistoryPeriodRange;
  ptaxRatesByDate?: Map<string, number | null>;
}): MaterialMarketComparativeChartResponse {
  const dates = enumerateIsoDatesInRange(input.range);
  const materialByDate = buildMaterialBrlByQuoteDate(input.rows, input.range);
  const quotePtaxByDate = buildQuotePtaxByDate(input.rows, input.range);
  const brentByDate = buildBrentPriceByDate(input.brentSnapshots, input.range);
  const globalPtax = input.ptaxRatesByDate ?? new Map<string, number | null>();

  const ptaxRaw = new Map<string, number>();
  for (const date of dates) {
    const fromQuote = quotePtaxByDate.get(date);
    if (fromQuote != null && fromQuote > 0) {
      ptaxRaw.set(date, fromQuote);
      continue;
    }
    const fromGlobal = globalPtax.get(date);
    if (fromGlobal != null && fromGlobal > 0) {
      ptaxRaw.set(date, fromGlobal);
    }
  }

  const materialBRL = sparseDailySeries(dates, materialByDate);
  const ptaxSell = forwardFillDailySeries(dates, ptaxRaw);
  const brentUSD = forwardFillDailySeries(dates, brentByDate);

  const quoteCount = materialByDate.size;
  const hasFewDataPoints = quoteCount < FEW_DATA_POINTS_THRESHOLD;

  const warnings: string[] = [];
  if (hasFewDataPoints) {
    warnings.push(
      "Poucas cotações no período — a comparação pode não ser representativa."
    );
  }

  const brentRawDays = brentByDate.size;
  const brentFilledDays = brentUSD.filter((p) => p.value != null).length;
  if (brentRawDays === 0) {
    warnings.push("Dados de Brent indisponíveis para o período selecionado.");
  } else if (brentFilledDays < dates.length) {
    warnings.push("Dados de Brent indisponíveis para parte do período.");
  }

  const ptaxWithValue = ptaxSell.filter((p) => p.value != null).length;
  if (ptaxWithValue === 0) {
    warnings.push("Cotações PTAX indisponíveis para o período selecionado.");
  } else if (ptaxWithValue < dates.length) {
    warnings.push("PTAX parcialmente indisponível — valores anteriores foram repetidos.");
  }

  const materialBase = firstNonNullSeriesValue(materialBRL);
  const ptaxBase = firstNonNullSeriesValue(ptaxSell);
  const brentBase = firstNonNullSeriesValue(brentUSD);
  const normalizationApplied = shouldApplyComparativeChartNormalization([
    materialBase,
    ptaxBase,
    brentBase,
  ]);

  return {
    period: input.range,
    hasFewDataPoints,
    normalizationApplied,
    series: {
      materialBRL,
      ptaxSell,
      brentUSD,
    },
    warnings,
  };
}

export function mergeComparativeChartSeriesForDisplay(
  response: MaterialMarketComparativeChartResponse,
  formatDateLabel: (iso: string) => string
): Array<{
  date: string;
  dateLabel: string;
  materialBRL: number | null;
  ptaxSell: number | null;
  brentUSD: number | null;
  materialBRLIndexed: number | null;
  ptaxSellIndexed: number | null;
  brentUSDIndexed: number | null;
}> {
  const { series, normalizationApplied } = response;
  const len = series.materialBRL.length;

  const materialBase = firstNonNullSeriesValue(series.materialBRL);
  const ptaxBase = firstNonNullSeriesValue(series.ptaxSell);
  const brentBase = firstNonNullSeriesValue(series.brentUSD);

  const materialIndexed = normalizationApplied
    ? indexSeriesToBase100(series.materialBRL, materialBase)
    : series.materialBRL.map((p) => p.value);
  const ptaxIndexed = normalizationApplied
    ? indexSeriesToBase100(series.ptaxSell, ptaxBase)
    : series.ptaxSell.map((p) => p.value);
  const brentIndexed = normalizationApplied
    ? indexSeriesToBase100(series.brentUSD, brentBase)
    : series.brentUSD.map((p) => p.value);

  const rows = [];
  for (let i = 0; i < len; i += 1) {
    const date = series.materialBRL[i]?.date ?? "";
    rows.push({
      date,
      dateLabel: formatDateLabel(date),
      materialBRL: series.materialBRL[i]?.value ?? null,
      ptaxSell: series.ptaxSell[i]?.value ?? null,
      brentUSD: series.brentUSD[i]?.value ?? null,
      materialBRLIndexed: materialIndexed[i] ?? null,
      ptaxSellIndexed: ptaxIndexed[i] ?? null,
      brentUSDIndexed: brentIndexed[i] ?? null,
    });
  }
  return rows;
}

export function collectComparativeChartPtaxDates(
  range: MaterialMarketPriceHistoryPeriodRange
): string[] {
  return enumerateIsoDatesInRange(range);
}
