/** Permissões UI/API Financeiro > Pedidos de Venda. */

import { canViewFinanceBilling, type FinanceBillingPermissionCheck } from "./financeBillingPermissions.js";

export type FinanceSalesOrdersPermissionCheck = FinanceBillingPermissionCheck;

export function canViewFinanceSalesOrders(auth: FinanceSalesOrdersPermissionCheck): boolean {
  return canViewFinanceBilling(auth);
}

export const FINANCE_SALES_ORDERS_VIEW_PERMISSIONS = [
  "sales_orders.view",
  "reports.view",
  "finance.view",
  "finance.accountsReceivable.view",
  "finance.accountsPayable.view",
] as const;
