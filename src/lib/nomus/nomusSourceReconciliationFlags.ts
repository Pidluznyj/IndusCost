/**
 * SYNC-02 — Kill switches independentes por entidade.
 *
 * Fail closed: ausente / vazio / valor desconhecido = reconciliação de
 * ausências DESABILITADA. CREATE/UPDATE dos syncers não dependem destas flags.
 */

import type { NomusSourceSyncEntityType } from "./nomusSourceLifecycleContract.js";

export const NOMUS_SOURCE_RECONCILE_SALES_ORDERS_ENV =
  "NOMUS_SOURCE_RECONCILE_SALES_ORDERS_ENABLED";
export const NOMUS_SOURCE_RECONCILE_AR_ENV =
  "NOMUS_SOURCE_RECONCILE_AR_ENABLED";
export const NOMUS_SOURCE_RECONCILE_AP_ENV =
  "NOMUS_SOURCE_RECONCILE_AP_ENABLED";

const ENABLED_VALUES = new Set(["1", "true", "yes", "on", "enabled"]);

function isEnvFlagEnabled(
  env: Record<string, string | undefined>,
  key: string
): boolean {
  const raw = env[key]?.trim().toLowerCase();
  return raw != null && ENABLED_VALUES.has(raw);
}

export function isNomusSalesOrderAbsenceReconciliationEnabled(
  env: Record<string, string | undefined> = process.env
): boolean {
  return isEnvFlagEnabled(env, NOMUS_SOURCE_RECONCILE_SALES_ORDERS_ENV);
}

export function isNomusAccountsReceivableAbsenceReconciliationEnabled(
  env: Record<string, string | undefined> = process.env
): boolean {
  return isEnvFlagEnabled(env, NOMUS_SOURCE_RECONCILE_AR_ENV);
}

export function isNomusAccountsPayableAbsenceReconciliationEnabled(
  env: Record<string, string | undefined> = process.env
): boolean {
  return isEnvFlagEnabled(env, NOMUS_SOURCE_RECONCILE_AP_ENV);
}

export function isNomusAbsenceReconciliationEnabledForEntity(
  entityType: NomusSourceSyncEntityType,
  env: Record<string, string | undefined> = process.env
): boolean {
  switch (entityType) {
    case "SALES_ORDER":
      return isNomusSalesOrderAbsenceReconciliationEnabled(env);
    case "ACCOUNTS_RECEIVABLE":
      return isNomusAccountsReceivableAbsenceReconciliationEnabled(env);
    case "ACCOUNTS_PAYABLE":
      return isNomusAccountsPayableAbsenceReconciliationEnabled(env);
    default: {
      const _exhaustive: never = entityType;
      void _exhaustive;
      return false;
    }
  }
}
