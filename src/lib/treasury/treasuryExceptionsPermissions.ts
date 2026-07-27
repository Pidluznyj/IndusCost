/**
 * Permissões UI — Central de Exceções.
 */

import { FINANCE_MODULE_RESOURCE_KEYS } from "@/src/lib/financeModulesAccess.js";

export type TreasuryExceptionsPermissionCheck = {
  hasPermission?: (key: string) => boolean;
  role?: string;
  isSuperAdmin?: () => boolean;
  canPerformAction?: (resourceKey: string, action: string) => boolean;
};

const EXCEPTIONS = FINANCE_MODULE_RESOURCE_KEYS.treasuryExceptions;
const ROOT = FINANCE_MODULE_RESOURCE_KEYS.treasury;

function dtoOrLegacy(
  auth: TreasuryExceptionsPermissionCheck,
  resourceKey: string,
  action: string,
  legacy: () => boolean
): boolean {
  if (typeof auth.canPerformAction === "function") {
    return auth.canPerformAction(resourceKey, action);
  }
  return legacy();
}

function has(auth: TreasuryExceptionsPermissionCheck, key: string): boolean {
  return typeof auth.hasPermission === "function"
    ? auth.hasPermission(key)
    : false;
}

export function canViewTreasuryExceptions(
  auth: TreasuryExceptionsPermissionCheck
): boolean {
  return dtoOrLegacy(auth, EXCEPTIONS, "view", () =>
    has(auth, "finance.treasury.exceptions.view") ||
    has(auth, "finance.treasury.view") ||
    has(auth, `${ROOT}.view`)
  );
}

export function canManageTreasuryExceptions(
  auth: TreasuryExceptionsPermissionCheck
): boolean {
  return dtoOrLegacy(auth, EXCEPTIONS, "manage", () =>
    has(auth, "finance.treasury.exceptions.manage")
  );
}
