/**
 * SYNC-02 — Contrato canônico de ciclo de vida Nomus (puro, sem I/O).
 *
 * Não altera sincronizadores nesta etapa. Regras de ausência só podem ser
 * aplicadas quando a execução for SUCCESS + payloadComplete e a flag da
 * entidade estiver habilitada.
 */

export const NOMUS_SOURCE_PRESENCE_STATUSES = [
  "PRESENT",
  "MISSING_CANDIDATE",
  "MISSING_CONFIRMED",
] as const;

export type NomusSourcePresenceStatus =
  (typeof NOMUS_SOURCE_PRESENCE_STATUSES)[number];

export const NOMUS_SOURCE_SYNC_ENTITY_TYPES = [
  "SALES_ORDER",
  "ACCOUNTS_RECEIVABLE",
  "ACCOUNTS_PAYABLE",
] as const;

export type NomusSourceSyncEntityType =
  (typeof NOMUS_SOURCE_SYNC_ENTITY_TYPES)[number];

export const NOMUS_SOURCE_SYNC_RUN_STATUSES = [
  "RUNNING",
  "SUCCESS",
  "FAILED",
  "INCONCLUSIVE",
] as const;

export type NomusSourceSyncRunStatus =
  (typeof NOMUS_SOURCE_SYNC_RUN_STATUSES)[number];

/** Escopo canônico do universo coberto por uma execução. */
export type NomusSourceSyncScope = {
  /** Identificador estável do tipo de universo (ex.: orders_issue_date_window). */
  kind: string;
  from?: string | null;
  to?: string | null;
  onlyPending?: boolean | null;
  strategy?: string | null;
  /** Metadados adicionais (não usados na igualdade de escopo). */
  extras?: Record<string, unknown>;
};

export type NomusSourceSyncRunSnapshot = {
  status: NomusSourceSyncRunStatus | string;
  payloadComplete: boolean;
  entityType: NomusSourceSyncEntityType | string;
  scope: NomusSourceSyncScope;
  coveredFrom?: Date | string | null;
  coveredTo?: Date | string | null;
};

export type NomusSourceLifecycleDefaults = {
  sourcePresenceStatus: "PRESENT";
  presentInLastPayload: true;
  missingConsecutiveRuns: 0;
  missingSince: null;
  sourceRemovedAt: null;
};

/** Defaults seguros para CREATE e backfill técnico (não é prova histórica). */
export function buildNomusSourceLifecycleDefaults(): NomusSourceLifecycleDefaults {
  return {
    sourcePresenceStatus: "PRESENT",
    presentInLastPayload: true,
    missingConsecutiveRuns: 0,
    missingSince: null,
    sourceRemovedAt: null,
  };
}

export function parseNomusSourcePresenceStatus(
  value: unknown
): NomusSourcePresenceStatus {
  if (
    typeof value === "string" &&
    (NOMUS_SOURCE_PRESENCE_STATUSES as readonly string[]).includes(value)
  ) {
    return value as NomusSourcePresenceStatus;
  }
  throw new Error(
    `NomusSourcePresenceStatus inválido: ${String(value)}. Use PRESENT | MISSING_CANDIDATE | MISSING_CONFIRMED.`
  );
}

export function parseNomusSourceSyncEntityType(
  value: unknown
): NomusSourceSyncEntityType {
  if (
    typeof value === "string" &&
    (NOMUS_SOURCE_SYNC_ENTITY_TYPES as readonly string[]).includes(value)
  ) {
    return value as NomusSourceSyncEntityType;
  }
  throw new Error(
    `NomusSourceSyncEntityType inválido: ${String(value)}. Use SALES_ORDER | ACCOUNTS_RECEIVABLE | ACCOUNTS_PAYABLE.`
  );
}

export function parseNomusSourceSyncRunStatus(
  value: unknown
): NomusSourceSyncRunStatus {
  if (
    typeof value === "string" &&
    (NOMUS_SOURCE_SYNC_RUN_STATUSES as readonly string[]).includes(value)
  ) {
    return value as NomusSourceSyncRunStatus;
  }
  throw new Error(
    `NomusSourceSyncRunStatus inválido: ${String(value)}. Use RUNNING | SUCCESS | FAILED | INCONCLUSIVE.`
  );
}

/**
 * Reconciliação de ausências só com execução bem-sucedida e payload completo.
 * Flags por entidade são avaliadas à parte (kill switch).
 */
export function canReconcileAbsencesFromRun(
  run: Pick<NomusSourceSyncRunSnapshot, "status" | "payloadComplete">
): boolean {
  return run.status === "SUCCESS" && run.payloadComplete === true;
}

/** Normaliza escopo para comparação (ignora extras). */
export function normalizeNomusSourceSyncScope(
  scope: NomusSourceSyncScope
): Omit<NomusSourceSyncScope, "extras"> {
  return {
    kind: String(scope.kind ?? "").trim(),
    from: scope.from == null || scope.from === "" ? null : String(scope.from),
    to: scope.to == null || scope.to === "" ? null : String(scope.to),
    onlyPending:
      scope.onlyPending == null ? null : Boolean(scope.onlyPending),
    strategy:
      scope.strategy == null || scope.strategy === ""
        ? null
        : String(scope.strategy),
  };
}

/**
 * Escopos incompatíveis não podem gerar ausência (ex.: janela recente vs full AR).
 */
export function areNomusSourceSyncScopesCompatible(
  a: NomusSourceSyncScope,
  b: NomusSourceSyncScope
): boolean {
  const na = normalizeNomusSourceSyncScope(a);
  const nb = normalizeNomusSourceSyncScope(b);
  if (!na.kind || !nb.kind || na.kind !== nb.kind) return false;
  if (na.from !== nb.from) return false;
  if (na.to !== nb.to) return false;
  if (na.onlyPending !== nb.onlyPending) return false;
  return true;
}

/**
 * Um registro local só pode ser considerado ausente se estiver no mesmo
 * universo (entityType + scope) da execução completa.
 */
export function canMarkRecordMissingInRun(input: {
  run: NomusSourceSyncRunSnapshot;
  recordEntityType: NomusSourceSyncEntityType | string;
  recordScope: NomusSourceSyncScope;
  reconciliationEnabled: boolean;
}): boolean {
  if (!input.reconciliationEnabled) return false;
  if (!canReconcileAbsencesFromRun(input.run)) return false;
  if (input.run.entityType !== input.recordEntityType) return false;
  return areNomusSourceSyncScopesCompatible(input.run.scope, input.recordScope);
}

/** Helpers de escopo canônico (documentação / futuros syncers). */
export function buildSalesOrderIssueDateScope(input: {
  from: string;
  to: string;
  strategy: string;
}): NomusSourceSyncScope {
  return {
    kind: "sales_orders_issue_date_window",
    from: input.from,
    to: input.to,
    strategy: input.strategy,
    onlyPending: null,
  };
}

export function buildAccountsReceivableDueDateScope(input: {
  from: string;
  to: string;
  onlyPending: boolean;
  strategy: string;
}): NomusSourceSyncScope {
  return {
    kind: "accounts_receivable_due_date_window",
    from: input.from,
    to: input.to,
    onlyPending: input.onlyPending,
    strategy: input.strategy,
  };
}

export function buildAccountsPayableDueDateScope(input: {
  from: string;
  to: string;
  onlyPending: boolean;
  strategy: string;
}): NomusSourceSyncScope {
  return {
    kind: "accounts_payable_due_date_window",
    from: input.from,
    to: input.to,
    onlyPending: input.onlyPending,
    strategy: input.strategy,
  };
}
