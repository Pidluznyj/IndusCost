/**
 * SYNC-03 — Motor puro de reconciliação de presença Nomus.
 *
 * Calcula CREATE / UPDATE / UNCHANGED / MISSING_* / REACTIVATE.
 * Não faz I/O, HTTP, delete físico nem integra sincronizadores.
 *
 * Analogia (Documento de Saída): decideStockDocumentHeaderAction /
 * planStockDocumentPersist — decisão por hash + plano idempotente.
 * Ausência aqui é mais restrita (escopo + payloadComplete + flag).
 */

import {
  areNomusSourceSyncScopesCompatible,
  buildNomusSourceLifecycleDefaults,
  canMarkRecordMissingInRun,
  canReconcileAbsencesFromRun,
  type NomusSourcePresenceStatus,
  type NomusSourceSyncEntityType,
  type NomusSourceSyncRunSnapshot,
  type NomusSourceSyncScope,
} from "./nomusSourceLifecycleContract.js";

// ---------------------------------------------------------------------------
// Tipos de entrada
// ---------------------------------------------------------------------------

export type NomusSourceReconciliationMode = "preview" | "apply";

/** Registro retornado pelo Nomus nesta execução (já mapeado; sem HTTP). */
export type NomusSourceFoundRecord = {
  externalId: string;
  payloadHash: string;
};

/** Snapshot local no mesmo entityType (caller filtra; motor valida escopo). */
export type NomusSourceLocalRecord = {
  /** Id local (cuid). Usado só para correlacionar o plano. */
  localId: string;
  externalId: string;
  entityType: NomusSourceSyncEntityType;
  payloadHash: string | null | undefined;
  sourcePresenceStatus: NomusSourcePresenceStatus;
  presentInLastPayload: boolean;
  missingConsecutiveRuns: number;
  missingSince: Date | string | null;
  sourceRemovedAt: Date | string | null;
  /** Escopo do universo em que o registro foi observado / deve ser avaliado. */
  scope: NomusSourceSyncScope;
  firstSeenAt?: Date | string | null;
  lastSeenAt?: Date | string | null;
  lastSyncRunId?: string | null;
};

/** Resultado de consulta direcionada oficial (já resolvida fora do motor). */
export type NomusSourceDirectedLookupResult = {
  externalId: string;
  /** true = ainda existe na fonte; false = oficialmente não encontrado. */
  found: boolean;
};

/**
 * Confirmação de ausência:
 * - consecutiveCompleteMissesToConfirm: runs completas consecutivas sem o id
 *   (default 2 → 1ª = CANDIDATE, 2ª = CONFIRMED);
 * - confirmViaDirectedLookup: not-found direcionado confirma imediatamente.
 */
export type NomusSourceConfirmationConfig = {
  consecutiveCompleteMissesToConfirm?: number;
  confirmViaDirectedLookup?: boolean;
};

export type NomusSourceReconciliationInput = {
  entityType: NomusSourceSyncEntityType;
  scope: NomusSourceSyncScope;
  run: NomusSourceSyncRunSnapshot & { id?: string | null };
  found: readonly NomusSourceFoundRecord[];
  localRecords: readonly NomusSourceLocalRecord[];
  directedLookups?: readonly NomusSourceDirectedLookupResult[];
  confirmation?: NomusSourceConfirmationConfig;
  /** Data/hora da execução (lastSeenAt / missingSince / sourceRemovedAt). */
  executedAt: Date | string;
  /** Kill switch da entidade (fail-closed no caller). */
  reconciliationEnabled: boolean;
  /**
   * preview — plano somente leitura (padrão).
   * apply — mesmo plano + patches de lifecycle prontos para persistência
   *         (ainda sem I/O; syncers aplicam depois).
   */
  mode?: NomusSourceReconciliationMode;
};

// ---------------------------------------------------------------------------
// Tipos de saída
// ---------------------------------------------------------------------------

export type NomusSourceReconciliationAction =
  | "CREATE"
  | "UPDATE"
  | "UNCHANGED"
  | "MISSING_CANDIDATE"
  | "MISSING_CONFIRMED"
  | "REACTIVATE"
  | "IGNORE_OUTSIDE_SCOPE"
  | "INCONCLUSIVE";

