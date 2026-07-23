/**
 * SYNC-07 — Contrato do CRUD canônico Nomus (puro).
 *
 * Todas as rotinas automáticas/manuais devem passar por este contrato:
 * estratégia explícita, escopo, disparador, flags de ausência e correlationId.
 * Não confirma ausência em RECENT_WINDOW. Não é módulo de consumidores (ops).
 */

import type { NomusSourceSyncEntityType } from "./nomusSourceLifecycleContract.js";
import {
  NOMUS_SOURCE_RECONCILE_AP_ENV,
  NOMUS_SOURCE_RECONCILE_AR_ENV,
  NOMUS_SOURCE_RECONCILE_SALES_ORDERS_ENV,
  isNomusAbsenceReconciliationEnabledForEntity,
} from "./nomusSourceReconciliationFlags.js";
import {
  NOMUS_OPS_EXCLUDE_MISSING_AP_ENV,
  NOMUS_OPS_EXCLUDE_MISSING_AR_ENV,
  NOMUS_OPS_EXCLUDE_MISSING_SALES_ORDERS_ENV,
} from "./nomusSourcePresencePolicy.js";

export const NOMUS_CANONICAL_SYNC_STRATEGIES = [
  "RECENT_WINDOW",
  "FULL_RECONCILIATION",
  "TARGETED_LOOKUP",
] as const;

export type NomusCanonicalSyncStrategy =
  (typeof NOMUS_CANONICAL_SYNC_STRATEGIES)[number];

export const NOMUS_CANONICAL_SOURCE_TRIGGERS = [
  "SCHEDULED_HOURLY",
  "SCHEDULED_DAILY",
  "ADMIN_PANEL",
  "CLI",
  "ORCHESTRATOR",
  "TARGETED_AUDIT",
] as const;

export type NomusCanonicalSourceTrigger =
  (typeof NOMUS_CANONICAL_SOURCE_TRIGGERS)[number];

export type NomusCanonicalSyncMode = "preview" | "apply";

export type NomusCanonicalSyncEntity =
  | "SALES_ORDER"
  | "ACCOUNTS_RECEIVABLE"
  | "ACCOUNTS_PAYABLE";

export type NomusCanonicalSyncRequest = {
  entity: NomusCanonicalSyncEntity;
  strategy: NomusCanonicalSyncStrategy;
  mode: NomusCanonicalSyncMode;
  scope: unknown;
  sourceTrigger: NomusCanonicalSourceTrigger;
  /** Pedido do chamador — pode ser forçado a false pela estratégia. */
  allowMissingDetection?: boolean;
  allowMissingConfirmation?: boolean;
  requestedBy?: string | null;
  correlationId?: string | null;
  /** Alvo opcional (TARGETED_LOOKUP). */
  targetExternalId?: string | number | null;
  targetOrderCode?: string | null;
};

export type NomusCanonicalSyncLockName =
  | "nomus-sales-orders"
  | "nomus-accounts-receivable"
  | "nomus-accounts-payable"
  | "nomus-orchestrator-global";

export type NomusCanonicalSyncResultStatus =
  | "SUCCESS"
  | "SUCCESS_WITH_ERRORS"
  | "FAILED"
  | "INCONCLUSIVE"
  | "SKIPPED_LOCKED"
  | "SKIPPED_FLAG";

export type NomusCanonicalSyncCounters = {
  pagesRead: number;
  rowsRead: number;
  created: number;
  updated: number;
  unchanged: number;
  reactivated: number;
  missingCandidates: number;
  missingConfirmed: number;
  errors: number;
  http429: number;
};

export type NomusCanonicalSyncExecution = {
  entity: NomusCanonicalSyncEntity;
  entityType: NomusSourceSyncEntityType;
  strategy: NomusCanonicalSyncStrategy;
  mode: NomusCanonicalSyncMode;
  scope: unknown;
  sourceTrigger: NomusCanonicalSourceTrigger;
  allowMissingDetection: boolean;
  allowMissingConfirmation: boolean;
  requestedBy: string | null;
  correlationId: string;
  lockName: NomusCanonicalSyncLockName;
  targetExternalId: string | null;
  targetOrderCode: string | null;
  flags: {
    lifecycleTracking: true;
    missingDetectionEnv: string;
    missingConfirmationEnv: string;
    operationalExclusionEnv: string;
    missingReconciliationEnabled: boolean;
  };
  /** Estratégia de syncer legado (CLI/env). */
  legacyStrategyLabel: string;
};

