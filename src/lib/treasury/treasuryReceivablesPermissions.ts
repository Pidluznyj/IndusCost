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
const RECEIVABLES_PROMISE =
  FINANCE_MODULE_RESOURCE_KEYS.treasuryReceivablesPromise;
const RECEIVABLES_COLLECTION =
  FINANCE_MODULE_RESOURCE_KEYS.treasuryReceivablesCollection;
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

/** Alterar expectativa operacional (manage + leitura oficial CR). */
export function canManageTreasuryReceivables(
  auth: TreasuryReceivablesPermissionCheck
): boolean {
  const treasuryOk = dtoOrLegacy(auth, RECEIVABLES, "manage", () =>
    has(auth, "finance.treasury.receivables.manage") ||
    has(auth, "finance.treasury.manage") ||
    has(auth, `${ROOT}.manage`)
  );
  const officialOk = dtoOrLegacy(auth, OFFICIAL_AR, "view", () =>
    has(auth, "finance.accounts_receivable.view") ||
    has(auth, "finance.accounts_receivable")
  );
  return treasuryOk && officialOk;
}

/** Registrar/cancelar/cumprir promessas (execute + leitura oficial CR). */
export function canPromiseTreasuryReceivables(
  auth: TreasuryReceivablesPermissionCheck
): boolean {
  const treasuryOk = dtoOrLegacy(auth, RECEIVABLES_PROMISE, "execute", () =>
    has(auth, "finance.treasury.receivables.promise") ||
    has(auth, "finance.treasury.receivables.manage") ||
    has(auth, "finance.treasury.manage")
  );
  const officialOk = dtoOrLegacy(auth, OFFICIAL_AR, "view", () =>
    has(auth, "finance.accounts_receivable.view") ||
    has(auth, "finance.accounts_receivable")
  );
  return treasuryOk && officialOk;
}

/** Registrar/cancelar ações de cobrança (execute + leitura oficial CR). */
export function canCollectTreasuryReceivables(
  auth: TreasuryReceivablesPermissionCheck
): boolean {
  const treasuryOk = dtoOrLegacy(auth, RECEIVABLES_COLLECTION, "execute", () =>
    has(auth, "finance.treasury.receivables.collection") ||
    has(auth, "finance.treasury.receivables.manage") ||
    has(auth, "finance.treasury.manage")
  );
  const officialOk = dtoOrLegacy(auth, OFFICIAL_AR, "view", () =>
    has(auth, "finance.accounts_receivable.view") ||
    has(auth, "finance.accounts_receivable")
  );
  return treasuryOk && officialOk;
}