/** Campos oficiais de lifecycle a escrever (sem delete). */
export type NomusSourceLifecyclePatch = {
  sourcePresenceStatus: NomusSourcePresenceStatus;
  presentInLastPayload: boolean;
  firstSeenAt?: Date | string | null;
  lastSeenAt: Date | string | null;
  missingSince: Date | string | null;
  missingConsecutiveRuns: number;
  sourceRemovedAt: Date | string | null;
  lastSyncRunId: string | null;
  payloadHash?: string | null;
};

export type NomusSourceReconciliationItem = {
  action: NomusSourceReconciliationAction;
  externalId: string;
  localId: string | null;
  entityType: NomusSourceSyncEntityType;
  reason: string;
  previousPresenceStatus: NomusSourcePresenceStatus | null;
  nextPresenceStatus: NomusSourcePresenceStatus | null;
  payloadChanged: boolean | null;
  /** Patch só preenchido em mode=apply (e ações que alteram lifecycle). */
  lifecyclePatch: NomusSourceLifecyclePatch | null;
};

export type NomusSourceReconciliationCounters = {
  creates: number;
  updates: number;
  unchanged: number;
  missingCandidates: number;
  missingConfirmed: number;
  reactivated: number;
  ignoredOutsideScope: number;
  inconclusive: number;
  /** Sempre 0 — motor nunca planeja delete físico. */
  deletes: number;
};

export type NomusSourceReconciliationPlan = {
  mode: NomusSourceReconciliationMode;
  entityType: NomusSourceSyncEntityType;
  scope: NomusSourceSyncScope;
  runStatus: string;
  payloadComplete: boolean;
  absencesEvaluated: boolean;
  creates: NomusSourceReconciliationItem[];
  updates: NomusSourceReconciliationItem[];
  unchanged: NomusSourceReconciliationItem[];
  missingCandidates: NomusSourceReconciliationItem[];
  missingConfirmed: NomusSourceReconciliationItem[];
  reactivated: NomusSourceReconciliationItem[];
  ignoredOutsideScope: NomusSourceReconciliationItem[];
  inconclusive: NomusSourceReconciliationItem[];
  /** Motivos agregados da execução (não por registro). */
  reasons: string[];
  counters: NomusSourceReconciliationCounters;
};

const DEFAULT_CONSECUTIVE_MISSES_TO_CONFIRM = 2;

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function normalizeExternalId(value: string): string {
  return String(value ?? "").trim();
}

function hashesEqual(
  a: string | null | undefined,
  b: string | null | undefined
): boolean {
  const left = (a ?? "").trim();
  const right = (b ?? "").trim();
  return left.length > 0 && left === right;
}

function isMissingStatus(status: NomusSourcePresenceStatus): boolean {
  return status === "MISSING_CANDIDATE" || status === "MISSING_CONFIRMED";
}

function emptyCounters(): NomusSourceReconciliationCounters {
  return {
    creates: 0,
    updates: 0,
    unchanged: 0,
    missingCandidates: 0,
    missingConfirmed: 0,
    reactivated: 0,
    ignoredOutsideScope: 0,
    inconclusive: 0,
    deletes: 0,
  };
}

function presentPatch(input: {
  executedAt: Date;
  runId: string | null;
  payloadHash?: string | null;
  firstSeenAt?: Date | string | null;
  includeFirstSeen: boolean;
}): NomusSourceLifecyclePatch {
  const defaults = buildNomusSourceLifecycleDefaults();
  const patch: NomusSourceLifecyclePatch = {
    sourcePresenceStatus: defaults.sourcePresenceStatus,
    presentInLastPayload: defaults.presentInLastPayload,
    lastSeenAt: input.executedAt,
    missingSince: defaults.missingSince,
    missingConsecutiveRuns: defaults.missingConsecutiveRuns,
    sourceRemovedAt: defaults.sourceRemovedAt,
    lastSyncRunId: input.runId,
  };
  if (input.includeFirstSeen) {
    patch.firstSeenAt = input.firstSeenAt ?? input.executedAt;
  }
  if (input.payloadHash !== undefined) {
    patch.payloadHash = input.payloadHash;
  }
  return patch;
}

