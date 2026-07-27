/**
 * Permissões UI — conciliação / movimentos bancários / OFX.
 */

import { FINANCE_MODULE_RESOURCE_KEYS } from "@/src/lib/financeModulesAccess.js";

export type TreasuryReconciliationPermissionCheck = {
  hasPermission?: (key: string) => boolean;
  role?: string;
  isSuperAdmin?: () => boolean;
  canPerformAction?: (resourceKey: string, action: string) => boolean;
};

const RECONCILIATION = FINANCE_MODULE_RESOURCE_KEYS.treasuryReconciliation;
const ROOT = FINANCE_MODULE_RESOURCE_KEYS.treasury;

function dtoOrLegacy(
  auth: TreasuryReconciliationPermissionCheck,
  resourceKey: string,
  action: string,
  legacy: () => boolean
): boolean {
  if (typeof auth.canPerformAction === "function") {
    return auth.canPerformAction(resourceKey, action);
  }
  return legacy();
}

function has(auth: TreasuryReconciliationPermissionCheck, key: string): boolean {
  return typeof auth.hasPermission === "function"
    ? auth.hasPermission(key)
    : false;
}

export function canViewTreasuryReconciliation(
  auth: TreasuryReconciliationPermissionCheck
): boolean {
  return dtoOrLegacy(auth, RECONCILIATION, "view", () =>
    has(auth, "finance.treasury.reconciliation.view") ||
    has(auth, "finance.treasury.reconciliation.manage") ||
    has(auth, "finance.treasury.view") ||
    has(auth, `${ROOT}.view`)
  );
}

export function canManageTreasuryReconciliation(
  auth: TreasuryReconciliationPermissionCheck
): boolean {
  return dtoOrLegacy(auth, RECONCILIATION, "manage", () =>
    has(auth, "finance.treasury.reconciliation.manage")
  );
}
