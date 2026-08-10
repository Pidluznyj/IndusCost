/**
 * Lock exclusivo do sync de Propostas Nomus (SYNC-07 — rotina horária).
 *
 * - Um único arquivo serializa qualquer execução (CLI direto, orquestrador
 *   diário via --only=proposals, cron horário) — sem matar processo vivo.
 * - PID morto → lock órfão reclaimado.
 * - Respeita o lock global Nomus (`nomus-orchestrator-global`, usado pelo
 *   pipeline diário das 02:00 e pelo runner de Pedidos) via probe externo
 *   (não adquire — apenas verifica). Mesmo mecanismo de
 *   `nomusProductionOrdersSyncLock.ts`.
 * - Quando o global está ocupado, NÃO desiste na hora: espera de forma
 *   segura (flock bloqueante com timeout — zero polling) até liberar ou
 *   estourar `NOMUS_PROPOSALS_GLOBAL_LOCK_WAIT_SECONDS` (default 45min).
 *   Um lock dedicado (`hourlyWaiterLock`) garante no máximo um "waiter"
 *   por vez — não protege dados, só evita dois crons esperando em paralelo.
 * - Sem deadlock: o pipeline diário (`runNomusDailySync.sh`) já roda sua
 *   etapa de propostas com `NOMUS_PROPOSALS_RESPECT_GLOBAL_LOCK=0` — nunca
 *   entra neste fluxo de espera, então nunca espera por si mesmo.
 */

