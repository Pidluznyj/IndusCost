/**
 * Constantes de lock / auditoria do sync de Ordens de Produção Nomus (OP-11).
 */

export const NOMUS_PRODUCTION_ORDERS_LOG_PREFIX = "[nomus-production-orders]";

export const NOMUS_PRODUCTION_ORDERS_SYNC_TARGET = "production-orders" as const;

export const NOMUS_PRODUCTION_ORDERS_SYNC_LOCK_ENV = "NOMUS_PRODUCTION_ORDERS_SYNC_LOCK_FILE";

/** Lock dedicado compartilhado por backfill + incremental (manual e automático). */
export const NOMUS_PRODUCTION_ORDERS_SYNC_LOCK_FILE_DEFAULT =
  "/tmp/induscost-nomus-production-orders.lock";

export const NOMUS_PRODUCTION_ORDERS_RESPECT_GLOBAL_LOCK_ENV =
  "NOMUS_PRODUCTION_ORDERS_RESPECT_GLOBAL_LOCK";

/** Lock global de pedidos/daily — conflito manual × automático. */
export const NOMUS_SYNC_GLOBAL_LOCK_FILE_DEFAULT =
  process.env.NOMUS_SYNC_LOCK_FILE || "/tmp/induscost-nomus-sync-global.lock";

export type ProductionOrdersSyncRunType = "backfill" | "incremental" | "sync";

export type ProductionOrdersSyncRunMode = "preview" | "apply";

export type ProductionOrdersSyncRunStatus =
  | "SUCCESS"
  | "FAILED"
  | "BLOCKED"
  | "INTERRUPTED";

export function resolveProductionOrdersSyncLockFile(
  env: NodeJS.ProcessEnv = process.env
): string {
  const fromEnv = (env[NOMUS_PRODUCTION_ORDERS_SYNC_LOCK_ENV] ?? "").trim();
  return fromEnv || NOMUS_PRODUCTION_ORDERS_SYNC_LOCK_FILE_DEFAULT;
}

export function shouldRespectGlobalNomusLock(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = (env[NOMUS_PRODUCTION_ORDERS_RESPECT_GLOBAL_LOCK_ENV] ?? "1").trim().toLowerCase();
  return raw !== "0" && raw !== "false" && raw !== "no";
}
