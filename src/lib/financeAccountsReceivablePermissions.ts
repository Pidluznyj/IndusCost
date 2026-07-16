/** Permissões UI Financeiro > Contas a Receber — contrato finance.accounts_receivable. */

export type FinanceArPermissionCheck = {
  hasPermission: (key: string) => boolean;
};

/** Contrato: AR.view | finance.view — sem reports/settings mega. */
export function canViewFinanceAccountsReceivable(auth: FinanceArPermissionCheck): boolean {
  return (
    auth.hasPermission("finance.accountsReceivable.view") ||
    auth.hasPermission("finance.view")
  );
}

/** P13: export exige chave .export — não autorizar só com view. */
export function canExportFinanceAccountsReceivable(auth: FinanceArPermissionCheck): boolean {
  return auth.hasPermission("finance.accountsReceivable.export");
}

/** Alinhado ao Admin (`settings.nomus.sync` apenas). */
export function canRunFinanceAccountsReceivableSync(auth: FinanceArPermissionCheck): boolean {
  return auth.hasPermission("settings.nomus.sync");
}
