/**
 * Lock exclusivo do sync de Propostas Nomus (SYNC-07 — rotina horária).
 *
 * - Um único arquivo serializa qualquer execução (CLI direto, orquestrador
 *   diário via --only=proposals, cron horário) — sem matar processo vivo.
 * - PID morto → lock órfão reclaimado.
 * - Respeita o lock global Nomus (`nomus-orchestrator-global`, usado pelo
 *   pipeline diário das 02:00 e pelo runner de Pedidos) via probe externo
 *   (não adquire — apenas verifica), evitando propostas rodarem em paralelo
 *   com o pipeline diário. Mesmo mecanismo de `nomusProductionOrdersSyncLock.ts`.
 */

import { existsSync, mkdirSync, openSync, closeSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { probeGlobalNomusSyncLockHeld } from "@/src/lib/nomusProductionOrdersSyncLock.js";
import {
  NOMUS_PROPOSALS_LOG_PREFIX,
  resolveProposalsSyncLockFile,
  shouldRespectGlobalNomusLock,
  type ProposalsSyncRunMode,
} from "@/src/lib/nomusProposalsSyncConstants.js";

export type ProposalsSyncLockPayload = {
  version: 1;
  token: string;
  pid: number;
  mode: ProposalsSyncRunMode;
  startedAt: string;
  hostname: string | null;
};

export type ProposalsSyncLockAcquireResult =
  | {
      ok: true;
      lockFile: string;
      token: string;
      payload: ProposalsSyncLockPayload;
    }
  | {
      ok: false;
      code: "LOCK_HELD" | "GLOBAL_LOCK_HELD";
      message: string;
      lockFile: string;
      holder: ProposalsSyncLockPayload | null;
    };

export type ProposalsSyncLockHandle = {
  lockFile: string;
  token: string;
  payload: ProposalsSyncLockPayload;
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

export function parseProposalsSyncLockPayload(raw: string | null | undefined): ProposalsSyncLockPayload | null {
  if (!raw?.trim()) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<ProposalsSyncLockPayload>;
    if (parsed.version !== 1) return null;
    if (typeof parsed.token !== "string" || !parsed.token) return null;
    if (typeof parsed.pid !== "number" || !Number.isFinite(parsed.pid)) return null;
    if (parsed.mode !== "dry" && parsed.mode !== "apply") return null;
    if (typeof parsed.startedAt !== "string" || !parsed.startedAt) return null;
    return {
      version: 1,
      token: parsed.token,
      pid: Math.trunc(parsed.pid),
      mode: parsed.mode,
      startedAt: parsed.startedAt,
      hostname: typeof parsed.hostname === "string" ? parsed.hostname : null,
    };
  } catch {
    return null;
  }
}

export function readProposalsSyncLockFile(lockFile: string): ProposalsSyncLockPayload | null {
  try {
    if (!existsSync(lockFile)) return null;
    return parseProposalsSyncLockPayload(readFileSync(lockFile, "utf8"));
  } catch {
    return null;
  }
}

function ensureLockDir(lockFile: string): void {
  const dir = dirname(lockFile);
  if (dir && dir !== "." && !existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

function tryRemoveStaleLock(lockFile: string, holder: ProposalsSyncLockPayload | null): boolean {
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
 * Adquire lock exclusivo do sync de propostas. Não mata processo válido.
 * Lock órfão (PID morto) é reclaimado. Verifica lock global antes (não adquire).
 */
export function acquireProposalsSyncLock(args: {
  mode: ProposalsSyncRunMode;
  lockFile?: string;
  env?: NodeJS.ProcessEnv;
  respectGlobalLock?: boolean;
  probeGlobalLock?: () => boolean;
  now?: () => Date;
  pid?: number;
}): ProposalsSyncLockAcquireResult {
  const env = args.env ?? process.env;
  const lockFile = args.lockFile ?? resolveProposalsSyncLockFile(env);
  const respectGlobal = args.respectGlobalLock ?? shouldRespectGlobalNomusLock(env);
  const probeGlobal = args.probeGlobalLock ?? (() => probeGlobalNomusSyncLockHeld());

  if (respectGlobal && probeGlobal()) {
    return {
      ok: false,
      code: "GLOBAL_LOCK_HELD",
      message: `${NOMUS_PROPOSALS_LOG_PREFIX} SKIPPED: sync global Nomus (diário 02:00 / pedidos) em andamento — propostas horário adiado para evitar conflito.`,
      lockFile,
      holder: null,
    };
  }

  ensureLockDir(lockFile);

  const payload: ProposalsSyncLockPayload = {
    version: 1,
    token: randomUUID(),
    pid: args.pid ?? process.pid,
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

  const holder = readProposalsSyncLockFile(lockFile);
  if (tryRemoveStaleLock(lockFile, holder) && tryCreate()) {
    return { ok: true, lockFile, token: payload.token, payload };
  }

  const live = readProposalsSyncLockFile(lockFile);
  const holderDesc = live ? `mode=${live.mode} pid=${live.pid} since=${live.startedAt}` : "holder desconhecido";

  return {
    ok: false,
    code: "LOCK_HELD",
    message: `${NOMUS_PROPOSALS_LOG_PREFIX} SKIPPED: outra execução do sync de propostas já está em andamento (${holderDesc}).`,
    lockFile,
    holder: live,
  };
}

/** Libera somente se o token for o dono atual (não derruba execução alheia). */
export function releaseProposalsSyncLock(args: { lockFile: string; token: string }): boolean {
  const current = readProposalsSyncLockFile(args.lockFile);
  if (!current) return true;
  if (current.token !== args.token) return false;
  try {
    unlinkSync(args.lockFile);
    return true;
  } catch {
    return false;
  }
}

export function withProposalsSyncLock(
  args: Parameters<typeof acquireProposalsSyncLock>[0]
): ProposalsSyncLockHandle | null {
  const acquired = acquireProposalsSyncLock(args);
  if (!acquired.ok) return null;
  return {
    lockFile: acquired.lockFile,
    token: acquired.token,
    payload: acquired.payload,
    release: () => releaseProposalsSyncLock({ lockFile: acquired.lockFile, token: acquired.token }),
  };
}

export function formatProposalsLockBlockedLog(
  result: Extract<ProposalsSyncLockAcquireResult, { ok: false }>
): string {
  return `${result.message} lockFile=${result.lockFile} code=${result.code}`;
}

export { probeGlobalNomusSyncLockHeld };
