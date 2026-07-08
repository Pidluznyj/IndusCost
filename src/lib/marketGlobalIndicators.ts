/**
 * Indicadores globais de mercado (PTAX + Brent) para a Home de Inteligência de Mercado.
 * Mapeamento puro a partir de snapshots já persistidos — sem chamadas externas.
 */

import { BRENT_DEFAULT_SOURCE } from "@/src/lib/brentCommodityService.js";

export const MARKET_GLOBAL_INDICATORS_API =
  "/api/market-intelligence/global-indicators" as const;

export const PTAX_DEFAULT_SOURCE_LABEL = "BCB PTAX" as const;
export const BRENT_DISPLAY_UNIT = "barril" as const;

const BRENT_SOURCE_LABELS: Record<string, string> = {
  [BRENT_DEFAULT_SOURCE]: "Yahoo Finance",
};

export type MarketGlobalIndicatorsPtaxDto = {
  sellRate: number;
  buyRate: number;
  source: string;
  lastUpdate: string;
};

export type MarketGlobalIndicatorsBrentDto = {
  price: number;
  currency: string;
  unit: string;
  variationFromPrevious: number | null;
  source: string;
  lastUpdate: string;
};

export type MarketGlobalIndicatorsDto = {
  ptax: MarketGlobalIndicatorsPtaxDto | null;
  brent: MarketGlobalIndicatorsBrentDto | null;
  lastUpdate: string | null;
  sourcesLabel: string | null;
  hasData: boolean;
};

export type MarketGlobalPtaxSourceRow = {
  status: string;
  sellRate: number | string | null | { toString(): string };
  buyRate: number | string | null | { toString(): string };
  source?: string | null;
  collectedAt: Date | string;
};

export type MarketGlobalBrentSourceRow = {
  status: string;
  priceUSD: number | string | null | { toString(): string };
  source?: string | null;
  collectedAt: Date | string;
  variationFromPrevious?: number | string | null | { toString(): string };
};

function toNumber(value: { toString(): string } | number | string | null | undefined): number | null {
  if (value == null) return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

export function formatBrentSourceLabel(source: string | null | undefined): string {
  const key = source?.trim();
  if (!key) return "Yahoo Finance";
  return BRENT_SOURCE_LABELS[key] ?? key;
}

export function buildMarketGlobalIndicatorsSourcesLabel(input: {
  ptaxSource: string | null;
  brentSource: string | null;
}): string | null {
  const labels: string[] = [];
  if (input.ptaxSource?.trim()) labels.push(input.ptaxSource.trim());
  if (input.brentSource?.trim()) labels.push(input.brentSource.trim());
  if (labels.length === 0) return null;
  return labels.join(" · ");
}

export function mapPtaxSnapshotToIndicator(
  snapshot: MarketGlobalPtaxSourceRow | null
): MarketGlobalIndicatorsPtaxDto | null {
  if (!snapshot || snapshot.status !== "SUCCESS") return null;
  const sellRate = toNumber(snapshot.sellRate);
  const buyRate = toNumber(snapshot.buyRate);
  if (sellRate == null || buyRate == null) return null;
  return {
    sellRate,
    buyRate,
    source: snapshot.source?.trim() || PTAX_DEFAULT_SOURCE_LABEL,
    lastUpdate: toIso(snapshot.collectedAt),
  };
}

export function mapBrentSnapshotToIndicator(
  snapshot: MarketGlobalBrentSourceRow | null
): MarketGlobalIndicatorsBrentDto | null {
  if (!snapshot || snapshot.status !== "SUCCESS") return null;
  const price = toNumber(snapshot.priceUSD);
  if (price == null) return null;

  return {
    price,
    currency: "USD",
    unit: BRENT_DISPLAY_UNIT,
    variationFromPrevious: toNumber(snapshot.variationFromPrevious),
    source: formatBrentSourceLabel(snapshot.source),
    lastUpdate: toIso(snapshot.collectedAt),
  };
}

export function resolveMarketGlobalIndicatorsLastUpdate(
  ptax: MarketGlobalIndicatorsPtaxDto | null,
  brent: MarketGlobalIndicatorsBrentDto | null
): string | null {
  const timestamps = [ptax?.lastUpdate, brent?.lastUpdate].filter(
    (value): value is string => Boolean(value)
  );
  if (timestamps.length === 0) return null;
  return timestamps.sort((a, b) => b.localeCompare(a))[0] ?? null;
}

export function mapMarketGlobalIndicators(input: {
  ptax: MarketGlobalPtaxSourceRow | null;
  brent: MarketGlobalBrentSourceRow | null;
}): MarketGlobalIndicatorsDto {
  const ptax = mapPtaxSnapshotToIndicator(input.ptax);
  const brent = mapBrentSnapshotToIndicator(input.brent);
  const lastUpdate = resolveMarketGlobalIndicatorsLastUpdate(ptax, brent);
  const sourcesLabel = buildMarketGlobalIndicatorsSourcesLabel({
    ptaxSource: ptax?.source ?? null,
    brentSource: brent?.source ?? null,
  });

  return {
    ptax,
    brent,
    lastUpdate,
    sourcesLabel,
    hasData: ptax != null || brent != null,
  };
}
