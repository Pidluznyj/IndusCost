/**
 * PURCH-MIRROR-01 — Lock de arquivo contra execução concorrente do sync de
 * Pedidos de Compra Nomus. Modelado em
 * `nomusSalesOrderSourceReconciliation.server.ts::acquireSalesOrderReconcileLock`.
 *
 * Desvio deliberado do precedente: o default usa `os.tmpdir()` em vez de um
 * caminho `/tmp/...` fixo — o CODEBASE_MAP.md já documenta que o default
 * POSIX-only dos outros locks é uma pegadinha em dev Windows; aqui
 * corrigimos isso na origem em vez de repetir o problema. Pode ser
 * sobrescrito via `NOMUS_PURCHASE_ORDERS_SYNC_LOCK_FILE`.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir, hostname } from "node:os";
import { randomUUID } from "node:crypto";

export const NOMUS_PURCHASE_ORDERS_SYNC_LOCK_ENV =
  "NOMUS_PURCHASE_ORDERS_SYNC_LOCK_FILE";

type LockPayload = {
  version: 1;
  token: string;
  pid: number;
  mode: string;
  startedAt: string;
  hostname: string | null;
};

function isPidAlive(pid: number): boolean {
  if (!Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    return err.code === "EPERM";
  }
}

export function resolveNomusPurchaseOrdersSyncLockFile(
  env: NodeJS.ProcessEnv = process.env
): string {
  const raw = (env[NOMUS_PURCHASE_ORDERS_SYNC_LOCK_ENV] ?? "").trim();
  return raw || join(tmpdir(), "induscost-nomus-purchase-orders-sync.lock");
}

export type NomusPurchaseOrdersSyncLockAcquireResult =
  | { ok: true; lockFile: string; token: string; release: () => void }
  | { ok: false; code: "LOCKED"; message: string; lockFile: string };

/**
 * Tenta adquirir o lock. Uma segunda execução concorrente recebe
 * `{ ok: false, code: "LOCKED" }` e deve encerrar como SKIPPED — nunca deve
 * rodar em paralelo com outra instância do mesmo sync. Locks de PID morto
 * são auto-curados (self-heal), assim como no precedente de Pedidos de
 * Venda.
 */
export function acquireNomusPurchaseOrdersSyncLock(input: {
  mode: string;
  lockFile?: string;
  env?: NodeJS.ProcessEnv;
}): NomusPurchaseOrdersSyncLockAcquireResult {
  const lockFile =
    input.lockFile ?? resolveNomusPurchaseOrdersSyncLockFile(input.env);
  mkdirSync(dirname(lockFile), { recursive: true });

  if (existsSync(lockFile)) {
    try {
      const raw = readFileSync(lockFile, "utf8");
      const parsed = JSON.parse(raw) as Partial<LockPayload>;
      if (
        parsed.version === 1 &&
        typeof parsed.pid === "number" &&
        isPidAlive(parsed.pid)
      ) {
        return {
          ok: false,
          code: "LOCKED",
          message: `Sync de Pedidos de Compra Nomus já em andamento (pid=${parsed.pid}).`,
          lockFile,
        };
      }
      unlinkSync(lockFile);
    } catch {
      try {
        unlinkSync(lockFile);
      } catch {
        /* ignore */
      }
    }
  }

  const token = randomUUID();
  const payload: LockPayload = {
    version: 1,
    token,
    pid: process.pid,
    mode: input.mode,
    startedAt: new Date().toISOString(),
    hostname: hostname(),
  };
  writeFileSync(lockFile, JSON.stringify(payload), "utf8");

  const release = () => {
    try {
      if (!existsSync(lockFile)) return;
      const raw = readFileSync(lockFile, "utf8");
      const parsed = JSON.parse(raw) as Partial<LockPayload>;
      if (parsed.token === token) unlinkSync(lockFile);
    } catch {
      /* ignore */
    }
  };

  return { ok: true, lockFile, token, release };
}
