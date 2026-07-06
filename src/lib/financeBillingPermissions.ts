/** Permissões UI/API Financeiro > Faturamento (espelha motor executivo + domínio financeiro). */

import { canViewFinanceAccountsPayable } from "./financeAccountsPayablePermissions.js";
import {
  canViewFinanceAccountsReceivable,
  type FinanceArPermissionCheck,
} from "./financeAccountsReceivablePermissions.js";

export type FinanceBillingPermissionCheck = FinanceArPermissionCheck;

/** Mesma base do motor executivo (`canSeeSalesOrders`) + acesso financeiro. */
export function canViewFinanceBilling(auth: FinanceBillingPermissionCheck): boolean {
  return (
    auth.hasPermission("sales_orders.view") ||
    auth.hasPermission("reports.view") ||
    auth.hasPermission("finance.view") ||
    canViewFinanceAccountsReceivable(auth) ||
    canViewFinanceAccountsPayable(auth)
  );
}

export const FINANCE_BILLING_VIEW_PERMISSIONS = [
  "sales_orders.view",
  "reports.view",
  "finance.view",
  "finance.accountsReceivable.view",
  "finance.accountsPayable.view",
  "settings.nomus.view",
  "settings.view",
] as const;

/** Alinhado ao Admin (`settings.nomus.sync` apenas). */
export function canRunFinanceBillingNfeSync(auth: FinanceBillingPermissionCheck): boolean {
  return auth.hasPermission("settings.nomus.sync");
}
