/**
 * SYNC-04 — Adapter puro: sincronizador de Pedidos ↔ motor SYNC-03.
 *
 * Regras de produto:
 * - recent-window: CREATE/UPDATE/PRESENT; nunca ausência.
 * - full-reconciliation: ausência só com prova de completude (igual OP-81).
 * - consulta direcionada: confirma candidato específico sem alterar outros.
 *
 * Sem HTTP/Prisma. Lookups e fetches entram já resolvidos.
 */

import { createHash } from "node:crypto";
import {
  buildSalesOrderIssueDateScope,
  type NomusSourcePresenceStatus,
  type NomusSourceSyncScope,
} from "./nomusSourceLifecycleContract.js";
import {
  planNomusSourceReconciliation,
  type NomusSourceDirectedLookupResult,
  type NomusSourceFoundRecord,
  type NomusSourceLocalRecord,
  type NomusSourceLifecyclePatch,
  type NomusSourceReconciliationItem,
  type NomusSourceReconciliationMode,
  type NomusSourceReconciliationPlan,
} from "./nomusSourceReconciliationEngine.js";
import type { NomusSalesOrdersSyncStrategy } from "../nomusSalesOrdersSyncWindow.js";

export type SalesOrderFetchCompletenessAssessment = {
  /** Autoriza ausência no motor (SUCCESS + payloadComplete). */
  payloadComplete: boolean;
  status: "COMPLETE" | "INCONCLUSIVE_FETCH" | "RECENT_WINDOW";
  strategy: NomusSalesOrdersSyncStrategy;
  reasons: string[];
  startPage: number;
  stoppedBecauseEmpty: boolean;
  stoppedBecauseNoNext: boolean;
  stoppedBecauseMaxPages: boolean;
  http429Count: number;
  errors: string[];
};

export type SalesOrderFetchMetaForCompleteness = {
  strategy: NomusSalesOrdersSyncStrategy;
  startPage: number;
  /** Hit maxPages no bloco (cursor) — NÃO prova universo completo. */
  completedWindow: boolean;
  stoppedBecauseEmpty: boolean;
  /** Derivado: parou sem empty e sem maxPages (hasNext=false). */
  stoppedBecauseNoNext?: boolean;
  stoppedBecauseWindowExceeded?: boolean;
  http429Count?: number;
  errors?: string[];
  /** Erro HTTP / abort não recuperado. */
  fetchFailed?: boolean;
};

/**
 * Checklist SYNC-04:
 * 1. recent-window NÃO cobre universo completo → nunca payloadComplete.
 * 2. full-reconciliation só COMPLETE com startPage=1 + drain (empty|no_next)
 *    + sem maxPages + sem erro/429 não recuperado (mesma prova OP-81).
 */