export type NomusCanonicalSyncResult = {
  ok: boolean;
  status: NomusCanonicalSyncResultStatus;
  execution: NomusCanonicalSyncExecution;
  runId: string | null;
  correlationId: string;
  lock: { name: NomusCanonicalSyncLockName; acquired: boolean; skipped?: boolean };
  payloadComplete: boolean | null;
  counters: NomusCanonicalSyncCounters;
  hooks: Array<{ name: string; ran: boolean; reason?: string }>;
  message?: string;
  startedAt: string;
  finishedAt: string;
};

export const ENTITY_LOCK_NAME: Record<
  NomusCanonicalSyncEntity,
  NomusCanonicalSyncLockName
> = {
  SALES_ORDER: "nomus-sales-orders",
  ACCOUNTS_RECEIVABLE: "nomus-accounts-receivable",
  ACCOUNTS_PAYABLE: "nomus-accounts-payable",
};

/**
 * Lock interno TypeScript (`openSync("wx")`) — NÃO compartilha pathname com flock do shell.
 * CR/CP: `.canonical.lock` (OP-04). Pedidos: entity lock próprio (shell usa global).
 */
export const ENTITY_LOCK_FILE_DEFAULT: Record<NomusCanonicalSyncLockName, string> =
  {
    "nomus-sales-orders": "/tmp/induscost-nomus-sales-orders.lock",
    "nomus-accounts-receivable":
      "/tmp/induscost-nomus-accounts-receivable.canonical.lock",
    "nomus-accounts-payable":
      "/tmp/induscost-nomus-accounts-payable.canonical.lock",
    "nomus-orchestrator-global": "/tmp/induscost-nomus-sync-global.lock",
  };

/**
 * Paths do flock do runner/shell (autoridade no host).
 * Mantidos separados do lock canônico TypeScript (OP-04).
 */
export const ENTITY_SHELL_FLOCK_FILE_DEFAULT = {
  "nomus-accounts-receivable": "/tmp/induscost-nomus-accounts-receivable.lock",
  "nomus-accounts-payable": "/tmp/induscost-nomus-accounts-payable.lock",
} as const;

/** Env vars do lock canônico interno (não confundir com NOMUS_AR/AP_SYNC_LOCK_FILE do shell). */
export const ENTITY_CANONICAL_LOCK_ENV: Partial<
  Record<NomusCanonicalSyncLockName, string>
> = {
  "nomus-sales-orders": "NOMUS_SALES_ORDERS_SYNC_LOCK_FILE",
  "nomus-accounts-receivable": "NOMUS_ACCOUNTS_RECEIVABLE_CANONICAL_LOCK_FILE",
  "nomus-accounts-payable": "NOMUS_ACCOUNTS_PAYABLE_CANONICAL_LOCK_FILE",
  "nomus-orchestrator-global": "NOMUS_SYNC_GLOBAL_LOCK_FILE",
};


/** Serviços canônicos — único ponto de apply por entidade. */
export const CANONICAL_SYNC_SERVICE_NAMES = {
  SALES_ORDER: "runNomusSalesOrdersSync",
  ACCOUNTS_RECEIVABLE: "runNomusAccountsReceivableSync",
  ACCOUNTS_PAYABLE: "runNomusAccountsPayableSync",
} as const;

export const POST_SYNC_HOOK_NAMES = [
  "commissionMaterialization",
  "crmCommercialOwnerAutoAssign",
  "productionOrdersAfterSalesOrders",
  "stockDocumentsAfterSalesOrders",
  "salesOrderFlowRecompute",
] as const;

