/**
 * OP-56 — Orquestração do rebuild do Fluxo de Pedidos (server).
 * Somente dados locais; sem Nomus HTTP.
 * Apply grava apenas snapshots/eventos derivados via recomputeSalesOrderFlow.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Prisma, PrismaClient } from "@prisma/client";
import {
  recomputeSalesOrderFlow,
  type RecomputeSalesOrderFlowResult,
  type SalesOrderFlowRecomputeDb,
} from "./salesOrderFlowRecompute.server.js";
import { loadSalesOrderFlowEvidenceBatch } from "./salesOrderFlowEvidence.server.js";
import type { SalesOrderFlowEvidencePack } from "./salesOrderFlowEvidence.js";
import {
  acquireSalesOrderFlowRebuildLock,
  emptySalesOrderFlowRebuildSummary,
  endOfUtcDay,
  exitCodeForSalesOrderFlowRebuildSummary,
  isUuidLike,
  parseSalesOrderFlowRebuildCheckpoint,
  releaseSalesOrderFlowRebuildLock,
  serializeSalesOrderFlowRebuildCheckpoint,
  shouldAdvanceSalesOrderFlowRebuildCheckpoint,
  type SalesOrderFlowRebuildCheckpoint,
  type SalesOrderFlowRebuildCliOptions,
  type SalesOrderFlowRebuildSummary,
} from "./salesOrderFlowRebuild.js";
import {
  aggregateSalesOrderFlowRecomputeObservabilityMetrics,
  type SalesOrderFlowRecomputeObservabilityLog,
} from "./salesOrderFlowObservability.js";
import { persistSalesOrderFlowRecomputeObservabilityBestEffort } from "./salesOrderFlowObservability.server.js";
import { SALES_ORDER_FLOW_COMPUTATION_VERSION } from "./salesOrderFlowFingerprint.js";

export type SalesOrderFlowRebuildCandidate = {
  id: string;
  orderCode: string;
};

export type SalesOrderFlowRebuildListDb = Pick<PrismaClient, "salesOrder">;

export type SalesOrderFlowRebuildRunDb = SalesOrderFlowRebuildListDb &
  SalesOrderFlowRecomputeDb &
  Pick<PrismaClient, "integrationRun">;

export type SalesOrderFlowRebuildIo = {
  readCheckpoint?: (path: string) => string | null;
  writeCheckpoint?: (path: string, content: string) => void;
  now?: () => Date;
  recompute?: (
    db: SalesOrderFlowRecomputeDb,
    salesOrderId: string,
    options: {
      dryRun?: boolean;
      source?: "rebuild" | "rebuild-preview";
      evidencePack?: SalesOrderFlowEvidencePack | null;
    }
  ) => Promise<RecomputeSalesOrderFlowResult>;
  loadEvidenceBatch?: typeof loadSalesOrderFlowEvidenceBatch;
  persistObservability?: typeof persistSalesOrderFlowRecomputeObservabilityBestEffort;
  acquireLock?: typeof acquireSalesOrderFlowRebuildLock;
  releaseLock?: typeof releaseSalesOrderFlowRebuildLock;
  /** Se retornar true no meio do lote, aborta sem avançar checkpoint. */
  shouldAbortBatch?: () => boolean;
};

async function resolveResumeAfterId(
  db: SalesOrderFlowRebuildListDb,
  options: SalesOrderFlowRebuildCliOptions,
  checkpoint: SalesOrderFlowRebuildCheckpoint | null
): Promise<string | null> {
  if (options.resumeFrom) {
    if (isUuidLike(options.resumeFrom)) {
      return options.resumeFrom.trim();
    }
    const byCode = await db.salesOrder.findFirst({
      where: { orderCode: options.resumeFrom.trim() },
      select: { id: true },
      orderBy: { id: "asc" },
    });
    return byCode?.id ?? null;
  }
  // Checkpoint só com --resume / --resume-from (evita apply com 0 pedidos).
  if (options.resumeFromCheckpoint) {
    return checkpoint?.lastSalesOrderId ?? null;
  }
  return null;
}

