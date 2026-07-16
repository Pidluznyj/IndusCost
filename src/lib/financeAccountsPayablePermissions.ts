/** Permissões UI Financeiro > Contas a Pagar (espelha guards do backend P18). */

export type FinanceApPermissionCheck = {
  hasPermission: (key: string) => boolean;
};

/**
 * View do módulo AP — chave dedicada (não reports/settings.view).
 * finance.view permanece como OR legado de shell, mas APIs usam requireResource.
 */
export function canViewFinanceAccountsPayable(auth: FinanceApPermissionCheck): boolean {
  return (
    auth.hasPermission("finance.accountsPayable.view") ||
    auth.hasPermission("finance.view")
  );
}

/**
 * Export exige chave .export — não autorizar só com view.
 */
export function canExportFinanceAccountsPayable(auth: FinanceApPermissionCheck): boolean {
  return auth.hasPermission("finance.accountsPayable.export");
}

/** Sync manual — settings.nomus.sync (contrato execute em finance.accounts_payable). */
export function canRunFinanceAccountsPayableSync(auth: FinanceApPermissionCheck): boolean {
  return auth.hasPermission("settings.nomus.sync");
}

export function canManageFinanceApAllocations(auth: FinanceApPermissionCheck): boolean {
  return (
    auth.hasPermission("finance.ap_allocations.manage") ||
    auth.hasPermission("finance.ap_allocations.apply_batch")
  );
}
