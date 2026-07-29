/**
 * Permissões — Relatório de descontos comerciais.
 *
 * Recursos canônicos:
 * - commercial.sales_orders.discount_report (view/export)
 * - commercial.sales_orders.discount_report.margin (view da margem comercial)
 *
 * Não expõe custo. Margem só com autorização específica (ou fluxo.values).
 */

export const SALES_ORDER_COMMERCIAL_DISCOUNT_REPORT_RESOURCE =
  "commercial.sales_orders.discount_report" as const;

export const SALES_ORDER_COMMERCIAL_DISCOUNT_REPORT_MARGIN_RESOURCE =
  "commercial.sales_orders.discount_report.margin" as const;

export type DiscountReportPermissionCheck = {
  hasPermission: (key: string) => boolean;
  canAccessResource?: (resourceKey: string, action?: string) => boolean;
};

function canResource(
  auth: DiscountReportPermissionCheck,
  resourceKey: string,
  action: string
): boolean {
  if (auth.canAccessResource?.(resourceKey, action)) return true;
  return false;
}

/** Visualizar relatório (valores bruto/desconto/líquido — sem margem). */
export function canViewSalesOrderCommercialDiscountReport(
  auth: DiscountReportPermissionCheck
): boolean {
  return (
    canResource(auth, SALES_ORDER_COMMERCIAL_DISCOUNT_REPORT_RESOURCE, "view") ||
    auth.hasPermission("sales_orders.discount_report.view") ||
    auth.hasPermission("sales_orders.view")
  );
}

/** Exportar CSV/Excel. */
export function canExportSalesOrderCommercialDiscountReport(
  auth: DiscountReportPermissionCheck
): boolean {
  return (
    canResource(auth, SALES_ORDER_COMMERCIAL_DISCOUNT_REPORT_RESOURCE, "export") ||
    auth.hasPermission("sales_orders.discount_report.export") ||
    canViewSalesOrderCommercialDiscountReport(auth)
  );
}

/** Ver margem comercial no relatório (nunca custo). */
export function canViewSalesOrderCommercialDiscountReportMargin(
  auth: DiscountReportPermissionCheck
): boolean {
  return (
    canResource(
      auth,
      SALES_ORDER_COMMERCIAL_DISCOUNT_REPORT_MARGIN_RESOURCE,
      "view"
    ) ||
    auth.hasPermission("sales_orders.discount_report.margin.view") ||
    auth.hasPermission("sales_orders.flow.values.view")
  );
}
