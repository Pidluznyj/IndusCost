/** Endpoint e helpers da margem geral da listagem (fora do GET paginado). */
export const SALES_ORDER_LIST_MARGIN_SUMMARY_PATH = "/api/sales-orders/margin-summary";

/** Margens da página atual (coluna Margem) — fora do GET paginado. */
export const SALES_ORDER_LIST_PAGE_MARGINS_PATH = "/api/sales-orders/page-margins";

export function getSalesOrderListMarginSummaryUrl(query = ""): string {
  return query
    ? `${SALES_ORDER_LIST_MARGIN_SUMMARY_PATH}?${query}`
    : SALES_ORDER_LIST_MARGIN_SUMMARY_PATH;
}

export function getSalesOrderListPageMarginsUrl(query = ""): string {
  return query
    ? `${SALES_ORDER_LIST_PAGE_MARGINS_PATH}?${query}`
    : SALES_ORDER_LIST_PAGE_MARGINS_PATH;
}
