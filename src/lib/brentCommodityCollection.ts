import type { CommoditySnapshot } from "@prisma/client";
import { prisma } from "@/src/lib/prisma.js";
import {
  calculateBrentVariationFromPrevious,
  fetchBrentQuoteFromYahoo,
  parseBrentQuoteDateIso,
} from "@/src/lib/brentCommodityService.js";

export const BRENT_COMMODITY_LOG_PREFIX = "[brent-commodity-collection]" as const;

export type BrentCollectionResult = {
  snapshot: CommoditySnapshot;
};

export type BrentSnapshotApiItem = {
  id: string;
  commodityType: string;
  priceUSD: number | null;
  quoteDate: string;
  collectedAt: string;
  source: string | null;
  status: string;
  errorMessage: string | null;
  variationFromPrevious: number | null;
};

export function serializeBrentSnapshotForApi(snapshot: CommoditySnapshot): BrentSnapshotApiItem {
  return {
    id: snapshot.id,
    commodityType: snapshot.commodityType,
    priceUSD: snapshot.priceUSD != null ? Number(snapshot.priceUSD) : null,
    quoteDate: snapshot.quoteDate.toISOString().slice(0, 10),
    collectedAt: snapshot.collectedAt.toISOString(),
    source: snapshot.source,
    status: snapshot.status,
    errorMessage: snapshot.errorMessage,
    variationFromPrevious:
      snapshot.variationFromPrevious != null ? Number(snapshot.variationFromPrevious) : null,
  };
}

export async function getPreviousSuccessfulBrentSnapshot(
  beforeCollectedAt: Date
): Promise<CommoditySnapshot | null> {
  return prisma.commoditySnapshot.findFirst({
    where: {
      commodityType: "BRENT",
      status: "SUCCESS",
      collectedAt: { lt: beforeCollectedAt },
    },
    orderBy: [{ collectedAt: "desc" }],
  });
}

export async function getLatestBrentSnapshot(): Promise<CommoditySnapshot | null> {
  const successful = await prisma.commoditySnapshot.findFirst({
    where: { commodityType: "BRENT", status: "SUCCESS" },
    orderBy: [{ quoteDate: "desc" }, { collectedAt: "desc" }],
  });
  if (successful) return successful;

  return prisma.commoditySnapshot.findFirst({
    where: { commodityType: "BRENT" },
    orderBy: [{ collectedAt: "desc" }],
  });
}

/** Coleta manual Brent — sempre append-only (nova linha por execução). */
export async function collectBrentCommoditySnapshot(input?: {
  fetchImpl?: typeof fetch;
  at?: Date;
}): Promise<BrentCollectionResult> {
  const collectedAt = input?.at ?? new Date();
  const fallbackQuoteDate = parseBrentQuoteDateIso(collectedAt.toISOString().slice(0, 10));

  console.info(`${BRENT_COMMODITY_LOG_PREFIX} start manual collectedAt=${collectedAt.toISOString()}`);

  try {
    const quote = await fetchBrentQuoteFromYahoo(input?.fetchImpl);
    const quoteDate = parseBrentQuoteDateIso(quote.quoteDate);
    const previous = await getPreviousSuccessfulBrentSnapshot(collectedAt);
    const variationFromPrevious =
      previous?.priceUSD != null
        ? calculateBrentVariationFromPrevious(quote.priceUSD, Number(previous.priceUSD))
        : null;

    const snapshot = await prisma.commoditySnapshot.create({
      data: {
        commodityType: "BRENT",
        priceUSD: quote.priceUSD,
        quoteDate,
        collectedAt,
        source: quote.source,
        status: "SUCCESS",
        variationFromPrevious,
      },
    });

    console.info(
      `${BRENT_COMMODITY_LOG_PREFIX} success id=${snapshot.id} priceUSD=${quote.priceUSD} variation=${variationFromPrevious ?? "n/a"}`
    );

    return { snapshot };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha ao coletar Brent.";
    console.error(`${BRENT_COMMODITY_LOG_PREFIX} failure:`, message);

    const snapshot = await prisma.commoditySnapshot.create({
      data: {
        commodityType: "BRENT",
        quoteDate: fallbackQuoteDate,
        collectedAt,
        status: "FAILED",
        errorMessage: message,
      },
    });

    console.info(`${BRENT_COMMODITY_LOG_PREFIX} saved FAILED id=${snapshot.id}`);
    return { snapshot };
  }
}
