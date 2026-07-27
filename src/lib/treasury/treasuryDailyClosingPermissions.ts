/**
 * Permissões UI — fechamento diário da Tesouraria.
 */

import { FINANCE_MODULE_RESOURCE_KEYS } from "@/src/lib/financeModulesAccess.js";

export type TreasuryDailyClosingPermissionCheck = {
  hasPermission?: (key: string) => boolean;
  role?: string;
  isSuperAdmin?: () => boolean;
  canPerformAction?: (resourceKey: string, action: string) => boolean;
};

const CLOSING = FINANCE_MODULE_RESOURCE_KEYS.treasuryClosing;
const ROOT = FINANCE_MODULE_RESOURCE_KEYS.treasury;

function dtoOrLegacy(
  auth: TreasuryDailyClosingPermissionCheck,
  resourceKey: string,
  action: string,
  legacy: () => boolean
): boolean {
  if (typeof auth.canPerformAction === "function") {
    return auth.canPerformAction(resourceKey, action);
  }
  return legacy();
}

function has(auth: TreasuryDailyClosingPermissionCheck, key: string): boolean {
  return typeof auth.hasPermission === "function"
    ? auth.hasPermission(key)
    : false;
}

export function canViewTreasuryDailyClosing(
  auth: TreasuryDailyClosingPermissionCheck
): boolean {
  return dtoOrLegacy(auth, CLOSING, "view", () =>
    has(auth, "finance.treasury.closing.view") ||
    has(auth, "finance.treasury.view") ||
    has(auth, `${ROOT}.view`)
  );
}

export function canCloseTreasuryDailyClosing(
  auth: TreasuryDailyClosingPermissionCheck
): boolean {
  return dtoOrLegacy(auth, CLOSING, "close", () =>
    has(auth, "finance.treasury.closing.close")
  );
}

export function canReopenTreasuryDailyClosing(
  auth: TreasuryDailyClosingPermissionCheck
): boolean {
  return dtoOrLegacy(auth, CLOSING, "reopen", () =>
    has(auth, "finance.treasury.closing.reopen")
  );
}
