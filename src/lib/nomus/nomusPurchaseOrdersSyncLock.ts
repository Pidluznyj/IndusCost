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
 *
 * NOMUS-CRON-02 (agendamento pós-Contas a Receber) — acrescenta aqui o
 * mesmo padrão já usado por Ordens de Produção (OP-11,
 * `nomusProductionOrdersSyncLock.ts`): antes de disputar o lock próprio da
 * entidade, faz um PROBE (não uma aquisição) do lock global Nomus
 * (`/tmp/induscost-nomus-sync-global.lock`, o mesmo usado pelo sync diário e
 * por Pedidos de Venda). Reutiliza o probe existente
 * (`probeGlobalNomusSyncLockHeld`) em vez de reimplementar checagem de
 * `flock` — "não invente um segundo mecanismo de lock". Isso NÃO substitui
 * o lock de arquivo próprio (PID+token) abaixo, que continua sendo a única
 * proteção formal contra duas execuções de Pedidos de Compra em paralelo;
 * é uma camada adicional de coordenação com o resto do ecossistema Nomus
 * (Contas a Receber ainda não participa desse lock global — ver auditoria
 * em docs/NOMUS_PURCHASE_ORDERS_MIRROR.md seção 10).
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
import { probeGlobalNomusSyncLockHeld } from "../nomusProductionOrdersSyncLock.js";
import { NOMUS_SYNC_GLOBAL_LOCK_FILE_DEFAULT } from "../nomusProductionOrdersSyncConstants.js";

export const NOMUS_PURCHASE_ORDERS_SYNC_LOCK_ENV =
  "NOMUS_PURCHASE_ORDERS_SYNC_LOCK_FILE";

export const NOMUS_PURCHASE_ORDERS_RESPECT_GLOBAL_LOCK_ENV =
  "NOMUS_PURCHASE_ORDERS_RESPECT_GLOBAL_LOCK";

/**
 * Por padrão, respeita o lock global (não dispara Pedidos de Compra se o
 * sync diário/Pedidos de Venda estiver em andamento). O wrapper
 * `runNomusAccountsReceivableThenPurchaseOrdersSync.sh` já roda depois do
 * runner de Contas a Receber ter encerrado (que não detém o lock global),
 * então este probe continua útil ali para evitar colidir com o daily/SO.
 */
export function shouldRespectPurchaseOrdersGlobalLock(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  const raw = (
    env[NOMUS_PURCHASE_ORDERS_RESPECT_GLOBAL_LOCK_ENV] ?? "1"
  )
    .trim()
    .toLowerCase();
  return raw !== "0" && raw !== "false" && raw !== "no";
}

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
  | { ok: false; code: "LOCKED"; message: string; lockFile: string }
  | { ok: false; code: "GLOBAL_LOCK_HELD"; message: string; lockFile: string };

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
  respectGlobalLock?: boolean;
  probeGlobalLock?: () => boolean;
  globalLockFile?: string;
}): NomusPurchaseOrdersSyncLockAcquireResult {
  const env = input.env ?? process.env;
  const lockFile =
    input.lockFile ?? resolveNomusPurchaseOrdersSyncLockFile(env);

  const respectGlobal =
    input.respectGlobalLock ?? shouldRespectPurchaseOrdersGlobalLock(env);
  const probeGlobal =
    input.probeGlobalLock ??
    (() =>
      probeGlobalNomusSyncLockHeld(
        input.globalLockFile ?? NOMUS_SYNC_GLOBAL_LOCK_FILE_DEFAULT
      ));

  if (respectGlobal && probeGlobal()) {
    return {
      ok: false,
      code: "GLOBAL_LOCK_HELD",
      message:
        "SKIPPED: sync global Nomus (daily/Pedidos de Venda) em andamento — execução de Pedidos de Compra adiada para evitar disputa concorrente da API.",
      lockFile,
    };
  }

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
