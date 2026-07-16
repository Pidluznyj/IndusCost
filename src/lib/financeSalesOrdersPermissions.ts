/** Permissões UI Financeiro > Pedidos de Venda — contrato finance.sales_orders. */

export type FinanceSalesOrdersPermissionCheck = {
  hasPermission: (key: string) => boolean;
};

/** Contrato: finance.salesOrders.view | sales_orders.view | finance.view — sem AR/AP. */
export function canViewFinanceSalesOrders(auth: FinanceSalesOrdersPermissionCheck): boolean {
  return (
    auth.hasPermission("finance.salesOrders.view") ||
    auth.hasPermission("sales_orders.view") ||
    auth.hasPermission("finance.view")
  );
}

/** @deprecated Preferir requireResource. */
export const FINANCE_SALES_ORDERS_VIEW_PERMISSIONS = [
  "finance.salesOrders.view",
  "sales_orders.view",
  "finance.view",
] as const;
