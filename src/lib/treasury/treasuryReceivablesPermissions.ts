/**
 * Permissões UI — Central de Tesouraria > Contas a receber.
 */

import { FINANCE_MODULE_RESOURCE_KEYS } from "@/src/lib/financeModulesAccess.js";

export type TreasuryReceivablesPermissionCheck = {
  hasPermission?: (key: string) => boolean;
  role?: string;
  isSuperAdmin?: () => boolean;
  canPerformAction?: (resourceKey: string, action: string) => boolean;
};

const RECEIVABLES = FINANCE_MODULE_RESOURCE_KEYS.treasuryReceivables;
const OFFICIAL_AR = FINANCE_MODULE_RESOURCE_KEYS.accountsReceivable;
const ROOT = FINANCE_MODULE_RESOURCE_KEYS.treasury;

function dtoOrLegacy(
  auth: TreasuryReceivablesPermissionCheck,
  resourceKey: string,
  action: string,
  legacy: () => boolean
): boolean {
  if (typeof auth.canPerformAction === "function") {
    return auth.canPerformAction(resourceKey, action);
  }
  return legacy();
}

function has(auth: TreasuryReceivablesPermissionCheck, key: string): boolean {
  return typeof auth.hasPermission === "function"
    ? auth.hasPermission(key)
    : false;
}

/** Shell Tesouraria + leitura oficial CR (mesma regra da API). */
export function canViewTreasuryReceivables(
  auth: TreasuryReceivablesPermissionCheck
): boolean {
  const treasuryOk = dtoOrLegacy(auth, RECEIVABLES, "view", () =>
    has(auth, "finance.treasury.receivables.view") ||
    has(auth, "finance.treasury.view") ||
    has(auth, `${ROOT}.view`)
  );
  const officialOk = dtoOrLegacy(auth, OFFICIAL_AR, "view", () =>
    has(auth, "finance.accounts_receivable.view") ||
    has(auth, "finance.accounts_receivable")
  );
  return treasuryOk && officialOk;
}
