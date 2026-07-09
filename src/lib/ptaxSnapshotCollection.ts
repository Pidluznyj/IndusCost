import type { PtaxSnapshot } from "@prisma/client";
import { prisma } from "./prisma.js";
import {
  PTAX_BCB_SOURCE,
  resolvePtaxBcbRates,
} from "./materialMarketPtax.js";
import { getSaoPauloDateTimeParts } from "./brentCommodityJob.js";

export const PTAX_SNAPSHOT_LOG_PREFIX = "[ptax-snapshot-collection]" as const;

export type PtaxCollectionTrigger = "MANUAL" | "SCHEDULED";

export type PtaxCollectionOutcome =
  | { action: "created"; snapshot: PtaxSnapshot; quoteDate: string }
  | {
      action: "skipped";
      reason: string;
      quoteDate: string;
      existingSnapshotId: string;
    };

export type PtaxSnapshotApiItem = {
  id: string;
  quoteDate: string;
  buyRate: number | null;
  sellRate: number | null;
  source: string;
  status: string;
  errorMessage: string | null;
  collectedAt: string;
};

export function parsePtaxQuoteDateIso(dateIso: string): Date {
  return new Date(`${dateIso}T12:00:00.000Z`);
}

export function serializePtaxSnapshotForApi(snapshot: PtaxSnapshot): PtaxSnapshotApiItem {
  return {
    id: snapshot.id,
    quoteDate: snapshot.quoteDate.toISOString().slice(0, 10),
    buyRate: snapshot.buyRate != null ? Number(snapshot.buyRate) : null,
    sellRate: snapshot.sellRate != null ? Number(snapshot.sellRate) : null,
    source: snapshot.source,
    status: snapshot.status,
    errorMessage: snapshot.errorMessage,
    collectedAt: snapshot.collectedAt.toISOString(),
  };
}

export async function getLatestPtaxSnapshot(): Promise<PtaxSnapshot | null> {
  return (
    (await prisma.ptaxSnapshot.findFirst({
      where: { status: "SUCCESS" },
      orderBy: [{ quoteDate: "desc" }, { collectedAt: "desc" }],
    })) ??
    (await prisma.ptaxSnapshot.findFirst({
      orderBy: [{ collectedAt: "desc" }],
    }))
  );
}

export async function collectPtaxSnapshot(input: {
  trigger: PtaxCollectionTrigger;
  at?: Date;
  fetchImpl?: typeof fetch;
}): Promise<PtaxCollectionOutcome> {
  const collectedAt = input.at ?? new Date();
  const parts = getSaoPauloDateTimeParts(collectedAt);
  const requestedDate = parts.dateIso;

  console.info(
    `${PTAX_SNAPSHOT_LOG_PREFIX} start trigger=${input.trigger} requestedDate=${requestedDate} source=${PTAX_BCB_SOURCE}`
  );

  let rates: Awaited<ReturnType<typeof resolvePtaxBcbRates>> = null;
  try {
    rates = await resolvePtaxBcbRates(requestedDate, input.fetchImpl);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha ao consultar BCB PTAX.";
    console.error(`${PTAX_SNAPSHOT_LOG_PREFIX} fetch failure:`, message);
    const snapshot = await prisma.ptaxSnapshot.create({
      data: {
        quoteDate: parsePtaxQuoteDateIso(requestedDate),
        status: "FAILED",
        errorMessage: message,
        collectedAt,
        source: PTAX_BCB_SOURCE,
      },
    });
    return { action: "created", snapshot, quoteDate: requestedDate };
  }

  if (!rates) {
    const message = `Sem cotação PTAX disponível para ${requestedDate} (nem em dias anteriores).`;
    console.warn(`${PTAX_SNAPSHOT_LOG_PREFIX} no quote: ${message}`);
    const snapshot = await prisma.ptaxSnapshot.create({
      data: {
        quoteDate: parsePtaxQuoteDateIso(requestedDate),
        status: "FAILED",
        errorMessage: message,
        collectedAt,
        source: PTAX_BCB_SOURCE,
      },
    });
    return { action: "created", snapshot, quoteDate: requestedDate };
  }

  const effectiveQuoteDate = rates.quoteDate;
  console.info(
    `${PTAX_SNAPSHOT_LOG_PREFIX} resolved quoteDate=${effectiveQuoteDate} buy=${rates.buyRate} sell=${rates.sellRate}`
  );

  const existing = await prisma.ptaxSnapshot.findFirst({
    where: {
      quoteDate: parsePtaxQuoteDateIso(effectiveQuoteDate),
      status: "SUCCESS",
    },
    orderBy: { collectedAt: "desc" },
  });
  if (existing) {
    const reason = `Coleta PTAX já realizada com sucesso para ${effectiveQuoteDate}.`;
    console.info(`${PTAX_SNAPSHOT_LOG_PREFIX} skip trigger=${input.trigger} existing=${existing.id}`);
    return {
      action: "skipped",
      reason,
      quoteDate: effectiveQuoteDate,
      existingSnapshotId: existing.id,
    };
  }

  const snapshot = await prisma.ptaxSnapshot.create({
    data: {
      quoteDate: parsePtaxQuoteDateIso(effectiveQuoteDate),
      buyRate: rates.buyRate,
      sellRate: rates.sellRate,
      source: PTAX_BCB_SOURCE,
      status: "SUCCESS",
      collectedAt,
    },
  });
  console.info(`${PTAX_SNAPSHOT_LOG_PREFIX} snapshot created id=${snapshot.id} quoteDate=${effectiveQuoteDate}`);
  return { action: "created", snapshot, quoteDate: effectiveQuoteDate };
}
