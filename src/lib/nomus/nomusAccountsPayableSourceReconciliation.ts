/**
 * SYNC-06 — Adapter puro: Contas a Pagar ↔ motor SYNC-03.
 *
 * Independência dura: ausência de Pedido/CR NÃO implica ausência de CP
 * (ex.: fontes independentes).
 *
 * Sem HTTP/Prisma.
 */

import {
  buildAccountsPayableDueDateScope,
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

/** Escopo autoritativo declarado na execução. */
export type AccountsPayableAuthoritativeScopeKind =
  | "DUE_DATE_WINDOW_ALL_TITLES"
  | "OPEN_PAYABLES_SCOPE";

export type AccountsPayableFetchCompletenessAssessment = {
  payloadComplete: boolean;
  status: "COMPLETE" | "INCONCLUSIVE_FETCH" | "OPEN_SCOPE_COMPLETE";
  /** Label operacional do syncer (não prova completude sozinho). */
  syncStrategy: string;
  authoritativeScope: AccountsPayableAuthoritativeScopeKind;
  onlyPending: boolean;
  reasons: string[];
  startPage: number;
  stoppedBecauseEmpty: boolean;
  stoppedBecauseNoNext: boolean;
  stoppedBecauseMaxPages: boolean;
  http429Count: number;
  errors: string[];
};

export type AccountsPayableFetchMetaForCompleteness = {
  syncStrategy: string;
  startPage: number;
  maxPages: number;
  pagesRead: number;
  stoppedBecauseEmpty: boolean;
  stoppedBecauseNoNext: boolean;
  /** true se parou por atingir lastPage do plano (maxPages). */
  stoppedBecauseMaxPages: boolean;
  onlyPending: boolean;
  http429Count?: number;
  errors?: string[];
  fetchFailed?: boolean;
};

/**
 * Checklist SYNC-06 / SYNC-01:
 * 1. Endpoint cobre janela de vencimento + apenasPendentes — não “todo o Nomus”.
 * 2. apenasPendentes=false → pagos/liquidados entram no payload.
 * 3. Cancelados: status boolean mapeado (não são delete).
 * 4. Sem GET individual oficial — confirmação via lookup em lista ou 2ª run.
 * 5. Label full_refresh_upsert NÃO prova completude; exige drain startPage=1.
 */
export function assessAccountsPayableSyncPayloadCompleteness(
  meta: AccountsPayableFetchMetaForCompleteness
): AccountsPayableFetchCompletenessAssessment {
  const http429Count = meta.http429Count ?? 0;
  const errors = [...(meta.errors ?? [])];
  const reasons: string[] = [];
  const authoritativeScope: AccountsPayableAuthoritativeScopeKind =
    meta.onlyPending
      ? "OPEN_PAYABLES_SCOPE"
      : "DUE_DATE_WINDOW_ALL_TITLES";

  if (meta.onlyPending) {
    reasons.push("OPEN_PAYABLES_SCOPE");
    reasons.push("PAID_HISTORICAL_TITLES_OUT_OF_ABSENCE_UNIVERSE");
  } else {
    reasons.push("DUE_DATE_WINDOW_ALL_TITLES");
    reasons.push("PAID_TITLES_INCLUDED_IN_PAYLOAD_WHEN_PRESENT");
  }

  if (meta.startPage !== 1) {
    reasons.push("START_PAGE_NOT_ONE_INCOMPLETE_SNAPSHOT");
  }
  if (meta.stoppedBecauseMaxPages) {
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

  const drained = meta.stoppedBecauseEmpty || meta.stoppedBecauseNoNext;
  if (!drained) {
    reasons.push("UNIVERSE_NOT_DRAINED");
  }

  // Label full_refresh_upsert sozinho NÃO autoriza ausência.
  const payloadComplete =
    meta.startPage === 1 &&
    drained &&
    !meta.stoppedBecauseMaxPages &&
    !meta.fetchFailed &&
    errors.length === 0;

  if (payloadComplete) {
    reasons.push(
      meta.onlyPending
        ? "OPEN_SCOPE_FETCH_COMPLETE"
        : "DUE_DATE_WINDOW_FETCH_COMPLETE"
    );
  } else {
    reasons.push("INCONCLUSIVE_FETCH");
    reasons.push("ABSENCE_CONFIRMATION_BLOCKED");
  }

  return {
    payloadComplete,
    status: payloadComplete
      ? meta.onlyPending
        ? "OPEN_SCOPE_COMPLETE"
        : "COMPLETE"
      : "INCONCLUSIVE_FETCH",
    syncStrategy: meta.syncStrategy,
    authoritativeScope,
    onlyPending: meta.onlyPending,
    reasons: [...new Set(reasons)],
    startPage: meta.startPage,
    stoppedBecauseEmpty: meta.stoppedBecauseEmpty,
    stoppedBecauseNoNext: meta.stoppedBecauseNoNext,
    stoppedBecauseMaxPages: meta.stoppedBecauseMaxPages,
    http429Count,
    errors,
  };
}

export function parseNomusFinancialOnlyPending(
  env: { NOMUS_FINANCIAL_ONLY_PENDING?: string } = process.env
): boolean {
  const raw = (env.NOMUS_FINANCIAL_ONLY_PENDING ?? "false").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

export function buildAccountsPayableSyncReconciliationScope(input: {
  from: string;
  to: string;
  onlyPending: boolean;
  syncStrategy: string;
}): NomusSourceSyncScope {
  return buildAccountsPayableDueDateScope({
    from: input.from,
    to: input.to,
    onlyPending: input.onlyPending,
    strategy: input.onlyPending
      ? `OPEN_PAYABLES_SCOPE:${input.syncStrategy}`
      : input.syncStrategy,
  });
}

/** Título ainda no universo aberto (não liquidado / com saldo). */
export function isOpenAccountsPayableTitle(input: {
  balancePayable?: number | null;
  settlementDate?: Date | string | null;
}): boolean {
  if (input.settlementDate != null && String(input.settlementDate).trim() !== "") {
    return false;
  }
  const bal = input.balancePayable ?? 0;
  return Number.isFinite(bal) && bal > 0.000001;
}

export type AccountsPayableLifecycleLocalSnapshot = {
  localId: string;
  externalId: number;
  payloadHash: string | null;
  sourcePresenceStatus: NomusSourcePresenceStatus;
  presentInLastPayload: boolean;
  missingConsecutiveRuns: number;
  missingSince: Date | string | null;
  sourceRemovedAt: Date | string | null;
  firstSeenAt?: Date | string | null;
  lastSeenAt?: Date | string | null;
  lastSyncRunId?: string | null;
  dueDateIso?: string | null;
  balancePayable?: number | null;
  amountPaid?: number | null;
  settlementDate?: Date | string | null;
  status?: boolean | null;
  description?: string | null;
};

export function toAccountsPayableLocalRecord(
  row: AccountsPayableLifecycleLocalSnapshot,
  scope: NomusSourceSyncScope
): NomusSourceLocalRecord {
  return {
    localId: row.localId,
    externalId: String(row.externalId),
    entityType: "ACCOUNTS_PAYABLE",
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

/**
 * Em OPEN_PAYABLES_SCOPE, só títulos abertos entram na avaliação de ausência.
 * Pagos históricos ficam fora (preservados).
 */
export function selectLocalsForAccountsPayableAbsenceUniverse(input: {
  locals: readonly AccountsPayableLifecycleLocalSnapshot[];
  onlyPending: boolean;
}): {
  inUniverse: AccountsPayableLifecycleLocalSnapshot[];
  preservedHistoricalPaid: AccountsPayableLifecycleLocalSnapshot[];
} {
  if (!input.onlyPending) {
    return { inUniverse: [...input.locals], preservedHistoricalPaid: [] };
  }
  const inUniverse: AccountsPayableLifecycleLocalSnapshot[] = [];
  const preservedHistoricalPaid: AccountsPayableLifecycleLocalSnapshot[] = [];
  for (const row of input.locals) {
    if (
      isOpenAccountsPayableTitle({
        balancePayable: row.balancePayable,
        settlementDate: row.settlementDate,
      })
    ) {
      inUniverse.push(row);
    } else {
      preservedHistoricalPaid.push(row);
    }
  }
  return { inUniverse, preservedHistoricalPaid };
}

export type BuildAccountsPayableReconciliationPlanArgs = {
  syncStrategy: string;
  scope: NomusSourceSyncScope;
  completeness: AccountsPayableFetchCompletenessAssessment;
  reconciliationEnabled: boolean;
  foundRows: ReadonlyArray<{ externalId: number; payloadHash: string }>;
  localRecords: readonly AccountsPayableLifecycleLocalSnapshot[];
  directedLookups?: ReadonlyArray<{ externalId: number; found: boolean }>;
  executedAt: Date | string;
  runId?: string | null;
  runStatus?: "SUCCESS" | "FAILED" | "INCONCLUSIVE" | "RUNNING";
  mode?: NomusSourceReconciliationMode;
};

export function buildAccountsPayableSourceReconciliationPlan(
  args: BuildAccountsPayableReconciliationPlanArgs
): NomusSourceReconciliationPlan {
  const absenceAllowed =
    args.reconciliationEnabled && args.completeness.payloadComplete;

  const status =
    args.runStatus ??
    (args.completeness.payloadComplete
      ? "SUCCESS"
      : args.completeness.errors.length > 0
        ? "FAILED"
        : "INCONCLUSIVE");

  const { inUniverse, preservedHistoricalPaid } =
    selectLocalsForAccountsPayableAbsenceUniverse({
      locals: args.localRecords,
      onlyPending: args.completeness.onlyPending,
    });

  const found: NomusSourceFoundRecord[] = args.foundRows.map((r) => ({
    externalId: String(r.externalId),
    payloadHash: r.payloadHash,
  }));

  const directedLookups: NomusSourceDirectedLookupResult[] = (
    args.directedLookups ?? []
  ).map((d) => ({
    externalId: String(d.externalId),
    found: d.found,
  }));

  const localRecords = inUniverse.map((row) =>
    toAccountsPayableLocalRecord(row, args.scope)
  );

  const plan = planNomusSourceReconciliation({
    entityType: "ACCOUNTS_PAYABLE",
    scope: args.scope,
    run: {
      id: args.runId ?? null,
      status,
      payloadComplete: args.completeness.payloadComplete,
      entityType: "ACCOUNTS_PAYABLE",
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

  for (const paid of preservedHistoricalPaid) {
    plan.ignoredOutsideScope.push({
      action: "IGNORE_OUTSIDE_SCOPE",
      externalId: String(paid.externalId),
      localId: paid.localId,
      entityType: "ACCOUNTS_PAYABLE",
      reason: "PAID_HISTORICAL_OUTSIDE_OPEN_PAYABLES_SCOPE",
      previousPresenceStatus: paid.sourcePresenceStatus,
      nextPresenceStatus: paid.sourcePresenceStatus,
      payloadChanged: null,
      lifecyclePatch: null,
    });
    plan.counters.ignoredOutsideScope += 1;
  }

  plan.reasons = [
    ...new Set([
      ...plan.reasons,
      ...args.completeness.reasons,
      "OTHER_ENTITY_ABSENCE_DOES_NOT_IMPLY_AP_ABSENCE",
    ]),
  ];

  return plan;
}

export function planDirectedAccountsPayableAbsenceConfirmation(input: {
  local: AccountsPayableLifecycleLocalSnapshot;
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
    externalId: String(input.local.externalId),
    localId: input.local.localId,
    entityType: "ACCOUNTS_PAYABLE",
    reason: "DIRECTED_LOOKUP_NOT_FOUND",
    previousPresenceStatus: input.local.sourcePresenceStatus,
    nextPresenceStatus: "MISSING_CONFIRMED",
    payloadChanged: null,
    lifecyclePatch: mode === "apply" ? patch : null,
  };
}

export function buildPresentAccountsPayableLifecycleWriteData(input: {
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

export type AccountsPayableReconciliationPreviewSummary = {
  creates: Array<{ externalId: string; localId: string | null; reason: string }>;
  updates: Array<{ externalId: string; localId: string | null; reason: string }>;
  unchanged: Array<{ externalId: string; localId: string | null; reason: string }>;
  missingCandidates: Array<{
    externalId: string;
    localId: string | null;
    reason: string;
    balancePayable?: number | null;
    amountPaid?: number | null;
  }>;
  missingConfirmed: Array<{
    externalId: string;
    localId: string | null;
    reason: string;
    balancePayable?: number | null;
    amountPaid?: number | null;
  }>;
  reactivated: Array<{ externalId: string; localId: string | null; reason: string }>;
  ignoredOutsideScope: Array<{
    externalId: string;
    localId: string | null;
    reason: string;
  }>;
  inconclusive: Array<{ externalId: string; localId: string | null; reason: string }>;
  fetchCompleteness: AccountsPayableFetchCompletenessAssessment;
  scope: NomusSourceSyncScope;
  authoritativeScope: AccountsPayableAuthoritativeScopeKind;
  /** Soma de saldo aberto dos ausentes (candidato+confirmado). */
  totalOpenAffected: number;
  /** Soma de valor já recebido nos ausentes — permanece no registro (não apagar). */
  /** Soma de valor já pago nos ausentes — permanece no registro. */
  totalPaidHistoricalProtected: number;
  counters: NomusSourceReconciliationPlan["counters"];
  reasons: string[];
  absencesEvaluated: boolean;
};

function moneyOf(value: number | null | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function summarizeAccountsPayableReconciliationPreview(
  plan: NomusSourceReconciliationPlan,
  completeness: AccountsPayableFetchCompletenessAssessment,
  scope: NomusSourceSyncScope,
  localsByExternalId?: ReadonlyMap<string, AccountsPayableLifecycleLocalSnapshot>
): AccountsPayableReconciliationPreviewSummary {
  const enrichMissing = (items: NomusSourceReconciliationItem[]) =>
    items.map((i) => {
      const local = localsByExternalId?.get(i.externalId);
      return {
        externalId: i.externalId,
        localId: i.localId,
        reason: i.reason,
        balancePayable: local?.balancePayable ?? null,
        amountPaid: local?.amountPaid ?? null,
      };
    });

  const missingAll = [
    ...plan.missingCandidates,
    ...plan.missingConfirmed,
  ];
  let totalOpenAffected = 0;
  let totalPaidHistoricalProtected = 0;
  for (const item of missingAll) {
    const local = localsByExternalId?.get(item.externalId);
    totalOpenAffected += moneyOf(local?.balancePayable);
    totalPaidHistoricalProtected += moneyOf(local?.amountPaid);
  }

  const simple = (items: NomusSourceReconciliationItem[]) =>
    items.map((i) => ({
      externalId: i.externalId,
      localId: i.localId,
      reason: i.reason,
    }));

  return {
    creates: simple(plan.creates),
    updates: simple(plan.updates),
    unchanged: simple(plan.unchanged),
    missingCandidates: enrichMissing(plan.missingCandidates),
    missingConfirmed: enrichMissing(plan.missingConfirmed),
    reactivated: simple(plan.reactivated),
    ignoredOutsideScope: simple(plan.ignoredOutsideScope),
    inconclusive: simple(plan.inconclusive),
    fetchCompleteness: completeness,
    scope,
    authoritativeScope: completeness.authoritativeScope,
    totalOpenAffected,
    totalPaidHistoricalProtected,
    counters: plan.counters,
    reasons: plan.reasons,
    absencesEvaluated: plan.absencesEvaluated,
  };
}

/** CR piloto ligado ao PD 02739 — entidade independente. */
/**
 * Eixo operacional obrigatório: vencimento (dueDate).
 * Não usar paymentDate/competenceDate como substituto em relatórios.
 */
export function assertAccountsPayableOperationalAxisIsDueDate(input: {
  dueDate: Date | string | null | undefined;
  paymentDate?: Date | string | null;
  competenceDate?: Date | string | null;
  operationalDueDate: Date | string | null | undefined;
}): void {
  if (input.dueDate == null) return;
  const due =
    input.dueDate instanceof Date
      ? input.dueDate.toISOString()
      : String(input.dueDate);
  const op =
    input.operationalDueDate instanceof Date
      ? input.operationalDueDate.toISOString()
      : String(input.operationalDueDate ?? "");
  if (op && op !== due) {
    // scheduleDate fallback is allowed only when dueDate is null (handled above).
    throw new Error(
      "Contas a Pagar: eixo operacional deve ser data de vencimento (dueDate)."
    );
  }
}

/**
 * Proteção financeira: patches de ausência NÃO devem zerar valores históricos.
 * (O motor só altera campos de presença; este helper documenta/valida o contrato.)
 */
export function assertAbsencePatchPreservesFinancialHistory(patch: NomusSourceLifecyclePatch): void {
  const forbidden = [
    "amountPaid",
    "amountPayable",
    "balancePayable",
    "settlementDate",
    "paymentDate",
    "documentNumber",
    "dueDate",
    "rawPayload",
    "costCenter",
    "costCenterId",
  ];
  for (const key of forbidden) {
    if (Object.prototype.hasOwnProperty.call(patch, key)) {
      throw new Error(
        `Absence lifecycle patch must not touch financial field: ${key}`
      );
    }
  }
}