export async function listSalesOrderFlowRebuildCandidates(
  db: SalesOrderFlowRebuildListDb,
  options: SalesOrderFlowRebuildCliOptions,
  cursorAfterId: string | null
): Promise<SalesOrderFlowRebuildCandidate[]> {
  const where: Prisma.SalesOrderWhereInput = {};

  if (options.orderCode) {
    where.orderCode = options.orderCode;
  }

  if (options.fromDate || options.toDate) {
    where.issueDate = {};
    if (options.fromDate) where.issueDate.gte = options.fromDate;
    if (options.toDate) where.issueDate.lte = endOfUtcDay(options.toDate);
  }

  if (cursorAfterId) {
    where.id = { gt: cursorAfterId };
  }

  if (!options.includeCompleted) {
    where.OR = [
      { flowSnapshot: null },
      { flowSnapshot: { is: { currentStage: { not: "SHIPPED_COMPLETED" } } } },
    ];
  }

  const rows = await db.salesOrder.findMany({
    where,
    select: { id: true, orderCode: true },
    orderBy: { id: "asc" },
    take: options.batchSize,
  });

  return rows.map((r) => ({ id: r.id, orderCode: r.orderCode }));
}

/**
 * Executa preview ou apply em lotes.
 * Checkpoint avança somente após lote completo em apply.
 */
