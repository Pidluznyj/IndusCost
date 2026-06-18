export const MATERIAL_USAGE_AUDIT_DRAWER_TITLE = "Auditoria da matéria-prima";

export const MATERIAL_USAGE_AUDIT_FILTERS_NOTE =
  "Auditoria calculada com os filtros atualmente aplicados.";

export const MATERIAL_USAGE_AUDIT_LOADING = "Carregando auditoria da matéria-prima…";

export const MATERIAL_USAGE_AUDIT_FISCAL_NOTE =
  "Realizado considera pedidos faturados/com NF emitida. Este indicador mede assertividade comercial/fiscal, não baixa real de estoque.";

export const MATERIAL_USAGE_AUDIT_TOOLTIPS = {
  planned:
    "Previsto = uso estimado da matéria-prima calculado sobre pedidos de venda válidos filtrados (SalesOrder + BOM).",
  realized:
    "Realizado = uso estimado sobre pedidos faturados/com NF emitida (comercial/fiscal, não consumo de estoque).",
  balance: "Saldo = Previsto − Realizado (quantidade de matéria-prima).",
  accuracy: "Assertividade = Realizado ÷ Previsto.",
  costDifference:
    "Diferença R$ = Custo realizado − Custo previsto (mesma regra da coluna Dif. R$ da tabela).",
  unitCost: "Custo unitário de referência da matéria-prima na BOM/custo aberto.",
} as const;

export const MATERIAL_USAGE_AUDIT_DIFF_NEGATIVE =
  "Há consumo previsto ainda não realizado/faturado.";

export const MATERIAL_USAGE_AUDIT_DIFF_POSITIVE =
  "O realizado ficou acima do previsto.";

export const MATERIAL_USAGE_AUDIT_DIFF_ZERO = "Previsto e realizado estão alinhados em valor.";

export const MATERIAL_USAGE_AUDIT_BUTTON_LABEL = "Auditar";

export const MATERIAL_USAGE_AUDIT_BUTTON_TOOLTIP = "Ver composição da diferença";

export const MATERIAL_USAGE_AUDIT_TABS = {
  summary: "Resumo da diferença",
  products: "Produtos relacionados",
  plannedOrders: "Pedidos previstos",
  realizedOrders: "Pedidos faturados",
  variance: "Diferença por produto",
  alerts: "Alertas de dados",
} as const;
