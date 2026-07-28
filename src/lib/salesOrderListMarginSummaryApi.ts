/** Endpoint e helpers da margem geral da listagem (fora do GET paginado). */
export const SALES_ORDER_LIST_MARGIN_SUMMARY_PATH = "/api/sales-orders/margin-summary";

export function getSalesOrderListMarginSummaryUrl(query = ""): string {
  return query
    ? `${SALES_ORDER_LIST_MARGIN_SUMMARY_PATH}?${query}`
    : SALES_ORDER_LIST_MARGIN_SUMMARY_PATH;
}
