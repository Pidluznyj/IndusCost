/**
 * Regras puras — quando o sync oficial AR/AP pode solicitar recálculo de projeção.
 * Não altera lógica financeira Nemus; não cria cron.
 */

import type { TreasuryProjectionRecalcEventType } from "../contracts/treasuryEnums.js";

export const TREASURY_COMPANY_CODE_ENV = "TREASURY_COMPANY_CODE";
export const TREASURY_DEFAULT_COMPANY_CODE = "LAZARIOS";

export type TreasuryProjectionRecalcAfterNomusSyncDecisionInput = {
  mode: "apply" | "preview" | "dry";
  exitCode: number;
  payloadComplete: boolean;
  /** finish*SourceSyncRun concluiu com SUCCESS. */
  officialRunSucceeded: boolean;
  created: number;
  updated: number;
  lifecycleApplied?: number;
};

export type TreasuryProjectionRecalcAfterNomusSyncDecision = {
  enqueue: boolean;
  reason: string;
};

export type TreasuryProjectionRecalcAffectedPeriod = {
  affectedPeriodFrom: string;
  affectedPeriodTo: string;
};

export type TreasuryProjectionRecalcAfterNomusSyncPayload =
  TreasuryProjectionRecalcAffectedPeriod & {
    source: "accounts-receivable" | "accounts-payable";
    eventType: TreasuryProjectionRecalcEventType;
    sourceSyncRunId: string | null;
    created: number;
    updated: number;
    lifecycleApplied: number;
    enqueuedAt: string;
    sourceSyncRunIds?: string[];
  };

export function resolveTreasuryCompanyCodeForNomusSync(
  env: Record<string, string | undefined> = process.env
): string {
  const raw =
    env[TREASURY_COMPANY_CODE_ENV]?.trim() ||
    env.COMPANY_CODE?.trim() ||
    TREASURY_DEFAULT_COMPANY_CODE;
  return raw.toUpperCase();
}

export function toTreasuryCivilDateKey(value: Date): string {
  return value.toISOString().slice(0, 10);
}

/**
 * Emite somente após sync apply completo e run oficial SUCCESS,
 * com mudanças relevantes. Nunca em preview, FAILED ou INCONCLUSIVE.
 */
export function shouldEnqueueTreasuryProjectionRecalcAfterNomusSync(
  input: TreasuryProjectionRecalcAfterNomusSyncDecisionInput
): TreasuryProjectionRecalcAfterNomusSyncDecision {
  if (input.mode !== "apply") {
    return { enqueue: false, reason: "preview_or_dry_skips_recalc" };
  }
  if (input.exitCode !== 0) {
    return { enqueue: false, reason: "sync_exit_failed" };
  }
  if (!input.payloadComplete) {
    return { enqueue: false, reason: "payload_incomplete_preserves_checkpoint" };
  }
  if (!input.officialRunSucceeded) {
    return { enqueue: false, reason: "official_run_not_succeeded" };
  }
  const changed =
    Math.max(0, input.created) +
    Math.max(0, input.updated) +
    Math.max(0, input.lifecycleApplied ?? 0);
  if (changed <= 0) {
    return { enqueue: false, reason: "no_relevant_changes" };
  }
  return { enqueue: true, reason: "official_sync_succeeded_with_changes" };
}

export function mergeTreasuryProjectionRecalcAffectedPeriod(
  existing: Partial<TreasuryProjectionRecalcAffectedPeriod> | null | undefined,
  incoming: TreasuryProjectionRecalcAffectedPeriod
): TreasuryProjectionRecalcAffectedPeriod {
  const from =
    existing?.affectedPeriodFrom &&
    existing.affectedPeriodFrom < incoming.affectedPeriodFrom
      ? existing.affectedPeriodFrom
      : incoming.affectedPeriodFrom;
  const to =
    existing?.affectedPeriodTo &&
    existing.affectedPeriodTo > incoming.affectedPeriodTo
      ? existing.affectedPeriodTo
      : incoming.affectedPeriodTo;
  return { affectedPeriodFrom: from, affectedPeriodTo: to };
}

export function buildTreasuryProjectionRecalcAfterNomusSyncPayload(input: {
  source: "accounts-receivable" | "accounts-payable";
  eventType: "AR_SYNC" | "AP_SYNC";
  sourceSyncRunId: string | null;
  coveredFrom: Date;
  coveredTo: Date;
  created: number;
  updated: number;
  lifecycleApplied?: number;
  now?: Date;
}): TreasuryProjectionRecalcAfterNomusSyncPayload {
  const from = toTreasuryCivilDateKey(input.coveredFrom);
  const to = toTreasuryCivilDateKey(input.coveredTo);
  const ordered =
    from <= to
      ? { affectedPeriodFrom: from, affectedPeriodTo: to }
      : { affectedPeriodFrom: to, affectedPeriodTo: from };
  return {
    ...ordered,
    source: input.source,
    eventType: input.eventType,
    sourceSyncRunId: input.sourceSyncRunId,
    sourceSyncRunIds: input.sourceSyncRunId ? [input.sourceSyncRunId] : [],
    created: input.created,
    updated: input.updated,
    lifecycleApplied: input.lifecycleApplied ?? 0,
    enqueuedAt: (input.now ?? new Date()).toISOString(),
  };
}

/** Une payloads de sync equivalentes (dedupe) expandindo o período afetado. */
export function mergeTreasuryProjectionRecalcAfterNomusSyncPayload(
  existing: unknown,
  incoming: TreasuryProjectionRecalcAfterNomusSyncPayload
): TreasuryProjectionRecalcAfterNomusSyncPayload {
  const prev =
    existing && typeof existing === "object" && !Array.isArray(existing)
      ? (existing as Record<string, unknown>)
      : {};
  const period = mergeTreasuryProjectionRecalcAffectedPeriod(
    {
      affectedPeriodFrom:
        typeof prev.affectedPeriodFrom === "string"
          ? prev.affectedPeriodFrom
          : undefined,
      affectedPeriodTo:
        typeof prev.affectedPeriodTo === "string"
          ? prev.affectedPeriodTo
          : undefined,
    },
    incoming
  );
  const prevIds = Array.isArray(prev.sourceSyncRunIds)
    ? prev.sourceSyncRunIds.filter((id): id is string => typeof id === "string")
    : [];
  const nextIds = [
    ...new Set([
      ...prevIds,
      ...(incoming.sourceSyncRunIds ?? []),
      ...(incoming.sourceSyncRunId ? [incoming.sourceSyncRunId] : []),
    ]),
  ];
  return {
    ...incoming,
    ...period,
    sourceSyncRunIds: nextIds,
    created:
      (typeof prev.created === "number" ? prev.created : 0) + incoming.created,
    updated:
      (typeof prev.updated === "number" ? prev.updated : 0) + incoming.updated,
    lifecycleApplied:
      (typeof prev.lifecycleApplied === "number" ? prev.lifecycleApplied : 0) +
      incoming.lifecycleApplied,
  };
}
