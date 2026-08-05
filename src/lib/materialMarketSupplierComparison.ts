/**
 * Comparação de fornecedores por matéria-prima — Inteligência de Mercado 360º.
 * Ordenação padrão: menor preço médio (averagePrice), desempate por menor último preço (lastPrice).
 */

export const MATERIAL_MARKET_SUPPLIER_PERIOD_VALUES = ["30d", "90d", "6m", "12m", "all"] as const;

export type MaterialMarketSupplierPeriod = (typeof MATERIAL_MARKET_SUPPLIER_PERIOD_VALUES)[number];

export const DEFAULT_MATERIAL_MARKET_SUPPLIER_PERIOD: MaterialMarketSupplierPeriod = "90d";

export const DEFAULT_MATERIAL_MARKET_SUPPLIER_STALE_DAYS = 90;

export const MATERIAL_MARKET_SUPPLIER_PERIOD_LABELS: Record<MaterialMarketSupplierPeriod, string> = {
  "30d": "30 dias",
  "90d": "90 dias",
  "6m": "6 meses",
  "12m": "12 meses",
  all: "Todo o período",
};

export type MaterialMarketSupplierQuoteInput = {
  id: string;
  supplierId?: string | null;
  supplierName?: string | null;
  quoteDate: string | Date;
  netPrice: number;
  paymentTerms?: string | null;
  notes?: string | null;
};

export type MaterialMarketSupplierComparisonRow = {
  rank: number;
  supplierKey: string;
  supplierId: string | null;
  supplierName: string;
  lastPrice: number;
  averagePrice: number;
  minPrice: number;
  maxPrice: number;
  quoteCount: number;
  bestPriceCount: number;
  bestPriceFrequency: number;
  periodVariation: number | null;
  averagePaymentTerms: string | null;
  mostCommonCommercialCondition: string | null;
  lastQuoteDate: string;
  isStale: boolean;
};

export type MaterialMarketSupplierComparisonResponse = {
  period: MaterialMarketSupplierPeriod;
  periodLabel: string;
  periodStartDate: string | null;
  periodEndDate: string;
  staleDays: number;
  items: MaterialMarketSupplierComparisonRow[];
  total: number;
};

