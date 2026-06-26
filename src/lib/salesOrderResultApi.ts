import type { SalesOrderResultFilters } from "./salesOrderResultTypes.js";

export function getSalesOrderResultApiPath(query: Partial<SalesOrderResultFilters>): string {
  const params = new URLSearchParams();
  if (query.year != null) params.set("year", String(query.year));
  if (query.month != null) params.set("month", String(query.month));
  if (query.customerId) params.set("customerId", query.customerId);
  if (query.productId) params.set("productId", query.productId);
  if (query.sellerId) params.set("responsible", query.sellerId);
  if (query.companyId) params.set("company", query.companyId);
  if (query.asOfDate) params.set("asOfDate", query.asOfDate);
  return `/api/sales-orders/results?${params.toString()}`;
}

export const SALES_ORDER_RESULT_MARGIN_TOOLTIP = {
  title: "Margem gerencial",
  lines: [
    "Preço de venda: valor unitário vendido do pedido/NF (motor oficial de margem).",
    "Imposto: soma dos componentes da regra fiscal (TaxRule) cadastrada no produto ou regra padrão.",
    "Receita líquida gerencial: valor vendido − imposto estimado.",
    "Custo: custo real do produto cadastrado na aba Produtos (motor oficial).",
    "Margem R$: receita líquida gerencial − custo.",
    "Margem %: margem R$ ÷ receita líquida gerencial.",
    "A margem agregada é ponderada por receita, não média simples dos itens.",
  ],
} as const;
