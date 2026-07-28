/**
 * Runner I/O do backfill de complementos operacionais da Tesouraria.
 * preview: só lê; apply: create idempotente em lotes com checkpoint/retomada.
 */

import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import type { PrismaClient, Prisma } from "@prisma/client";
import {
  buildTreasuryTitleComplementBackfillPreviewReport,
  chunkTreasuryBackfillItems,
  createEmptyTreasuryBackfillCheckpoint,
  isAfterTreasuryBackfillCursor,
  moneyFromOfficial,
  parseTreasuryBackfillCursor,
  parseTreasuryTitleComplementBackfillCli,
  planTreasuryTitleComplementBackfill,
  serializeTreasuryBackfillCursor,
  type TreasuryComplementBackfillExisting,
  type TreasuryOfficialTitleBackfillSeed,
  type TreasuryTitleComplementBackfillCheckpoint,
  type TreasuryTitleComplementBackfillCliOptions,
  type TreasuryTitleComplementBackfillPreviewReport,
  type TreasuryTitleComplementCreateSeed,
  TREASURY_TITLE_COMPLEMENT_BACKFILL_NOTES,
} from "./treasuryTitleComplementBackfill.js";
import { TreasuryDomainError } from "./domain/treasuryErrors.js";
import {
  createTreasuryTitleOperationalComplementRepository,
} from "./repositories/treasuryTitleOperationalComplementRepository.server.js";

const LOG_PREFIX = "[treasury-title-complement-backfill]";

export type TreasuryTitleComplementBackfillRunSummary = {
  ok: boolean;
  mode: "preview" | "apply";
  runId: string;
  preview: TreasuryTitleComplementBackfillPreviewReport | null;
  created: number;
  skipped: number;
  errors: number;
  batches: number;
  checkpoint: TreasuryTitleComplementBackfillCheckpoint | null;
  checkpointFile: string | null;
  durationMs: number;
  logs: string[];
  errorReport: Array<{
    officialTitleId: string;
    officialExternalId: number;
    message: string;
  }>;
  resumedFromCursor: string | null;
  completed: boolean;
};

function logLine(
  logs: string[],
  message: string,
  emit = true
): void {
  const line = `${LOG_PREFIX} ${message}`;
  logs.push(line);
  if (emit) console.warn(line);
}

function civilRangeToUtcBounds(
  from: string | null,
  to: string | null
): { gte?: Date; lte?: Date } {
  const out: { gte?: Date; lte?: Date } = {};
  if (from) {
    const [y, m, d] = from.split("-").map(Number);
    out.gte = new Date(Date.UTC(y!, m! - 1, d!));
  }
  if (to) {
    const [y, m, d] = to.split("-").map(Number);
    out.lte = new Date(Date.UTC(y!, m! - 1, d!));
  }
  return out;
}

function loadCheckpoint(
  file: string | null
): TreasuryTitleComplementBackfillCheckpoint | null {
  if (!file || !existsSync(file)) return null;
  try {
    const raw = JSON.parse(readFileSync(file, "utf8")) as
      | TreasuryTitleComplementBackfillCheckpoint
      | { version?: number };
    if (raw && raw.version === 1 && "runId" in raw) {
      return raw as TreasuryTitleComplementBackfillCheckpoint;
    }
  } catch {
    return null;
  }
  return null;
}

function saveCheckpoint(
  file: string | null,
  checkpoint: TreasuryTitleComplementBackfillCheckpoint
): void {
  if (!file) return;
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(checkpoint, null, 2), "utf8");
}

