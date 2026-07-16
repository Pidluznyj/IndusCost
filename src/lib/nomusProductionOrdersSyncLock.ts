/**
 * Lock exclusivo de sync de Ordens de Produção (OP-11).
 *
 * - Um único arquivo serializa backfill + incremental (e sync unificado).
 * - Não mata processo válido: se PID vivo, retorna BLOCKED.
 * - PID morto → lock órfão reclaimado (processo interrompido).
 * - Opcionalmente detecta lock global Nomus (manual vs automático).
 */

import { existsSync, mkdirSync, openSync, closeSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { isGlobalNomusSyncLockHeldFromFlockProbe } from "@/src/lib/nomusDailySyncRunnerShared.js";
import {
  NOMUS_PRODUCTION_ORDERS_LOG_PREFIX,
  NOMUS_SYNC_GLOBAL_LOCK_FILE_DEFAULT,
  resolveProductionOrdersSyncLockFile,
  shouldRespectGlobalNomusLock,
  type ProductionOrdersSyncRunMode,
  type ProductionOrdersSyncRunType,
} from "@/src/lib/nomusProductionOrdersSyncConstants.js";

export type ProductionOrdersSyncLockPayload = {
  version: 1;
  token: string;
  pid: number;
  type: ProductionOrdersSyncRunType;
  mode: ProductionOrdersSyncRunMode;
  startedAt: string;
  hostname: string | null;
};

export type ProductionOrdersSyncLockAcquireResult =
  | {
      ok: true;
      lockFile: string;
      token: string;
      payload: ProductionOrdersSyncLockPayload;
    }
  | {
      ok: false;
      code: "LOCK_HELD" | "GLOBAL_LOCK_HELD" | "SHELL_LOCK_HELD";
      message: string;
      lockFile: string;
      holder: ProductionOrdersSyncLockPayload | null;
    };

export type ProductionOrdersSyncLockHandle = {
  lockFile: string;
  token: string;
  payload: ProductionOrdersSyncLockPayload;
  release: () => void;
};

function isPidAlive(pid: number): boolean {
  if (!Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === "EPERM") return true; // existe, sem permissão de sinal
    return false; // ESRCH etc.
  }
}

export function parseProductionOrdersSyncLockPayload(
  raw: string | null | undefined
): ProductionOrdersSyncLockPayload | null {
  if (!raw?.trim()) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<ProductionOrdersSyncLockPayload>;
    if (parsed.version !== 1) return null;
    if (typeof parsed.token !== "string" || !parsed.token) return null;
    if (typeof parsed.pid !== "number" || !Number.isFinite(parsed.pid)) return null;
    if (parsed.type !== "backfill" && parsed.type !== "incremental" && parsed.type !== "sync") {
      return null;
    }
    if (parsed.mode !== "preview" && parsed.mode !== "apply") return null;
    if (typeof parsed.startedAt !== "string" || !parsed.startedAt) return null;
    return {
      version: 1,
      token: parsed.token,
      pid: Math.trunc(parsed.pid),
      type: parsed.type,
      mode: parsed.mode,
      startedAt: parsed.startedAt,
      hostname: typeof parsed.hostname === "string" ? parsed.hostname : null,
    };
  } catch {
    return null;
  }
}

export function readProductionOrdersSyncLockFile(
  lockFile: string
): ProductionOrdersSyncLockPayload | null {
  try {
    if (!existsSync(lockFile)) return null;
    return parseProductionOrdersSyncLockPayload(readFileSync(lockFile, "utf8"));
  } catch {
    return null;
  }
}

export function probeGlobalNomusSyncLockHeld(
  lockFile: string = NOMUS_SYNC_GLOBAL_LOCK_FILE_DEFAULT
): boolean {
  try {
    const probe = spawnSync("flock", ["-n", lockFile, "-c", "true"], { stdio: "ignore" });
    if (probe.error) return false; // Windows / flock ausente → não bloqueia
    return isGlobalNomusSyncLockHeldFromFlockProbe(probe.status);
  } catch {
    return false;
  }
}

/** Probe do flock companion do shell (`lockFile.flock`). */
export function probeProductionOrdersShellFlockHeld(lockFile: string): boolean {
  return probeGlobalNomusSyncLockHeld(`${lockFile}.flock`);
}

