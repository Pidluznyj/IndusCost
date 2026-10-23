/**
 * Adapter puro: Pedidos de Compra Nomus ↔ motor canônico de presença (SYNC-03).
 *
 * O Nomus é a autoridade sobre a existência do pedido. Ausência na API NÃO é cancelamento:
 *   - PRESENT            → encontrado numa consulta válida;
 *   - MISSING_CANDIDATE  → não apareceu numa varredura completa e confiável do universo;
 *   - MISSING_CONFIRMED  → ausência corroborada (2 varreduras completas em execuções distintas,
 *                          com intervalo mínimo, ou consulta por ID com semântica validada);
 *   - REACTIVATE         → reapareceu: volta a PRESENT, histórico preservado.
 *
 * Proteções além do motor:
 *   - completude da busca (página 1 → fim, sem limite de páginas, sem falha HTTP, sem registro
 *     sem ID; filtro de datas ignorado/ambíguo → INCONCLUSIVE);
 *   - idempotência por execução: o mesmo run nunca conta ausência duas vezes;
 *   - intervalo mínimo entre a 1ª ausência e a confirmação (oportunidades distintas);
 *   - guarda de volume: confirmações em massa viram candidatas + alerta.
 *
 * Sem HTTP/Prisma. Nunca planeja delete físico.
 */

import {
  buildPurchaseOrderScope,
  type NomusSourcePresenceStatus,
  type NomusSourceSyncScope,
} from "./nomusSourceLifecycleContract.js";
import {
  assertNoPhysicalDeletes,
  planNomusSourceReconciliation,
  type NomusSourceDirectedLookupResult,
  type NomusSourceLifecyclePatch,
  type NomusSourceLocalRecord,
  type NomusSourceReconciliationItem,
  type NomusSourceReconciliationMode,
  type NomusSourceReconciliationPlan,
} from "./nomusSourceReconciliationEngine.js";

export type PurchaseOrderSyncStrategy = "RECENT_WINDOW" | "FULL_RECONCILIATION" | "TARGETED_LOOKUP";
export type PurchaseOrderReconcileScopeMode = "full" | "window";

/** O que a paginação efetivamente observou (preenchido pelo serviço). */
export type PurchaseOrderFetchMeta = {
  strategy: PurchaseOrderSyncStrategy;
  /** Janela enviada ao Nomus (dataInicio/dataFim); null = sem filtro de datas. */
  requestedWindow: { from: Date; to: Date } | null;
  startPage: number;
  pagesRead: number;
  recordsRead: number;
  stoppedBecauseEmpty: boolean;
  stoppedBecauseNoNext: boolean;
  stoppedBecauseMaxPages: boolean;
  fetchFailed: boolean;
  fetchError?: string | null;
  http429Count: number;
  /** Itens que não mapearam mas cujo ID oficial foi identificado (contam como encontrados). */
  mapErrorsIdentified: number;
  /** Itens sem ID oficial identificável — comprometem a identificação do universo. */
  unidentifiedRecords: number;
  duplicateRecords: number;
  /** Retornados com emissão fora da janela pedida (filtro ignorado ou com outra semântica). */
  returnedOutsideWindow: number;
  /**
   * Semântica de dataInicio/dataFim comprovada em homologação (NOMUS_PO_DATE_FILTER_VALIDATED=1).
   * Sem isso, uma janela nunca prova o universo: o filtro pode usar outro campo de data e omitir
   * pedidos emitidos na janela.
   */
  dateFilterValidated?: boolean;
};

export type PurchaseOrderFetchCompleteness = {
  /** Universo declarado percorrido de ponta a ponta, sem falha técnica. */
  payloadComplete: boolean;
  /** Status da execução no NomusSourceSyncRun. */
  runStatus: "SUCCESS" | "INCONCLUSIVE" | "FAILED";
  /** Filtro de datas: não usado, consistente com a janela, ou ignorado/ambíguo. */
  dateFilter: "NOT_USED" | "CONSISTENT" | "IGNORED_OR_AMBIGUOUS";
  reasons: string[];
};

