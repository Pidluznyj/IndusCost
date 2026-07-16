/** Permissões UI/API Financeiro → Relatório Presidencial — contrato finance.executive_report. */

export type FinanceExecutiveReportPermissionCheck = {
  hasPermission: (key: string) => boolean;
};

/** Contrato: reports.view | finance.view (+ chave dedicada legado). Sem AR/AP. */
export function canViewFinanceExecutiveReport(
  auth: FinanceExecutiveReportPermissionCheck
): boolean {
  return (
    auth.hasPermission("finance.executiveReport.view") ||
    auth.hasPermission("reports.view") ||
    auth.hasPermission("finance.view")
  );
}

/** @deprecated Preferir requireResource. */
export const FINANCE_EXECUTIVE_REPORT_VIEW_PERMISSIONS = [
  "finance.executiveReport.view",
  "reports.view",
  "finance.view",
] as const;