function resolveConfirmation(config?: NomusSourceConfirmationConfig): {
  consecutiveCompleteMissesToConfirm: number;
  confirmViaDirectedLookup: boolean;
} {
  const n = config?.consecutiveCompleteMissesToConfirm;
  return {
    consecutiveCompleteMissesToConfirm:
      typeof n === "number" && Number.isFinite(n) && n >= 2
        ? Math.floor(n)
        : DEFAULT_CONSECUTIVE_MISSES_TO_CONFIRM,
    confirmViaDirectedLookup: config?.confirmViaDirectedLookup !== false,
  };
}

/**
 * Planeja reconciliação de presença para uma entidade + escopo.
 * Função pura: sem HTTP, sem Prisma, sem delete.
 */
export function planNomusSourceReconciliation(
  input: NomusSourceReconciliationInput
): NomusSourceReconciliationPlan {
  const mode: NomusSourceReconciliationMode = input.mode ?? "preview";
  const executedAt = toDate(input.executedAt);
  const runId = input.run.id ?? null;
  const confirmation = resolveConfirmation(input.confirmation);
  const reasons: string[] = [];

  const plan: NomusSourceReconciliationPlan = {
    mode,
    entityType: input.entityType,
    scope: input.scope,
    runStatus: String(input.run.status),
    payloadComplete: input.run.payloadComplete === true,
    absencesEvaluated: false,
    creates: [],
    updates: [],
    unchanged: [],
    missingCandidates: [],
    missingConfirmed: [],
    reactivated: [],
    ignoredOutsideScope: [],
    inconclusive: [],
    reasons,
    counters: emptyCounters(),
  };

  const pushItem = (
    bucket: keyof Pick<
      NomusSourceReconciliationPlan,
      | "creates"
      | "updates"
      | "unchanged"
      | "missingCandidates"
      | "missingConfirmed"
      | "reactivated"
      | "ignoredOutsideScope"
      | "inconclusive"
    >,
    item: NomusSourceReconciliationItem
  ) => {
    plan[bucket].push(item);
    plan.counters[bucket] += 1;
  };

  const withPatch = (
    item: Omit<NomusSourceReconciliationItem, "lifecyclePatch">,
    patch: NomusSourceLifecyclePatch | null
  ): NomusSourceReconciliationItem => ({
    ...item,
    lifecyclePatch: mode === "apply" ? patch : null,
  });

  // --- Proteção: run incompleta / erro / 429 não recuperado ---
  const runOkForAbsences = canReconcileAbsencesFromRun(input.run);
  if (input.run.status === "FAILED") {
    reasons.push("RUN_FAILED_ABSENCE_SKIPPED");
  } else if (input.run.status === "INCONCLUSIVE") {
    reasons.push("RUN_INCONCLUSIVE_ABSENCE_SKIPPED");
  } else if (input.run.payloadComplete !== true) {
    reasons.push("PAYLOAD_INCOMPLETE_ABSENCE_SKIPPED");
  }
  if (!input.reconciliationEnabled) {
    reasons.push("ENTITY_RECONCILE_FLAG_DISABLED");
  }
  if (input.run.entityType !== input.entityType) {
    reasons.push("RUN_ENTITY_TYPE_MISMATCH");
  }

  // Índice de encontrados (último ganha se duplicado no payload)
  const foundByExternalId = new Map<string, NomusSourceFoundRecord>();
  for (const row of input.found) {
    const id = normalizeExternalId(row.externalId);
    if (!id) continue;
    foundByExternalId.set(id, { externalId: id, payloadHash: row.payloadHash });
  }

  const directedNotFound = new Set<string>();
  const directedFound = new Set<string>();
  for (const lookup of input.directedLookups ?? []) {
    const id = normalizeExternalId(lookup.externalId);
    if (!id) continue;
    if (lookup.found) directedFound.add(id);
    else directedNotFound.add(id);
  }

  // Locais por externalId (mesmo entityType; outros entityTypes = independência)
  const localsInEntity: NomusSourceLocalRecord[] = [];
  for (const local of input.localRecords) {
    if (local.entityType !== input.entityType) {
      // Independência Pedido/CR/CP: nunca inferir cruzado.
      pushItem(
        "ignoredOutsideScope",
        withPatch(
          {
            action: "IGNORE_OUTSIDE_SCOPE",
            externalId: normalizeExternalId(local.externalId),
            localId: local.localId,
            entityType: local.entityType,
            reason: "DIFFERENT_ENTITY_TYPE",
            previousPresenceStatus: local.sourcePresenceStatus,
            nextPresenceStatus: local.sourcePresenceStatus,
            payloadChanged: null,
          },
          null
        )
      );
      continue;
    }
    localsInEntity.push(local);
  }

  const localByExternalId = new Map<string, NomusSourceLocalRecord>();
  for (const local of localsInEntity) {
    const id = normalizeExternalId(local.externalId);
    if (!id) continue;
    // Se houver colisão no mesmo entityType, mantém o primeiro (caller não deve enviar).
    if (!localByExternalId.has(id)) localByExternalId.set(id, local);
  }

  // --- CREATE / UPDATE / UNCHANGED / REACTIVATE (registros retornados) ---
  for (const [externalId, found] of foundByExternalId) {
    const local = localByExternalId.get(externalId);

    if (!local) {
      const patch = presentPatch({
        executedAt,
        runId,
        payloadHash: found.payloadHash,
        includeFirstSeen: true,
        firstSeenAt: executedAt,
      });
      pushItem(
        "creates",
        withPatch(
          {
            action: "CREATE",
            externalId,
            localId: null,
            entityType: input.entityType,
            reason: "NOT_FOUND_LOCALLY",
            previousPresenceStatus: null,
            nextPresenceStatus: "PRESENT",
            payloadChanged: true,
          },
          patch
        )
      );
      continue;
    }

    // Registro retornado: sempre PRESENT + limpa ausência (mesmo se hash igual).
    const wasMissing = isMissingStatus(local.sourcePresenceStatus);
    const payloadChanged = !hashesEqual(local.payloadHash, found.payloadHash);
    const patch = presentPatch({
      executedAt,
      runId,
      payloadHash: found.payloadHash,
      includeFirstSeen: local.firstSeenAt == null,
      firstSeenAt: local.firstSeenAt ?? executedAt,
    });

    if (wasMissing) {
      pushItem(
        "reactivated",
        withPatch(
          {
            action: "REACTIVATE",
            externalId,
            localId: local.localId,
            entityType: input.entityType,
            reason: payloadChanged
              ? "REAPPEARED_WITH_PAYLOAD_CHANGE"
              : "REAPPEARED_SAME_PAYLOAD",
            previousPresenceStatus: local.sourcePresenceStatus,
            nextPresenceStatus: "PRESENT",
            payloadChanged,
          },
          patch
        )
      );
      continue;
    }

    if (payloadChanged) {
      pushItem(
        "updates",
        withPatch(
          {
            action: "UPDATE",
            externalId,
            localId: local.localId,
            entityType: input.entityType,
            reason:
              (local.payloadHash ?? "").trim().length === 0
                ? "PAYLOAD_HASH_BACKFILL"
                : "PAYLOAD_HASH_CHANGED",
            previousPresenceStatus: local.sourcePresenceStatus,
            nextPresenceStatus: "PRESENT",
            payloadChanged: true,
          },
          patch
        )
      );
      continue;
    }

    pushItem(
      "unchanged",
      withPatch(
        {
          action: "UNCHANGED",
          externalId,
          localId: local.localId,
          entityType: input.entityType,
          reason: "PAYLOAD_HASH_UNCHANGED",
          previousPresenceStatus: local.sourcePresenceStatus,
          nextPresenceStatus: "PRESENT",
          payloadChanged: false,
        },
        // UNCHANGED ainda atualiza presença/timestamps oficiais (sem delete).
        patch
      )
    );
  }

  // --- Ausência (somente universo completo + flag + escopo) ---
  const canEvaluateAbsences =
    input.reconciliationEnabled &&
    runOkForAbsences &&
    input.run.entityType === input.entityType &&
    areNomusSourceSyncScopesCompatible(input.run.scope, input.scope);

  if (!canEvaluateAbsences) {
    if (
      input.run.payloadComplete !== true ||
      input.run.status !== "SUCCESS"
    ) {
      // Registros locais não retornados: presença intocada → INCONCLUSIVE.
      for (const local of localsInEntity) {
        const id = normalizeExternalId(local.externalId);
        if (!id || foundByExternalId.has(id)) continue;
        if (
          !areNomusSourceSyncScopesCompatible(input.scope, local.scope) ||
          !areNomusSourceSyncScopesCompatible(input.run.scope, local.scope)
        ) {
          continue;
        }
        pushItem(
          "inconclusive",
          withPatch(
            {
              action: "INCONCLUSIVE",
              externalId: id,
              localId: local.localId,
              entityType: input.entityType,
              reason:
                input.run.status === "FAILED"
                  ? "RUN_FAILED_PRESENCE_UNCHANGED"
                  : input.run.status === "INCONCLUSIVE"
                    ? "RUN_INCONCLUSIVE_PRESENCE_UNCHANGED"
                    : "PAYLOAD_INCOMPLETE_PRESENCE_UNCHANGED",
              previousPresenceStatus: local.sourcePresenceStatus,
              nextPresenceStatus: local.sourcePresenceStatus,
              payloadChanged: null,
            },
            null
          )
        );
      }
    }
    plan.reasons = [...new Set(reasons)];
    return plan;
  }

  plan.absencesEvaluated = true;
  reasons.push("ABSENCES_EVALUATED");

  for (const local of localsInEntity) {
    const externalId = normalizeExternalId(local.externalId);
    if (!externalId) continue;
    if (foundByExternalId.has(externalId)) continue;

    // Fora do escopo coberto desta execução → não marcar ausência.
    const inScope = canMarkRecordMissingInRun({
      run: input.run,
      recordEntityType: local.entityType,
      recordScope: local.scope,
      reconciliationEnabled: true,
    });

    if (!inScope) {
      pushItem(
        "ignoredOutsideScope",
        withPatch(
          {
            action: "IGNORE_OUTSIDE_SCOPE",
            externalId,
            localId: local.localId,
            entityType: input.entityType,
            reason: "RECORD_OUTSIDE_RUN_SCOPE",
            previousPresenceStatus: local.sourcePresenceStatus,
            nextPresenceStatus: local.sourcePresenceStatus,
            payloadChanged: null,
          },
          null
        )
      );
      continue;
    }

    // Lookup direcionado encontrou o registro → não ausentar (presença intocada
    // neste plano; syncer pode forçar refresh depois).
    if (directedFound.has(externalId)) {
      pushItem(
        "inconclusive",
        withPatch(
          {
            action: "INCONCLUSIVE",
            externalId,
            localId: local.localId,
            entityType: input.entityType,
            reason: "DIRECTED_LOOKUP_FOUND_PRESENCE_UNCHANGED",
            previousPresenceStatus: local.sourcePresenceStatus,
            nextPresenceStatus: local.sourcePresenceStatus,
            payloadChanged: null,
          },
          null
        )
      );
      continue;
    }

    const nextRuns = Math.max(0, local.missingConsecutiveRuns) + 1;
    const directedConfirms =
      confirmation.confirmViaDirectedLookup &&
      directedNotFound.has(externalId);
    const consecutiveConfirms =
      nextRuns >= confirmation.consecutiveCompleteMissesToConfirm;
    const confirm = directedConfirms || consecutiveConfirms;

    if (confirm) {
      const patch: NomusSourceLifecyclePatch = {
        sourcePresenceStatus: "MISSING_CONFIRMED",
        presentInLastPayload: false,
        lastSeenAt: local.lastSeenAt ?? null,
        missingSince: local.missingSince ?? executedAt,
        missingConsecutiveRuns: nextRuns,
        sourceRemovedAt: local.sourceRemovedAt ?? executedAt,
        lastSyncRunId: runId,
      };
      pushItem(
        "missingConfirmed",
        withPatch(
          {
            action: "MISSING_CONFIRMED",
            externalId,
            localId: local.localId,
            entityType: input.entityType,
            reason: directedConfirms
              ? "DIRECTED_LOOKUP_NOT_FOUND"
              : "CONSECUTIVE_COMPLETE_MISSES",
            previousPresenceStatus: local.sourcePresenceStatus,
            nextPresenceStatus: "MISSING_CONFIRMED",
            payloadChanged: null,
          },
          patch
        )
      );
      continue;
    }

    // Primeira ausência (ou ainda abaixo do limiar de confirmação).
    const patch: NomusSourceLifecyclePatch = {
      sourcePresenceStatus: "MISSING_CANDIDATE",
      presentInLastPayload: false,
      lastSeenAt: local.lastSeenAt ?? null,
      missingSince: local.missingSince ?? executedAt,
      missingConsecutiveRuns: nextRuns,
      sourceRemovedAt: null,
      lastSyncRunId: runId,
    };
    pushItem(
      "missingCandidates",
      withPatch(
        {
          action: "MISSING_CANDIDATE",
          externalId,
          localId: local.localId,
          entityType: input.entityType,
          reason: "FIRST_COMPLETE_MISS",
          previousPresenceStatus: local.sourcePresenceStatus,
          nextPresenceStatus: "MISSING_CANDIDATE",
          payloadChanged: null,
        },
        patch
      )
    );
  }

  plan.reasons = [...new Set(reasons)];
  return plan;
}