export function assessPurchaseOrderFetchCompleteness(meta: PurchaseOrderFetchMeta): PurchaseOrderFetchCompleteness {
  const reasons: string[] = [];
  if (meta.fetchFailed) reasons.push("FETCH_FAILED");
  if (meta.fetchFailed && meta.http429Count > 0) reasons.push("HTTP_429_UNRECOVERED");
  if (meta.startPage !== 1) reasons.push("START_PAGE_NOT_ONE_INCOMPLETE_SNAPSHOT");
  if (meta.stoppedBecauseMaxPages) reasons.push("MAX_PAGES_HIT_INCOMPLETE_SNAPSHOT");
  const drained = meta.stoppedBecauseEmpty || meta.stoppedBecauseNoNext;
  if (!drained && !meta.fetchFailed) reasons.push("UNIVERSE_NOT_DRAINED");
  if (meta.unidentifiedRecords > 0) reasons.push("UNIDENTIFIED_RECORDS_IN_PAYLOAD");
  if (meta.mapErrorsIdentified > 0) reasons.push("MAP_ERRORS_WITH_OFFICIAL_ID");
  if (meta.duplicateRecords > 0) reasons.push("DUPLICATE_RECORDS_IN_PAYLOAD");

  const dateFilter: PurchaseOrderFetchCompleteness["dateFilter"] =
    meta.requestedWindow == null ? "NOT_USED" : meta.returnedOutsideWindow > 0 ? "IGNORED_OR_AMBIGUOUS" : "CONSISTENT";
  if (dateFilter === "IGNORED_OR_AMBIGUOUS") reasons.push("DATE_FILTER_IGNORED_OR_AMBIGUOUS");

  if (meta.requestedWindow != null && meta.dateFilterValidated !== true) reasons.push("DATE_FILTER_SEMANTICS_NOT_VALIDATED");

  const technicalComplete =
    !meta.fetchFailed && meta.startPage === 1 && drained && !meta.stoppedBecauseMaxPages && meta.unidentifiedRecords === 0;
  // Filtro ignorado/ambíguo ou não validado: o universo coberto não é o declarado → nunca autoriza
  // ausência. A execução em si (todas as páginas lidas) continua tecnicamente bem-sucedida.
  const windowProven = meta.requestedWindow == null || (dateFilter === "CONSISTENT" && meta.dateFilterValidated === true);
  const payloadComplete = technicalComplete && windowProven;
  const runStatus = meta.fetchFailed ? "FAILED" : technicalComplete ? "SUCCESS" : "INCONCLUSIVE";
  reasons.push(payloadComplete ? "FETCH_COMPLETE" : "ABSENCE_CONFIRMATION_BLOCKED");
  return { payloadComplete, runStatus, dateFilter, reasons: [...new Set(reasons)] };
}

/** Escopo canônico da execução. Varredura de reconciliação padrão: universo inteiro, sem datas. */
export function buildPurchaseOrderRunScope(input: {
  strategy: PurchaseOrderSyncStrategy;
  window: { from: Date; to: Date } | null;
  targetExternalId?: number | null;
}): NomusSourceSyncScope {
  if (input.strategy === "TARGETED_LOOKUP") {
    // Consulta por ID cobre só o próprio pedido — nunca o universo.
    const id = input.targetExternalId != null ? String(input.targetExternalId) : null;
    return { kind: "purchase_orders_targeted_lookup", from: id, to: id, strategy: input.strategy, onlyPending: null };
  }
  if (input.window == null) {
    return buildPurchaseOrderScope({ kind: "purchase_orders_full_universe", strategy: input.strategy });
  }
  return buildPurchaseOrderScope({
    kind: "purchase_orders_issue_date_window",
    from: input.window.from.toISOString().slice(0, 10),
    to: input.window.to.toISOString().slice(0, 10),
    strategy: input.strategy,
  });
}

