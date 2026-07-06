import type { GuidedTourStep } from "@/src/components/tour/GuidedTour";

export const REPORTS_TOUR_STEPS: GuidedTourStep[] = [
  {
    target: "reports-root",
    title: "Central de relatórios",
    description:
      "Indicadores gerenciais alinhados aos dados do sistema. O conteúdo depende do período e filtros — nada é gravado pelo tour.",
  },
  {
    target: "reports-header-actions",
    title: "Atualizar e imprimir",
    description: "Atualize os agregados e use **Imprimir / PDF** (atalho do navegador, ex.: Ctrl+P) para exportar.",
  },
  {
    target: "reports-filters",
    title: "Filtros globais",
    description: "Período, cliente, responsável, produto e faixas de valor refinam os gráficos e tabelas abaixo.",
  },
  {
    target: "reports-tabs",
    title: "Categorias de relatório",
    description: "Alterne entre visões (executivo, comercial, etc.) para mudar o conjunto de painéis exibidos.",
  },
  {
    target: "reports-main-content",
    title: "Painéis",
    description:
      "KPIs, gráficos e tabelas aparecem aqui conforme a aba e os filtros — após os dados carregarem sem erro.",
    optional: true,
  },
];
