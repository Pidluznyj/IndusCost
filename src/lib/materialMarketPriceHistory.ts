/**
 * Série de histórico de preços — Inteligência de Mercado (gráfico 360º).
 */
import type { MaterialMarketQuoteSourceRow } from "./materialMarketQuote.js";
import { formatMaterialIntelligenceQuoteDate } from "./materialIntelligence360Sections.js";
import {
  resolveSupplierKey,
  type MaterialMarketSupplierComparisonRow,
} from "./materialMarketSupplierComparison.js";

/** Quantas linhas de fornecedor o gráfico de histórico mostra no máximo. */
export const MATERIAL_MARKET_PRICE_HISTORY_MAX_SUPPLIER_LINES = 3;

/** Chave estável para cotações sem fornecedor identificável (sem supplierId nem supplierName). */
export const UNKNOWN_SUPPLIER_KEY = "unknown";

export const MATERIAL_MARKET_PRICE_HISTORY_PERIOD_VALUES = [
  "30d",
  "90d",
  "6m",
  "12m",
  "24m",
  "custom",
] as const;

export type MaterialMarketPriceHistoryPeriod =
  (typeof MATERIAL_MARKET_PRICE_HISTORY_PERIOD_VALUES)[number];

export const MATERIAL_MARKET_PRICE_HISTORY_PERIOD_OPTIONS: {
  value: MaterialMarketPriceHistoryPeriod;
  label: string;
}[] = [
  { value: "30d", label: "30 dias" },
  { value: "90d", label: "90 dias" },
  { value: "6m", label: "6 meses" },
  { value: "12m", label: "12 meses" },
  { value: "24m", label: "24 meses" },
  { value: "custom", label: "Personalizado" },
];

export type MaterialMarketPriceHistoryPeriodRange = {
  preset: MaterialMarketPriceHistoryPeriod;
  dateFrom: string;
  dateTo: string;
};

export type MaterialMarketPriceHistoryPoint = {
  id: string;
  date: string;
  dateLabel: string;
  supplierId: string | null;
  supplierKey: string;
  supplierName: string | null;
  originalCurrency: string;
  originalPrice: number;
  priceBRL: number;
  exchangeRateUsed: number | null;
  notes: string | null;
};

/** Uma linha do gráfico — todas as cotações de UM fornecedor no período. */
export type MaterialMarketPriceHistorySeries = {
  supplierKey: string;
  supplierId: string | null;
  supplierName: string;
  averagePrice: number;
  isStale: boolean;
  points: MaterialMarketPriceHistoryPoint[];
};

export type MaterialMarketPriceHistoryResponse = {
  period: MaterialMarketPriceHistoryPeriodRange;
  /** Mantido para compatibilidade (export CSV/XLSX/PDF) — todas as cotações, sem corte. */
  points: MaterialMarketPriceHistoryPoint[];
  /** Até MATERIAL_MARKET_PRICE_HISTORY_MAX_SUPPLIER_LINES linhas — ver buildMaterialMarketPriceHistorySupplierSeries. */
  series: MaterialMarketPriceHistorySeries[];
  /** Quantos fornecedores distintos têm cotação no período (antes do corte de linhas). */
  totalSuppliers: number;
  total: number;
};

