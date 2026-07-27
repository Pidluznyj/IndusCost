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
import {
  createTreasuryPostClosingChangeService,
  type TreasuryPostClosingRecordResult,
} from "./treasuryPostClosingChangeService.server.js";
import { toCivilDateKey } from "@/src/lib/financeCivilDate.js";

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
  postClosing: TreasuryPostClosingRecordResult[];
};

export type TreasuryProjectionRecalcAfterNomusSyncDeps = {
  repository: TreasuryProjectionRecalcJobRepository;
  now?: () => Date;
  companyCode?: string;
  prisma?: PrismaClient;
  scanPostClosing?: (input: {
    companyCode: string;
    dateFrom: string;
    dateTo: string;
    forceWithoutHash?: boolean;
    requestId?: string | null;
    now?: Date;
  }) => Promise<TreasuryPostClosingRecordResult[]>;
};

export function createTreasuryProjectionRecalcAfterNomusSyncDeps(
  db: PrismaClient
): TreasuryProjectionRecalcAfterNomusSyncDeps {
  const postClosing = createTreasuryPostClosingChangeService({ prisma: db });
  return {
    repository: createTreasuryProjectionRecalcJobRepository(db),
    prisma: db,
    scanPostClosing: (input) => postClosing.scanClosedDaysAfterSync(input),
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
    return { decision, companyCode: null, jobs: [], postClosing: [] };
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

  let postClosing: TreasuryPostClosingRecordResult[] = [];
  const dateFrom = toCivilDateKey(input.coveredFrom);
  const dateTo = toCivilDateKey(input.coveredTo);
  if (deps.scanPostClosing && dateFrom && dateTo) {
    try {
      postClosing = await deps.scanPostClosing({
        companyCode,
        dateFrom,
        dateTo,
        forceWithoutHash: true,
        requestId: input.requestId ?? input.sourceSyncRunId,
        now,
      });
    } catch {
      postClosing = [];
    }
  }

  return { decision, companyCode, jobs, postClosing };
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
