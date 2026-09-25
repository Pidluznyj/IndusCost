/**
 * Endpoint e helper de URL do KPI "Prazo médio de recebimento" da listagem de
 * Pedidos de Venda (frontend-safe — sem Prisma/Node).
 *
 * Rota estática registrada ANTES de `/api/sales-orders/:id` (ver server.ts).
 */
export const SALES_ORDER_GRANTED_PAYMENT_TERM_SUMMARY_PATH =
  "/api/sales-orders/payment-term-summary";

/** Mesma query string dos filtros aplicados da listagem (page/pageSize são ignorados na agregação). */
export function getSalesOrderGrantedPaymentTermSummaryUrl(query = ""): string {
  return query
    ? `${SALES_ORDER_GRANTED_PAYMENT_TERM_SUMMARY_PATH}?${query}`
    : SALES_ORDER_GRANTED_PAYMENT_TERM_SUMMARY_PATH;
}
