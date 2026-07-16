/**
 * Reparo server-side OP-14.1/14.2: datas + empresa a partir do rawJson.
 * Atualiza: openedAt, releasedAt, plannedAt, deliveryAt, nomusUpdatedAt,
 * externalCompanyId, companyName.
 * Não altera: closedAt, rawJson, payloadHash, timestamps de sync, vínculos.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import type { Prisma, PrismaClient } from "@prisma/client";
import {
  countRepairFieldsToFill,
  emptyProductionOrderDateRepairCounters,
  hasRepairableFieldsNull,
  mapProductionOrderRepairFieldsFromRawJson,
  parseProductionOrderDateRepairCheckpoint,
  parseProductionOrderDateRepairCli,
  productionOrderFieldsNeedRepair,
  serializeProductionOrderDateRepairCheckpoint,
  summarizeProductionOrderRepairDiff,
  type ProductionOrderDateRepairCheckpoint,
  type ProductionOrderDateRepairCli,
  type ProductionOrderDateRepairCounters,
  type ProductionOrderRepairableFields,
  type ProductionOrderRepairableKey,
  PRODUCTION_ORDER_REPAIRABLE_KEYS,
} from "@/src/lib/nomusProductionOrdersDateRepair.js";
import {
  buildProductionOrdersSyncAuditRecord,
  type ProductionOrdersSyncAuditRecord,
} from "@/src/lib/nomusProductionOrdersSyncAudit.js";
import { withProductionOrdersSyncGuard } from "@/src/lib/nomusProductionOrdersSyncGuard.server.js";
import { NOMUS_PRODUCTION_ORDERS_LOG_PREFIX } from "@/src/lib/nomusProductionOrdersSyncConstants.js";

type DbClient = Prisma.TransactionClient | PrismaClient;

const REPAIR_SELECT = {
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
  externalCompanyId: true,
  companyName: true,
  payloadHash: true,
} as const;

function currentRepairableFromRow(row: {
  openedAt: Date | null;
  releasedAt: Date | null;
  plannedAt: Date | null;
  deliveryAt: Date | null;
  nomusUpdatedAt: Date | null;
  externalCompanyId: number | null;
  companyName: string | null;
}): ProductionOrderRepairableFields {
  return {
    openedAt: row.openedAt,
    releasedAt: row.releasedAt,
    plannedAt: row.plannedAt,
    deliveryAt: row.deliveryAt,
    nomusUpdatedAt: row.nomusUpdatedAt,
    externalCompanyId: row.externalCompanyId,
    companyName: row.companyName,
  };
}

function addFieldCounts(
  target: ProductionOrderDateRepairCounters["fieldsToFill"],
  delta: Record<ProductionOrderRepairableKey, number>
): void {
  for (const key of PRODUCTION_ORDER_REPAIRABLE_KEYS) {
    target[key] += delta[key];
  }
}

function readCheckpointFile(path: string | null): ProductionOrderDateRepairCheckpoint | null {
  if (!path) return null;
  try {
    if (!existsSync(path)) return null;
    return parseProductionOrderDateRepairCheckpoint(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function writeCheckpointFile(path: string | null, checkpoint: ProductionOrderDateRepairCheckpoint): void {
  if (!path) return;
  writeFileSync(path, serializeProductionOrderDateRepairCheckpoint(checkpoint), "utf8");
}

export type ProductionOrderDateRepairResult = {
  mode: "preview" | "apply";
  counters: ProductionOrderDateRepairCounters;
  samples: Array<{
    externalId: number;
    name: string | null;
    status: string | null;
    before: ProductionOrderRepairableFields;
    after: ProductionOrderRepairableFields;
    diff: ReturnType<typeof summarizeProductionOrderRepairDiff>;
    closedAtPreserved: Date | null;
  }>;
  durationMs: number;
  exitCode: number;
  lockBlocked?: boolean;
  checkpointFile: string | null;
  lastProcessedExternalId: number | null;
  audit?: ProductionOrdersSyncAuditRecord;
};

function buildWhere(
  cli: ProductionOrderDateRepairCli,
  afterExternalId: number | null
): Prisma.NomusProductionOrderWhereInput {
  const where: Prisma.NomusProductionOrderWhereInput = {};
  if (cli.externalId != null) {
    where.externalId = cli.externalId;
    return where;
  }
  const and: Prisma.NomusProductionOrderWhereInput[] = [];
  if (afterExternalId != null) {
    and.push({ externalId: { gt: afterExternalId } });
  }
  if (cli.onlyNullDates) {
    // Otimização: só linhas com algum campo reparável ainda nulo.
    and.push({
      OR: [
        { openedAt: null },
        { releasedAt: null },
        { plannedAt: null },
        { deliveryAt: null },
        { nomusUpdatedAt: null },
        { companyName: null },
        { externalCompanyId: null },
      ],
    });
  }
  if (and.length > 0) where.AND = and;
  return where;
}

export async function runProductionOrderDateRepairFromRawJson(
  db: DbClient,
  cli: ProductionOrderDateRepairCli,
  options?: {
    readCheckpoint?: () => ProductionOrderDateRepairCheckpoint | null;
    writeCheckpoint?: (checkpoint: ProductionOrderDateRepairCheckpoint) => void;
    now?: () => Date;
  }
): Promise<ProductionOrderDateRepairResult> {
  const started = Date.now();
  const now = options?.now ?? (() => new Date());
  const counters = emptyProductionOrderDateRepairCounters();
  const samples: ProductionOrderDateRepairResult["samples"] = [];

  const checkpoint =
    options?.readCheckpoint?.() ?? readCheckpointFile(cli.checkpointFile);
  let afterExternalId =
    cli.afterExternalId ??
    (cli.externalId == null ? checkpoint?.lastProcessedExternalId ?? null : null);

  let remaining = cli.limit;
  let lastProcessedExternalId: number | null = afterExternalId;

  while (remaining == null || remaining > 0) {
    const take =
      remaining == null ? cli.batchSize : Math.min(cli.batchSize, remaining);
    const rows = await db.nomusProductionOrder.findMany({
      where: buildWhere(cli, afterExternalId),
      select: REPAIR_SELECT,
      orderBy: { externalId: "asc" },
      take,
    });
    if (rows.length === 0) break;

    for (const row of rows) {
      counters.scanned += 1;
      lastProcessedExternalId = row.externalId;
      afterExternalId = row.externalId;

      const mapped = mapProductionOrderRepairFieldsFromRawJson(row.rawJson);
      if (!mapped.ok) {
        counters.skippedInvalid += 1;
        continue;
      }

      const current = currentRepairableFromRow(row);
      const next = mapped.fields;

      if (mapped.fieldErrors.length > 0) {
        counters.invalidDates += mapped.fieldErrors.length;
      }

      if (
        cli.onlyNullDates &&
        !hasRepairableFieldsNull(current) &&
        cli.externalId == null
      ) {
        counters.unchanged += 1;
        continue;
      }

      if (!productionOrderFieldsNeedRepair(current, next)) {
        counters.unchanged += 1;
        continue;
      }

      const fill = countRepairFieldsToFill(current, next);
      addFieldCounts(counters.fieldsToFill, fill);
      const diff = summarizeProductionOrderRepairDiff(current, next);
      counters.wouldUpdate += 1;

      if (samples.length < 20) {
        samples.push({
          externalId: row.externalId,
          name: row.name,
          status: row.status,
          before: current,
          after: next,
          diff,
          closedAtPreserved: row.closedAt,
        });
      }

      if (cli.mode !== "apply") continue;

      try {
        await db.nomusProductionOrder.update({
          where: { id: row.id },
          data: {
            openedAt: next.openedAt,
            releasedAt: next.releasedAt,
            plannedAt: next.plannedAt,
            deliveryAt: next.deliveryAt,
            nomusUpdatedAt: next.nomusUpdatedAt,
            externalCompanyId: next.externalCompanyId,
            companyName: next.companyName,
            // NÃO alterar: closedAt, rawJson, payloadHash, firstSeenAt, lastSeenAt,
            // lastChangedAt, syncedAt, vínculos
          },
          select: { id: true },
        });
        counters.updated += 1;
        addFieldCounts(counters.fieldsFilled, fill);
      } catch {
        counters.errors += 1;
      }
    }

    if (cli.mode === "apply" && lastProcessedExternalId != null) {
      const nextCheckpoint: ProductionOrderDateRepairCheckpoint = {
        version: 1,
        lastProcessedExternalId,
        updatedAt: now().toISOString(),
        mode: cli.mode,
      };
      if (options?.writeCheckpoint) options.writeCheckpoint(nextCheckpoint);
      else writeCheckpointFile(cli.checkpointFile, nextCheckpoint);
    }

    if (remaining != null) remaining -= rows.length;
    if (rows.length < take) break;
    if (cli.externalId != null) break;
  }

  const durationMs = Date.now() - started;
  const exitCode = counters.errors > 0 ? 1 : 0;

  return {
    mode: cli.mode,
    counters,
    samples,
    durationMs,
    exitCode,
    checkpointFile: cli.checkpointFile,
    lastProcessedExternalId,
  };
}

/**
 * Entrypoint oficial com lock compartilhado (evita concorrência com backfill/incremental).
 */