export function assessSalesOrderSyncPayloadCompleteness(
  meta: SalesOrderFetchMetaForCompleteness
): SalesOrderFetchCompletenessAssessment {
  const http429Count = meta.http429Count ?? 0;
  const errors = [...(meta.errors ?? [])];
  const reasons: string[] = [];

  if (meta.strategy === "recent-window") {
    reasons.push("RECENT_WINDOW_NEVER_MARKS_ABSENT");
    return {
      payloadComplete: false,
      status: "RECENT_WINDOW",
      strategy: meta.strategy,
      reasons,
      startPage: meta.startPage,
      stoppedBecauseEmpty: meta.stoppedBecauseEmpty,
      stoppedBecauseNoNext: meta.stoppedBecauseNoNext === true,
      stoppedBecauseMaxPages: meta.completedWindow,
      http429Count,
      errors,
    };
  }

  const stoppedBecauseNoNext =
    meta.stoppedBecauseNoNext === true ||
    (!meta.stoppedBecauseEmpty &&
      !meta.completedWindow &&
      meta.stoppedBecauseWindowExceeded !== true &&
      !meta.fetchFailed);

  const stoppedBecauseMaxPages = meta.completedWindow === true;

  if (meta.startPage !== 1) {
    reasons.push("START_PAGE_NOT_ONE_INCOMPLETE_SNAPSHOT");
  }
  if (stoppedBecauseMaxPages) {
    reasons.push("MAX_PAGES_HIT_INCOMPLETE_SNAPSHOT");
  }
  if (meta.fetchFailed) {
    reasons.push("FETCH_FAILED");
    errors.push("fetch_failed");
  }
  if (http429Count > 0 && meta.fetchFailed) {
    reasons.push("HTTP_429_UNRECOVERED");
  }
  if (errors.length > 0 && !reasons.includes("FETCH_FAILED")) {
    reasons.push("FETCH_ERRORS");
  }

  const drained = meta.stoppedBecauseEmpty || stoppedBecauseNoNext;
  if (!drained) {
    reasons.push("UNIVERSE_NOT_DRAINED");
  }

  const payloadComplete =
    meta.strategy === "full-reconciliation" &&
    meta.startPage === 1 &&
    drained &&
    !stoppedBecauseMaxPages &&
    !meta.fetchFailed &&
    errors.length === 0;

  if (payloadComplete) {
    reasons.push("FULL_RECONCILIATION_COMPLETE");
  } else if (!reasons.includes("RECENT_WINDOW_NEVER_MARKS_ABSENT")) {
    reasons.push("INCONCLUSIVE_FETCH");
  }

  return {
    payloadComplete,
    status: payloadComplete ? "COMPLETE" : "INCONCLUSIVE_FETCH",
    strategy: meta.strategy,
    reasons: [...new Set(reasons)],
    startPage: meta.startPage,
    stoppedBecauseEmpty: meta.stoppedBecauseEmpty,
    stoppedBecauseNoNext,
    stoppedBecauseMaxPages,
    http429Count,
    errors,
  };
}

export function stableNomusSalesOrderPayloadHash(
  pedido: Record<string, unknown>
): string {
  return createHash("sha256").update(JSON.stringify(pedido)).digest("hex");
}

export function buildSalesOrderSyncReconciliationScope(input: {
  strategy: NomusSalesOrdersSyncStrategy;
  fromIso: string;
  toIso: string;
}): NomusSourceSyncScope {
  return buildSalesOrderIssueDateScope({
    from: input.fromIso,
    to: input.toIso,
    strategy: input.strategy,
  });
}

export type SalesOrderLifecycleLocalSnapshot = {
  localId: string;
  externalSalesOrderId: number;
  orderCode: string;
  payloadHash: string | null;
  sourcePresenceStatus: NomusSourcePresenceStatus;
  presentInLastPayload: boolean;
  missingConsecutiveRuns: number;
  missingSince: Date | string | null;
  sourceRemovedAt: Date | string | null;
  firstSeenAt?: Date | string | null;
  lastSeenAt?: Date | string | null;
  lastSyncRunId?: string | null;
  /** issueDate ISO (YYYY-MM-DD) — usado só para diagnóstico. */
  issueDateIso?: string | null;
};

export function toSalesOrderLocalRecord(
  row: SalesOrderLifecycleLocalSnapshot,
  scope: NomusSourceSyncScope
): NomusSourceLocalRecord {
  return {
    localId: row.localId,
    externalId: String(row.externalSalesOrderId),
    entityType: "SALES_ORDER",
    payloadHash: row.payloadHash,
    sourcePresenceStatus: row.sourcePresenceStatus,
    presentInLastPayload: row.presentInLastPayload,
    missingConsecutiveRuns: row.missingConsecutiveRuns,
    missingSince: row.missingSince,
    sourceRemovedAt: row.sourceRemovedAt,
    scope,
    firstSeenAt: row.firstSeenAt,
    lastSeenAt: row.lastSeenAt,
    lastSyncRunId: row.lastSyncRunId,
  };
}

export type BuildSalesOrderReconciliationPlanArgs = {
  strategy: NomusSalesOrdersSyncStrategy;
  scope: NomusSourceSyncScope;
  completeness: SalesOrderFetchCompletenessAssessment;
  /** Kill switch NOMUS_SOURCE_RECONCILE_SALES_ORDERS_ENABLED. */
  reconciliationEnabled: boolean;
  foundPedidos: ReadonlyArray<{
    externalSalesOrderId: number;
    payloadHash: string;
  }>;
  localRecords: readonly SalesOrderLifecycleLocalSnapshot[];
  directedLookups?: ReadonlyArray<{
    externalSalesOrderId: number;
    found: boolean;
  }>;
  executedAt: Date | string;
  runId?: string | null;
  runStatus?: "SUCCESS" | "FAILED" | "INCONCLUSIVE" | "RUNNING";
  mode?: NomusSourceReconciliationMode;
};

