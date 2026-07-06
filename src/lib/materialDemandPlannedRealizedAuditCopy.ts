export const MATERIAL_USAGE_AUDIT_DRAWER_TITLE = "Auditoria da matéria-prima";

export const MATERIAL_USAGE_AUDIT_FILTERS_NOTE =
  "Auditoria calculada com os filtros atualmente aplicados.";

export const MATERIAL_USAGE_AUDIT_LOADING = "Carregando auditoria da matéria-prima…";

export const MATERIAL_USAGE_AUDIT_FISCAL_NOTE =
  "O realizado considera pedidos faturados/com NF emitida. Este indicador mede assertividade comercial/fiscal, não baixa real de estoque.";

export const MATERIAL_USAGE_AUDIT_TOOLTIPS = {
  planned: "Previsto = uso estimado da matéria-prima sobre pedidos de venda válidos filtrados (SalesOrder + BOM).",
  invoiced:
    "Faturado = uso estimado sobre pedidos com NF emitida (comercial/fiscal, não consumo de estoque).",
  pending: "A faturar = Previsto − Faturado (quantidade ainda não faturada).",
  partial: "Parcial = quantidade faltante em pedidos parcialmente faturados.",
  accuracy: "Assertividade = Faturado ÷ Previsto.",
  costDifference: "Diferença R$ = Custo faturado − Custo previsto (regra da coluna Dif. R$).",
} as const;

export const MATERIAL_USAGE_AUDIT_DIFF_NEGATIVE =
  "Há consumo previsto ainda não realizado/faturado.";

export const MATERIAL_USAGE_AUDIT_DIFF_POSITIVE =
  "O realizado ficou acima do previsto.";

export const MATERIAL_USAGE_AUDIT_DIFF_ZERO = "Previsto e faturado estão alinhados em valor.";

export const MATERIAL_USAGE_AUDIT_BUTTON_LABEL = "Auditar";

export const MATERIAL_USAGE_AUDIT_BUTTON_TOOLTIP =
  "Auditar diferença entre previsto e faturado";

export const MATERIAL_USAGE_AUDIT_DIFFERENCE_BRIDGE_TITLE = "De onde vem a diferença?";

export const MATERIAL_USAGE_AUDIT_PARTIAL_EMPTY =
  "Nenhum pedido parcialmente faturado para esta matéria-prima.";

export const MATERIAL_USAGE_AUDIT_UNEXPLAINED_WARNING =
  "Parte do saldo não pôde ser classificada automaticamente; verifique alertas de dados.";

export const MATERIAL_USAGE_AUDIT_TABS = {
  summary: "Resumo comparativo",
  products: "Comparativo por produto",
  notInvoicedOrders: "Pedidos não faturados",
  realizedOrders: "Pedidos faturados",
  partiallyInvoicedOrders: "Pedidos parcialmente faturados",
  alerts: "Alertas de dados",
} as const;

export const MATERIAL_USAGE_PRODUCT_STATUS_LABELS = {
  ok: "OK",
  pending_invoice: "A faturar",
  partial: "Parcial",
  not_invoiced: "Sem faturamento",
  warning: "Atenção",
} as const;
