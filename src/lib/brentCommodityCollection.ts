import type {
  CommodityCollectionSlot,
  CommodityCollectionTrigger,
  CommoditySnapshot,
} from "@prisma/client";
import { prisma } from "./prisma.js";
import {
  calculateBrentVariationFromPrevious,
  fetchBrentQuoteFromYahoo,
  parseBrentQuoteDateIso,
} from "@/src/lib/brentCommodityService.js";
import {
  getSaoPauloDateTimeParts,
  resolveBrentCollectionSlot,
} from "@/src/lib/brentCommoditySchedule.js";

export const BRENT_COMMODITY_LOG_PREFIX = "[brent-commodity-collection]" as const;

export type BrentCollectionOutcome =
  | {
      action: "created";
      snapshot: CommoditySnapshot;
      slot: CommodityCollectionSlot;
      quoteDate: string;
    }
  | {
      action: "skipped";
      reason: string;
      slot: CommodityCollectionSlot;
      quoteDate: string;
      existingSnapshotId: string;
    };

export type BrentCollectionInput = {
  trigger: CommodityCollectionTrigger;
  at?: Date;
  fetchImpl?: typeof fetch;
};

export type BrentSnapshotApiItem = {
  id: string;
  commodityType: string;
  priceUSD: number | null;
  quoteDate: string;
  scheduledSlot: CommodityCollectionSlot;
  collectedAt: string;
  source: string | null;
  status: string;
  errorMessage: string | null;
  variationFromPrevious: number | null;
  trigger: CommodityCollectionTrigger;
};

export function buildBrentDedupKey(input: {
  quoteDate: string;
  slot: CommodityCollectionSlot;
}): string {
  return `BRENT:${input.quoteDate}:${input.slot}`;
}

export function serializeBrentSnapshotForApi(snapshot: CommoditySnapshot): BrentSnapshotApiItem {
  return {
    id: snapshot.id,
    commodityType: snapshot.commodityType,
    priceUSD: snapshot.priceUSD != null ? Number(snapshot.priceUSD) : null,
    quoteDate: snapshot.quoteDate.toISOString().slice(0, 10),
    scheduledSlot: snapshot.scheduledSlot,
    collectedAt: snapshot.collectedAt.toISOString(),
    source: snapshot.source,
    status: snapshot.status,
    errorMessage: snapshot.errorMessage,
    variationFromPrevious:
      snapshot.variationFromPrevious != null ? Number(snapshot.variationFromPrevious) : null,
    trigger: snapshot.trigger,
  };
}

export async function findSuccessfulBrentSnapshotForSlot(input: {
  quoteDate: Date;
  slot: CommodityCollectionSlot;
}): Promise<CommoditySnapshot | null> {
  return prisma.commoditySnapshot.findFirst({
    where: {
      commodityType: "BRENT",
      quoteDate: input.quoteDate,
      scheduledSlot: input.slot,
      status: "SUCCESS",
    },
    orderBy: { collectedAt: "desc" },
  });
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

export async function collectBrentCommoditySnapshot(
  input: BrentCollectionInput
): Promise<BrentCollectionOutcome> {
  const collectedAt = input.at ?? new Date();
  const parts = getSaoPauloDateTimeParts(collectedAt);
  const slot = resolveBrentCollectionSlot(parts);
  const quoteDate = parseBrentQuoteDateIso(parts.dateIso);

  const existing = await findSuccessfulBrentSnapshotForSlot({ quoteDate, slot });
  if (existing) {
    const reason = `Coleta já realizada com sucesso para ${parts.dateIso} (${slot}).`;
    console.info(
      `${BRENT_COMMODITY_LOG_PREFIX} skip trigger=${input.trigger} slot=${slot} quoteDate=${parts.dateIso} existing=${existing.id}`
    );
    return {
      action: "skipped",
      reason,
      slot,
      quoteDate: parts.dateIso,
      existingSnapshotId: existing.id,
    };
  }

  console.info(
    `${BRENT_COMMODITY_LOG_PREFIX} start trigger=${input.trigger} slot=${slot} quoteDate=${parts.dateIso}`
  );

  try {
    const quote = await fetchBrentQuoteFromYahoo(input.fetchImpl);
    const resolvedQuoteDate = parseBrentQuoteDateIso(quote.quoteDate);
    const previous = await getPreviousSuccessfulBrentSnapshot(collectedAt);
    const variationFromPrevious =
      previous?.priceUSD != null
        ? calculateBrentVariationFromPrevious(quote.priceUSD, Number(previous.priceUSD))
        : null;

    const snapshot = await prisma.commoditySnapshot.create({
      data: {
        commodityType: "BRENT",
        priceUSD: quote.priceUSD,
        quoteDate: resolvedQuoteDate,
        scheduledSlot: slot,
        collectedAt,
        source: quote.source,
        status: "SUCCESS",
        variationFromPrevious,
        trigger: input.trigger,
      },
    });

    console.info(
      `${BRENT_COMMODITY_LOG_PREFIX} success id=${snapshot.id} slot=${slot} priceUSD=${quote.priceUSD} variation=${variationFromPrevious ?? "n/a"}`
    );

    return {
      action: "created",
      snapshot,
      slot,
      quoteDate: parts.dateIso,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha ao coletar Brent.";
    console.error(`${BRENT_COMMODITY_LOG_PREFIX} failure slot=${slot} quoteDate=${parts.dateIso}:`, message);

    const snapshot = await prisma.commoditySnapshot.create({
      data: {
        commodityType: "BRENT",
        quoteDate,
        scheduledSlot: slot,
        collectedAt,
        status: "FAILED",
        errorMessage: message,
        trigger: input.trigger,
      },
    });

    console.info(`${BRENT_COMMODITY_LOG_PREFIX} saved FAILED id=${snapshot.id}`);
    return {
      action: "created",
      snapshot,
      slot,
      quoteDate: parts.dateIso,
    };
  }
}
