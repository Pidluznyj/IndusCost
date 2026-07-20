/**
 * SYNC-07 — Policy pura de presença da origem (sem Prisma).
 *
 * Regra:
 * - PRESENT → operacional
 * - MISSING_CANDIDATE → operacional (alerta administrativo opcional)
 * - MISSING_CONFIRMED → fora das visões operacionais futuras; histórico/auditoria preservados
 *
 * Flags independentes (fail-closed): desligadas = comportamento anterior.
 * Filtros Prisma/SQL: ver `nomusSourcePresencePolicy.server.ts`.
 */

import type { NomusSourcePresenceStatus } from "./nomusSourceLifecycleContract.js";

export const NOMUS_OPS_EXCLUDE_MISSING_SALES_ORDERS_ENV =
  "NOMUS_OPS_EXCLUDE_MISSING_SALES_ORDERS_ENABLED";
export const NOMUS_OPS_EXCLUDE_MISSING_AR_ENV =
  "NOMUS_OPS_EXCLUDE_MISSING_AR_ENABLED";
export const NOMUS_OPS_EXCLUDE_MISSING_AP_ENV =
  "NOMUS_OPS_EXCLUDE_MISSING_AP_ENABLED";

const ENABLED_VALUES = new Set(["1", "true", "yes", "on", "enabled"]);

function isEnvFlagEnabled(
  env: Record<string, string | undefined>,
  key: string
): boolean {
  const raw = env[key]?.trim().toLowerCase();
  return raw != null && ENABLED_VALUES.has(raw);
}

export function isNomusOpsExcludeMissingSalesOrdersEnabled(
  env: Record<string, string | undefined> = process.env
): boolean {
  return isEnvFlagEnabled(env, NOMUS_OPS_EXCLUDE_MISSING_SALES_ORDERS_ENV);
}

export function isNomusOpsExcludeMissingArEnabled(
  env: Record<string, string | undefined> = process.env
): boolean {
  return isEnvFlagEnabled(env, NOMUS_OPS_EXCLUDE_MISSING_AR_ENV);
}

export function isNomusOpsExcludeMissingApEnabled(
  env: Record<string, string | undefined> = process.env
): boolean {
  return isEnvFlagEnabled(env, NOMUS_OPS_EXCLUDE_MISSING_AP_ENV);
}

/**
 * Equivalente canônico a isOperationallyPresent(record).
 * Só MISSING_CONFIRMED sai do universo operacional.
 */
export function isNomusSourceOperationallyPresent(
  status: NomusSourcePresenceStatus | string | null | undefined
): boolean {
  return status !== "MISSING_CONFIRMED";
}

/** MISSING_CANDIDATE permanece operacional; pode exibir alerta administrativo. */
export function isNomusSourcePresenceAdminAlert(
  status: NomusSourcePresenceStatus | string | null | undefined
): boolean {
  return status === "MISSING_CANDIDATE";
}

/** Histórico/auditoria: todos os status permanecem acessíveis. */
export function isNomusSourcePresenceVisibleForAudit(
  status: NomusSourcePresenceStatus | string | null | undefined
): boolean {
  void status;
  return true;
}

/** SUPER_ADMIN (e equivalentes) podem auditar ausências confirmadas. */
export function canAuditConfirmedMissingPresence(
  role: string | null | undefined
): boolean {
  const normalized = role?.trim().toUpperCase() ?? "";
  return normalized === "SUPER_ADMIN" || normalized === "ADMIN";
}

export type NomusSourcePresenceRow = {
  sourcePresenceStatus?: NomusSourcePresenceStatus | string | null;
};

/**
 * Exclui do universo operacional aberto (saldo > 0).
 * Títulos/pedidos já liquidados com MISSING_CONFIRMED permanecem no histórico.
 */
