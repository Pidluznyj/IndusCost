/**
 * Saúde da sincronização de Pedidos de Compra Nomus (puro, sem I/O).
 *
 * Regras:
 *   - "último sucesso" = último run SUCCESS que não é prévia (SKIPPED/INCONCLUSIVE/FAILED nunca contam);
 *   - STALE = sem sucesso dentro do limite da fonte ativa, ou run RUNNING preso além do limite;
 *   - pulo nunca atualiza o último sucesso.
 */

export type PurchaseOrderSyncRunLite = {
  id: string;
  status: string;
  strategy: string;
  startedAt: Date;
  finishedAt: Date | null;
  payloadComplete: boolean;
  summaryJson?: unknown;
};

export type PurchaseOrderSyncOverallStatus =
  | "OK"
  | "RUNNING"
  | "STALE"
  | "FAILED"
  | "INCONCLUSIVE"
  | "NEVER_RAN";

export function isPreviewStrategy(strategy: string): boolean {
  return strategy.endsWith("_PREVIEW");
}

export function isCountableSuccess(run: Pick<PurchaseOrderSyncRunLite, "status" | "strategy">): boolean {
  return run.status === "SUCCESS" && !isPreviewStrategy(run.strategy);
}

/** Próximos disparos da agenda própria (hora cheia + 37 min; diário 06:37 UTC = 03:37 BRT). */
export function computeNextPurchaseOrderRuns(now: Date): { nextHourlyAt: Date; nextDailyAt: Date } {
  const hourly = new Date(now);
  hourly.setUTCMinutes(37, 0, 0);
  if (hourly.getTime() <= now.getTime()) hourly.setUTCHours(hourly.getUTCHours() + 1);
  const daily = new Date(now);
  daily.setUTCHours(6, 37, 0, 0);
  if (daily.getTime() <= now.getTime()) daily.setUTCDate(daily.getUTCDate() + 1);
  return { nextHourlyAt: hourly, nextDailyAt: daily };
}

/** Limite de defasagem: agenda própria = 3 h; encadeamento após CR (a cada 2 h) = 5 h. */
export function resolvePurchaseOrderStaleHours(
  scheduleSource: "chain" | "independent",
  env: Record<string, string | undefined> = process.env
): number {
  const raw = Number(env.NOMUS_PO_STALE_HOURS);
  if (Number.isFinite(raw) && raw >= 1 && raw <= 24 * 7) return raw;
  return scheduleSource === "independent" ? 3 : 5;
}

export function computePurchaseOrderSyncHealth(input: {
  runs: readonly PurchaseOrderSyncRunLite[];
  now: Date;
  staleHours: number;
  /** Limite para um RUNNING ser considerado preso (processo morto sem finalizar o run). */
  runningStuckMinutes?: number;
}): {
  overallStatus: PurchaseOrderSyncOverallStatus;
  staleReason: string | null;
  lastRun: PurchaseOrderSyncRunLite | null;
  lastSuccess: PurchaseOrderSyncRunLite | null;
  lastFailure: PurchaseOrderSyncRunLite | null;
  lastSkipped: PurchaseOrderSyncRunLite | null;
  lastFullReconciliation: PurchaseOrderSyncRunLite | null;
  hoursSinceLastSuccess: number | null;
} {
  const sorted = [...input.runs].sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());
  const lastRun = sorted[0] ?? null;
  const lastSuccess = sorted.find(isCountableSuccess) ?? null;
  const lastFailure = sorted.find((r) => r.status === "FAILED" || r.status === "INCONCLUSIVE") ?? null;
  const lastSkipped = sorted.find((r) => r.status === "SKIPPED") ?? null;
  const lastFullReconciliation =
    sorted.find((r) => r.strategy === "FULL_RECONCILIATION" && r.status !== "SKIPPED") ?? null;
  const hoursSinceLastSuccess = lastSuccess
    ? (input.now.getTime() - (lastSuccess.finishedAt ?? lastSuccess.startedAt).getTime()) / 3_600_000
    : null;
  const stuckMs = (input.runningStuckMinutes ?? 120) * 60_000;

  let overallStatus: PurchaseOrderSyncOverallStatus;
  let staleReason: string | null = null;
  if (!lastRun) {
    overallStatus = "NEVER_RAN";
  } else if (lastRun.status === "RUNNING") {
    if (input.now.getTime() - lastRun.startedAt.getTime() > stuckMs) {
      overallStatus = "STALE";
      staleReason = "RUN_STUCK_IN_RUNNING";
    } else {
      overallStatus = "RUNNING";
    }
  } else if (hoursSinceLastSuccess == null || hoursSinceLastSuccess > input.staleHours) {
    overallStatus = "STALE";
    staleReason = hoursSinceLastSuccess == null ? "NO_SUCCESSFUL_RUN" : "LAST_SUCCESS_TOO_OLD";
  } else if (lastRun.status === "FAILED") {
    overallStatus = "FAILED";
  } else if (lastRun.status === "INCONCLUSIVE") {
    overallStatus = "INCONCLUSIVE";
  } else {
    overallStatus = "OK";
  }

  return {
    overallStatus,
    staleReason,
    lastRun,
    lastSuccess,
    lastFailure,
    lastSkipped,
    lastFullReconciliation,
    hoursSinceLastSuccess: hoursSinceLastSuccess == null ? null : Math.round(hoursSinceLastSuccess * 100) / 100,
  };
}

/** Campos do summaryJson que o painel pode exibir (nada de payload, URL ou credencial). */
const SAFE_SUMMARY_KEYS = [
  "trigger",
  "correlationId",
  "requestedBy",
  "scheduleSource",
  "scheduleDelaySeconds",
  "mode",
  "strategy",
  "scopeKind",
  "window",
  "flags",
  "fetch",
  "completeness",
  "applied",
  "canceledInPayload",
  "plan",
  "guards",
  "alerts",
  "previewOnly",
  "absenceWritesApplied",
  "eventsWritten",
  "missingCandidatesSample",
  "missingConfirmedSample",
  "reactivatedSample",
  "directedLookup",
  "targetedLookup",
  "partial",
  "durationMs",
  "skipReason",
  "waitedSeconds",
  "error",
] as const;

export function sanitizePurchaseOrderRunSummary(summary: unknown): Record<string, unknown> | null {
  if (!summary || typeof summary !== "object" || Array.isArray(summary)) return null;
  const source = summary as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of SAFE_SUMMARY_KEYS) {
    if (key in source) out[key] = source[key];
  }
  return out;
}

export const NOMUS_PO_RECONCILE_AUTHORIZE_PHRASE = "AUTORIZO AUSENCIAS PEDIDOS DE COMPRA";
