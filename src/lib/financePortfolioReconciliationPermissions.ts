/** Permissões UI Financeiro > Conciliação de Carteira (camada paralela). */

export const FINANCE_PORTFOLIO_RECONCILIATION_VIEW_PERMISSIONS = [
  "finance.view",
  "finance.accountsReceivable.view",
  "finance.accountsPayable.view",
  "reports.view",
  "settings.nomus.view",
] as const;

export type FinancePortfolioReconciliationPermissionCheck = {
  hasPermission: (permission: string) => boolean;
  hasAnyPermission: (permissions: string[]) => boolean;
};

export function canViewFinancePortfolioReconciliation(
  auth: FinancePortfolioReconciliationPermissionCheck
): boolean {
  return auth.hasAnyPermission([...FINANCE_PORTFOLIO_RECONCILIATION_VIEW_PERMISSIONS]);
}
