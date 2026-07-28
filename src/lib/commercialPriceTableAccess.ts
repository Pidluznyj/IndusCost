/**
 * Consulta da Tabela comercial (preços publicados vigentes).
 * Não abre Formação de Preço nem geração/publicação.
 */
export const COMMERCIAL_PRICE_TABLE_VIEW_PERMISSIONS = [
  "price_table.view",
  "proposals.view",
  "sales_orders.view",
  "pricing.view",
  "settings.price_tables.view",
] as const;

export const COMMERCIAL_PRICE_TABLE_ROUTE_PATH = "/commercial/price-table";
export const COMMERCIAL_PRICE_TABLE_PAGE_TITLE = "Tabela comercial";
export const COMMERCIAL_PRICE_TABLE_PAGE_SUBTITLE =
  "Preços de venda publicados por produto e tabela comercial.";

export function canViewCommercialPriceTable(check: {
  hasPermission: (permission: string) => boolean;
  hasAnyPermission?: (permissions: string[]) => boolean;
}): boolean {
  if (check.hasAnyPermission) {
    return check.hasAnyPermission([...COMMERCIAL_PRICE_TABLE_VIEW_PERMISSIONS]);
  }
  return COMMERCIAL_PRICE_TABLE_VIEW_PERMISSIONS.some((key) => check.hasPermission(key));
}