function toIsoDateOnly(value: Date | string): string {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

function toNumber(value: number | string | { toString(): string }): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function formatYmdLocal(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function isMaterialMarketPriceHistoryPeriod(
  value: unknown
): value is MaterialMarketPriceHistoryPeriod {
  return (
    typeof value === "string" &&
    (MATERIAL_MARKET_PRICE_HISTORY_PERIOD_VALUES as readonly string[]).includes(value)
  );
}

export function resolveMaterialMarketPriceHistoryPeriodRange(
  preset: MaterialMarketPriceHistoryPeriod,
  customDateFrom?: string,
  customDateTo?: string,
  referenceDate = new Date()
): MaterialMarketPriceHistoryPeriodRange | null {
  const ref = new Date(referenceDate);
  ref.setHours(0, 0, 0, 0);
  const dateTo = formatYmdLocal(ref);

  if (preset === "custom") {
    const dateFrom = (customDateFrom ?? "").trim();
    const to = (customDateTo ?? "").trim();
    if (!dateFrom || !to) return null;
    if (dateFrom > to) return null;
    return { preset, dateFrom, dateTo: to };
  }

  const start = new Date(ref);
  switch (preset) {
    case "30d":
      start.setDate(start.getDate() - 30);
      break;
    case "90d":
      start.setDate(start.getDate() - 90);
      break;
    case "6m":
      start.setMonth(start.getMonth() - 6);
      break;
    case "12m":
      start.setMonth(start.getMonth() - 12);
      break;
    case "24m":
      start.setMonth(start.getMonth() - 24);
      break;
    default:
      return null;
  }

  return { preset, dateFrom: formatYmdLocal(start), dateTo };
}

export function parseMaterialMarketPriceHistoryQuery(
  query: { period?: unknown; dateFrom?: unknown; dateTo?: unknown },
  referenceDate = new Date()
):
  | { ok: true; range: MaterialMarketPriceHistoryPeriodRange }
  | { ok: false; message: string } {
  const periodRaw = typeof query.period === "string" ? query.period.trim() : "12m";
  const preset = isMaterialMarketPriceHistoryPeriod(periodRaw) ? periodRaw : "12m";
  const dateFrom =
    typeof query.dateFrom === "string" ? query.dateFrom.trim() : undefined;
  const dateTo = typeof query.dateTo === "string" ? query.dateTo.trim() : undefined;

  const range = resolveMaterialMarketPriceHistoryPeriodRange(
    preset,
    dateFrom,
    dateTo,
    referenceDate
  );

  if (!range) {
    return {
      ok: false,
      message: "Informe data inicial e final para o período personalizado.",
    };
  }

  return { ok: true, range };
}

export function isQuoteDateWithinRange(
  quoteDate: string | Date,
  range: MaterialMarketPriceHistoryPeriodRange
): boolean {
  const iso = toIsoDateOnly(quoteDate);
  if (!iso) return false;
  return iso >= range.dateFrom && iso <= range.dateTo;
}

export function computeMaterialQuotePriceBRL(input: {
  netPrice: number;
  currency: string;
  exchangeRateUsed?: number | null;
}): { priceBRL: number; exchangeRateUsed: number | null } {
  const currency = input.currency.trim().toUpperCase();
  const netPrice = input.netPrice;

  if (currency === "BRL") {
    return { priceBRL: netPrice, exchangeRateUsed: null };
  }

  if (currency === "USD") {
    const rate = input.exchangeRateUsed;
    if (rate != null && Number.isFinite(rate) && rate > 0) {
      return {
        priceBRL: Math.round(netPrice * rate * 1_000_000) / 1_000_000,
        exchangeRateUsed: rate,
      };
    }
    return { priceBRL: netPrice, exchangeRateUsed: null };
  }

  const rate = input.exchangeRateUsed;
  if (rate != null && Number.isFinite(rate) && rate > 0) {
    return {
      priceBRL: Math.round(netPrice * rate * 1_000_000) / 1_000_000,
      exchangeRateUsed: rate,
    };
  }

  return { priceBRL: netPrice, exchangeRateUsed: null };
}

export function mapMaterialMarketQuoteToPriceHistoryPoint(
  row: MaterialMarketQuoteSourceRow,
  exchangeRateUsed?: number | null
): MaterialMarketPriceHistoryPoint | null {
  if (row.status === "CANCELLED") return null;

  const netPrice = toNumber(row.netPrice);
  const currency = row.currency.trim().toUpperCase();
  const storedNetPriceBrl =
    row.netPriceBrl != null ? toNumber(row.netPriceBrl) : null;
  const storedPtax =
    row.ptaxVenda != null ? toNumber(row.ptaxVenda) : null;

  let priceBRL: number;
  let rate: number | null;

  if (storedNetPriceBrl != null && Number.isFinite(storedNetPriceBrl)) {
    priceBRL = storedNetPriceBrl;
    rate = currency === "BRL" ? null : storedPtax;
  } else {
    const converted = computeMaterialQuotePriceBRL({
      netPrice,
      currency,
      exchangeRateUsed: storedPtax ?? exchangeRateUsed,
    });
    priceBRL = converted.priceBRL;
    rate = converted.exchangeRateUsed;
  }

  const date = toIsoDateOnly(row.quoteDate);
  if (!date) return null;

  return {
    id: row.id,
    date,
    dateLabel: formatMaterialIntelligenceQuoteDate(date),
    supplierId: row.supplierId?.trim() || null,
    supplierKey:
      resolveSupplierKey({ supplierId: row.supplierId, supplierName: row.supplierName }) ??
      UNKNOWN_SUPPLIER_KEY,
    supplierName: row.supplierName?.trim() || null,
    originalCurrency: currency,
    originalPrice: netPrice,
    priceBRL,
    exchangeRateUsed: rate,
    notes: row.notes?.trim() || null,
  };
}

export function sortPriceHistoryPointsChronologically(
  points: MaterialMarketPriceHistoryPoint[]
): MaterialMarketPriceHistoryPoint[] {
  return [...points].sort((a, b) => {
    if (a.date !== b.date) return a.date.localeCompare(b.date);
    return a.id.localeCompare(b.id);
  });
}

/**
 * Escolhe, dentre os fornecedores com cotação no período, as até
 * MATERIAL_MARKET_PRICE_HISTORY_MAX_SUPPLIER_LINES linhas do gráfico.
 *
 * Regra: com 3 fornecedores ou menos, mostra todos (nada a escolher). Com
 * mais de 3, filtra primeiro por "cotação atualizada" (isStale=false, vindo
 * do ranking) e, dentre os atualizados, pega os de menor preço médio — a
 * MESMA ordenação de compareMaterialMarketSuppliersForRanking (ranking já
 * vem ordenado ascendente por averagePrice). Se sobrarem menos de 3
 * atualizados, mostra só esses — nunca completa com fornecedor desatualizado.
 */
export function buildMaterialMarketPriceHistorySupplierSeries(
  points: ReadonlyArray<MaterialMarketPriceHistoryPoint>,
  supplierRanking: ReadonlyArray<
    Pick<
      MaterialMarketSupplierComparisonRow,
      "supplierKey" | "supplierId" | "supplierName" | "averagePrice" | "isStale"
    >
  >,
  maxLines: number = MATERIAL_MARKET_PRICE_HISTORY_MAX_SUPPLIER_LINES
): { series: MaterialMarketPriceHistorySeries[]; totalSuppliers: number } {
  const keysInPeriod = new Set(points.map((p) => p.supplierKey));
  const eligible = supplierRanking.filter((s) => keysInPeriod.has(s.supplierKey));

  const selected =
    eligible.length > maxLines
      ? eligible.filter((s) => !s.isStale).slice(0, maxLines)
      : eligible;

  const pointsByKey = new Map<string, MaterialMarketPriceHistoryPoint[]>();
  for (const point of points) {
    const bucket = pointsByKey.get(point.supplierKey);
    if (bucket) bucket.push(point);
    else pointsByKey.set(point.supplierKey, [point]);
  }

  const series: MaterialMarketPriceHistorySeries[] = selected.map((s) => ({
    supplierKey: s.supplierKey,
    supplierId: s.supplierId,
    supplierName: s.supplierName,
    averagePrice: s.averagePrice,
    isStale: s.isStale,
    points: pointsByKey.get(s.supplierKey) ?? [],
  }));

  return { series, totalSuppliers: eligible.length };
}

export function buildMaterialMarketPriceHistoryResponse(input: {
  rows: MaterialMarketQuoteSourceRow[];
  range: MaterialMarketPriceHistoryPeriodRange;
  exchangeRatesByDate?: Map<string, number | null>;
  supplierRanking?: ReadonlyArray<
    Pick<
      MaterialMarketSupplierComparisonRow,
      "supplierKey" | "supplierId" | "supplierName" | "averagePrice" | "isStale"
    >
  >;
}): MaterialMarketPriceHistoryResponse {
  const rates = input.exchangeRatesByDate ?? new Map<string, number | null>();

  const points = sortPriceHistoryPointsChronologically(
    input.rows
      .filter((row) => isQuoteDateWithinRange(row.quoteDate, input.range))
      .map((row) => {
        const date = toIsoDateOnly(row.quoteDate);
        const currency = row.currency.trim().toUpperCase();
        const hasStoredBrl = row.netPriceBrl != null;
        const rate =
          !hasStoredBrl && currency === "USD"
            ? (rates.get(date) ?? null)
            : null;
        return mapMaterialMarketQuoteToPriceHistoryPoint(row, rate);
      })
      .filter((p): p is MaterialMarketPriceHistoryPoint => p != null)
  );

  const { series, totalSuppliers } = buildMaterialMarketPriceHistorySupplierSeries(
    points,
    input.supplierRanking ?? []
  );

  return {
    period: input.range,
    points,
    series,
    totalSuppliers,
    total: points.length,
  };
}

export function collectUsdQuoteDatesForPtax(
  rows: MaterialMarketQuoteSourceRow[],
  range: MaterialMarketPriceHistoryPeriodRange
): string[] {
  const dates = new Set<string>();
  for (const row of rows) {
    if (row.status === "CANCELLED") continue;
    if (row.netPriceBrl != null) continue;
    const currency = row.currency.trim().toUpperCase();
    if (currency !== "USD") continue;
    const date = toIsoDateOnly(row.quoteDate);
    if (!date || !isQuoteDateWithinRange(date, range)) continue;
    dates.add(date);
  }
  return [...dates].sort();
}
