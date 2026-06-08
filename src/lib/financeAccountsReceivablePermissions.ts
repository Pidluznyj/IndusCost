/** Permissões UI Financeiro > Contas a Receber (espelha guards do backend). */

export type FinanceArPermissionCheck = {
  hasPermission: (key: string) => boolean;
};

export function canViewFinanceAccountsReceivable(auth: FinanceArPermissionCheck): boolean {
  return (
    auth.hasPermission("finance.accountsReceivable.view") ||
    auth.hasPermission("finance.view") ||
    auth.hasPermission("reports.view") ||
    auth.hasPermission("settings.nomus.view") ||
    auth.hasPermission("settings.view")
  );
}

export function canExportFinanceAccountsReceivable(auth: FinanceArPermissionCheck): boolean {
  return (
    auth.hasPermission("finance.accountsReceivable.export") ||
    canViewFinanceAccountsReceivable(auth)
  );
}

/** Alinhado ao Admin (`settings.nomus.sync` apenas). */
export function canRunFinanceAccountsReceivableSync(auth: FinanceArPermissionCheck): boolean {
  return auth.hasPermission("settings.nomus.sync");
}