async function loadOfficialTitles(
  prisma: PrismaClient,
  options: TreasuryTitleComplementBackfillCliOptions
): Promise<TreasuryOfficialTitleBackfillSeed[]> {
  const due = civilRangeToUtcBounds(options.from, options.to);
  const dueFilter =
    due.gte || due.lte
      ? {
          dueDate: {
            ...(due.gte ? { gte: due.gte } : {}),
            ...(due.lte ? { lte: due.lte } : {}),
          },
        }
      : {};

  const take = options.limit ?? undefined;
  const seeds: TreasuryOfficialTitleBackfillSeed[] = [];

  if (options.titleType === "RECEIVABLE" || options.titleType === "ALL") {
    const rows = await prisma.nomusAccountsReceivable.findMany({
      where: dueFilter,
      orderBy: { externalId: "asc" },
      take,
      select: {
        id: true,
        externalId: true,
        dueDate: true,
        status: true,
        balanceReceivable: true,
        sourcePresenceStatus: true,
        sourceRemovedAt: true,
      },
    });
    for (const row of rows) {
      seeds.push({
        titleType: "RECEIVABLE",
        officialTitleId: row.id,
        officialExternalId: row.externalId,
        dueDate: row.dueDate,
        scheduleDate: null,
        openBalance: moneyFromOfficial(row.balanceReceivable),
        status: row.status,
        sourcePresenceStatus: row.sourcePresenceStatus,
        sourceRemovedAt: row.sourceRemovedAt,
      });
    }
  }

  if (options.titleType === "PAYABLE" || options.titleType === "ALL") {
    const payableWhere: Prisma.NomusAccountsPayableWhereInput =
      due.gte || due.lte
        ? {
            OR: [
              {
                dueDate: {
                  ...(due.gte ? { gte: due.gte } : {}),
                  ...(due.lte ? { lte: due.lte } : {}),
                },
              },
              {
                scheduleDate: {
                  ...(due.gte ? { gte: due.gte } : {}),
                  ...(due.lte ? { lte: due.lte } : {}),
                },
              },
            ],
          }
        : {};
    const rows = await prisma.nomusAccountsPayable.findMany({
      where: payableWhere,
      orderBy: { externalId: "asc" },
      take,
      select: {
        id: true,
        externalId: true,
        dueDate: true,
        scheduleDate: true,
        status: true,
        balancePayable: true,
        sourcePresenceStatus: true,
        sourceRemovedAt: true,
      },
    });
    for (const row of rows) {
      seeds.push({
        titleType: "PAYABLE",
        officialTitleId: row.id,
        officialExternalId: row.externalId,
        dueDate: row.dueDate,
        scheduleDate: row.scheduleDate,
        openBalance: moneyFromOfficial(row.balancePayable),
        status: row.status,
        sourcePresenceStatus: row.sourcePresenceStatus,
        sourceRemovedAt: row.sourceRemovedAt,
      });
    }
  }

  return seeds;
}

async function loadExistingComplements(
  prisma: PrismaClient,
  titleIds: string[]
): Promise<TreasuryComplementBackfillExisting[]> {
  if (titleIds.length === 0) return [];
  const rows = await prisma.treasuryTitleOperationalComplement.findMany({
    where: { officialTitleId: { in: titleIds } },
    select: {
      id: true,
      titleType: true,
      officialTitleId: true,
      officialExternalId: true,
      cancelledAt: true,
    },
  });
  return rows.map((r) => ({
    id: r.id,
    titleType: r.titleType as "RECEIVABLE" | "PAYABLE",
    officialTitleId: r.officialTitleId,
    officialExternalId: r.officialExternalId,
    cancelledAt: r.cancelledAt,
  }));
}

async function createComplementIdempotent(
  prisma: PrismaClient,
  seed: TreasuryTitleComplementCreateSeed
): Promise<"created" | "skipped"> {
  const repo = createTreasuryTitleOperationalComplementRepository(prisma);
  const existing = await repo.findByOfficialTitle(
    seed.titleType,
    seed.officialTitleId
  );
  if (existing) return "skipped";

  try {
    await repo.create({
      titleType: seed.titleType,
      officialTitleId: seed.officialTitleId,
      officialExternalId: seed.officialExternalId,
      expectedDate: seed.expectedDate,
      scheduledDate: seed.scheduledDate,
      expectedAmount: seed.expectedAmount,
      scheduledAmount: seed.scheduledAmount,
      status: seed.status,
      priority: seed.priority,
      notes: seed.notes ?? TREASURY_TITLE_COMPLEMENT_BACKFILL_NOTES,
      createdByUserId: seed.createdByUserId,
    });
    return "created";
  } catch (err) {
    if (err instanceof TreasuryDomainError && err.code === "CONFLICT") {
      return "skipped";
    }
    const code = (err as { code?: string }).code;
    if (code === "P2002") return "skipped";
    throw err;
  }
}