/**
 * Aplica mentalmente o plano sobre snapshots locais (puro) — útil para
 * idempotência em testes. Não persiste.
 */
export function applyNomusSourceReconciliationPlanLocally(
  locals: readonly NomusSourceLocalRecord[],
  plan: NomusSourceReconciliationPlan,
  found: readonly NomusSourceFoundRecord[]
): NomusSourceLocalRecord[] {
  const byId = new Map(locals.map((l) => [l.localId, { ...l }]));
  const foundByExt = new Map(
    found.map((f) => [normalizeExternalId(f.externalId), f])
  );

  const allItems = [
    ...plan.creates,
    ...plan.updates,
    ...plan.unchanged,
    ...plan.missingCandidates,
    ...plan.missingConfirmed,
    ...plan.reactivated,
  ];

  for (const item of allItems) {
    const patch = item.lifecyclePatch;
    if (!patch) continue;

    if (item.action === "CREATE" && item.localId == null) {
      const incoming = foundByExt.get(item.externalId);
      const localId = `created:${item.externalId}`;
      byId.set(localId, {
        localId,
        externalId: item.externalId,
        entityType: item.entityType,
        payloadHash: patch.payloadHash ?? incoming?.payloadHash ?? null,
        sourcePresenceStatus: patch.sourcePresenceStatus,
        presentInLastPayload: patch.presentInLastPayload,
        missingConsecutiveRuns: patch.missingConsecutiveRuns,
        missingSince: patch.missingSince,
        sourceRemovedAt: patch.sourceRemovedAt,
        scope: plan.scope,
        firstSeenAt: patch.firstSeenAt ?? patch.lastSeenAt,
        lastSeenAt: patch.lastSeenAt,
        lastSyncRunId: patch.lastSyncRunId,
      });
      continue;
    }

    if (item.localId == null) continue;
    const current = byId.get(item.localId);
    if (!current) continue;
    byId.set(item.localId, {
      ...current,
      sourcePresenceStatus: patch.sourcePresenceStatus,
      presentInLastPayload: patch.presentInLastPayload,
      missingConsecutiveRuns: patch.missingConsecutiveRuns,
      missingSince: patch.missingSince,
      sourceRemovedAt: patch.sourceRemovedAt,
      lastSeenAt: patch.lastSeenAt,
      lastSyncRunId: patch.lastSyncRunId,
      payloadHash:
        patch.payloadHash !== undefined
          ? patch.payloadHash
          : current.payloadHash,
      firstSeenAt:
        patch.firstSeenAt !== undefined
          ? patch.firstSeenAt
          : current.firstSeenAt,
    });
  }

  return [...byId.values()];
}

/** Garante que o plano nunca inclui delete físico. */
export function assertNoPhysicalDeletes(
  plan: NomusSourceReconciliationPlan
): void {
  if (plan.counters.deletes !== 0) {
    throw new Error("Reconciliation plan must never include physical deletes");
  }
  const actions = [
    ...plan.creates,
    ...plan.updates,
    ...plan.unchanged,
    ...plan.missingCandidates,
    ...plan.missingConfirmed,
    ...plan.reactivated,
    ...plan.ignoredOutsideScope,
    ...plan.inconclusive,
  ].map((i) => i.action);
  if (actions.some((a) => String(a).toUpperCase().includes("DELETE"))) {
    throw new Error("Reconciliation plan must never include DELETE actions");
  }
}
