/**
 * Permissões da aba Tributos / dados fiscais documentais do Pedido de Venda.
 */
import type { PermissionChecker } from "../modulePermissions.js";

export const SALES_ORDER_FISCAL_TAXES_PERMISSIONS = [
  "sales_orders.invoice.view",
  "sales_orders.detail.view",
] as const;

export function canViewSalesOrderFiscalTaxes(check: PermissionChecker): boolean {
  return SALES_ORDER_FISCAL_TAXES_PERMISSIONS.some((key) => check.hasPermission(key));
}

/**
 * Variante para bags de permissão do backend (string[]).
 * - Bag vazia / ausente → libera (legado / testes sem contexto).
 * - Bag sem nenhuma `sales_orders.*` → libera (auth de teste genérico).
 * - Bag com `sales_orders.*` → exige invoice.view ou detail.view.
 */
export function canViewSalesOrderFiscalTaxesFromPermissions(
  permissions: readonly string[] | null | undefined
): boolean {
  if (!permissions || permissions.length === 0) {
    return true;
  }
  const touchesSalesOrders = permissions.some((p) =>
    p.startsWith("sales_orders.")
  );
  if (!touchesSalesOrders) {
    return true;
  }
  return SALES_ORDER_FISCAL_TAXES_PERMISSIONS.some((key) =>
    permissions.includes(key)
  );
}