import { existsSync, mkdirSync, openSync, closeSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import {
  probeGlobalNomusSyncLockHeld,
  waitForGlobalNomusSyncLockToFree,
} from "@/src/lib/nomusProductionOrdersSyncLock.js";
import {
  NOMUS_PROPOSALS_LOG_PREFIX,
  resolveProposalsGlobalLockWaitSeconds,
  resolveProposalsHourlyWaiterLockFile,
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

/** Metadados de espera pelo lock global — presente quando houve espera (bem-sucedida ou não). */
export type ProposalsGlobalLockWaitInfo = {
  reason: "GLOBAL_LOCK_HELD";
  waitStartedAt: string;
  waitFinishedAt: string;
  waitDurationMs: number;
  timeoutSeconds: number;
};

export type ProposalsSyncLockAcquireResult =
  | {
      ok: true;
      lockFile: string;
      token: string;
      payload: ProposalsSyncLockPayload;
      /** Presente quando a aquisição precisou esperar o lock global liberar. */
      wait: ProposalsGlobalLockWaitInfo | null;
    }
  | {
      ok: false;
      code: "LOCK_HELD" | "GLOBAL_LOCK_HELD" | "GLOBAL_LOCK_WAIT_TIMEOUT" | "HOURLY_WAITER_ALREADY_ACTIVE";
      message: string;
      lockFile: string;
      holder: ProposalsSyncLockPayload | null;
      /** Presente em GLOBAL_LOCK_WAIT_TIMEOUT — quanto tempo esperou antes de desistir. */
      wait?: ProposalsGlobalLockWaitInfo | null;
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

// ---------------------------------------------------------------------------
// Waiter lock — dedup de "hourly waiters" (seção 6/20 da missão). NÃO protege
// dados: só impede que dois disparos horários fiquem esperando o lock global
// ao mesmo tempo. Nunca usado pelo sync diário nem pelo CLI fora do fluxo de
// espera. Mesmo padrão de orphan-reclaim (PID morto) do lock principal.
// ---------------------------------------------------------------------------

type HourlyWaiterLockPayload = {
  version: 1;
  token: string;
  pid: number;
  startedAt: string;
};

function readHourlyWaiterLockFile(lockFile: string): HourlyWaiterLockPayload | null {
  try {
    if (!existsSync(lockFile)) return null;
    const raw = JSON.parse(readFileSync(lockFile, "utf8")) as Partial<HourlyWaiterLockPayload>;
    if (raw.version !== 1 || typeof raw.token !== "string" || typeof raw.pid !== "number") return null;
    return {
      version: 1,
      token: raw.token,
      pid: Math.trunc(raw.pid),
      startedAt: typeof raw.startedAt === "string" ? raw.startedAt : "",
    };
  } catch {
    return null;
  }
}

function tryAcquireHourlyWaiterLock(
  lockFile: string,
  now: () => Date,
  pid: number
): { ok: true; token: string } | { ok: false } {
  ensureLockDir(lockFile);
  const payload: HourlyWaiterLockPayload = {
    version: 1,
    token: randomUUID(),
    pid,
    startedAt: now().toISOString(),
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
  if (tryCreate()) return { ok: true, token: payload.token };

  const holder = readHourlyWaiterLockFile(lockFile);
  const staleOrOrphan = !holder || !isPidAlive(holder.pid);
  if (staleOrOrphan) {
    try {
      unlinkSync(lockFile);
    } catch {
      /* concorrência residual — próxima tentativa (ou o próximo cron) resolve */
    }
    if (tryCreate()) return { ok: true, token: payload.token };
  }
  return { ok: false };
}

function releaseHourlyWaiterLock(lockFile: string, token: string): void {
  const current = readHourlyWaiterLockFile(lockFile);
  if (!current || current.token !== token) return;
  try {
    unlinkSync(lockFile);
  } catch {
    /* melhor esforço — PID morto detectado no próximo waiter reclaima */
  }
}

/**
 * Adquire lock exclusivo do sync de propostas. Não mata processo válido.
 * Lock órfão (PID morto) é reclaimado.
 *
 * Lock global (`respectGlobalLock`): antes só VERIFICAVA (não adquiria) e, se
 * ocupado, retornava GLOBAL_LOCK_HELD na hora — a execução horária era
 * perdida até o próximo cron. Agora, quando ocupado, espera de forma segura
 * (flock bloqueante com timeout, zero polling) até liberar ou estourar
 * `globalLockWaitSeconds` (default 45 min, `0` = comportamento legado).
 * Um lock dedicado (`waiterLockFile`) garante no máximo um "waiter" horário
 * por vez — uma segunda execução concorrente não fica esperando em paralelo,
 * volta imediatamente como HOURLY_WAITER_ALREADY_ACTIVE.
 */
export function acquireProposalsSyncLock(args: {
  mode: ProposalsSyncRunMode;
  lockFile?: string;
  env?: NodeJS.ProcessEnv;
  respectGlobalLock?: boolean;
  probeGlobalLock?: () => boolean;
  globalLockWaitSeconds?: number;
  waiterLockFile?: string;
  /** Espera bloqueante pelo lock global; retorna true se liberou dentro do timeout. Injetável para testes. */
  waitForGlobalLock?: (timeoutSeconds: number) => boolean;
  now?: () => Date;
  pid?: number;
}): ProposalsSyncLockAcquireResult {
  const env = args.env ?? process.env;
  const lockFile = args.lockFile ?? resolveProposalsSyncLockFile(env);
  const respectGlobal = args.respectGlobalLock ?? shouldRespectGlobalNomusLock(env);
  const probeGlobal = args.probeGlobalLock ?? (() => probeGlobalNomusSyncLockHeld());
  const now = args.now ?? (() => new Date());
  const pid = args.pid ?? process.pid;

  let waitInfo: ProposalsGlobalLockWaitInfo | null = null;

  if (respectGlobal && probeGlobal()) {
    const waitSeconds = args.globalLockWaitSeconds ?? resolveProposalsGlobalLockWaitSeconds(env);

    if (waitSeconds <= 0) {
      return {
        ok: false,
        code: "GLOBAL_LOCK_HELD",
        message: `${NOMUS_PROPOSALS_LOG_PREFIX} SKIPPED: sync global Nomus (diário 02:00 / pedidos) em andamento — propostas horário adiado para evitar conflito.`,
        lockFile,
        holder: null,
      };
    }

    const waiterLockFile = args.waiterLockFile ?? resolveProposalsHourlyWaiterLockFile(env);
    const waiter = tryAcquireHourlyWaiterLock(waiterLockFile, now, pid);
    if (!waiter.ok) {
      return {
        ok: false,
        code: "HOURLY_WAITER_ALREADY_ACTIVE",
        message: `${NOMUS_PROPOSALS_LOG_PREFIX} SKIPPED: já existe uma execução horária de propostas aguardando o lock global (waiterLockFile=${waiterLockFile}).`,
        lockFile,
        holder: null,
      };
    }

    const waitStartedAt = now();
    console.log(
      `${NOMUS_PROPOSALS_LOG_PREFIX} WAITING_FOR_GLOBAL_LOCK startedWaitingAt=${waitStartedAt.toISOString()} timeoutSeconds=${waitSeconds}`
    );
    let acquired: boolean;
    try {
      const wait = args.waitForGlobalLock ?? ((timeoutSeconds: number) => waitForGlobalNomusSyncLockToFree(timeoutSeconds));
      acquired = wait(waitSeconds);
    } finally {
      releaseHourlyWaiterLock(waiterLockFile, waiter.token);
    }
    const waitFinishedAt = now();
    waitInfo = {
      reason: "GLOBAL_LOCK_HELD",
      waitStartedAt: waitStartedAt.toISOString(),
      waitFinishedAt: waitFinishedAt.toISOString(),
      waitDurationMs: waitFinishedAt.getTime() - waitStartedAt.getTime(),
      timeoutSeconds: waitSeconds,
    };
    console.log(
      `${NOMUS_PROPOSALS_LOG_PREFIX} ${acquired ? "GLOBAL_LOCK_AVAILABLE" : "GLOBAL_LOCK_WAIT_TIMEOUT"} globalLockAvailableAt=${waitFinishedAt.toISOString()} waitDurationMs=${waitInfo.waitDurationMs}`
    );

    if (!acquired) {
      return {
        ok: false,
        code: "GLOBAL_LOCK_WAIT_TIMEOUT",
        message: `${NOMUS_PROPOSALS_LOG_PREFIX} SKIPPED: sync global Nomus continuou ocupado após ${waitSeconds}s de espera — propostas horário adiado para o próximo cron.`,
        lockFile,
        holder: null,
        wait: waitInfo,
      };
    }
  }

  ensureLockDir(lockFile);

  const payload: ProposalsSyncLockPayload = {
    version: 1,
    token: randomUUID(),
    pid,
    mode: args.mode,
    startedAt: now().toISOString(),
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
    return { ok: true, lockFile, token: payload.token, payload, wait: waitInfo };
  }

  const holder = readProposalsSyncLockFile(lockFile);
  if (tryRemoveStaleLock(lockFile, holder) && tryCreate()) {
    return { ok: true, lockFile, token: payload.token, payload, wait: waitInfo };
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