export type PurchaseOrderLifecycleLocal = {
  localId: string;
  externalId: number;
  orderNumber: string | null;
  payloadHash: string | null;
  issuedAt: Date | null;
  sourcePresenceStatus: NomusSourcePresenceStatus;
  presentInLastPayload: boolean;
  missingConsecutiveRuns: number;
  missingSince: Date | null;
  sourceRemovedAt: Date | null;
  firstSeenAt: Date | null;
  lastSeenAt: Date | null;
  lastSyncRunId: string | null;
};

export type PurchaseOrderReconciliationPolicy = {
  /** Mínimo entre a 1ª ausência e a confirmação (horas) — oportunidades distintas. */
  minHoursBetweenMisses: number;
  /** Limite absoluto de confirmações por execução. */
  maxConfirmationsPerRun: number;
  /** Limite proporcional ao universo avaliado (0–1). */
  maxConfirmationsRatio: number;
};

export const DEFAULT_PURCHASE_ORDER_RECONCILIATION_POLICY: PurchaseOrderReconciliationPolicy = {
  minHoursBetweenMisses: 20,
  maxConfirmationsPerRun: 20,
  maxConfirmationsRatio: 0.05,
};

function numberEnv(env: Record<string, string | undefined>, key: string, fallback: number, min: number, max: number): number {
  const raw = Number(env[key]);
  return Number.isFinite(raw) && raw >= min && raw <= max ? raw : fallback;
}

export function resolvePurchaseOrderReconciliationPolicy(
  env: Record<string, string | undefined> = process.env
): PurchaseOrderReconciliationPolicy {
  const d = DEFAULT_PURCHASE_ORDER_RECONCILIATION_POLICY;
  return {
    minHoursBetweenMisses: numberEnv(env, "NOMUS_PO_CONFIRM_MIN_HOURS_BETWEEN_MISSES", d.minHoursBetweenMisses, 1, 24 * 30),
    maxConfirmationsPerRun: numberEnv(env, "NOMUS_PO_MAX_CONFIRMATIONS_PER_RUN", d.maxConfirmationsPerRun, 1, 100_000),
    maxConfirmationsRatio: numberEnv(env, "NOMUS_PO_MAX_CONFIRMATIONS_RATIO", d.maxConfirmationsRatio, 0.0001, 1),
  };
}

/** Limite de confirmações da execução: o menor entre o absoluto e o proporcional (mínimo 1). */
export function purchaseOrderConfirmationLimit(policy: PurchaseOrderReconciliationPolicy, universeSize: number): number {
  return Math.max(1, Math.min(policy.maxConfirmationsPerRun, Math.ceil(policy.maxConfirmationsRatio * Math.max(0, universeSize))));
}

export type PurchaseOrderReconciliationGuards = {
  universeSize: number;
  outsideScope: number;
  /** Já MISSING_CONFIRMED e ainda ausentes: permanecem confirmados, fora das guardas. */
  alreadyConfirmed: number;
  sameRunSkipped: number;
  confirmationsRequested: number;
  confirmationsApplied: number;
  heldByInterval: number;
  heldByConfirmationDisabled: number;
  massGuardTriggered: boolean;
  confirmationLimit: number;
};

export type PurchaseOrderReconciliationAlert = {
  code: "MASS_ABSENCE_GUARD_TRIGGERED" | "MASS_ABSENCE_CANDIDATES" | "ABSENCE_EVALUATION_SKIPPED";
  severity: "warning" | "critical";
  message: string;
};

export type PurchaseOrderReconciliationResult = {
  plan: NomusSourceReconciliationPlan;
  guards: PurchaseOrderReconciliationGuards;
  alerts: PurchaseOrderReconciliationAlert[];
};

