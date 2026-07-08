/**
 * Economia potencial — compara preço oficial/atual vs. melhor cotação de mercado.
 *
 * Preço atual (baseline):
 * 1. `Material.currentCost` quando > 0 (custo oficial cadastrado);
 * 2. senão, preço líquido da cotação manual mais recente (qualquer status ativo no histórico).
 *
 * Melhor preço: menor `netPrice` em BRL entre cotações ACTIVE/DRAFT no período informado.
 */

import {
  filterMaterialMarketQuotesForAnalytics,
  parseMaterialMarketQuoteAnalyticsPeriod,
  resolveMaterialMarketQuoteAnalyticsDateRange,
  type MaterialMarketQuoteAnalyticsPeriod,
  MATERIAL_MARKET_QUOTE_ANALYTICS_PERIOD_LABELS,
} from "./materialMarketQuoteAnalytics.js";
import {
  sortMaterialMarketQuotesChronologically,
  type MaterialMarketQuoteSourceRow,
} from "./materialMarketQuote.js";

export const DEFAULT_MATERIAL_MARKET_SAVINGS_PERIOD: MaterialMarketQuoteAnalyticsPeriod = "90d";
export const DEFAULT_MATERIAL_MARKET_SAVINGS_RANKING_VOLUME = 1;

export const MATERIAL_MARKET_SAVINGS_NO_SAVINGS_MESSAGE = "Sem economia";
export const MATERIAL_MARKET_SAVINGS_NO_QUOTES_MESSAGE =
  "Nenhuma cotação no período para comparar.";
export const MATERIAL_MARKET_SAVINGS_NO_CURRENT_PRICE_MESSAGE =
  "Preço atual indisponível para calcular economia.";

export type MaterialMarketSavingsCurrentPriceSource = "currentCost" | "latestQuote";

export type MaterialMarketSavingsQuoteInput = {
  quoteDate: string | Date;
  netPrice: number | string | { toString(): string };
  currency?: string;
  status?: string;
  supplierName?: string | null;
};

export type MaterialMarketSavingsOpportunityInput = {
  materialId: string;
  unit: string;
  currentCost: number | string | { toString(): string };
  quotes: MaterialMarketSavingsQuoteInput[];
  estimatedVolume: number;
  period?: MaterialMarketQuoteAnalyticsPeriod;
  referenceDate?: Date;
};

export type MaterialMarketSavingsOpportunityResult = {
  empty: boolean;
  hasSavings: boolean;
  message: string | null;
  materialId: string;
  unit: string;
  estimatedVolume: number;
  period: MaterialMarketQuoteAnalyticsPeriod;
  periodLabel: string;
  currentPriceSource: MaterialMarketSavingsCurrentPriceSource | null;
  currentPrice: number | null;
  bestPrice: number | null;
  bestPriceDate: string | null;
  recommendedSupplier: string | null;
  unitSavings: number;
  totalSavings: number;
  savingsPercent: number | null;
};

export type MaterialMarketSavingsOpportunityRankItem = MaterialMarketSavingsOpportunityResult & {
  code: string;
  description: string;
  intelligencePath: string;
};

export type MaterialMarketSavingsOpportunitiesResponse = {
  defaultVolume: number;
  period: MaterialMarketQuoteAnalyticsPeriod;
  periodLabel: string;
  topOpportunity: MaterialMarketSavingsOpportunityRankItem | null;
  items: MaterialMarketSavingsOpportunityRankItem[];
};

const COMPARABLE_QUOTE_STATUSES = new Set(["ACTIVE", "DRAFT"]);

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

