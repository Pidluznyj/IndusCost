import type { CommoditySnapshot, PtaxSnapshot } from "@prisma/client";
import { prisma } from "@/src/lib/prisma.js";
import { calculatePercentageChange } from "@/src/lib/financeExecutiveReportUtils.js";
import { BRENT_DEFAULT_SOURCE } from "@/src/lib/brentCommodityService.js";

export const MARKET_GLOBAL_INDICATORS_API =
  "/api/market-intelligence/global-indicators" as const;

export const PTAX_DEFAULT_SOURCE_LABEL = "BCB PTAX" as const;

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

function toNumber(value: { toString(): string } | number | null | undefined): number | null {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
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
  const labels = new Set<string>();
  if (input.ptaxSource?.trim()) labels.add(input.ptaxSource.trim());
  if (input.brentSource?.trim()) labels.add(input.brentSource.trim());
  if (labels.size === 0) return null;
  return [...labels].join(" · ");
}

export function mapPtaxSnapshotToIndicator(
  snapshot: PtaxSnapshot | null
): MarketGlobalIndicatorsPtaxDto | null {
  if (!snapshot || snapshot.status !== "SUCCESS") return null;
  const sellRate = toNumber(snapshot.sellRate);
  const buyRate = toNumber(snapshot.buyRate);
  if (sellRate == null || buyRate == null) return null;
  return {
    sellRate,
    buyRate,
    source: snapshot.source?.trim() || PTAX_DEFAULT_SOURCE_LABEL,
    lastUpdate: snapshot.collectedAt.toISOString(),
  };
}

export function mapBrentSnapshotsToIndicator(input: {
  latest: CommoditySnapshot | null;
  previous: CommoditySnapshot | null;
}): MarketGlobalIndicatorsBrentDto | null {
  const { latest, previous } = input;
  if (!latest || latest.status !== "SUCCESS") return null;
  const price = toNumber(latest.price);
  if (price == null) return null;

  const previousPrice = previous?.status === "SUCCESS" ? toNumber(previous.price) : null;
  const variationFromPrevious = calculatePercentageChange(price, previousPrice);

  return {
    price,
    currency: latest.currency?.trim() || "USD",
    unit: latest.unit?.trim() || "barrel",
    variationFromPrevious,
    source: formatBrentSourceLabel(latest.source),
    lastUpdate: latest.collectedAt.toISOString(),
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
  ptax: PtaxSnapshot | null;
  brentLatest: CommoditySnapshot | null;
  brentPrevious: CommoditySnapshot | null;
}): MarketGlobalIndicatorsDto {
  const ptax = mapPtaxSnapshotToIndicator(input.ptax);
  const brent = mapBrentSnapshotsToIndicator({
    latest: input.brentLatest,
    previous: input.brentPrevious,
  });
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

export async function loadMarketGlobalIndicators(): Promise<MarketGlobalIndicatorsDto> {
  const [ptax, brentSnapshots] = await Promise.all([
    prisma.ptaxSnapshot.findFirst({
      where: { status: "SUCCESS" },
      orderBy: [{ quoteDate: "desc" }, { collectedAt: "desc" }],
    }),
    prisma.commoditySnapshot.findMany({
      where: { commodityType: "BRENT", status: "SUCCESS" },
      orderBy: [{ quoteDate: "desc" }, { collectedAt: "desc" }],
      take: 2,
    }),
  ]);

  return mapMarketGlobalIndicators({
    ptax,
    brentLatest: brentSnapshots[0] ?? null,
    brentPrevious: brentSnapshots[1] ?? null,
  });
}
