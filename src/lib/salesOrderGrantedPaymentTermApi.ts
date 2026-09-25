/**
 * Endpoints e helpers de URL do KPI "Prazo médio de recebimento" de Pedidos de
 * Venda (frontend-safe — sem Prisma/Node).
 *
 * Rotas estáticas registradas ANTES de `/api/sales-orders/:id` (ver server.ts).
 */
export const SALES_ORDER_GRANTED_PAYMENT_TERM_SUMMARY_PATH =
  "/api/sales-orders/payment-term-summary";

/** Série mensal (tela Resultado): 12 meses do ano filtrado × mesmo período do ano anterior. */
export const SALES_ORDER_GRANTED_PAYMENT_TERM_MONTHLY_PATH =
  "/api/sales-orders/payment-term-monthly";

/** Mesma query string dos filtros aplicados da listagem (page/pageSize são ignorados na agregação). */
export function getSalesOrderGrantedPaymentTermSummaryUrl(query = ""): string {
  return query
    ? `${SALES_ORDER_GRANTED_PAYMENT_TERM_SUMMARY_PATH}?${query}`
    : SALES_ORDER_GRANTED_PAYMENT_TERM_SUMMARY_PATH;
}

/** Mesma query dos filtros aplicados da tela Resultado (o servidor ignora Mês: visão de 12 meses). */
export function getSalesOrderGrantedPaymentTermMonthlyUrl(query = ""): string {
  return query
    ? `${SALES_ORDER_GRANTED_PAYMENT_TERM_MONTHLY_PATH}?${query}`
    : SALES_ORDER_GRANTED_PAYMENT_TERM_MONTHLY_PATH;
}
