/**
 * DS-03.6 — Reparo server-side do cabeçalho normalizado a partir do rawJson.
 * Atualiza apenas campos normalizados. Preserva rawJson, itens, IDs e vínculos.
 * Usa o lock oficial de Documentos de Saída.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import type { Prisma, PrismaClient } from "@prisma/client";
import {
  buildStockDocumentRepairPatch,
  countStockDocumentFieldsToFill,
  emptyStockDocumentRepairCounters,
  mapStockDocumentRepairFieldsFromRawJson,
  parseStockDocumentRepairCheckpoint,
  parseStockDocumentRepairCli,
  serializeStockDocumentRepairCheckpoint,
  stockDocumentNeedsRepair,
  summarizeStockDocumentRepairDiff,
  type StockDocumentRepairCheckpoint,
  type StockDocumentRepairCli,
  type StockDocumentRepairCounters,
  type StockDocumentRepairableFields,
  type StockDocumentRepairableKey,
  STOCK_DOCUMENT_REPAIRABLE_KEYS,
} from "@/src/lib/nomusStockDocumentsRepair.js";
import {
  acquireStockDocumentsSyncLock,
  releaseStockDocumentsSyncLock,
} from "@/src/lib/nomusStockDocumentsSyncLock.js";
import { NOMUS_STOCK_DOCUMENTS_LOG_PREFIX } from "@/src/lib/nomusStockDocumentsSyncConstants.js";

type DbClient = Prisma.TransactionClient | PrismaClient;

const REPAIR_SELECT = {
  id: true,
  externalId: true,
  documentNumber: true,
  statusRaw: true,
  isCancelled: true,
  cancelledAt: true,
  cancellationReason: true,
  totalValue: true,
  personExternalId: true,
  personName: true,
  companyExternalId: true,
  companyName: true,
  movementDate: true,
  paymentTermsRaw: true,
  payloadHash: true,
  rawJson: true,
  idNfe: true,
  tipoDocumentoEstoque: true,
  dataDocumento: true,
  firstSeenAt: true,
  lastSeenAt: true,
  presentInLastPayload: true,
  syncedAt: true,
  _count: { select: { items: true } },
} as const;

function currentRepairableFromRow(row: {
  documentNumber: string | null;
  statusRaw: string | null;
  isCancelled: boolean;
  cancelledAt: Date | null;
  cancellationReason: string | null;
  totalValue: Prisma.Decimal | null;
  personExternalId: number | null;
  personName: string | null;
  companyExternalId: number | null;
  companyName: string | null;
  movementDate: Date | null;
  paymentTermsRaw: string | null;
  payloadHash: string;
}): StockDocumentRepairableFields {
  return {
    documentNumber: row.documentNumber,
    statusRaw: row.statusRaw,
    isCancelled: row.isCancelled,
    cancelledAt: row.cancelledAt,
    cancellationReason: row.cancellationReason,
    totalValue: row.totalValue,
    personExternalId: row.personExternalId,
    personName: row.personName,
    companyExternalId: row.companyExternalId,
    companyName: row.companyName,
    movementDate: row.movementDate,
    paymentTermsRaw: row.paymentTermsRaw,
    payloadHash: row.payloadHash,
  };
}

function addFieldCounts(
  target: StockDocumentRepairCounters["fieldsToFill"],
  delta: Record<StockDocumentRepairableKey, number>
): void {
  for (const key of STOCK_DOCUMENT_REPAIRABLE_KEYS) {
    target[key] += delta[key];
  }
}

function readCheckpointFile(path: string | null): StockDocumentRepairCheckpoint | null {
  if (!path) return null;
  try {
    if (!existsSync(path)) return null;
    return parseStockDocumentRepairCheckpoint(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function writeCheckpointFile(
  path: string | null,
  checkpoint: StockDocumentRepairCheckpoint
): void {
  if (!path) return;
  writeFileSync(path, serializeStockDocumentRepairCheckpoint(checkpoint), "utf8");
}

function buildWhere(
  cli: StockDocumentRepairCli,
  afterExternalId: number | null
): Prisma.NomusStockDocumentWhereInput {
  const where: Prisma.NomusStockDocumentWhereInput = {};
  if (cli.externalId != null) {
    where.externalId = cli.externalId;
    return where;
  }
  const and: Prisma.NomusStockDocumentWhereInput[] = [];
  if (afterExternalId != null) {
    and.push({ externalId: { gt: afterExternalId } });
  }
  if (cli.onlyNull) {
    and.push({
      OR: [
        { documentNumber: null },
        { statusRaw: null },
        { isCancelled: false },
        { cancelledAt: null },
        { cancellationReason: null },
        { totalValue: null },
        { personExternalId: null },
        { personName: null },
        { companyExternalId: null },
        { companyName: null },
        { movementDate: null },
        { paymentTermsRaw: null },
        { payloadHash: "" },
      ],
    });
  }
  if (and.length > 0) where.AND = and;
  return where;
}

export type StockDocumentRepairResult = {
  mode: "preview" | "apply";
  counters: StockDocumentRepairCounters;
  samples: Array<{
    externalId: number;
    before: StockDocumentRepairableFields;
    after: StockDocumentRepairableFields;
    diff: ReturnType<typeof summarizeStockDocumentRepairDiff>;
    itemCountPreserved: number;
    idPreserved: string;
    rawJsonPreserved: true;
    absentKeys: StockDocumentRepairableKey[];
    fieldErrors: Array<{ field: string; error: string; rawValue: string | null }>;
  }>;
  durationMs: number;
  exitCode: number;
  lockBlocked?: boolean;
  checkpointFile: string | null;
  lastProcessedExternalId: number | null;
};

export async function runStockDocumentRepairFromRawJson(
  db: DbClient,
  cli: StockDocumentRepairCli,
  options?: {
    readCheckpoint?: () => StockDocumentRepairCheckpoint | null;
    writeCheckpoint?: (checkpoint: StockDocumentRepairCheckpoint) => void;
    now?: () => Date;
  }
): Promise<StockDocumentRepairResult> {
  const started = Date.now();
  const now = options?.now ?? (() => new Date());
  const counters = emptyStockDocumentRepairCounters();
  const samples: StockDocumentRepairResult["samples"] = [];

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
    const rows = await db.nomusStockDocument.findMany({
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

      const mapped = mapStockDocumentRepairFieldsFromRawJson(row.rawJson);
      if (!mapped.ok) {
        counters.skippedInvalid += 1;
        continue;
      }

      const current = currentRepairableFromRow(row);
      const next = mapped.fields;
      counters.invalidDates += mapped.fieldErrors.length;
      counters.absentFields += mapped.absentKeys.length;

      if (!stockDocumentNeedsRepair(current, next, { onlyNull: cli.onlyNull })) {
        counters.unchanged += 1;
        continue;
      }

      const patch = buildStockDocumentRepairPatch(current, next, {
        onlyNull: cli.onlyNull,
      });
      const fill = countStockDocumentFieldsToFill(patch);
      addFieldCounts(counters.fieldsToFill, fill);
      const after = { ...current, ...patch };
      const diff = summarizeStockDocumentRepairDiff(current, patch);
      counters.wouldUpdate += 1;

      if (samples.length < 20) {
        samples.push({
          externalId: row.externalId,
          before: current,
          after,
          diff,
          itemCountPreserved: row._count.items,
          idPreserved: row.id,
          rawJsonPreserved: true,
          absentKeys: mapped.absentKeys,
          fieldErrors: mapped.fieldErrors,
        });
      }

      if (cli.mode !== "apply") continue;

      try {
        await db.nomusStockDocument.update({
          where: { id: row.id },
          data: patch,
          select: { id: true },
        });
        counters.updated += 1;
        addFieldCounts(counters.fieldsFilled, fill);
      } catch {
        counters.errors += 1;
      }
    }

    if (cli.mode === "apply" && lastProcessedExternalId != null) {
      const nextCheckpoint: StockDocumentRepairCheckpoint = {
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

  return {
    mode: cli.mode,
    counters,
    samples,
    durationMs: Date.now() - started,
    exitCode: counters.errors > 0 ? 1 : 0,
    checkpointFile: cli.checkpointFile,
    lastProcessedExternalId,
  };
}

/**
 * Entrypoint oficial com lock compartilhado (evita concorrência com sync).
 */