export async function runNomusProductionOrdersDateRepair(args: {
  prisma: PrismaClient;
  argv?: string[];
  cli?: ProductionOrderDateRepairCli;
  env?: NodeJS.ProcessEnv;
  skipLock?: boolean;
  respectGlobalLock?: boolean;
  logger?: (message: string) => void;
}): Promise<ProductionOrderDateRepairResult> {
  const env = args.env ?? process.env;
  const cli = args.cli ?? parseProductionOrderDateRepairCli(args.argv ?? process.argv.slice(2), env);
  const log = args.logger ?? ((m: string) => console.warn(m));

  const guarded = await withProductionOrdersSyncGuard(
    {
      type: "date-repair",
      mode: cli.mode,
      env,
      prisma: args.prisma,
      skipLock: args.skipLock ?? false,
      respectGlobalLock: args.respectGlobalLock,
      logger: log,
    },
    async () => runProductionOrderDateRepairFromRawJson(args.prisma, cli),
    (result, ctx) =>
      buildProductionOrdersSyncAuditRecord({
        type: "date-repair",
        mode: cli.mode,
        startedAt: ctx.startedAt,
        finishedAt: ctx.finishedAt,
        status: result.exitCode === 0 ? "SUCCESS" : "FAILED",
        exitCode: result.exitCode,
        lockFile: ctx.lockFile,
        received: result.counters.scanned,
        updated: result.counters.updated,
        unchanged: result.counters.unchanged,
        invalid: result.counters.skippedInvalid,
        errors: result.counters.errors,
        finalMessage: `${NOMUS_PRODUCTION_ORDERS_LOG_PREFIX} date-repair scanned=${result.counters.scanned} updated=${result.counters.updated} wouldUpdate=${result.counters.wouldUpdate} unchanged=${result.counters.unchanged} invalid=${result.counters.skippedInvalid} errors=${result.counters.errors}`,
      })
  );

  if (guarded.blocked) {
    return {
      mode: cli.mode,
      counters: emptyProductionOrderDateRepairCounters(),
      samples: [],
      durationMs: 0,
      exitCode: 0,
      lockBlocked: true,
      checkpointFile: cli.checkpointFile,
      lastProcessedExternalId: null,
      audit: guarded.audit,
    };
  }

  const result = guarded.result!;
  return { ...result, audit: guarded.audit, exitCode: guarded.exitCode };
}
