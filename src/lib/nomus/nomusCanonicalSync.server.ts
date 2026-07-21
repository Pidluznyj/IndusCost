/**
 * SYNC-07 — Gateway canônico de sync Nomus (server).
 *
 * runNomusSalesOrdersSync / runNomusAccountsReceivableSync / runNomusAccountsPayableSync
 * são as únicas funções de apply por entidade. CLI, shell, painel e orquestrador
 * apenas montam o request e chamam estes serviços.
 *
 * OP-04: lock canônico TypeScript usa pathname separado do flock do shell
 * (CR/CP: `.canonical.lock`) para evitar autolock SKIPPED_LOCKED.
 */

import {
  mkdirSync,
  openSync,
  closeSync,
  unlinkSync,
  existsSync,
  writeSync,
  readFileSync,
} from "node:fs";
import { dirname } from "node:path";
import {
  buildCanonicalSyncExecution,
  emptyCanonicalCounters,
  ENTITY_CANONICAL_LOCK_ENV,
  ENTITY_LOCK_FILE_DEFAULT,
  ENTITY_SHELL_FLOCK_FILE_DEFAULT,
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

/** Path do lock canônico interno (openSync wx) — exportado para testes OP-04. */
export function resolveCanonicalEntityLockFile(
  name: NomusCanonicalSyncLockName,
  env: NodeJS.ProcessEnv = process.env
): string {
  const envKey = ENTITY_CANONICAL_LOCK_ENV[name];
  const fromEnv = envKey ? (env[envKey] ?? "").trim() : "";
  return fromEnv || ENTITY_LOCK_FILE_DEFAULT[name];
}

/** Path do flock do shell (CR/CP) — só documentação/teste; shell usa NOMUS_AR/AP_SYNC_LOCK_FILE. */
export function resolveShellFlockLockFile(
  name: "nomus-accounts-receivable" | "nomus-accounts-payable",
  env: NodeJS.ProcessEnv = process.env
): string {
  const envKey =
    name === "nomus-accounts-receivable"
      ? "NOMUS_AR_SYNC_LOCK_FILE"
      : "NOMUS_AP_SYNC_LOCK_FILE";
  const fromEnv = (env[envKey] ?? "").trim();
  return fromEnv || ENTITY_SHELL_FLOCK_FILE_DEFAULT[name];
}

function isProcessAlive(pid: number): boolean {
  if (!Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code;
    // EPERM: processo existe mas sem permissão de sinal — não é stale.
    if (code === "EPERM") return true;
    return false;
  }
}

/**
 * Recupera lock canônico obsoleto somente com PID comprovadamente morto.
 * Não remove por tempo. Não remove lock ativo de outro processo.
 */
export function tryRecoverStaleCanonicalLock(path: string): {
  recovered: boolean;
  reason: string;
} {
  if (!existsSync(path)) {
    return { recovered: false, reason: "lock_absent" };
  }
  let raw = "";
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return { recovered: false, reason: "unreadable" };
  }
  const match = raw.match(/^pid=(\d+)\s*$/m);
  if (!match) {
    return {
      recovered: false,
      reason: "no_pid_metadata_no_blind_delete",
    };
  }
  const pid = Number(match[1]);
  if (isProcessAlive(pid)) {
    return { recovered: false, reason: `owner_alive_pid=${pid}` };
  }
  try {
    unlinkSync(path);
    console.warn(
      `[nomus-canonical-lock] stale lock recuperado path=${path} pid=${pid} (processo inexistente)`
    );
    return { recovered: true, reason: `stale_pid=${pid}` };
  } catch {
    return { recovered: false, reason: "unlink_failed" };
  }
}

function writeCanonicalLockMetadata(
  fd: number,
  name: NomusCanonicalSyncLockName
): void {
  const body = [
    `pid=${process.pid}`,
    `name=${name}`,
    `acquiredAt=${new Date().toISOString()}`,
    "",
  ].join("\n");
  writeSync(fd, body);
}

/**
 * Lock por entidade (best-effort em Windows/Linux).
 * Em Linux, shells usam flock em path separado (CR/CP); este lock
 * serializa chamadas in-process / CLI concorrentes da mesma entidade.
 */
export function tryAcquireCanonicalEntityLock(
  name: NomusCanonicalSyncLockName,
  correlationId: string,
  options?: { env?: NodeJS.ProcessEnv }
):
  | { ok: true; path: string; recoveredStale?: boolean }
  | { ok: false; code: "LOCK_HELD"; path: string; message: string } {
  const env = options?.env ?? process.env;
  const path = resolveCanonicalEntityLockFile(name, env);
  try {
    mkdirSync(dirname(path), { recursive: true });
  } catch {
    /* ignore */
  }

  const attemptOpen = ():
    | { ok: true; path: string; recoveredStale?: boolean }
    | { ok: false; code: "LOCK_HELD"; path: string; message: string }
    | { retry: true } => {
    try {
      const fd = openSync(path, "wx");
      try {
        writeCanonicalLockMetadata(fd, name);
      } catch {
        /* metadata best-effort — lock ainda vale */
      }
      heldByCorrelation.set(correlationId, { name, fd, path });
      return { ok: true, path };
    } catch (error) {
      const code = (error as NodeJS.ErrnoException)?.code;
      if (code === "EEXIST") {
        return { retry: true };
      }
      // Fallback: se filesystem não suporte wx exclusivo, não bloqueia apply
      // (shell flock permanece autoridade no host).
      return { ok: true, path };
    }
  };

  const first = attemptOpen();
  if (!("retry" in first)) return first;

  const recovered = tryRecoverStaleCanonicalLock(path);
  if (recovered.recovered) {
    const second = attemptOpen();
    if (!("retry" in second) && second.ok) {
      return { ...second, recoveredStale: true };
    }
    if (!("retry" in second)) return second;
  }

  return {
    ok: false,
    code: "LOCK_HELD",
    path,
    message: `SKIPPED_LOCKED: lock canônico ${name} já adquirido (${path}).`,
  };
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
    console.warn(
      `[nomus-canonical-sync] SKIPPED_LOCKED entity=${execution.entity} correlationId=${execution.correlationId} path=${lockAttempt.path}`
    );
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

  console.info(
    `[nomus-canonical-sync] RUN_STARTED entity=${execution.entity} correlationId=${execution.correlationId} lock=${lockAttempt.path}${
      lockAttempt.recoveredStale ? " stale_recovered=1" : ""
    }`
  );

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
    console.info(
      `[nomus-canonical-sync] ${delegated.status} entity=${execution.entity} correlationId=${execution.correlationId}`
    );
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
  } catch (error) {
    console.error(
      `[nomus-canonical-sync] FAILED entity=${execution.entity} correlationId=${execution.correlationId}`,
      error
    );
    throw error;
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
