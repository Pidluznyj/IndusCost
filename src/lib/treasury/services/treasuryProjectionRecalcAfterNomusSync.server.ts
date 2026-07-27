/**
 * Hook pós-sync AR/AP — enfileira recálculo na fila PostgreSQL após run oficial SUCCESS.
 * Não altera upserts/checkpoints Nemus; não inicia cron.
 */

import type { PrismaClient } from "@prisma/client";
import {
  buildTreasuryProjectionRecalcAfterNomusSyncPayload,
  resolveTreasuryCompanyCodeForNomusSync,
  shouldEnqueueTreasuryProjectionRecalcAfterNomusSync,
  type TreasuryProjectionRecalcAfterNomusSyncDecision,
} from "../domain/treasuryProjectionRecalcAfterNomusSync.js";
import { createTreasuryProjectionRecalcJobRepository } from "../repositories/treasuryProjectionRecalcJobRepository.server.js";
import type { TreasuryProjectionRecalcJobRepository } from "../repositories/treasuryProjectionRecalcJobRepository.server.js";
import {
  enqueueTreasuryProjectionRecalcForDefaultScenarios,
  type EnqueueTreasuryProjectionRecalcResult,
} from "./treasuryProjectionRecalcQueueService.server.js";

export type RunTreasuryProjectionRecalcAfterNomusSyncInput = {
  source: "accounts-receivable" | "accounts-payable";
  eventType: "AR_SYNC" | "AP_SYNC";
  mode: "apply" | "preview" | "dry";
  exitCode: number;
  payloadComplete: boolean;
  officialRunSucceeded: boolean;
  sourceSyncRunId: string | null;
  coveredFrom: Date;
  coveredTo: Date;
  created: number;
  updated: number;
  lifecycleApplied?: number;
  requestId?: string | null;
  companyCode?: string | null;
};

export type RunTreasuryProjectionRecalcAfterNomusSyncResult = {
  decision: TreasuryProjectionRecalcAfterNomusSyncDecision;
  companyCode: string | null;
  jobs: EnqueueTreasuryProjectionRecalcResult[];
};

export type TreasuryProjectionRecalcAfterNomusSyncDeps = {
  repository: TreasuryProjectionRecalcJobRepository;
  now?: () => Date;
  companyCode?: string;
};

export function createTreasuryProjectionRecalcAfterNomusSyncDeps(
  db: PrismaClient
): TreasuryProjectionRecalcAfterNomusSyncDeps {
  return {
    repository: createTreasuryProjectionRecalcJobRepository(db),
  };
}

export async function runTreasuryProjectionRecalcAfterNomusSync(
  input: RunTreasuryProjectionRecalcAfterNomusSyncInput,
  deps: TreasuryProjectionRecalcAfterNomusSyncDeps
): Promise<RunTreasuryProjectionRecalcAfterNomusSyncResult> {
  const decision = shouldEnqueueTreasuryProjectionRecalcAfterNomusSync({
    mode: input.mode,
    exitCode: input.exitCode,
    payloadComplete: input.payloadComplete,
    officialRunSucceeded: input.officialRunSucceeded,
    created: input.created,
    updated: input.updated,
    lifecycleApplied: input.lifecycleApplied,
  });

  if (!decision.enqueue) {
    return { decision, companyCode: null, jobs: [] };
  }

  const companyCode =
    input.companyCode?.trim().toUpperCase() ||
    deps.companyCode ||
    resolveTreasuryCompanyCodeForNomusSync();
  const now = deps.now?.() ?? new Date();
  const payload = buildTreasuryProjectionRecalcAfterNomusSyncPayload({
    source: input.source,
    eventType: input.eventType,
    sourceSyncRunId: input.sourceSyncRunId,
    coveredFrom: input.coveredFrom,
    coveredTo: input.coveredTo,
    created: input.created,
    updated: input.updated,
    lifecycleApplied: input.lifecycleApplied,
    now,
  });

  const jobs = await enqueueTreasuryProjectionRecalcForDefaultScenarios(
    {
      companyCode,
      eventType: input.eventType,
      subjectId: "*",
      payload,
      requestId: input.requestId ?? input.sourceSyncRunId,
    },
    { repository: deps.repository, now: () => now }
  );

  return { decision, companyCode, jobs };
}

export function formatTreasuryProjectionRecalcAfterNomusSyncLog(
  result: RunTreasuryProjectionRecalcAfterNomusSyncResult
): string {
  if (!result.decision.enqueue) {
    return `[treasury-projection-recalc-after-sync] ignorado reason=${result.decision.reason}`;
  }
  const deduped = result.jobs.filter((j) => j.deduplicated).length;
  const created = result.jobs.length - deduped;
  return (
    `[treasury-projection-recalc-after-sync] enfileirado company=${result.companyCode} ` +
    `jobs=${result.jobs.length} created=${created} deduplicated=${deduped} ` +
    `reason=${result.decision.reason}`
  );
}