/**
 * recent-window: flag de ausência forçada off (mesmo com env on).
 * full-reconciliation: usa flag + payloadComplete da prova OP-81.
 */
export function buildSalesOrderSourceReconciliationPlan(
  args: BuildSalesOrderReconciliationPlanArgs
): NomusSourceReconciliationPlan {
  const absenceAllowed =
    args.strategy === "full-reconciliation" &&
    args.reconciliationEnabled &&
    args.completeness.payloadComplete;

  const status =
    args.runStatus ??
    (args.completeness.status === "COMPLETE" ||
    args.strategy === "recent-window"
      ? "SUCCESS"
      : args.completeness.errors.length > 0
        ? "FAILED"
        : "INCONCLUSIVE");

  const found: NomusSourceFoundRecord[] = args.foundPedidos.map((p) => ({
    externalId: String(p.externalSalesOrderId),
    payloadHash: p.payloadHash,
  }));

  const directedLookups: NomusSourceDirectedLookupResult[] = (
    args.directedLookups ?? []
  ).map((d) => ({
    externalId: String(d.externalSalesOrderId),
    found: d.found,
  }));

  const localRecords = args.localRecords.map((row) =>
    toSalesOrderLocalRecord(row, args.scope)
  );

  const plan = planNomusSourceReconciliation({
    entityType: "SALES_ORDER",
    scope: args.scope,
    run: {
      id: args.runId ?? null,
      status,
      payloadComplete: args.completeness.payloadComplete,
      entityType: "SALES_ORDER",
      scope: args.scope,
    },
    found,
    localRecords,
    directedLookups,
    executedAt: args.executedAt,
    reconciliationEnabled: absenceAllowed,
    mode: args.mode ?? "preview",
    confirmation: {
      consecutiveCompleteMissesToConfirm: 2,
      confirmViaDirectedLookup: true,
    },
  });

  if (args.strategy === "recent-window") {
    plan.reasons = [
      ...new Set([...plan.reasons, "RECENT_WINDOW_NEVER_MARKS_ABSENT"]),
    ];
  }

  return plan;
}

/**
 * Confirma ausência de UM pedido via consulta direcionada oficial.
 * Não altera outros pedidos; não exige universo completo do sync.
 */
export function planDirectedSalesOrderAbsenceConfirmation(input: {
  local: SalesOrderLifecycleLocalSnapshot;
  scope: NomusSourceSyncScope;
  directedFound: boolean;
  executedAt: Date | string;
  runId?: string | null;
  mode?: NomusSourceReconciliationMode;
}): NomusSourceReconciliationItem | null {
  if (input.directedFound) return null;

  const executedAt =
    input.executedAt instanceof Date
      ? input.executedAt
      : new Date(input.executedAt);
  const nextRuns = Math.max(0, input.local.missingConsecutiveRuns) + 1;
  const patch: NomusSourceLifecyclePatch = {
    sourcePresenceStatus: "MISSING_CONFIRMED",
    presentInLastPayload: false,
    lastSeenAt: input.local.lastSeenAt ?? null,
    missingSince: input.local.missingSince ?? executedAt,
    missingConsecutiveRuns: nextRuns,
    sourceRemovedAt: input.local.sourceRemovedAt ?? executedAt,
    lastSyncRunId: input.runId ?? null,
  };

  const mode = input.mode ?? "preview";
  return {
    action: "MISSING_CONFIRMED",
    externalId: String(input.local.externalSalesOrderId),
    localId: input.local.localId,
    entityType: "SALES_ORDER",
    reason: "DIRECTED_LOOKUP_NOT_FOUND",
    previousPresenceStatus: input.local.sourcePresenceStatus,
    nextPresenceStatus: "MISSING_CONFIRMED",
    payloadChanged: null,
    lifecyclePatch: mode === "apply" ? patch : null,
  };
}

