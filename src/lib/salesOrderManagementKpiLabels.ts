/**
 * Labels de apresentação dos cards KPI — Gestão de Pedidos.
 * Apenas copy de UX; não altera cálculos.
 */

export const SALES_ORDER_MGMT_KPI_SECTIONS = {
  overview: {
    title: "Visão Geral",
    subtitle: "Indicadores principais do filtro atual.",
  },
  margin: {
    title: "Margem do filtro",
    subtitle:
      "Consolidado econômico dos pedidos filtrados (dados internos). Clique em Margem % ou R$ para detalhar.",
  },
  alerts: {
    title: "Alertas",
    subtitle: "Pedidos que precisam de ação ou revisão. Clique para filtrar quando disponível.",
  },
  logistics: {
    title: "Logística e Atendimento",
    subtitle: "Cumprimento de prazo, entrega/faturamento e pendências por status logístico.",
  },
  economics: {
    title: "Análise Econômica",
    subtitle: "Margem, custo e rentabilidade do filtro atual (dados internos).",
  },
  fulfillment: {
    title: "Faturamento / NF-e",
    subtitle: "Conversão dos pedidos em notas fiscais e cobertura de faturamento.",
  },
} as const;

export const SALES_ORDER_LIST_KPI_SECTION = {
  title: "Visão Geral",
  subtitle: "Resumo comercial dos pedidos filtrados.",
} as const;