export async function runTreasuryTitleComplementBackfill(input: {
  prisma: PrismaClient;
  argv?: string[];
  env?: NodeJS.ProcessEnv;
  now?: () => Date;
}): Promise<TreasuryTitleComplementBackfillRunSummary> {
  const started = Date.now();
  const logs: string[] = [];
  const options = parseTreasuryTitleComplementBackfillCli(
    input.argv ?? process.argv.slice(2),
    input.env ?? process.env
  );
  const runId = randomUUID();
  const errorReport: TreasuryTitleComplementBackfillRunSummary["errorReport"] =
    [];

  logLine(
    logs,
    `início mode=${options.mode} titleType=${options.titleType} from=${options.from ?? "*"} to=${options.to ?? "*"} batchSize=${options.batchSize}`
  );

  if (options.mode === "apply" && !options.createdByUserId) {
    throw new Error(
      "apply exige --created-by-user-id=UUID ou env TREASURY_BACKFILL_CREATED_BY_USER_ID."
    );
  }

  if (options.mode === "apply" && options.createdByUserId) {
    const user = await input.prisma.appUser.findUnique({
      where: { id: options.createdByUserId },
      select: { id: true },
    });
    if (!user) {
      throw new Error(
        `createdByUserId não encontrado em AppUser: ${options.createdByUserId}`
      );
    }
  }

  const createdByUserId =
    options.createdByUserId ?? "00000000-0000-4000-8000-000000000000";

  let checkpoint =
    options.resume && options.mode === "apply"
      ? loadCheckpoint(options.checkpointFile)
      : null;
  if (!checkpoint && options.mode === "apply") {
    checkpoint = createEmptyTreasuryBackfillCheckpoint({
      runId,
      titleType: options.titleType,
      from: options.from,
      to: options.to,
    });
  }

  const resumeCursor = parseTreasuryBackfillCursor(checkpoint?.cursor ?? null);
  if (resumeCursor) {
    logLine(logs, `retomando após cursor ${checkpoint!.cursor}`);
  }

  const t0 = Date.now();
  const titles = await loadOfficialTitles(input.prisma, options);
  const complements = await loadExistingComplements(
    input.prisma,
    titles.map((t) => t.officialTitleId)
  );
  const plan = planTreasuryTitleComplementBackfill({
    titles,
    existingComplements: complements,
    createdByUserId,
    openOnly: options.openOnly,
  });
  const sampleDurationMs = Date.now() - t0;

  const preview = buildTreasuryTitleComplementBackfillPreviewReport({
    mode: options.mode,
    options,
    plan,
    sampleDurationMs,
  });

  logLine(
    logs,
    `scan titlesFound=${preview.titlesFound} eligible=${preview.eligible} wouldCreate=${preview.wouldCreate} existing=${preview.existingComplements} cancelledOfficial=${preview.cancelledOfficial} inconsistencies=${preview.inconsistencies} duplicates=${preview.duplicates} sampleMs=${sampleDurationMs}`
  );

  if (options.mode === "preview") {
    const summary: TreasuryTitleComplementBackfillRunSummary = {
      ok: true,
      mode: "preview",
      runId,
      preview,
      created: 0,
      skipped:
        preview.titlesFound -
        preview.wouldCreate,
      errors: 0,
      batches: 0,
      checkpoint: null,
      checkpointFile: options.checkpointFile,
      durationMs: Date.now() - started,
      logs,
      errorReport,
      resumedFromCursor: null,
      completed: true,
    };
    if (options.json) {
      console.log(JSON.stringify(summary, null, 2));
    } else {
      console.log(JSON.stringify(preview, null, 2));
    }
    return summary;
  }

  // APPLY — nunca altera títulos oficiais; só create de complementos ausentes.
  let created = checkpoint?.created ?? 0;
  let skipped = checkpoint?.skipped ?? 0;
  let errors = checkpoint?.errors ?? 0;
  let batches = 0;

  const pending = plan.toCreate.filter((item) =>
    isAfterTreasuryBackfillCursor(item, resumeCursor)
  );
  const chunks = chunkTreasuryBackfillItems(pending, options.batchSize);

  for (const chunk of chunks) {
    batches += 1;
    const batchStarted = Date.now();
    for (const item of chunk) {
      if (!item.create) {
        skipped += 1;
        continue;
      }
      try {
        const result = await createComplementIdempotent(
          input.prisma,
          item.create
        );
        if (result === "created") created += 1;
        else skipped += 1;
      } catch (err) {
        errors += 1;
        const message = err instanceof Error ? err.message : String(err);
        errorReport.push({
          officialTitleId: item.officialTitleId,
          officialExternalId: item.officialExternalId,
          message,
        });
        logLine(
          logs,
          `erro create ${item.titleType}:${item.officialExternalId} — ${message}`
        );
      }
      if (checkpoint) {
        checkpoint.cursor = serializeTreasuryBackfillCursor(item);
        checkpoint.created = created;
        checkpoint.skipped = skipped;
        checkpoint.errors = errors;
        checkpoint.updatedAt = (input.now?.() ?? new Date()).toISOString();
      }
    }
    if (checkpoint) {
      saveCheckpoint(options.checkpointFile, checkpoint);
    }
    logLine(
      logs,
      `lote ${batches}/${chunks.length} size=${chunk.length} created=${created} skipped=${skipped} errors=${errors} ms=${Date.now() - batchStarted}`
    );
  }

  if (checkpoint) {
    checkpoint.completed = true;
    checkpoint.updatedAt = (input.now?.() ?? new Date()).toISOString();
    saveCheckpoint(options.checkpointFile, checkpoint);
  }

  const summary: TreasuryTitleComplementBackfillRunSummary = {
    ok: errors === 0,
    mode: "apply",
    runId: checkpoint?.runId ?? runId,
    preview,
    created,
    skipped,
    errors,
    batches,
    checkpoint,
    checkpointFile: options.checkpointFile,
    durationMs: Date.now() - started,
    logs,
    errorReport,
    resumedFromCursor: resumeCursor
      ? serializeTreasuryBackfillCursor(resumeCursor)
      : null,
    completed: true,
  };

  console.log(JSON.stringify(summary, null, 2));
  return summary;
}
