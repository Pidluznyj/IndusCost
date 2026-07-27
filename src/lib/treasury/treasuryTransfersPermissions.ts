/**
 * Permissões UI — transferências internas.
 */

import { FINANCE_MODULE_RESOURCE_KEYS } from "@/src/lib/financeModulesAccess.js";

export type TreasuryTransfersPermissionCheck = {
  hasPermission?: (key: string) => boolean;
  role?: string;
  isSuperAdmin?: () => boolean;
  canPerformAction?: (resourceKey: string, action: string) => boolean;
};

const TRANSFERS = FINANCE_MODULE_RESOURCE_KEYS.treasuryTransfers;
const ROOT = FINANCE_MODULE_RESOURCE_KEYS.treasury;

function dtoOrLegacy(
  auth: TreasuryTransfersPermissionCheck,
  resourceKey: string,
  action: string,
  legacy: () => boolean
): boolean {
  if (typeof auth.canPerformAction === "function") {
    return auth.canPerformAction(resourceKey, action);
  }
  return legacy();
}

function has(auth: TreasuryTransfersPermissionCheck, key: string): boolean {
  return typeof auth.hasPermission === "function"
    ? auth.hasPermission(key)
    : false;
}

export function canViewTreasuryTransfers(
  auth: TreasuryTransfersPermissionCheck
): boolean {
  return dtoOrLegacy(auth, TRANSFERS, "view", () =>
    has(auth, "finance.treasury.transfers.view") ||
    has(auth, "finance.treasury.view") ||
    has(auth, `${ROOT}.view`)
  );
}

export function canManageTreasuryTransfers(
  auth: TreasuryTransfersPermissionCheck
): boolean {
  return dtoOrLegacy(auth, TRANSFERS, "manage", () =>
    has(auth, "finance.treasury.transfers.manage")
  );
}