function toIsoDateOnly(value: Date | string): string {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

export function parseMaterialMarketSavingsVolume(
  value: unknown,
  fallback = DEFAULT_MATERIAL_MARKET_SAVINGS_RANKING_VOLUME
): number {
  if (value == null || value === "") return fallback;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return roundMoney(n);
}

function isComparableQuote(quote: MaterialMarketSavingsQuoteInput): boolean {
  if (quote.currency && quote.currency.toUpperCase() !== "BRL") return false;
  const status = quote.status?.toUpperCase() ?? "ACTIVE";
  return COMPARABLE_QUOTE_STATUSES.has(status);
}

function resolveCurrentPrice(input: {
  currentCost: number | string | { toString(): string };
  quotes: MaterialMarketSavingsQuoteInput[];
}): { price: number | null; source: MaterialMarketSavingsCurrentPriceSource | null } {
  const official = toNumber(input.currentCost);
  if (official > 0) {
    return { price: roundMoney(official), source: "currentCost" };
  }

  const sorted = sortMaterialMarketQuotesChronologically(
    input.quotes.map((q, index) => ({
      id: String(index),
      materialId: "",
      quoteDate: q.quoteDate,
      price: toNumber(q.netPrice),
      currency: q.currency ?? "BRL",
      unit: "",
      netPrice: q.netPrice,
      status: q.status ?? "ACTIVE",
      createdAt: q.quoteDate,
      updatedAt: q.quoteDate,
    }))
  );

  const latest = sorted.find((q) => isComparableQuote(q));
  if (!latest) {
    return { price: null, source: null };
  }

  return {
    price: roundMoney(toNumber(latest.netPrice)),
    source: "latestQuote",
  };
}

function findBestQuoteInPeriod(
  quotes: MaterialMarketSavingsQuoteInput[],
  range: { from: Date | null; to: Date | null }
): { price: number; quoteDate: string; supplierName: string | null } | null {
  const filtered = filterMaterialMarketQuotesForAnalytics(quotes, range).filter(isComparableQuote);
  if (filtered.length === 0) return null;

  let best: { price: number; quoteDate: string; supplierName: string | null } | null = null;

  for (const quote of filtered) {
    const price = roundMoney(toNumber(quote.netPrice));
    if (!best || price < best.price) {
      best = {
        price,
        quoteDate: toIsoDateOnly(quote.quoteDate),
        supplierName: quote.supplierName?.trim() || null,
      };
    }
  }

  return best;
}

export function computeMaterialMarketSavingsOpportunity(
  input: MaterialMarketSavingsOpportunityInput
): MaterialMarketSavingsOpportunityResult {
  const period = parseMaterialMarketQuoteAnalyticsPeriod(input.period, DEFAULT_MATERIAL_MARKET_SAVINGS_PERIOD);
  const periodLabel = MATERIAL_MARKET_QUOTE_ANALYTICS_PERIOD_LABELS[period];
  const estimatedVolume = parseMaterialMarketSavingsVolume(input.estimatedVolume);
  const range = resolveMaterialMarketQuoteAnalyticsDateRange({
    period,
    referenceDate: input.referenceDate,
  });

  const current = resolveCurrentPrice({
    currentCost: input.currentCost,
    quotes: input.quotes,
  });
  const best = findBestQuoteInPeriod(input.quotes, range);

  const base = {
    materialId: input.materialId,
    unit: input.unit,
    estimatedVolume,
    period,
    periodLabel,
    currentPriceSource: current.source,
    currentPrice: current.price,
    bestPrice: best?.price ?? null,
    bestPriceDate: best?.quoteDate ?? null,
    recommendedSupplier: best?.supplierName ?? null,
  };

  if (!best) {
    return {
      ...base,
      empty: true,
      hasSavings: false,
      message: MATERIAL_MARKET_SAVINGS_NO_QUOTES_MESSAGE,
      unitSavings: 0,
      totalSavings: 0,
      savingsPercent: null,
    };
  }

  if (current.price == null) {
    return {
      ...base,
      empty: true,
      hasSavings: false,
      message: MATERIAL_MARKET_SAVINGS_NO_CURRENT_PRICE_MESSAGE,
      unitSavings: 0,
      totalSavings: 0,
      savingsPercent: null,
    };
  }

  const rawUnitSavings = roundMoney(current.price - best.price);
  const hasSavings = rawUnitSavings > 0;
  const unitSavings = hasSavings ? rawUnitSavings : 0;
  const totalSavings = roundMoney(unitSavings * estimatedVolume);
  const savingsPercent =
    hasSavings && current.price > 0
      ? roundPercent((unitSavings / current.price) * 100)
      : null;

  return {
    ...base,
    empty: false,
    hasSavings,
    message: hasSavings ? null : MATERIAL_MARKET_SAVINGS_NO_SAVINGS_MESSAGE,
    unitSavings,
    totalSavings,
    savingsPercent,
  };
}

export function buildMaterialMarketSavingsOpportunityFromRows(input: {
  materialId: string;
  unit: string;
  currentCost: number | string | { toString(): string };
  quotes: MaterialMarketQuoteSourceRow[];
  estimatedVolume: number;
  period?: MaterialMarketQuoteAnalyticsPeriod;
  referenceDate?: Date;
}): MaterialMarketSavingsOpportunityResult {
  return computeMaterialMarketSavingsOpportunity({
    materialId: input.materialId,
    unit: input.unit,
    currentCost: input.currentCost,
    estimatedVolume: input.estimatedVolume,
    period: input.period,
    referenceDate: input.referenceDate,
    quotes: input.quotes.map((q) => ({
      quoteDate: q.quoteDate,
      netPrice: q.netPrice,
      currency: q.currency,
      status: q.status,
      supplierName: q.supplierName,
    })),
  });
}

export function rankMaterialMarketSavingsOpportunities(input: {
  materials: Array<{
    id: string;
    code: string;
    description: string;
    unit: string;
    currentCost: number | string | { toString(): string };
    quotes: MaterialMarketQuoteSourceRow[];
    intelligencePath: string;
  }>;
  estimatedVolume?: number;
  period?: MaterialMarketQuoteAnalyticsPeriod;
  referenceDate?: Date;
}): MaterialMarketSavingsOpportunitiesResponse {
  const defaultVolume = parseMaterialMarketSavingsVolume(input.estimatedVolume);
  const period = parseMaterialMarketQuoteAnalyticsPeriod(input.period, DEFAULT_MATERIAL_MARKET_SAVINGS_PERIOD);
  const periodLabel = MATERIAL_MARKET_QUOTE_ANALYTICS_PERIOD_LABELS[period];

  const items = input.materials
    .map((material) => {
      const savings = buildMaterialMarketSavingsOpportunityFromRows({
        materialId: material.id,
        unit: material.unit,
        currentCost: material.currentCost,
        quotes: material.quotes,
        estimatedVolume: defaultVolume,
        period,
        referenceDate: input.referenceDate,
      });
      return {
        ...savings,
        code: material.code,
        description: material.description,
        intelligencePath: material.intelligencePath,
      };
    })
    .filter((item) => !item.empty && item.hasSavings)
    .sort((a, b) => {
      if (b.totalSavings !== a.totalSavings) return b.totalSavings - a.totalSavings;
      return (b.savingsPercent ?? 0) - (a.savingsPercent ?? 0);
    });

  return {
    defaultVolume,
    period,
    periodLabel,
    topOpportunity: items[0] ?? null,
    items,
  };
}
