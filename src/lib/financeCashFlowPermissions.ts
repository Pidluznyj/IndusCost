/** Permissões UI Financeiro > Fluxo de Caixa */

export type FinanceCashFlowPermissionCheck = {
  hasPermission: (key: string) => boolean;
};

export function canViewFinanceCashFlow(auth: FinanceCashFlowPermissionCheck): boolean {
  return (
    auth.hasPermission("finance.view") ||
    auth.hasPermission("finance.accountsReceivable.view") ||
    auth.hasPermission("finance.accountsPayable.view") ||
    auth.hasPermission("reports.view") ||
    auth.hasPermission("settings.nomus.view") ||
    auth.hasPermission("settings.view")
  );
}

export function canExportFinanceCashFlow(auth: FinanceCashFlowPermissionCheck): boolean {
  return (
    auth.hasPermission("finance.accountsReceivable.export") ||
    auth.hasPermission("finance.accountsPayable.export") ||
    canViewFinanceCashFlow(auth)
  );
}
