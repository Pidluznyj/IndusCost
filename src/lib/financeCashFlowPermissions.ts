/** Permissões UI Financeiro > Fluxo de Caixa — alinhado ao contrato finance.cash_flow. */

export type FinanceCashFlowPermissionCheck = {
  hasPermission: (key: string) => boolean;
};

/** Contrato: finance.cashFlow.view | finance.view | reports.view — sem AR/AP. */
export function canViewFinanceCashFlow(auth: FinanceCashFlowPermissionCheck): boolean {
  return (
    auth.hasPermission("finance.cashFlow.view") ||
    auth.hasPermission("finance.view") ||
    auth.hasPermission("reports.view")
  );
}

/** Sem chave .export dedicada no contrato — exige view do fluxo. */
export function canExportFinanceCashFlow(auth: FinanceCashFlowPermissionCheck): boolean {
  return canViewFinanceCashFlow(auth);
}
