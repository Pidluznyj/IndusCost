import type { SalesOrderResultFilters } from "./salesOrderResultTypes.js";

/**
 * Query da aba Resultado — mesmos parâmetros canônicos da listagem de Pedidos
 * (`parseSalesOrderListQuery`), mais productId/asOfDate específicos do dashboard.
 */
export function getSalesOrderResultApiPath(query: Partial<SalesOrderResultFilters>): string {
  const params = new URLSearchParams();
  if (query.year != null) params.set("year", String(query.year));
  if (query.month != null) params.set("month", String(query.month));
  if (query.customerId) params.set("customerId", query.customerId);
  if (query.productId) params.set("productId", query.productId);
  if (query.sellerKey) params.set("sellerKey", query.sellerKey);
  else if (query.sellerId) params.set("sellerKey", query.sellerId);
  if (query.status) params.set("status", query.status);
  if (query.hasInvoice) params.set("hasInvoice", query.hasInvoice);
  if (query.receivableStatus) params.set("receivableStatus", query.receivableStatus);
  if (query.q) params.set("q", query.q);
  if (query.startDate) params.set("startDate", query.startDate);
  if (query.endDate) params.set("endDate", query.endDate);
  if (query.companyId) params.set("company", query.companyId);
  if (query.asOfDate) params.set("asOfDate", query.asOfDate);
  return `/api/sales-orders/results?${params.toString()}`;
}

export const SALES_ORDER_RESULT_MARGIN_TOOLTIP = {
  title: "Margem gerencial (motor oficial)",
  lines: [
    "Escopo: mesmos filtros da listagem Comercial > Pedidos de Venda.",
    "R$ Pedidos: Σ totalNetValue dos pedidos (motor oficial de pedidos).",
    "Imposto: TaxRule oficial (Parâmetros Nomus / ProductPricing).",
    "Receita líquida gerencial: venda de itens − imposto estimado.",
    "Custo: tabela de produção publicada vigente em SalesOrder.issueDate.",
    "Margem R$: receita líquida gerencial − custo versionado.",
    "Margem %: margem R$ ÷ receita líquida gerencial (ponderada, não média simples).",
  ],
} as const;
