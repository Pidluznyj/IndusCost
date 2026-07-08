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
} from "./brentCommodityService.js";
import {
  BRENT_COMMODITY_LOG_PREFIX,
  getSaoPauloDateTimeParts,
  resolveBrentCollectionSlot,
} from "./brentCommodityJob.js";

export { BRENT_COMMODITY_LOG_PREFIX };

export type BrentCollectionOutcome =
  | { action: "created"; snapshot: CommoditySnapshot; slot: CommodityCollectionSlot; quoteDate: string }
  | {
      action: "skipped";
      reason: string;
      slot: CommodityCollectionSlot;
      quoteDate: string;
      existingSnapshotId: string;
    };

export function buildBrentDedupKey(input: {
  quoteDate: string;
  slot: CommodityCollectionSlot;
}): string {
  return `BRENT:${input.quoteDate}:${input.slot}`;
}

export function serializeBrentSnapshotForApi(snapshot: CommoditySnapshot) {
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

export async function getLatestBrentSnapshot(): Promise<CommoditySnapshot | null> {
  return (
    (await prisma.commoditySnapshot.findFirst({
      where: { commodityType: "BRENT", status: "SUCCESS" },
      orderBy: [{ quoteDate: "desc" }, { collectedAt: "desc" }],
    })) ??
    (await prisma.commoditySnapshot.findFirst({
      where: { commodityType: "BRENT" },
      orderBy: [{ collectedAt: "desc" }],
    }))
  );
}

export async function collectBrentCommoditySnapshot(input: {
  trigger: CommodityCollectionTrigger;
  at?: Date;
  fetchImpl?: typeof fetch;
}): Promise<BrentCollectionOutcome> {
  const collectedAt = input.at ?? new Date();
  const parts = getSaoPauloDateTimeParts(collectedAt);
  const slot = resolveBrentCollectionSlot(parts);
  const quoteDate = parseBrentQuoteDateIso(parts.dateIso);

  const existing = await prisma.commoditySnapshot.findFirst({
    where: { commodityType: "BRENT", quoteDate, scheduledSlot: slot, status: "SUCCESS" },
    orderBy: { collectedAt: "desc" },
  });
  if (existing) {
    const reason = `Coleta já realizada com sucesso para ${parts.dateIso} (${slot}).`;
    console.info(`${BRENT_COMMODITY_LOG_PREFIX} skip trigger=${input.trigger} existing=${existing.id}`);
    return { action: "skipped", reason, slot, quoteDate: parts.dateIso, existingSnapshotId: existing.id };
  }

  console.info(`${BRENT_COMMODITY_LOG_PREFIX} start trigger=${input.trigger} slot=${slot}`);

  try {
    const quote = await fetchBrentQuoteFromYahoo(input.fetchImpl);
    const previous = await prisma.commoditySnapshot.findFirst({
      where: { commodityType: "BRENT", status: "SUCCESS", collectedAt: { lt: collectedAt } },
      orderBy: { collectedAt: "desc" },
    });
    const variationFromPrevious =
      previous?.priceUSD != null
        ? calculateBrentVariationFromPrevious(quote.priceUSD, Number(previous.priceUSD))
        : null;

    const snapshot = await prisma.commoditySnapshot.create({
      data: {
        commodityType: "BRENT",
        priceUSD: quote.priceUSD,
        quoteDate: parseBrentQuoteDateIso(quote.quoteDate),
        scheduledSlot: slot,
        collectedAt,
        source: quote.source,
        status: "SUCCESS",
        variationFromPrevious,
        trigger: input.trigger,
      },
    });
    return { action: "created", snapshot, slot, quoteDate: parts.dateIso };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha ao coletar Brent.";
    console.error(`${BRENT_COMMODITY_LOG_PREFIX} failure:`, message);
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
    return { action: "created", snapshot, slot, quoteDate: parts.dateIso };
  }
}
