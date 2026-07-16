/** Permissões UI Financeiro > Contas a Pagar (espelha guards do backend). */

export type FinanceApPermissionCheck = {
  hasPermission: (key: string) => boolean;
};

export function canViewFinanceAccountsPayable(auth: FinanceApPermissionCheck): boolean {
  return (
    auth.hasPermission("finance.accountsPayable.view") ||
    auth.hasPermission("finance.view") ||
    auth.hasPermission("reports.view") ||
    auth.hasPermission("settings.nomus.view") ||
    auth.hasPermission("settings.view")
  );
}

/**
 * P13: export exige chave .export — não autorizar só com view.
 */
export function canExportFinanceAccountsPayable(auth: FinanceApPermissionCheck): boolean {
  return auth.hasPermission("finance.accountsPayable.export");
}

/** Alinhado ao Admin (`settings.nomus.sync` apenas). */
export function canRunFinanceAccountsPayableSync(auth: FinanceApPermissionCheck): boolean {
  return auth.hasPermission("settings.nomus.sync");
}

export function canManageFinanceApAllocations(auth: FinanceApPermissionCheck): boolean {
  return auth.hasPermission("finance.ap_allocations.manage");
}