function inWindow(issuedAt: Date | null, scope: NomusSourceSyncScope): boolean {
  if (scope.kind === "purchase_orders_full_universe") return true;
  if (scope.kind === "purchase_orders_targeted_lookup") return false;
  if (!issuedAt || !scope.from || !scope.to) return false;
  const day = issuedAt.toISOString().slice(0, 10);
  return day >= String(scope.from) && day <= String(scope.to);
}

function toLocalRecord(row: PurchaseOrderLifecycleLocal, scope: NomusSourceSyncScope): NomusSourceLocalRecord {
  return {
    localId: row.localId,
    externalId: String(row.externalId),
    entityType: "PURCHASE_ORDER",
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

/** Rebaixa uma confirmação para candidata, sem contar esta execução como nova ausência. */
function holdAsCandidate(
  item: NomusSourceReconciliationItem,
  local: PurchaseOrderLifecycleLocal,
  reason: string,
  executedAt: Date,
  runId: string | null,
  mode: NomusSourceReconciliationMode
): NomusSourceReconciliationItem {
  const patch: NomusSourceLifecyclePatch = {
    sourcePresenceStatus: "MISSING_CANDIDATE",
    presentInLastPayload: false,
    lastSeenAt: local.lastSeenAt ?? null,
    missingSince: local.missingSince ?? executedAt,
    // Mantém a contagem: a confirmação exige uma oportunidade posterior, distinta desta.
    missingConsecutiveRuns: Math.max(1, local.missingConsecutiveRuns),
    sourceRemovedAt: null,
    lastSyncRunId: runId,
  };
  return {
    ...item,
    action: "MISSING_CANDIDATE",
    reason,
    nextPresenceStatus: "MISSING_CANDIDATE",
    lifecyclePatch: mode === "apply" ? patch : null,
  };
}

export function buildPurchaseOrderSourceReconciliationPlan(args: {
  strategy: PurchaseOrderSyncStrategy;
  scope: NomusSourceSyncScope;
  completeness: PurchaseOrderFetchCompleteness;
  /** Flag da entidade + permissão canônica de detecção (estratégia FULL). */
  absenceDetectionAllowed: boolean;
  /** Permissão canônica de confirmação (pode ser false = só candidatas). */
  absenceConfirmationAllowed: boolean;
  found: ReadonlyArray<{ externalId: number; payloadHash: string }>;
  locals: readonly PurchaseOrderLifecycleLocal[];
  /** Consultas por ID já resolvidas (só not-found com semântica validada entra como false). */
  directedLookups?: ReadonlyArray<{ externalId: number; found: boolean }>;
  executedAt: Date;
  runId: string | null;
  mode: NomusSourceReconciliationMode;
  policy?: PurchaseOrderReconciliationPolicy;
}): PurchaseOrderReconciliationResult {
  const policy = args.policy ?? DEFAULT_PURCHASE_ORDER_RECONCILIATION_POLICY;
  const foundIds = new Set(args.found.map((row) => String(row.externalId)));
  const alerts: PurchaseOrderReconciliationAlert[] = [];

  // Universo da execução: escopo + idempotência (o mesmo run nunca avalia ausência 2×).
  const outsideScopeScope = buildPurchaseOrderScope({ kind: "purchase_orders_issue_date_window", from: "outside", to: "outside", strategy: args.strategy });
  const engineLocals: NomusSourceLocalRecord[] = [];
  let outsideScope = 0;
  let sameRunSkipped = 0;
  const localsById = new Map<string, PurchaseOrderLifecycleLocal>();
  for (const row of args.locals) {
    localsById.set(row.localId, row);
    const isFound = foundIds.has(String(row.externalId));
    if (!isFound && args.runId != null && row.lastSyncRunId === args.runId) {
      sameRunSkipped += 1;
      continue;
    }
    const scoped = inWindow(row.issuedAt, args.scope);
    if (!scoped && !isFound) outsideScope += 1;
    engineLocals.push(toLocalRecord(row, scoped || isFound ? args.scope : outsideScopeScope));
  }
  const universeSize = engineLocals.filter((row) => row.scope === args.scope).length;

  const absenceAllowed =
    args.strategy === "FULL_RECONCILIATION" && args.absenceDetectionAllowed && args.completeness.payloadComplete;

  const directedLookups: NomusSourceDirectedLookupResult[] = (args.directedLookups ?? []).map((d) => ({
    externalId: String(d.externalId),
    found: d.found,
  }));

  const plan = planNomusSourceReconciliation({
    entityType: "PURCHASE_ORDER",
    scope: args.scope,
    run: {
      id: args.runId,
      status: args.completeness.runStatus,
      payloadComplete: args.completeness.payloadComplete,
      entityType: "PURCHASE_ORDER",
      scope: args.scope,
    },
    found: args.found.map((row) => ({ externalId: String(row.externalId), payloadHash: row.payloadHash })),
    localRecords: engineLocals,
    directedLookups,
    executedAt: args.executedAt,
    reconciliationEnabled: absenceAllowed,
    mode: args.mode,
    confirmation: { consecutiveCompleteMissesToConfirm: 2, confirmViaDirectedLookup: true },
  });

  if (args.strategy !== "FULL_RECONCILIATION") plan.reasons.push("STRATEGY_NEVER_EVALUATES_ABSENCE");
  if (!args.absenceDetectionAllowed) plan.reasons.push("PURCHASE_ORDER_ABSENCE_DETECTION_DISABLED");
  if (args.strategy === "FULL_RECONCILIATION" && !absenceAllowed) {
    alerts.push({
      code: "ABSENCE_EVALUATION_SKIPPED",
      severity: "warning",
      message: args.absenceDetectionAllowed
        ? `Ausências não avaliadas: varredura incompleta (${args.completeness.reasons.join(", ")}).`
        : "Ausências não avaliadas: reconciliação de Pedidos de Compra desligada.",
    });
  }

  // --- Pós-processamento das confirmações (intervalo, permissão, volume) ---
  let heldByInterval = 0;
  let heldByConfirmationDisabled = 0;
  const keptConfirmed: NomusSourceReconciliationItem[] = [];
  const stillConfirmed: NomusSourceReconciliationItem[] = [];
  for (const item of plan.missingConfirmed) {
    const local = item.localId ? localsById.get(item.localId) : undefined;
    if (!local) {
      keptConfirmed.push(item);
      continue;
    }
    if (local.sourcePresenceStatus === "MISSING_CONFIRMED") {
      // Confirmação anterior se mantém (nunca rebaixada por guarda desta execução).
      stillConfirmed.push(item);
      continue;
    }
    if (!args.absenceConfirmationAllowed) {
      heldByConfirmationDisabled += 1;
      plan.missingCandidates.push(holdAsCandidate(item, local, "CONFIRMATION_DISABLED", args.executedAt, args.runId, args.mode));
      continue;
    }
    const directed = item.reason === "DIRECTED_LOOKUP_NOT_FOUND";
    const since = local.missingSince?.getTime() ?? null;
    const elapsedHours = since == null ? 0 : (args.executedAt.getTime() - since) / 3_600_000;
    if (!directed && elapsedHours < policy.minHoursBetweenMisses) {
      heldByInterval += 1;
      plan.missingCandidates.push(
        holdAsCandidate(item, local, "CONFIRMATION_INTERVAL_NOT_ELAPSED", args.executedAt, args.runId, args.mode)
      );
      continue;
    }
    keptConfirmed.push(item);
  }

  const confirmationLimit = purchaseOrderConfirmationLimit(policy, universeSize);
  let massGuardTriggered = false;
  if (keptConfirmed.length > confirmationLimit) {
    massGuardTriggered = true;
    for (const item of keptConfirmed) {
      const local = item.localId ? localsById.get(item.localId) : undefined;
      if (local) plan.missingCandidates.push(holdAsCandidate(item, local, "MASS_ABSENCE_GUARD", args.executedAt, args.runId, args.mode));
    }
    alerts.push({
      code: "MASS_ABSENCE_GUARD_TRIGGERED",
      severity: "critical",
      message: `${keptConfirmed.length} ausência(s) a confirmar acima do limite de ${confirmationLimit} (universo ${universeSize}): mantidas como candidatas até revisão administrativa.`,
    });
    keptConfirmed.length = 0;
  }
  const requested = keptConfirmed.length + heldByInterval + heldByConfirmationDisabled;
  plan.missingConfirmed = [...stillConfirmed, ...keptConfirmed];

  if (plan.missingCandidates.length > confirmationLimit) {
    alerts.push({
      code: "MASS_ABSENCE_CANDIDATES",
      severity: "warning",
      message: `${plan.missingCandidates.length} pedido(s) ausente(s) em verificação (limite de alerta ${confirmationLimit}).`,
    });
  }

  plan.counters.missingCandidates = plan.missingCandidates.length;
  plan.counters.missingConfirmed = plan.missingConfirmed.length;
  plan.reasons = [...new Set([...plan.reasons, ...args.completeness.reasons])];
  assertNoPhysicalDeletes(plan);

  return {
    plan,
    guards: {
      universeSize,
      outsideScope,
      alreadyConfirmed: stillConfirmed.length,
      sameRunSkipped,
      confirmationsRequested: requested,
      confirmationsApplied: keptConfirmed.length,
      heldByInterval,
      heldByConfirmationDisabled,
      massGuardTriggered,
      confirmationLimit,
    },
    alerts,
  };
}

export type PurchaseOrderPresenceEventDraft = {
  purchaseOrderId: string;
  externalId: number;
  action: "MISSING_CANDIDATE" | "MISSING_CONFIRMED" | "REACTIVATE";
  fromStatus: NomusSourcePresenceStatus | null;
  toStatus: NomusSourcePresenceStatus;
  reason: string;
  missingConsecutiveRuns: number;
};

/** Eventos do histórico de presença: só transições de status (candidata→candidata não gera evento). */
export function buildPurchaseOrderPresenceEvents(
  plan: NomusSourceReconciliationPlan,
  localsById: ReadonlyMap<string, PurchaseOrderLifecycleLocal>
): PurchaseOrderPresenceEventDraft[] {
  const out: PurchaseOrderPresenceEventDraft[] = [];
  for (const item of [...plan.missingCandidates, ...plan.missingConfirmed, ...plan.reactivated]) {
    if (!item.localId || !item.lifecyclePatch) continue;
    const local = localsById.get(item.localId);
    if (!local) continue;
    if (item.previousPresenceStatus === item.lifecyclePatch.sourcePresenceStatus) continue;
    out.push({
      purchaseOrderId: item.localId,
      externalId: local.externalId,
      action: item.action as PurchaseOrderPresenceEventDraft["action"],
      fromStatus: item.previousPresenceStatus,
      toStatus: item.lifecyclePatch.sourcePresenceStatus,
      reason: item.reason,
      missingConsecutiveRuns: item.lifecyclePatch.missingConsecutiveRuns,
    });
  }
  return out;
}

/** Rótulo de interface: ausência ≠ cancelamento ≠ exclusão comprovada. */
export function describePurchaseOrderPresence(input: {
  sourcePresenceStatus: NomusSourcePresenceStatus | string | null | undefined;
  stage?: string | null;
}): { key: string; label: string; operational: boolean } {
  if (input.sourcePresenceStatus === "MISSING_CONFIRMED") {
    return { key: "MISSING_CONFIRMED", label: "Ausente no Nomus — confirmado", operational: false };
  }
  if (input.sourcePresenceStatus === "MISSING_CANDIDATE") {
    return { key: "MISSING_CANDIDATE", label: "Ausente no Nomus — em verificação", operational: true };
  }
  if (input.stage === "CANCELED") {
    return { key: "CANCELED", label: "Cancelado no Nomus", operational: true };
  }
  return { key: "PRESENT", label: "Presente no Nomus", operational: true };
}