export async function runNomusStockDocumentsRepair(args: {
  prisma: PrismaClient;
  argv?: string[];
  cli?: StockDocumentRepairCli;
  env?: NodeJS.ProcessEnv;
  skipLock?: boolean;
  logger?: (message: string) => void;
}): Promise<StockDocumentRepairResult> {
  const env = args.env ?? process.env;
  const cli =
    args.cli ?? parseStockDocumentRepairCli(args.argv ?? process.argv.slice(2), env);
  const log = args.logger ?? ((m: string) => console.warn(m));

  if (args.skipLock) {
    return runStockDocumentRepairFromRawJson(args.prisma, cli);
  }

  const lock = acquireStockDocumentsSyncLock({
    mode: cli.mode,
    env,
  });
  if (!lock.ok) {
    log(lock.message);
    return {
      mode: cli.mode,
      counters: emptyStockDocumentRepairCounters(),
      samples: [],
      durationMs: 0,
      exitCode: 0,
      lockBlocked: true,
      checkpointFile: cli.checkpointFile,
      lastProcessedExternalId: null,
    };
  }

  try {
    const result = await runStockDocumentRepairFromRawJson(args.prisma, cli);
    log(
      `${NOMUS_STOCK_DOCUMENTS_LOG_PREFIX} stage-repair scanned=${result.counters.scanned} updated=${result.counters.updated} wouldUpdate=${result.counters.wouldUpdate} unchanged=${result.counters.unchanged} invalid=${result.counters.skippedInvalid} errors=${result.counters.errors}`
    );
    return result;
  } finally {
    releaseStockDocumentsSyncLock({
      lockFile: lock.lockFile,
      token: lock.token,
    });
  }
}