function toIsoDateOnly(value: Date | string): string {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

function roundMoney(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function roundPercent(value: number): number {
  return Math.round(value * 10) / 10;
}

export function isMaterialMarketSupplierPeriod(value: unknown): value is MaterialMarketSupplierPeriod {
  return (
    typeof value === "string" &&
    (MATERIAL_MARKET_SUPPLIER_PERIOD_VALUES as readonly string[]).includes(value)
  );
}

export function parseMaterialMarketSupplierPeriod(value: unknown): MaterialMarketSupplierPeriod {
  return isMaterialMarketSupplierPeriod(value)
    ? value
    : DEFAULT_MATERIAL_MARKET_SUPPLIER_PERIOD;
}

export function resolveMaterialMarketSupplierPeriodBounds(
  period: MaterialMarketSupplierPeriod,
  referenceDate: Date = new Date()
): { startDate: Date | null; endDate: Date } {
  const endDate = new Date(referenceDate);
  endDate.setHours(23, 59, 59, 999);

  if (period === "all") {
    return { startDate: null, endDate };
  }

  const startDate = new Date(referenceDate);
  startDate.setHours(0, 0, 0, 0);

  switch (period) {
    case "30d":
      startDate.setDate(startDate.getDate() - 30);
      break;
    case "90d":
      startDate.setDate(startDate.getDate() - 90);
      break;
    case "6m":
      startDate.setMonth(startDate.getMonth() - 6);
      break;
    case "12m":
      startDate.setMonth(startDate.getMonth() - 12);
      break;
    default:
      break;
  }

  return { startDate, endDate };
}

function hasSupplierIdentity(quote: MaterialMarketSupplierQuoteInput): boolean {
  return Boolean(quote.supplierId?.trim() || quote.supplierName?.trim());
}

/** Exportado para uso fora deste arquivo (ex.: agrupar séries por fornecedor no histórico de preços) — mesma convenção de chave em todo o módulo. */
export function resolveSupplierKey(
  quote: Pick<MaterialMarketSupplierQuoteInput, "supplierId" | "supplierName">
): string | null {
  const supplierId = quote.supplierId?.trim();
  if (supplierId) return `id:${supplierId}`;
  const supplierName = quote.supplierName?.trim();
  if (supplierName) return `name:${supplierName.toLowerCase()}`;
  return null;
}

function resolveSupplierName(
  quote: MaterialMarketSupplierQuoteInput,
  supplierNameById?: ReadonlyMap<string, string>
): string {
  const name = quote.supplierName?.trim();
  if (name) return name;
  const supplierId = quote.supplierId?.trim();
  if (supplierId) {
    const resolved = supplierNameById?.get(supplierId)?.trim();
    if (resolved) return resolved;
    return `Fornecedor ${supplierId.slice(0, 8)}`;
  }
  return "Fornecedor desconhecido";
}

function modeString(values: Array<string | null | undefined>): string | null {
  const counts = new Map<string, number>();
  for (const value of values) {
    const trimmed = value?.trim();
    if (!trimmed) continue;
    counts.set(trimmed, (counts.get(trimmed) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestCount = 0;
  for (const [key, count] of counts) {
    if (count > bestCount) {
      best = key;
      bestCount = count;
    }
  }
  return best;
}

function parsePaymentTermsDays(value: string): number | null {
  const numbers = value.match(/\d+/g);
  if (!numbers?.length) return null;
  const days = numbers
    .map((n) => Number(n))
    .filter((n) => Number.isFinite(n) && n > 0);
  if (!days.length) return null;
  return days.reduce((sum, n) => sum + n, 0) / days.length;
}

function resolveAveragePaymentTerms(
  quotes: MaterialMarketSupplierQuoteInput[]
): string | null {
  const parsedDays = quotes
    .map((q) => (q.paymentTerms ? parsePaymentTermsDays(q.paymentTerms) : null))
    .filter((n): n is number => n != null);
  if (parsedDays.length) {
    const avg = parsedDays.reduce((sum, n) => sum + n, 0) / parsedDays.length;
    return `${Math.round(avg)} dias (média)`;
  }
  return modeString(quotes.map((q) => q.paymentTerms));
}

function resolveMostCommonCommercialCondition(
  quotes: MaterialMarketSupplierQuoteInput[]
): string | null {
  return (
    modeString(quotes.map((q) => q.paymentTerms)) ??
    modeString(quotes.map((q) => q.notes))
  );
}

function isQuoteInPeriod(
  quoteDate: string,
  bounds: { startDate: Date | null; endDate: Date }
): boolean {
  const date = new Date(quoteDate);
  if (Number.isNaN(date.getTime())) return false;
  if (bounds.startDate && date < bounds.startDate) return false;
  if (date > bounds.endDate) return false;
  return true;
}

function computeBestPriceCounts(
  quotes: Array<{ supplierKey: string; quoteDate: string; netPrice: number }>
): Map<string, number> {
  const byDate = new Map<string, Array<{ supplierKey: string; netPrice: number }>>();
  for (const quote of quotes) {
    const bucket = byDate.get(quote.quoteDate) ?? [];
    bucket.push({ supplierKey: quote.supplierKey, netPrice: quote.netPrice });
    byDate.set(quote.quoteDate, bucket);
  }

  const counts = new Map<string, number>();
  for (const dayQuotes of byDate.values()) {
    const minPrice = Math.min(...dayQuotes.map((q) => q.netPrice));
    for (const quote of dayQuotes) {
      if (Math.abs(quote.netPrice - minPrice) < 0.000001) {
        counts.set(quote.supplierKey, (counts.get(quote.supplierKey) ?? 0) + 1);
      }
    }
  }
  return counts;
}

function computePeriodVariation(
  quotes: Array<{ quoteDate: string; netPrice: number }>
): number | null {
  if (quotes.length < 2) return null;
  const sorted = [...quotes].sort((a, b) => a.quoteDate.localeCompare(b.quoteDate));
  const first = sorted[0]?.netPrice;
  const last = sorted[sorted.length - 1]?.netPrice;
  if (first == null || last == null || first === 0) return null;
  return roundPercent(((last - first) / first) * 100);
}

function isStaleQuote(lastQuoteDate: string, referenceDate: Date, staleDays: number): boolean {
  const last = new Date(lastQuoteDate);
  if (Number.isNaN(last.getTime())) return true;
  const cutoff = new Date(referenceDate);
  cutoff.setHours(0, 0, 0, 0);
  cutoff.setDate(cutoff.getDate() - staleDays);
  return last < cutoff;
}

export function compareMaterialMarketSuppliersForRanking(
  a: Pick<MaterialMarketSupplierComparisonRow, "averagePrice" | "lastPrice" | "supplierName">,
  b: Pick<MaterialMarketSupplierComparisonRow, "averagePrice" | "lastPrice" | "supplierName">
): number {
  if (a.averagePrice !== b.averagePrice) return a.averagePrice - b.averagePrice;
  if (a.lastPrice !== b.lastPrice) return a.lastPrice - b.lastPrice;
  return a.supplierName.localeCompare(b.supplierName, "pt-BR");
}

export function buildMaterialMarketSupplierComparison(
  quotes: MaterialMarketSupplierQuoteInput[],
  options: {
    period?: MaterialMarketSupplierPeriod;
    referenceDate?: Date;
    staleDays?: number;
    supplierNameById?: ReadonlyMap<string, string>;
  } = {}
): MaterialMarketSupplierComparisonResponse {
  const period = options.period ?? DEFAULT_MATERIAL_MARKET_SUPPLIER_PERIOD;
  const referenceDate = options.referenceDate ?? new Date();
  const staleDays = options.staleDays ?? DEFAULT_MATERIAL_MARKET_SUPPLIER_STALE_DAYS;
  const bounds = resolveMaterialMarketSupplierPeriodBounds(period, referenceDate);

  const periodQuotes = quotes
    .filter(hasSupplierIdentity)
    .map((quote) => ({
      ...quote,
      supplierKey: resolveSupplierKey(quote),
      quoteDate: toIsoDateOnly(quote.quoteDate),
      netPrice: roundMoney(quote.netPrice),
    }))
    .filter(
      (quote): quote is typeof quote & { supplierKey: string } =>
        Boolean(quote.supplierKey) && isQuoteInPeriod(quote.quoteDate, bounds)
    );

  const bestPriceCounts = computeBestPriceCounts(periodQuotes);

  const grouped = new Map<
    string,
    {
      supplierId: string | null;
      supplierName: string;
      quotes: Array<{ quoteDate: string; netPrice: number }>;
      rawQuotes: MaterialMarketSupplierQuoteInput[];
    }
  >();

  for (const quote of periodQuotes) {
    const existing = grouped.get(quote.supplierKey);
    const supplierName = resolveSupplierName(quote, options.supplierNameById);
    const entry = {
      quoteDate: quote.quoteDate,
      netPrice: quote.netPrice,
    };
    if (existing) {
      existing.quotes.push(entry);
      existing.rawQuotes.push(quote);
      if (!existing.supplierName && supplierName) existing.supplierName = supplierName;
    } else {
      grouped.set(quote.supplierKey, {
        supplierId: quote.supplierId?.trim() || null,
        supplierName,
        quotes: [entry],
        rawQuotes: [quote],
      });
    }
  }

  const items: MaterialMarketSupplierComparisonRow[] = [...grouped.entries()].map(
    ([supplierKey, group]) => {
      const sortedQuotes = [...group.quotes].sort((a, b) => b.quoteDate.localeCompare(a.quoteDate));
      const prices = group.quotes.map((q) => q.netPrice);
      const averagePrice = roundMoney(
        prices.reduce((sum, price) => sum + price, 0) / prices.length
      );
      const lastQuote = sortedQuotes[0];
      const bestPriceCount = bestPriceCounts.get(supplierKey) ?? 0;
      const bestPriceFrequency =
        group.quotes.length > 0
          ? roundPercent((bestPriceCount / group.quotes.length) * 100)
          : 0;

      return {
        rank: 0,
        supplierKey,
        supplierId: group.supplierId,
        supplierName: group.supplierName,
        lastPrice: lastQuote?.netPrice ?? 0,
        averagePrice,
        minPrice: Math.min(...prices),
        maxPrice: Math.max(...prices),
        quoteCount: group.quotes.length,
        bestPriceCount,
        bestPriceFrequency,
        periodVariation: computePeriodVariation(group.quotes),
        averagePaymentTerms: resolveAveragePaymentTerms(group.rawQuotes),
        mostCommonCommercialCondition: resolveMostCommonCommercialCondition(group.rawQuotes),
        lastQuoteDate: lastQuote?.quoteDate ?? "",
        isStale: lastQuote
          ? isStaleQuote(lastQuote.quoteDate, referenceDate, staleDays)
          : true,
      };
    }
  );

  items.sort(compareMaterialMarketSuppliersForRanking);
  items.forEach((item, index) => {
    item.rank = index + 1;
  });

  return {
    period,
    periodLabel: MATERIAL_MARKET_SUPPLIER_PERIOD_LABELS[period],
    periodStartDate: bounds.startDate ? toIsoDateOnly(bounds.startDate) : null,
    periodEndDate: toIsoDateOnly(bounds.endDate),
    staleDays,
    items,
    total: items.length,
  };
}