function ensureLockDir(lockFile: string): void {
  const dir = dirname(lockFile);
  if (dir && dir !== "." && !existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

function tryRemoveStaleLock(lockFile: string, holder: ProductionOrdersSyncLockPayload | null): boolean {
  if (!holder) {
    try {
      unlinkSync(lockFile);
      return true;
    } catch {
      return false;
    }
  }
  if (isPidAlive(holder.pid)) return false;
  try {
    unlinkSync(lockFile);
    return true;
  } catch {
    return false;
  }
}

/**
 * Adquire lock exclusivo. Não mata processo válido.
 * Lock órfão (PID morto) é reclaimado.
 */
export function acquireProductionOrdersSyncLock(args: {
  type: ProductionOrdersSyncRunType;
  mode: ProductionOrdersSyncRunMode;
  lockFile?: string;
  env?: NodeJS.ProcessEnv;
  respectGlobalLock?: boolean;
  probeGlobalLock?: () => boolean;
  now?: () => Date;
  pid?: number;
}): ProductionOrdersSyncLockAcquireResult {
  const env = args.env ?? process.env;
  const lockFile = args.lockFile ?? resolveProductionOrdersSyncLockFile(env);
  const respectGlobal =
    args.respectGlobalLock ?? shouldRespectGlobalNomusLock(env);
  const probeGlobal = args.probeGlobalLock ?? (() => probeGlobalNomusSyncLockHeld());

  if (respectGlobal && probeGlobal()) {
    return {
      ok: false,
      code: "GLOBAL_LOCK_HELD",
      message:
        "SKIPPED: sync global Nomus (pedidos/daily) em andamento — execução de OP bloqueada para evitar conflito manual/automático.",
      lockFile,
      holder: null,
    };
  }

  if (
    (env.NOMUS_PRODUCTION_ORDERS_UNDER_SHELL_LOCK ?? "").trim() !== "1" &&
    probeProductionOrdersShellFlockHeld(lockFile)
  ) {
    return {
      ok: false,
      code: "SHELL_LOCK_HELD",
      message:
        "SKIPPED: runner shell de Ordens de Produção já está em andamento (flock ativo).",
      lockFile,
      holder: null,
    };
  }

  ensureLockDir(lockFile);

  const payload: ProductionOrdersSyncLockPayload = {
    version: 1,
    token: randomUUID(),
    pid: args.pid ?? process.pid,
    type: args.type,
    mode: args.mode,
    startedAt: (args.now ?? (() => new Date()))().toISOString(),
    hostname: hostname() || null,
  };

  const tryCreate = (): boolean => {
    try {
      const fd = openSync(lockFile, "wx");
      try {
        writeFileSync(fd, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
      } finally {
        closeSync(fd);
      }
      return true;
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err.code === "EEXIST") return false;
      throw error;
    }
  };

  if (tryCreate()) {
    return { ok: true, lockFile, token: payload.token, payload };
  }

  const holder = readProductionOrdersSyncLockFile(lockFile);
  if (tryRemoveStaleLock(lockFile, holder) && tryCreate()) {
    return { ok: true, lockFile, token: payload.token, payload };
  }

  const live = readProductionOrdersSyncLockFile(lockFile);
  const holderDesc = live
    ? `type=${live.type} mode=${live.mode} pid=${live.pid} since=${live.startedAt}`
    : "holder desconhecido";

  return {
    ok: false,
    code: "LOCK_HELD",
    message: `SKIPPED: outra execução de Ordens de Produção ainda está em andamento (${holderDesc}).`,
    lockFile,
    holder: live,
  };
}

/** Libera somente se o token for o dono atual (não derruba execução alheia). */
export function releaseProductionOrdersSyncLock(args: {
  lockFile: string;
  token: string;
}): boolean {
  const current = readProductionOrdersSyncLockFile(args.lockFile);
  if (!current) return true;
  if (current.token !== args.token) return false;
  try {
    unlinkSync(args.lockFile);
    return true;
  } catch {
    return false;
  }
}

export function acquireProductionOrdersSyncLockHandle(
  args: Parameters<typeof acquireProductionOrdersSyncLock>[0]
): ProductionOrdersSyncLockHandle | ProductionOrdersSyncLockAcquireResult & { ok: false } {
  const result = acquireProductionOrdersSyncLock(args);
  if (!result.ok) return result;
  return {
    lockFile: result.lockFile,
    token: result.token,
    payload: result.payload,
    release: () => {
      releaseProductionOrdersSyncLock({ lockFile: result.lockFile, token: result.token });
    },
  };
}

export function formatProductionOrdersLockBlockedLog(
  result: Extract<ProductionOrdersSyncLockAcquireResult, { ok: false }>
): string {
  return `${NOMUS_PRODUCTION_ORDERS_LOG_PREFIX} ${result.message} lockFile=${result.lockFile} code=${result.code}`;
}
