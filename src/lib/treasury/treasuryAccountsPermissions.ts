/**
 * Permissões UI — Central de Tesouraria > Contas financeiras (DTO-first).
 */

import { FINANCE_MODULE_RESOURCE_KEYS } from "@/src/lib/financeModulesAccess.js";

export type TreasuryAccountsPermissionCheck = {
  hasPermission?: (key: string) => boolean;
  role?: string;
  isSuperAdmin?: () => boolean;
  canPerformAction?: (resourceKey: string, action: string) => boolean;
};

const ACCOUNTS = FINANCE_MODULE_RESOURCE_KEYS.treasuryAccounts;
const ROOT = FINANCE_MODULE_RESOURCE_KEYS.treasury;

function dtoOrLegacy(
  auth: TreasuryAccountsPermissionCheck,
  resourceKey: string,
  action: string,
  legacy: () => boolean
): boolean {
  if (typeof auth.canPerformAction === "function") {
    return auth.canPerformAction(resourceKey, action);
  }
  return legacy();
}

function has(auth: TreasuryAccountsPermissionCheck, key: string): boolean {
  return typeof auth.hasPermission === "function"
    ? auth.hasPermission(key)
    : false;
}

export function canViewTreasuryAccounts(
  auth: TreasuryAccountsPermissionCheck
): boolean {
  return dtoOrLegacy(auth, ACCOUNTS, "view", () =>
    has(auth, "finance.treasury.accounts.view") ||
    has(auth, "finance.treasury.view") ||
    has(auth, `${ROOT}.view`)
  );
}

export function canManageTreasuryAccounts(
  auth: TreasuryAccountsPermissionCheck
): boolean {
  return dtoOrLegacy(auth, ACCOUNTS, "manage", () =>
    has(auth, "finance.treasury.accounts.manage")
  );
}
