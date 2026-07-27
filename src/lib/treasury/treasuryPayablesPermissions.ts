/**
 * Permissões UI — Central de Tesouraria > Contas a pagar.
 */

import {
  FINANCE_AP_RESOURCE_KEY_REF,
  FINANCE_MODULE_RESOURCE_KEYS,
} from "@/src/lib/financeModulesAccess.js";

export type TreasuryPayablesPermissionCheck = {
  hasPermission?: (key: string) => boolean;
  role?: string;
  isSuperAdmin?: () => boolean;
  canPerformAction?: (resourceKey: string, action: string) => boolean;
};

const PAYABLES = FINANCE_MODULE_RESOURCE_KEYS.treasuryPayables;
const PAYABLES_PROGRAM = FINANCE_MODULE_RESOURCE_KEYS.treasuryPayablesProgram;
const OFFICIAL_AP = FINANCE_AP_RESOURCE_KEY_REF;
const ROOT = FINANCE_MODULE_RESOURCE_KEYS.treasury;

function dtoOrLegacy(
  auth: TreasuryPayablesPermissionCheck,
  resourceKey: string,
  action: string,
  legacy: () => boolean
): boolean {
  if (typeof auth.canPerformAction === "function") {
    return auth.canPerformAction(resourceKey, action);
  }
  return legacy();
}

function has(auth: TreasuryPayablesPermissionCheck, key: string): boolean {
  return typeof auth.hasPermission === "function"
    ? auth.hasPermission(key)
    : false;
}

export function canViewTreasuryPayables(
  auth: TreasuryPayablesPermissionCheck
): boolean {
  const treasuryOk = dtoOrLegacy(auth, PAYABLES, "view", () =>
    has(auth, "finance.treasury.payables.view") ||
    has(auth, "finance.treasury.view") ||
    has(auth, `${ROOT}.view`)
  );
  const officialOk = dtoOrLegacy(auth, OFFICIAL_AP, "view", () =>
    has(auth, "finance.accounts_payable.view") ||
    has(auth, "finance.accounts_payable")
  );
  return treasuryOk && officialOk;
}

export function canProgramTreasuryPayables(
  auth: TreasuryPayablesPermissionCheck
): boolean {
  const treasuryOk = dtoOrLegacy(auth, PAYABLES_PROGRAM, "execute", () =>
    has(auth, "finance.treasury.payables.program") ||
    has(auth, "finance.treasury.payables.manage") ||
    has(auth, "finance.treasury.manage")
  );
  const officialOk = dtoOrLegacy(auth, OFFICIAL_AP, "view", () =>
    has(auth, "finance.accounts_payable.view") ||
    has(auth, "finance.accounts_payable")
  );
  return treasuryOk && officialOk;
}
