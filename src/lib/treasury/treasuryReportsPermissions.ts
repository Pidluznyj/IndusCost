/**
 * Permissões UI — Central de Relatórios da Tesouraria.
 */

import { FINANCE_MODULE_RESOURCE_KEYS } from "@/src/lib/financeModulesAccess.js";

export type TreasuryReportsPermissionCheck = {
  hasPermission?: (key: string) => boolean;
  role?: string;
  isSuperAdmin?: () => boolean;
  canPerformAction?: (resourceKey: string, action: string) => boolean;
};

const REPORTS = FINANCE_MODULE_RESOURCE_KEYS.treasuryReports;
const ROOT = FINANCE_MODULE_RESOURCE_KEYS.treasury;

function dtoOrLegacy(
  auth: TreasuryReportsPermissionCheck,
  resourceKey: string,
  action: string,
  legacy: () => boolean
): boolean {
  if (typeof auth.canPerformAction === "function") {
    return auth.canPerformAction(resourceKey, action);
  }
  return legacy();
}

function has(auth: TreasuryReportsPermissionCheck, key: string): boolean {
  return typeof auth.hasPermission === "function"
    ? auth.hasPermission(key)
    : false;
}

export function canViewTreasuryReports(
  auth: TreasuryReportsPermissionCheck
): boolean {
  return dtoOrLegacy(auth, REPORTS, "view", () =>
    has(auth, "finance.treasury.reports.view") ||
    has(auth, "finance.treasury.view") ||
    has(auth, `${ROOT}.view`)
  );
}

/** Exportação exige export dedicado — não degrada para view. */
export function canExportTreasuryReports(
  auth: TreasuryReportsPermissionCheck
): boolean {
  return dtoOrLegacy(auth, ROOT, "export", () =>
    has(auth, "finance.treasury.export")
  );
}
