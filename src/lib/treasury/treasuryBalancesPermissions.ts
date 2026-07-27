/**
 * Permissões UI — Tesouraria > Saldos (DTO-first).
 */

import { FINANCE_MODULE_RESOURCE_KEYS } from "@/src/lib/financeModulesAccess.js";
import {
  canManageTreasuryAccounts,
  canViewTreasuryAccounts,
  type TreasuryAccountsPermissionCheck,
} from "./treasuryAccountsPermissions.js";

const BALANCES = FINANCE_MODULE_RESOURCE_KEYS.treasuryBalances;

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

/** Ver histórico/último saldo (herda view de contas). */
export function canViewTreasuryBalances(
  auth: TreasuryAccountsPermissionCheck
): boolean {
  return (
    canViewTreasuryAccounts(auth) ||
    dtoOrLegacy(auth, BALANCES, "manage", () =>
      has(auth, "finance.treasury.balances.manage")
    )
  );
}

/** Informar novo saldo. */
export function canManageTreasuryBalances(
  auth: TreasuryAccountsPermissionCheck
): boolean {
  if (canManageTreasuryAccounts(auth)) return true;
  return dtoOrLegacy(auth, BALANCES, "manage", () =>
    has(auth, "finance.treasury.balances.manage")
  );
}
