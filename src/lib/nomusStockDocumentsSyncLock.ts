/**
 * Lock exclusivo do sync de Documentos de Saída.
 * Espelha o padrão de Ordens de Produção (PID + token), sem cron.
 */

import {
  existsSync,
  mkdirSync,
  openSync,
  closeSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import {
  NOMUS_STOCK_DOCUMENTS_LOG_PREFIX,
  resolveStockDocumentsSyncLockFile,
} from "./nomusStockDocumentsSyncConstants.js";
import type { StockDocumentsSyncMode } from "./nomusStockDocumentsSyncLogic.js";

export type StockDocumentsSyncLockPayload = {
  version: 1;
  token: string;
  pid: number;
  mode: StockDocumentsSyncMode;
  startedAt: string;
  hostname: string | null;
};

export type StockDocumentsSyncLockAcquireResult =
  | {
      ok: true;
      lockFile: string;
      token: string;
      payload: StockDocumentsSyncLockPayload;
    }
  | {
      ok: false;
      code: "LOCK_HELD";
      message: string;
      lockFile: string;
      holder: StockDocumentsSyncLockPayload | null;
    };

export type StockDocumentsSyncLockHandle = {
  lockFile: string;
  token: string;
  payload: StockDocumentsSyncLockPayload;
  release: () => void;
};

function isPidAlive(pid: number): boolean {
  if (!Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === "EPERM") return true;
    return false;
  }
}

export function parseStockDocumentsSyncLockPayload(
  raw: string | null | undefined
): StockDocumentsSyncLockPayload | null {
  if (!raw?.trim()) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<StockDocumentsSyncLockPayload>;
    if (parsed.version !== 1) return null;
    if (typeof parsed.token !== "string" || !parsed.token) return null;
    if (typeof parsed.pid !== "number" || !Number.isFinite(parsed.pid)) return null;
    if (parsed.mode !== "preview" && parsed.mode !== "apply") return null;
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

export function readStockDocumentsSyncLockFile(
  lockFile: string
): StockDocumentsSyncLockPayload | null {
  try {
    if (!existsSync(lockFile)) return null;
    return parseStockDocumentsSyncLockPayload(readFileSync(lockFile, "utf8"));
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

function tryRemoveStaleLock(
  lockFile: string,
  holder: StockDocumentsSyncLockPayload | null
): boolean {
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

export function acquireStockDocumentsSyncLock(args: {
  mode: StockDocumentsSyncMode;
  lockFile?: string;
  env?: NodeJS.ProcessEnv;
  now?: () => Date;
  pid?: number;
}): StockDocumentsSyncLockAcquireResult {
  const env = args.env ?? process.env;
  const lockFile = args.lockFile ?? resolveStockDocumentsSyncLockFile(env);
  ensureLockDir(lockFile);

  const payload: StockDocumentsSyncLockPayload = {
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

  const holder = readStockDocumentsSyncLockFile(lockFile);
  if (tryRemoveStaleLock(lockFile, holder) && tryCreate()) {
    console.warn(
      `${NOMUS_STOCK_DOCUMENTS_LOG_PREFIX} lock órfão reclaimado: ${lockFile}`
    );
    return { ok: true, lockFile, token: payload.token, payload };
  }

  return {
    ok: false,
    code: "LOCK_HELD",
    message: `${NOMUS_STOCK_DOCUMENTS_LOG_PREFIX} SKIPPED: outra execução de Documentos de Saída ainda está em andamento (${lockFile}).`,
    lockFile,
    holder: readStockDocumentsSyncLockFile(lockFile),
  };
}

export function releaseStockDocumentsSyncLock(args: {
  lockFile: string;
  token: string;
}): void {
  const holder = readStockDocumentsSyncLockFile(args.lockFile);
  if (!holder) return;
  if (holder.token !== args.token) return;
  try {
    unlinkSync(args.lockFile);
  } catch {
    // best-effort
  }
}

export function withStockDocumentsSyncLock(
  args: Parameters<typeof acquireStockDocumentsSyncLock>[0]
): StockDocumentsSyncLockHandle | null {
  const acquired = acquireStockDocumentsSyncLock(args);
  if (!acquired.ok) return null;
  return {
    lockFile: acquired.lockFile,
    token: acquired.token,
    payload: acquired.payload,
    release: () =>
      releaseStockDocumentsSyncLock({
        lockFile: acquired.lockFile,
        token: acquired.token,
      }),
  };
}
