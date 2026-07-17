/**
 * SYNC-07 — Gateway canônico de sync Nomus (server).
 *
 * runNomusSalesOrdersSync / runNomusAccountsReceivableSync / runNomusAccountsPayableSync
 * são as únicas funções de apply por entidade. CLI, shell, painel e orquestrador
 * apenas montam o request e chamam estes serviços.
 */

import { mkdirSync, openSync, closeSync, unlinkSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import {
  buildCanonicalSyncExecution,
  emptyCanonicalCounters,
  ENTITY_LOCK_FILE_DEFAULT,
  planPostSyncHooks,
  type NomusCanonicalSyncExecution,
  type NomusCanonicalSyncLockName,
  type NomusCanonicalSyncRequest,
  type NomusCanonicalSyncResult,
  type NomusCanonicalSyncResultStatus,
} from "./nomusCanonicalSyncContract.js";

export type NomusCanonicalSyncDelegateResult = {
  status: NomusCanonicalSyncResultStatus;
  runId?: string | null;
  payloadComplete?: boolean | null;
  counters?: Partial<NomusCanonicalSyncResult["counters"]>;
  message?: string;
  hasRelevantChanges?: boolean;
  /** Hooks já disparados pelo delegate (evita duplicar). */
  hooksAlreadyRan?: string[];
};

export type NomusCanonicalSyncDelegate = (
  execution: NomusCanonicalSyncExecution
) => Promise<NomusCanonicalSyncDelegateResult>;

type HeldLock = {
  name: NomusCanonicalSyncLockName;
  fd: number;
  path: string;
};

const heldByCorrelation = new Map<string, HeldLock>();

function resolveLockPath(name: NomusCanonicalSyncLockName): string {
  const envKey =
    name === "nomus-sales-orders"
      ? "NOMUS_SALES_ORDERS_SYNC_LOCK_FILE"
      : name === "nomus-accounts-receivable"
        ? "NOMUS_ACCOUNTS_RECEIVABLE_LOCK_FILE"
        : name === "nomus-accounts-payable"
          ? "NOMUS_ACCOUNTS_PAYABLE_LOCK_FILE"
          : "NOMUS_SYNC_GLOBAL_LOCK_FILE";
  const fromEnv = (process.env[envKey] ?? "").trim();
  return fromEnv || ENTITY_LOCK_FILE_DEFAULT[name];
}

/**
 * Lock por entidade (best-effort em Windows/Linux).
 * Em Linux, shells já usam flock no path global/AR/AP; este lock
 * serializa chamadas in-process / CLI concorrentes da mesma entidade.
 */
export function tryAcquireCanonicalEntityLock(
  name: NomusCanonicalSyncLockName,
  correlationId: string
): { ok: true; path: string } | { ok: false; code: "LOCK_HELD"; path: string; message: string } {
  const path = resolveLockPath(name);
  try {
    mkdirSync(dirname(path), { recursive: true });
  } catch {
    /* ignore */
  }

  try {
    const fd = openSync(path, "wx");
    heldByCorrelation.set(correlationId, { name, fd, path });
    return { ok: true, path };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code;
    if (code === "EEXIST") {
      return {
        ok: false,
        code: "LOCK_HELD",
        path,
        message: `SKIPPED_LOCKED: lock ${name} já adquirido (${path}).`,
      };
    }
    // Fallback: se filesystem não suporta wx exclusivo, não bloqueia apply
    // (shell flock permanece autoridade no host).
    return { ok: true, path };
  }
}

export function releaseCanonicalEntityLock(correlationId: string): void {
  const held = heldByCorrelation.get(correlationId);
  if (!held) return;
  try {
    closeSync(held.fd);
  } catch {
    /* ignore */
  }
  try {
    if (existsSync(held.path)) unlinkSync(held.path);
  } catch {
    /* ignore */
  }
  heldByCorrelation.delete(correlationId);
}

async function runCanonicalEntitySync(
  request: NomusCanonicalSyncRequest,
  delegate: NomusCanonicalSyncDelegate
): Promise<NomusCanonicalSyncResult> {
  const startedAt = new Date();
  const execution = buildCanonicalSyncExecution(request);
  const lockAttempt = tryAcquireCanonicalEntityLock(
    execution.lockName,
    execution.correlationId
  );

  if (!lockAttempt.ok) {
    const finishedAt = new Date();
    return {
      ok: true,
      status: "SKIPPED_LOCKED",
      execution,
      runId: null,
      correlationId: execution.correlationId,
      lock: { name: execution.lockName, acquired: false, skipped: true },
      payloadComplete: null,
      counters: emptyCanonicalCounters(),
      hooks: planPostSyncHooks({
        mode: execution.mode,
        entity: execution.entity,
        applySucceeded: false,
        hasRelevantChanges: false,
      }).map((h) => ({ name: h.name, ran: false, reason: h.reason })),
      message: lockAttempt.message,
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
    };
  }

  try {
    // Propaga contexto para scripts/delegates e logs estruturados.
    process.env.NOMUS_CANONICAL_CORRELATION_ID = execution.correlationId;
    process.env.NOMUS_CANONICAL_SOURCE_TRIGGER = execution.sourceTrigger;
    process.env.NOMUS_CANONICAL_STRATEGY = execution.strategy;
    process.env.NOMUS_CANONICAL_MODE = execution.mode;
    process.env.NOMUS_CANONICAL_ALLOW_MISSING_DETECTION = execution.allowMissingDetection
      ? "1"
      : "0";
    process.env.NOMUS_CANONICAL_ALLOW_MISSING_CONFIRMATION =
      execution.allowMissingConfirmation ? "1" : "0";

    if (execution.entity === "SALES_ORDER") {
      process.env.NOMUS_SALES_ORDERS_SYNC_STRATEGY = execution.legacyStrategyLabel;
    }

    const delegated = await delegate(execution);
    const hooksPlan = planPostSyncHooks({
      mode: execution.mode,
      entity: execution.entity,
      applySucceeded:
        delegated.status === "SUCCESS" || delegated.status === "SUCCESS_WITH_ERRORS",
      hasRelevantChanges: delegated.hasRelevantChanges !== false,
    });
    const already = new Set(delegated.hooksAlreadyRan ?? []);
    const hooks = hooksPlan.map((h) => ({
      name: h.name,
      ran: h.shouldRun && already.has(h.name),
      reason: already.has(h.name)
        ? "ran_once_via_delegate"
        : h.shouldRun
          ? "delegate_owns_hook_dispatch"
          : h.reason,
    }));

    const finishedAt = new Date();
    return {
      ok:
        delegated.status === "SUCCESS" ||
        delegated.status === "SUCCESS_WITH_ERRORS" ||
        delegated.status === "SKIPPED_FLAG" ||
        delegated.status === "INCONCLUSIVE",
      status: delegated.status,
      execution,
      runId: delegated.runId ?? null,
      correlationId: execution.correlationId,
      lock: { name: execution.lockName, acquired: true },
      payloadComplete: delegated.payloadComplete ?? null,
      counters: { ...emptyCanonicalCounters(), ...delegated.counters },
      hooks,
      message: delegated.message,
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
    };
  } finally {
    releaseCanonicalEntityLock(execution.correlationId);
  }
}

/**
 * Pedidos — serviço canônico único.
 * Delegate padrão: implementação em scripts/nomusSalesOrdersSyncV1 (export execute*).
 */
export async function runNomusSalesOrdersSync(
  request: Omit<NomusCanonicalSyncRequest, "entity"> & {
    entity?: "SALES_ORDER";
  },
  delegate?: NomusCanonicalSyncDelegate
): Promise<NomusCanonicalSyncResult> {
  const full: NomusCanonicalSyncRequest = {
    ...request,
    entity: "SALES_ORDER",
    scope: request.scope ?? {
      kind: "sales_orders_issue_date_window",
      strategy: request.strategy,
    },
  };

  const impl =
    delegate ??
    (async (execution) => {
      const mod = await import(
        /* webpackIgnore: true */ "../../../scripts/nomusSalesOrdersSyncV1.ts"
      );
      if (typeof mod.executeNomusSalesOrdersSync !== "function") {
        throw new Error(
          "executeNomusSalesOrdersSync ausente — script deve exportar a implementação canônica."
        );
      }
      return mod.executeNomusSalesOrdersSync(execution) as Promise<NomusCanonicalSyncDelegateResult>;
    });

  return runCanonicalEntitySync(full, impl);
}

export async function runNomusAccountsReceivableSync(
  request: Omit<NomusCanonicalSyncRequest, "entity"> & {
    entity?: "ACCOUNTS_RECEIVABLE";
  },
  delegate?: NomusCanonicalSyncDelegate
): Promise<NomusCanonicalSyncResult> {
  const full: NomusCanonicalSyncRequest = {
    ...request,
    entity: "ACCOUNTS_RECEIVABLE",
    scope: request.scope ?? {
      kind: "accounts_receivable_due_date_window",
      strategy: request.strategy,
    },
  };

  const impl =
    delegate ??
    (async (execution) => {
      const mod = await import(
        /* webpackIgnore: true */ "../../../scripts/nomusAccountsReceivableSync.ts"
      );
      if (typeof mod.executeNomusAccountsReceivableSync !== "function") {
        throw new Error(
          "executeNomusAccountsReceivableSync ausente — script deve exportar a implementação canônica."
        );
      }
      return mod.executeNomusAccountsReceivableSync(
        execution
      ) as Promise<NomusCanonicalSyncDelegateResult>;
    });

  return runCanonicalEntitySync(full, impl);
}

export async function runNomusAccountsPayableSync(
  request: Omit<NomusCanonicalSyncRequest, "entity"> & {
    entity?: "ACCOUNTS_PAYABLE";
  },
  delegate?: NomusCanonicalSyncDelegate
): Promise<NomusCanonicalSyncResult> {
  const full: NomusCanonicalSyncRequest = {
    ...request,
    entity: "ACCOUNTS_PAYABLE",
    scope: request.scope ?? {
      kind: "accounts_payable_due_date_window",
      strategy: request.strategy,
    },
  };

  const impl =
    delegate ??
    (async (execution) => {
      const mod = await import(
        /* webpackIgnore: true */ "../../../scripts/nomusAccountsPayableSync.ts"
      );
      if (typeof mod.executeNomusAccountsPayableSync !== "function") {
        throw new Error(
          "executeNomusAccountsPayableSync ausente — script deve exportar a implementação canônica."
        );
      }
      return mod.executeNomusAccountsPayableSync(
        execution
      ) as Promise<NomusCanonicalSyncDelegateResult>;
    });

  return runCanonicalEntitySync(full, impl);
}

export function resolveSourceTriggerFromEnv(
  env: NodeJS.ProcessEnv = process.env
): NomusCanonicalSyncRequest["sourceTrigger"] {
  const raw = (env.NOMUS_CANONICAL_SOURCE_TRIGGER ?? "").trim().toUpperCase();
  const allowed = new Set([
    "SCHEDULED_HOURLY",
    "SCHEDULED_DAILY",
    "ADMIN_PANEL",
    "CLI",
    "ORCHESTRATOR",
    "TARGETED_AUDIT",
  ]);
  if (allowed.has(raw)) {
    return raw as NomusCanonicalSyncRequest["sourceTrigger"];
  }
  return "CLI";
}
