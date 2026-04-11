import type { GuidedTourStep } from "@/src/components/tour/GuidedTour";

/**
 * Tour do Dashboard (piloto). Passos opcionais exigem aba "Operação / Financeiro" e dados carregados.
 */
export const DASHBOARD_TOUR_STEPS: GuidedTourStep[] = [
  {
    target: "dashboard-module",
    title: "Visão geral",
    description:
      "O dashboard reúne indicadores gerenciais. Nada abre automaticamente — use o botão Tour quando quiser este guia.",
  },
  {
    target: "dashboard-tabs",
    title: "Alternar o foco",
    description:
      "Escolha entre Operação / Financeiro (indicadores de custos e produtos) ou Funil de Vendas (pipeline comercial B2B).",
  },
  {
    target: "dashboard-main-area",
    title: "Área principal",
    description:
      "Abaixo das abas aparecem gráficos, tabelas ou o funil, conforme a opção selecionada e os dados disponíveis.",
  },
  {
    target: "dashboard-kpi-cards",
    title: "Indicadores rápidos",
    description:
      "Na visão Operação, estes cartões destacam médias e totais (folha, máquinas, CIF, OPEX). Os valores vêm do mesmo motor de custo usado no sistema.",
    optional: true,
  },
  {
    target: "dashboard-charts-block",
    title: "Gráficos",
    description:
      "Composição de custo médio e desempenho de margem por produto ajudam a comparar produtos ativos. Passe o mouse nos gráficos para detalhes.",
    optional: true,
  },
];
