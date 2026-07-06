/** Permissões UI/API Financeiro → Relatório Presidencial. */

import { canViewFinanceBilling, type FinanceBillingPermissionCheck } from "./financeBillingPermissions.js";

export type FinanceExecutiveReportPermissionCheck = FinanceBillingPermissionCheck;

export function canViewFinanceExecutiveReport(
  auth: FinanceExecutiveReportPermissionCheck
): boolean {
  return (
    auth.hasPermission("finance.executiveReport.view") ||
    auth.hasPermission("reports.view") ||
    canViewFinanceBilling(auth)
  );
}

export const FINANCE_EXECUTIVE_REPORT_VIEW_PERMISSIONS = [
  "finance.executiveReport.view",
  "reports.view",
  "sales_orders.view",
  "finance.view",
  "finance.accountsReceivable.view",
  "finance.accountsPayable.view",
] as const;