/** Campos oficiais de presença a gravar em CREATE/UPDATE/REACTIVATE. */
export function buildPresentLifecycleWriteData(input: {
  payloadHash: string;
  executedAt: Date;
  runId: string | null;
  isCreate: boolean;
}): Record<string, unknown> {
  const data: Record<string, unknown> = {
    payloadHash: input.payloadHash,
    sourcePresenceStatus: "PRESENT",
    presentInLastPayload: true,
    lastSeenAt: input.executedAt,
    missingSince: null,
    missingConsecutiveRuns: 0,
    sourceRemovedAt: null,
    lastSyncRunId: input.runId,
  };
  if (input.isCreate) {
    data.firstSeenAt = input.executedAt;
  }
  return data;
}

export type SalesOrderReconciliationPreviewSummary = {
  creates: Array<{ externalId: string; localId: string | null; reason: string }>;
  updates: Array<{ externalId: string; localId: string | null; reason: string }>;
  unchanged: Array<{ externalId: string; localId: string | null; reason: string }>;
  missingCandidates: Array<{
    externalId: string;
    localId: string | null;
    reason: string;
    orderCode?: string | null;
  }>;
  missingConfirmed: Array<{
    externalId: string;
    localId: string | null;
    reason: string;
    orderCode?: string | null;
  }>;
  reactivated: Array<{ externalId: string; localId: string | null; reason: string }>;
  ignoredOutsideScope: Array<{
    externalId: string;
    localId: string | null;
    reason: string;
  }>;
  inconclusive: Array<{ externalId: string; localId: string | null; reason: string }>;
  fetchCompleteness: SalesOrderFetchCompletenessAssessment;
  counters: NomusSourceReconciliationPlan["counters"];
  reasons: string[];
  absencesEvaluated: boolean;
};

export function summarizeSalesOrderReconciliationPreview(
  plan: NomusSourceReconciliationPlan,
  completeness: SalesOrderFetchCompletenessAssessment,
  orderCodeByExternalId?: ReadonlyMap<string, string>
): SalesOrderReconciliationPreviewSummary {
  const mapItems = (items: NomusSourceReconciliationItem[]) =>
    items.map((i) => ({
      externalId: i.externalId,
      localId: i.localId,
      reason: i.reason,
      orderCode: orderCodeByExternalId?.get(i.externalId) ?? null,
    }));

  return {
    creates: mapItems(plan.creates).map(({ orderCode: _o, ...rest }) => rest),
    updates: mapItems(plan.updates).map(({ orderCode: _o, ...rest }) => rest),
    unchanged: mapItems(plan.unchanged).map(({ orderCode: _o, ...rest }) => rest),
    missingCandidates: mapItems(plan.missingCandidates),
    missingConfirmed: mapItems(plan.missingConfirmed),
    reactivated: mapItems(plan.reactivated).map(({ orderCode: _o, ...rest }) => rest),
    ignoredOutsideScope: mapItems(plan.ignoredOutsideScope).map(
      ({ orderCode: _o, ...rest }) => rest
    ),
    inconclusive: mapItems(plan.inconclusive).map(({ orderCode: _o, ...rest }) => rest),
    fetchCompleteness: completeness,
    counters: plan.counters,
    reasons: plan.reasons,
    absencesEvaluated: plan.absencesEvaluated,
  };
}

/** PD 02739 — caso piloto documentado (OP-81 / SYNC-04). */
export const SALES_ORDER_PILOT_ABSENCE = {
  orderCode: "PD 02739",
  externalSalesOrderId: 2737,
} as const;

export function isSalesOrderPilotAbsence(input: {
  orderCode?: string | null;
  externalSalesOrderId?: number | null;
}): boolean {
  if (input.externalSalesOrderId === SALES_ORDER_PILOT_ABSENCE.externalSalesOrderId) {
    return true;
  }
  const code = (input.orderCode ?? "").replace(/\s+/g, "").toUpperCase();
  return code === "PD02739";
}