export function shouldExcludeConfirmedMissingFromOpenOperations(input: {
  sourcePresenceStatus?: NomusSourcePresenceStatus | string | null;
  openBalance?: number | null;
  /** Pedidos não usam saldo; true = participante de universo operacional. */
  treatAsOpenOperational?: boolean;
}): boolean {
  if (isNomusSourceOperationallyPresent(input.sourcePresenceStatus)) return false;
  if (input.treatAsOpenOperational === true) return true;
  return (input.openBalance ?? 0) > 0;
}

/** Shape puro do filtro de presença (sem tipos Prisma). */
export function buildNomusSourceOperationallyPresentPrismaWhere(): {
  sourcePresenceStatus: { not: "MISSING_CONFIRMED" };
} {
  return { sourcePresenceStatus: { not: "MISSING_CONFIRMED" } };
}

export function mergePrismaWhereWithOperationalPresence<T extends object>(
  where: T,
  enabled: boolean
):
  | T
  | {
      AND: Array<
        T | ReturnType<typeof buildNomusSourceOperationallyPresentPrismaWhere>
      >;
    } {
  if (!enabled) return where;
  const presence = buildNomusSourceOperationallyPresentPrismaWhere();
  if (where == null || Object.keys(where).length === 0) {
    return presence as T;
  }
  return { AND: [where, presence] };
}

/**
 * Merges tipados no servidor via cast; aqui são genéricos (sem @prisma/client)
 * para módulos também alcançados pelo frontend (dashboards / helpers).
 */
export function mergeSalesOrderOperationalPresenceWhere<T extends object>(
  where: T,
  options?: {
    includeConfirmedMissing?: boolean;
    env?: Record<string, string | undefined>;
  }
): T | ReturnType<typeof mergePrismaWhereWithOperationalPresence<T>> {
  if (options?.includeConfirmedMissing) return where;
  if (!isNomusOpsExcludeMissingSalesOrdersEnabled(options?.env)) return where;
  return mergePrismaWhereWithOperationalPresence(where, true);
}

export function mergeAccountsReceivableOperationalPresenceWhere<T extends object>(
  where: T,
  options?: {
    /** Quando false, não aplica (ex.: visão settled/histórico). Default: true. */
    openOperationalUniverse?: boolean;
    includeConfirmedMissing?: boolean;
    env?: Record<string, string | undefined>;
  }
): T | ReturnType<typeof mergePrismaWhereWithOperationalPresence<T>> {
  if (options?.includeConfirmedMissing) return where;
  if (options?.openOperationalUniverse === false) return where;
  if (!isNomusOpsExcludeMissingArEnabled(options?.env)) return where;
  return mergePrismaWhereWithOperationalPresence(where, true);
}

export function mergeAccountsPayableOperationalPresenceWhere<T extends object>(
  where: T,
  options?: {
    openOperationalUniverse?: boolean;
    includeConfirmedMissing?: boolean;
    env?: Record<string, string | undefined>;
  }
): T | ReturnType<typeof mergePrismaWhereWithOperationalPresence<T>> {
  if (options?.includeConfirmedMissing) return where;
  if (options?.openOperationalUniverse === false) return where;
  if (!isNomusOpsExcludeMissingApEnabled(options?.env)) return where;
  return mergePrismaWhereWithOperationalPresence(where, true);
}

export function isFinanceArExcludedBySourcePresence(
  row: NomusSourcePresenceRow & { balanceReceivable?: number | null },
  env: Record<string, string | undefined> = process.env
): boolean {
  if (!isNomusOpsExcludeMissingArEnabled(env)) return false;
  return shouldExcludeConfirmedMissingFromOpenOperations({
    sourcePresenceStatus: row.sourcePresenceStatus,
    openBalance: row.balanceReceivable,
  });
}

export function isFinanceApExcludedBySourcePresence(
  row: NomusSourcePresenceRow & { balancePayable?: number | null },
  env: Record<string, string | undefined> = process.env
): boolean {
  if (!isNomusOpsExcludeMissingApEnabled(env)) return false;
  return shouldExcludeConfirmedMissingFromOpenOperations({
    sourcePresenceStatus: row.sourcePresenceStatus,
    openBalance: row.balancePayable,
  });
}
