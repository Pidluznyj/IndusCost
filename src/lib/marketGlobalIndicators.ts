/**
 * Indicadores globais de mercado (PTAX + Brent) para a Home de Inteligência de Mercado.
 * Mapeamento puro a partir de snapshots já persistidos — sem chamadas externas.
 */

import { BRENT_DEFAULT_SOURCE } from "@/src/lib/brentCommodityService.js";

export const MARKET_GLOBAL_INDICATORS_API =
  "/api/market-intelligence/global-indicators" as const;

export const MARKET_GLOBAL_INDICATORS_REFRESH_API =
  "/api/market-intelligence/global-indicators/refresh" as const;

export const PTAX_DEFAULT_SOURCE_LABEL = "BCB PTAX" as const;
export const BRENT_DISPLAY_UNIT = "barril" as const;

const BRENT_SOURCE_LABELS: Record<string, string> = {
  [BRENT_DEFAULT_SOURCE]: "Yahoo Finance",
};

export type MarketGlobalIndicatorsPtaxDto = {
  sellRate: number;
  buyRate: number;
  quoteDate: string;
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

export type MarketGlobalIndicatorsRefreshPartResult =
  | { ok: true; action: "created" | "skipped"; quoteDate?: string; reason?: string }
  | { ok: false; error: string };

export type MarketGlobalIndicatorsRefreshResponse = {
  brent: MarketGlobalIndicatorsRefreshPartResult;
  ptax: MarketGlobalIndicatorsRefreshPartResult;
  indicators: MarketGlobalIndicatorsDto;
};

type CollectionSnapshotLike = {
  status: string;
  errorMessage?: string | null;
};

type CollectionOutcomeLike =
  | { action: "skipped"; quoteDate: string; reason: string }
  | { action: "created"; quoteDate: string; snapshot: CollectionSnapshotLike }
  | { error: string };

export function mapCollectionOutcomeToRefreshPart(
  outcome: CollectionOutcomeLike
): MarketGlobalIndicatorsRefreshPartResult {
  if ("error" in outcome) return { ok: false, error: outcome.error };
  if (outcome.action === "skipped") {
    return {
      ok: true,
      action: "skipped",
      quoteDate: outcome.quoteDate,
      reason: outcome.reason,
    };
  }
  if (outcome.snapshot.status === "SUCCESS") {
    return { ok: true, action: "created", quoteDate: outcome.quoteDate };
  }
  return {
    ok: false,
    error: outcome.snapshot.errorMessage ?? "Coleta sem sucesso.",
  };
}

export type MarketGlobalPtaxSourceRow = {
  status: string;
  sellRate: number | string | null | { toString(): string };
  buyRate: number | string | null | { toString(): string };
  quoteDate?: Date | string;
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

function toQuoteDateIso(value: Date | string | null | undefined): string | null {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const trimmed = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) return trimmed.slice(0, 10);
  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

export function mapPtaxSnapshotToIndicator(
  snapshot: MarketGlobalPtaxSourceRow | null
): MarketGlobalIndicatorsPtaxDto | null {
  if (!snapshot || snapshot.status !== "SUCCESS") return null;
  const sellRate = toNumber(snapshot.sellRate);
  const buyRate = toNumber(snapshot.buyRate);
  const quoteDate = toQuoteDateIso(snapshot.quoteDate);
  if (sellRate == null || buyRate == null || quoteDate == null) return null;
  return {
    sellRate,
    buyRate,
    quoteDate,
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