export async function runSalesOrderFlowRebuild(
  db: SalesOrderFlowRebuildRunDb,
  options: SalesOrderFlowRebuildCliOptions,
  io: SalesOrderFlowRebuildIo = {}
): Promise<SalesOrderFlowRebuildSummary> {
  const nowFn = io.now ?? (() => new Date());
  const started = nowFn().getTime();
  const summary = emptySalesOrderFlowRebuildSummary(options);

  const readCheckpoint =
    io.readCheckpoint ??
    ((path: string) => {
      try {
        if (!existsSync(path)) return null;
        return readFileSync(path, "utf8");
      } catch {
        return null;
      }
    });

  const writeCheckpoint =
    io.writeCheckpoint ??
    ((path: string, content: string) => {
      const dir = dirname(path);
      if (dir && dir !== "." && !existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      writeFileSync(path, content, "utf8");
    });

  const recompute = io.recompute ?? recomputeSalesOrderFlow;
  const loadEvidenceBatch = io.loadEvidenceBatch ?? loadSalesOrderFlowEvidenceBatch;
  const persistObservability =
    io.persistObservability ??
    (async (observabilityDb, input) => {
      if (
        !observabilityDb ||
        typeof (observabilityDb as { integrationRun?: unknown }).integrationRun !==
          "object" ||
        (observabilityDb as { integrationRun?: unknown }).integrationRun == null
      ) {
        return;
      }
      await persistSalesOrderFlowRecomputeObservabilityBestEffort(
        observabilityDb,
        input
      );
    });
  const acquireLock = io.acquireLock ?? acquireSalesOrderFlowRebuildLock;
  const releaseLock = io.releaseLock ?? releaseSalesOrderFlowRebuildLock;
  const recomputeSource =
    options.mode === "preview" ? ("rebuild-preview" as const) : ("rebuild" as const);
  const observabilityLogs: SalesOrderFlowRecomputeObservabilityLog[] = [];
  const startedAt = nowFn();

  let lockToken: string | null = null;

  if (options.mode === "apply") {
    const lock = acquireLock({
      lockFile: options.lockFile,
      mode: "apply",
      now: nowFn,
    });
    if (!lock.ok) {
      summary.lockBlocked = true;
      summary.durationMs = nowFn().getTime() - started;
      summary.exitCode = exitCodeForSalesOrderFlowRebuildSummary(summary);
      return summary;
    }
    lockToken = lock.token;
  }

  try {
    const existingCheckpoint = parseSalesOrderFlowRebuildCheckpoint(
      readCheckpoint(options.checkpointFile)
    );
    let cursorAfterId = await resolveResumeAfterId(
      db,
      options,
      existingCheckpoint
    );
    let batchesCompleted = existingCheckpoint?.batchesCompleted ?? 0;
    let ordersProcessedTotal = existingCheckpoint?.ordersProcessed ?? 0;
    let lastCandidate: SalesOrderFlowRebuildCandidate | null = null;
    let checkpointAdvanced = false;

    const maxBatches = options.maxBatches ?? Number.POSITIVE_INFINITY;
    let batchesThisRun = 0;

    while (batchesThisRun < maxBatches) {
      const batch = await listSalesOrderFlowRebuildCandidates(
        db,
        options,
        cursorAfterId
      );
      if (batch.length === 0) break;

      summary.ordersSelected += batch.length;
      let batchComplete = false;

      try {
        // OP-75: uma carga de evidências por lote (evita N× pipeline).
        let evidenceBatchLoaded = false;
        let evidenceByOrderId = new Map<string, SalesOrderFlowEvidencePack>();
        try {
          evidenceByOrderId = await loadEvidenceBatch(
            db,
            batch.map((candidate) => candidate.id)
          );
          evidenceBatchLoaded = true;
        } catch {
          // DB de teste / parcial: recompute carrega evidência sob demanda.
          evidenceBatchLoaded = false;
        }
        for (const candidate of batch) {
          if (io.shouldAbortBatch?.()) {
            throw new Error("BATCH_INCOMPLETE");
          }
          try {
            const pack = evidenceByOrderId.get(candidate.id);
            const result = await recompute(db, candidate.id, {
              dryRun: options.mode === "preview",
              source: recomputeSource,
              ...(evidenceBatchLoaded
                ? { evidencePack: pack ?? null }
                : {}),
            });
            summary.ordersProcessed += 1;
            if (result.action === "created") summary.created += 1;
            else if (result.action === "updated") summary.updated += 1;
            else summary.unchanged += 1;
            if (result.observability) {
              observabilityLogs.push(result.observability);
            }
            lastCandidate = candidate;
            cursorAfterId = candidate.id;
          } catch (error) {
            const message =
              error instanceof Error ? error.message : String(error);
            if (message === "BATCH_INCOMPLETE") throw error;
            summary.errors += 1;
            summary.errorReport.push({
              salesOrderId: candidate.id,
              orderCode: candidate.orderCode,
              message,
            });
            lastCandidate = candidate;
            cursorAfterId = candidate.id;
          }
        }
        batchComplete = true;
        batchesThisRun += 1;
        batchesCompleted += 1;
        ordersProcessedTotal += batch.length;
        summary.batchesCompleted += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message !== "BATCH_INCOMPLETE") {
          summary.errors += 1;
          summary.errorReport.push({
            salesOrderId: lastCandidate?.id ?? "unknown",
            orderCode: lastCandidate?.orderCode ?? null,
            message,
          });
        }
        // lote incompleto → não avança checkpoint
      }

      if (
        shouldAdvanceSalesOrderFlowRebuildCheckpoint({
          batchComplete,
          mode: options.mode,
        }) &&
        lastCandidate
      ) {
        const checkpoint: SalesOrderFlowRebuildCheckpoint = {
          version: 1,
          lastSalesOrderId: lastCandidate.id,
          lastOrderCode: lastCandidate.orderCode,
          batchesCompleted,
          ordersProcessed: ordersProcessedTotal,
          updatedAt: nowFn().toISOString(),
        };
        writeCheckpoint(
          options.checkpointFile,
          serializeSalesOrderFlowRebuildCheckpoint(checkpoint)
        );
        summary.lastCheckpoint = checkpoint;
        summary.checkpointAdvanced = true;
        checkpointAdvanced = true;
      } else {
        summary.checkpointAdvanced = checkpointAdvanced;
      }

      if (!batchComplete) break;
      if (batch.length < options.batchSize) break;
    }
  } finally {
    if (lockToken) {
      releaseLock({ lockFile: options.lockFile, token: lockToken });
    }
  }

  summary.durationMs = nowFn().getTime() - started;
  summary.exitCode = exitCodeForSalesOrderFlowRebuildSummary(summary);

  const finishedAt = nowFn();
  const metrics = aggregateSalesOrderFlowRecomputeObservabilityMetrics(
    observabilityLogs,
    {
      source: recomputeSource,
      computationVersion: SALES_ORDER_FLOW_COMPUTATION_VERSION,
      durationMs: summary.durationMs,
    }
  );
  metrics.failures = Math.max(metrics.failures, summary.errors);
  metrics.ordersEvaluated = Math.max(
    metrics.ordersEvaluated,
    summary.ordersProcessed + summary.errors
  );
  await persistObservability(db, {
    source: recomputeSource,
    metrics,
    logs: observabilityLogs,
    startedAt,
    finishedAt,
    mode: options.mode,
    errorMessage:
      summary.errors > 0
        ? `${summary.errors} pedido(s) com falha no rebuild`
        : null,
  });

  return summary;
}
