/**
 * Reparo server-side: atualiza somente colunas de data a partir de rawJson.
 * Preserva rawJson, payloadHash, firstSeenAt, lastSeenAt, lastChangedAt, syncedAt e vínculos.
 */

import type { Prisma, PrismaClient } from "@prisma/client";
import {
  emptyProductionOrderDateRepairCounters,
  mapProductionOrderDatesFromRawJson,
  productionOrderDatesNeedRepair,
  summarizeProductionOrderDateRepairDiff,
  type ProductionOrderDateFields,
  type ProductionOrderDateRepairCli,
  type ProductionOrderDateRepairCounters,
} from "@/src/lib/nomusProductionOrdersDateRepair.js";

type DbClient = Prisma.TransactionClient | PrismaClient;

const DATE_SELECT = {
  id: true,
  externalId: true,
  name: true,
  status: true,
  rawJson: true,
  openedAt: true,
  releasedAt: true,
  plannedAt: true,
  deliveryAt: true,
  closedAt: true,
  nomusUpdatedAt: true,
} as const;

function currentDatesFromRow(row: {
  openedAt: Date | null;
  releasedAt: Date | null;
  plannedAt: Date | null;
  deliveryAt: Date | null;
  closedAt: Date | null;
  nomusUpdatedAt: Date | null;
}): ProductionOrderDateFields {
  return {
    openedAt: row.openedAt,
    releasedAt: row.releasedAt,
    plannedAt: row.plannedAt,
    deliveryAt: row.deliveryAt,
    closedAt: row.closedAt,
    nomusUpdatedAt: row.nomusUpdatedAt,
  };
}

function hasAllDatesNull(dates: ProductionOrderDateFields): boolean {
  return (
    dates.openedAt == null &&
    dates.releasedAt == null &&
    dates.plannedAt == null &&
    dates.deliveryAt == null &&
    dates.closedAt == null &&
    dates.nomusUpdatedAt == null
  );
}

export type ProductionOrderDateRepairResult = {
  mode: "preview" | "apply";
  counters: ProductionOrderDateRepairCounters;
  samples: Array<{
    externalId: number;
    name: string | null;
    status: string | null;
    diff: ReturnType<typeof summarizeProductionOrderDateRepairDiff>;
  }>;
};

export async function runProductionOrderDateRepairFromRawJson(
  db: DbClient,
  cli: ProductionOrderDateRepairCli
): Promise<ProductionOrderDateRepairResult> {
  const counters = emptyProductionOrderDateRepairCounters();
  const samples: ProductionOrderDateRepairResult["samples"] = [];

  const where: Prisma.NomusProductionOrderWhereInput = {};
  if (cli.externalId != null) {
    where.externalId = cli.externalId;
  } else if (cli.onlyNullDates) {
    where.AND = [
      { openedAt: null },
      { releasedAt: null },
      { plannedAt: null },
      { deliveryAt: null },
      { closedAt: null },
      { nomusUpdatedAt: null },
    ];
  }

  const rows = await db.nomusProductionOrder.findMany({
    where,
    select: DATE_SELECT,
    orderBy: { externalId: "asc" },
    skip: cli.offset,
    take: cli.limit ?? undefined,
  });

  for (const row of rows) {
    counters.scanned += 1;
    const mapped = mapProductionOrderDatesFromRawJson(row.rawJson);
    if (!mapped.ok) {
      counters.skippedInvalid += 1;
      continue;
    }

    const current = currentDatesFromRow(row);
    if (cli.onlyNullDates && !hasAllDatesNull(current) && cli.externalId == null) {
      counters.unchanged += 1;
      continue;
    }

    if (!productionOrderDatesNeedRepair(current, mapped.dates)) {
      counters.unchanged += 1;
      continue;
    }

    const diff = summarizeProductionOrderDateRepairDiff(current, mapped.dates);
    counters.wouldUpdate += 1;
    if (samples.length < 20) {
      samples.push({
        externalId: row.externalId,
        name: row.name,
        status: row.status,
        diff,
      });
    }

    if (cli.mode !== "apply") continue;

    try {
      await db.nomusProductionOrder.update({
        where: { id: row.id },
        data: {
          openedAt: mapped.dates.openedAt,
          releasedAt: mapped.dates.releasedAt,
          plannedAt: mapped.dates.plannedAt,
          deliveryAt: mapped.dates.deliveryAt,
          closedAt: mapped.dates.closedAt,
          nomusUpdatedAt: mapped.dates.nomusUpdatedAt,
          // Não tocar: rawJson, payloadHash, firstSeenAt, lastSeenAt, lastChangedAt, syncedAt
        },
        select: { id: true },
      });
      counters.updated += 1;
    } catch {
      counters.errors += 1;
    }
  }

  return { mode: cli.mode, counters, samples };
}
