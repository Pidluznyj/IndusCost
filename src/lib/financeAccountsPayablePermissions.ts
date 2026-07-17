/** Permissões UI Financeiro > Contas a Pagar (PERM-41: DTO-first; regras de vencimento intactas). */

import { FINANCE_AP_RESOURCE_KEY_REF } from "@/src/lib/financeModulesAccess.js";

export type FinanceApPermissionCheck = {
  hasPermission: (key: string) => boolean;
  canPerformAction?: (resourceKey: string, action: string) => boolean;
};

/**
 * View do módulo AP — chave dedicada (não reports/settings.view).
 * Com DTO: só `finance.accounts_payable` view (sem misturar escopo de dados).
 */
export function canViewFinanceAccountsPayable(auth: FinanceApPermissionCheck): boolean {
  if (typeof auth.canPerformAction === "function") {
    return auth.canPerformAction(FINANCE_AP_RESOURCE_KEY_REF, "view");
  }
  return (
    auth.hasPermission("finance.accountsPayable.view") ||
    auth.hasPermission("finance.view")
  );
}

/**
 * Export exige action .export — não autorizar só com view.
 */
export function canExportFinanceAccountsPayable(auth: FinanceApPermissionCheck): boolean {
  if (typeof auth.canPerformAction === "function") {
    return auth.canPerformAction(FINANCE_AP_RESOURCE_KEY_REF, "export");
  }
  return auth.hasPermission("finance.accountsPayable.export");
}

/** Sync manual — settings.nomus.sync (contrato execute em finance.accounts_payable). */
export function canRunFinanceAccountsPayableSync(auth: FinanceApPermissionCheck): boolean {
  if (typeof auth.canPerformAction === "function") {
    return (
      auth.canPerformAction(FINANCE_AP_RESOURCE_KEY_REF, "execute") ||
      auth.canPerformAction("admin.settings.nomus_sync", "synchronize")
    );
  }
  return auth.hasPermission("settings.nomus.sync");
}

export function canManageFinanceApAllocations(auth: FinanceApPermissionCheck): boolean {
  if (typeof auth.canPerformAction === "function") {
    return auth.canPerformAction(FINANCE_AP_RESOURCE_KEY_REF, "manage");
  }
  return (
    auth.hasPermission("finance.ap_allocations.manage") ||
    auth.hasPermission("finance.ap_allocations.apply_batch")
  );
}