export function newNomusCorrelationId(
  sourceTrigger: NomusCanonicalSourceTrigger = "CLI"
): string {
  const rand =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `rnd-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `nomus-${sourceTrigger.toLowerCase()}-${rand}`;
}

export function mapLegacySalesOrderStrategy(
  raw: string | null | undefined
): NomusCanonicalSyncStrategy {
  const v = String(raw ?? "recent-window").trim().toLowerCase();
  if (v === "full-reconciliation" || v === "full_reconciliation") {
    return "FULL_RECONCILIATION";
  }
  if (v === "targeted" || v === "targeted_lookup" || v === "targeted-lookup") {
    return "TARGETED_LOOKUP";
  }
  return "RECENT_WINDOW";
}

export function toLegacySalesOrderStrategyLabel(
  strategy: NomusCanonicalSyncStrategy
): string {
  switch (strategy) {
    case "FULL_RECONCILIATION":
      return "full-reconciliation";
    case "TARGETED_LOOKUP":
      return "full-reconciliation";
    case "RECENT_WINDOW":
    default:
      return "recent-window";
  }
}

/**
 * Política central: RECENT_WINDOW nunca avalia ausência.
 * FULL / TARGETED só se flag da entidade estiver on e o chamador pedir.
 * Frontend NÃO pode forçar confirmação — ver sanitizeAdminMissingFlags.
 */
export function resolveCanonicalMissingPermissions(input: {
  entity: NomusCanonicalSyncEntity;
  strategy: NomusCanonicalSyncStrategy;
  allowMissingDetection?: boolean;
  allowMissingConfirmation?: boolean;
  env?: Record<string, string | undefined>;
}): {
  allowMissingDetection: boolean;
  allowMissingConfirmation: boolean;
  missingReconciliationEnabled: boolean;
} {
  const env = input.env ?? process.env;
  const enabled = isNomusAbsenceReconciliationEnabledForEntity(
    input.entity,
    env
  );

  if (input.strategy === "RECENT_WINDOW" || !enabled) {
    return {
      allowMissingDetection: false,
      allowMissingConfirmation: false,
      missingReconciliationEnabled: enabled,
    };
  }

  const detection = input.allowMissingDetection !== false;
  const confirmation =
    input.strategy === "TARGETED_LOOKUP" || input.strategy === "FULL_RECONCILIATION"
      ? input.allowMissingConfirmation === true
      : false;

  return {
    allowMissingDetection: detection && enabled,
    allowMissingConfirmation: confirmation && enabled && detection,
    missingReconciliationEnabled: enabled,
  };
}

/** Backend rejeita allowMissingConfirmation vindo do painel sem estratégia compatível. */
export function sanitizeAdminMissingFlags(input: {
  strategy: NomusCanonicalSyncStrategy;
  allowMissingDetection?: unknown;
  allowMissingConfirmation?: unknown;
}): {
  allowMissingDetection: boolean;
  allowMissingConfirmation: boolean;
  rejectedConfirmation: boolean;
} {
  const wantsConfirm = input.allowMissingConfirmation === true;
  const compatible =
    input.strategy === "FULL_RECONCILIATION" ||
    input.strategy === "TARGETED_LOOKUP";
  if (wantsConfirm && !compatible) {
    return {
      allowMissingDetection: input.allowMissingDetection === true,
      allowMissingConfirmation: false,
      rejectedConfirmation: true,
    };
  }
  return {
    allowMissingDetection: input.allowMissingDetection === true,
    allowMissingConfirmation: wantsConfirm && compatible,
    rejectedConfirmation: false,
  };
}

export function buildCanonicalSyncExecution(
  request: NomusCanonicalSyncRequest,
  env: Record<string, string | undefined> = process.env
): NomusCanonicalSyncExecution {
  const missing = resolveCanonicalMissingPermissions({
    entity: request.entity,
    strategy: request.strategy,
    allowMissingDetection: request.allowMissingDetection,
    allowMissingConfirmation: request.allowMissingConfirmation,
    env,
  });

  const flagEnvs =
    request.entity === "SALES_ORDER"
      ? {
          missingDetectionEnv: NOMUS_SOURCE_RECONCILE_SALES_ORDERS_ENV,
          missingConfirmationEnv: NOMUS_SOURCE_RECONCILE_SALES_ORDERS_ENV,
          operationalExclusionEnv: NOMUS_OPS_EXCLUDE_MISSING_SALES_ORDERS_ENV,
        }
      : request.entity === "ACCOUNTS_RECEIVABLE"
        ? {
            missingDetectionEnv: NOMUS_SOURCE_RECONCILE_AR_ENV,
            missingConfirmationEnv: NOMUS_SOURCE_RECONCILE_AR_ENV,
            operationalExclusionEnv: NOMUS_OPS_EXCLUDE_MISSING_AR_ENV,
          }
        : {
            missingDetectionEnv: NOMUS_SOURCE_RECONCILE_AP_ENV,
            missingConfirmationEnv: NOMUS_SOURCE_RECONCILE_AP_ENV,
            operationalExclusionEnv: NOMUS_OPS_EXCLUDE_MISSING_AP_ENV,
          };

  return {
    entity: request.entity,
    entityType: request.entity,
    strategy: request.strategy,
    mode: request.mode,
    scope: request.scope,
    sourceTrigger: request.sourceTrigger,
    allowMissingDetection: missing.allowMissingDetection,
    allowMissingConfirmation: missing.allowMissingConfirmation,
    requestedBy: request.requestedBy ?? null,
    correlationId: request.correlationId?.trim() || newNomusCorrelationId(request.sourceTrigger),
    lockName: ENTITY_LOCK_NAME[request.entity],
    targetExternalId:
      request.targetExternalId != null ? String(request.targetExternalId) : null,
    targetOrderCode: request.targetOrderCode?.trim() || null,
    flags: {
      lifecycleTracking: true,
      ...flagEnvs,
      missingReconciliationEnabled: missing.missingReconciliationEnabled,
    },
    legacyStrategyLabel:
      request.entity === "SALES_ORDER"
        ? toLegacySalesOrderStrategyLabel(request.strategy)
        : "full_refresh_upsert",
  };
}

export function emptyCanonicalCounters(): NomusCanonicalSyncCounters {
  return {
    pagesRead: 0,
    rowsRead: 0,
    created: 0,
    updated: 0,
    unchanged: 0,
    reactivated: 0,
    missingCandidates: 0,
    missingConfirmed: 0,
    errors: 0,
    http429: 0,
  };
}

export function planPostSyncHooks(input: {
  mode: NomusCanonicalSyncMode;
  entity: NomusCanonicalSyncEntity;
  applySucceeded: boolean;
  hasRelevantChanges: boolean;
}): Array<{ name: (typeof POST_SYNC_HOOK_NAMES)[number]; shouldRun: boolean; reason: string }> {
  const base = POST_SYNC_HOOK_NAMES.map((name) => {
    if (input.mode !== "apply") {
      return { name, shouldRun: false, reason: "preview_skips_hooks" };
    }
    if (!input.applySucceeded) {
      return { name, shouldRun: false, reason: "apply_failed" };
    }
    if (!input.hasRelevantChanges) {
      return { name, shouldRun: false, reason: "no_relevant_changes" };
    }
    if (input.entity !== "SALES_ORDER" && name !== "commissionMaterialization") {
      return { name, shouldRun: false, reason: "entity_not_applicable" };
    }
    if (
      input.entity === "ACCOUNTS_RECEIVABLE" &&
      name === "commissionMaterialization"
    ) {
      return { name, shouldRun: true, reason: "ar_commission_hook" };
    }
    if (input.entity === "SALES_ORDER") {
      return { name, shouldRun: true, reason: "apply_success" };
    }
    return { name, shouldRun: false, reason: "entity_not_applicable" };
  });
  return base;
}

/** Matriz documentada de rotinas (fonte para docs + testes). */
export const NOMUS_AUTOMATIC_SYNC_ROUTINES = [
  {
    entity: "SALES_ORDER" as const,
    trigger: "SCHEDULED_HOURLY",
    frequency: "~2h (cron host)",
    script: "scripts/runNomusSalesOrdersSync.sh → sync:nomus:sales-orders:apply",
    strategy: "RECENT_WINDOW" as const,
    writes: true,
    lock: "nomus-orchestrator-global (shell) + nomus-sales-orders",
    canonicalService: CANONICAL_SYNC_SERVICE_NAMES.SALES_ORDER,
    allowMissingDetection: false,
    allowMissingConfirmation: false,
  },
  {
    entity: "SALES_ORDER" as const,
    trigger: "CLI",
    frequency: "ad-hoc",
    script: "scripts/runNomusSalesOrdersWideReconciliation.sh",
    strategy: "FULL_RECONCILIATION" as const,
    writes: true,
    lock: "nomus-orchestrator-global + nomus-sales-orders",
    canonicalService: CANONICAL_SYNC_SERVICE_NAMES.SALES_ORDER,
    allowMissingDetection: true,
    allowMissingConfirmation: true,
  },
  {
    entity: "SALES_ORDER" as const,
    trigger: "ORCHESTRATOR",
    frequency: "manual / sync:nomus:all",
    script: "scripts/nomusSyncOrchestrator.ts --only=sales-orders",
    strategy: "RECENT_WINDOW" as const,
    writes: true,
    lock: "child inherits; prefer entity lock",
    canonicalService: CANONICAL_SYNC_SERVICE_NAMES.SALES_ORDER,
    allowMissingDetection: false,
    allowMissingConfirmation: false,
  },
  {
    entity: "ACCOUNTS_RECEIVABLE" as const,
    trigger: "SCHEDULED_HOURLY",
    frequency: "17 */2 * * *",
    script: "scripts/runNomusAccountsReceivableSync.sh",
    strategy: "FULL_RECONCILIATION" as const,
    writes: true,
    lock: "flock shell (NOMUS_AR_SYNC_LOCK_FILE) + canonical (.canonical.lock)",
    canonicalService: CANONICAL_SYNC_SERVICE_NAMES.ACCOUNTS_RECEIVABLE,
    allowMissingDetection: false,
    allowMissingConfirmation: false,
    note: "Label full_refresh_upsert ≠ prova COMPLETE; ausência só com flag+completude",
  },
  {
    entity: "ACCOUNTS_RECEIVABLE" as const,
    trigger: "ADMIN_PANEL",
    frequency: "on demand",
    script: "nomusAccountsReceivableSyncRunner → mesmo shell",
    strategy: "FULL_RECONCILIATION" as const,
    writes: true,
    lock: "flock shell + canonical (.canonical.lock)",
    canonicalService: CANONICAL_SYNC_SERVICE_NAMES.ACCOUNTS_RECEIVABLE,
    allowMissingDetection: false,
    allowMissingConfirmation: false,
  },
  {
    entity: "ACCOUNTS_PAYABLE" as const,
    trigger: "SCHEDULED_HOURLY",
    frequency: "17 */2 * * *",
    script: "scripts/runNomusAccountsPayableSync.sh",
    strategy: "FULL_RECONCILIATION" as const,
    writes: true,
    lock: "flock shell (NOMUS_AP_SYNC_LOCK_FILE) + canonical (.canonical.lock)",
    canonicalService: CANONICAL_SYNC_SERVICE_NAMES.ACCOUNTS_PAYABLE,
    allowMissingDetection: false,
    allowMissingConfirmation: false,
  },
  {
    entity: "ACCOUNTS_PAYABLE" as const,
    trigger: "ADMIN_PANEL",
    frequency: "on demand",
    script: "nomusAccountsPayableSyncRunner → mesmo shell",
    strategy: "FULL_RECONCILIATION" as const,
    writes: true,
    lock: "flock shell + canonical (.canonical.lock)",
    canonicalService: CANONICAL_SYNC_SERVICE_NAMES.ACCOUNTS_PAYABLE,
    allowMissingDetection: false,
    allowMissingConfirmation: false,
  },
] as const;

export const ENTRY_POINTS_MUST_CALL_CANONICAL = [
  "scripts/nomusSalesOrdersSyncV1.ts",
  "scripts/nomusAccountsReceivableSync.ts",
  "scripts/nomusAccountsPayableSync.ts",
  "scripts/nomusSyncOrchestrator.ts",
  "src/lib/nomusAccountsReceivableSyncRunner.ts",
  "src/lib/nomusAccountsPayableSyncRunner.ts",
  "scripts/runNomusSalesOrdersSync.sh",
  "scripts/runNomusAccountsReceivableSync.sh",
  "scripts/runNomusAccountsPayableSync.sh",
] as const;

/** Shell runners não podem conter upsert/lifecycle. */
export const SHELL_FORBIDDEN_BUSINESS_PATTERNS = [
  /prisma\./i,
  /\.upsert\s*\(/,
  /MISSING_CONFIRMED/,
  /sourcePresenceStatus/,
  /payloadHash/,
] as const;
