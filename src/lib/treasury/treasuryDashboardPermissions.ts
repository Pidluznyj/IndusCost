/**
 * Permissões UI — Central de Tesouraria > Dashboard.
 */

import { FINANCE_MODULE_RESOURCE_KEYS } from "@/src/lib/financeModulesAccess.js";

export type TreasuryDashboardPermissionCheck = {
  hasPermission?: (key: string) => boolean;
  role?: string;
  isSuperAdmin?: () => boolean;
  canPerformAction?: (resourceKey: string, action: string) => boolean;
};

const DASHBOARD = FINANCE_MODULE_RESOURCE_KEYS.treasuryDashboard;
const ROOT = FINANCE_MODULE_RESOURCE_KEYS.treasury;

function dtoOrLegacy(
  auth: TreasuryDashboardPermissionCheck,
  resourceKey: string,
  action: string,
  legacy: () => boolean
): boolean {
  if (typeof auth.canPerformAction === "function") {
    return auth.canPerformAction(resourceKey, action);
  }
  return legacy();
}

function has(auth: TreasuryDashboardPermissionCheck, key: string): boolean {
  return typeof auth.hasPermission === "function"
    ? auth.hasPermission(key)
    : false;
}

export function canViewTreasuryDashboard(
  auth: TreasuryDashboardPermissionCheck
): boolean {
  return dtoOrLegacy(auth, DASHBOARD, "view", () =>
    has(auth, "finance.treasury.dashboard.view") ||
    has(auth, "finance.treasury.view") ||
    has(auth, `${ROOT}.view`)
  );
}
