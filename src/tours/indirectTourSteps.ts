import type { GuidedTourStep } from "@/src/components/tour/GuidedTour";

export const INDIRECT_COST_TOUR_STEPS: GuidedTourStep[] = [
  {
    target: "indirect-cost-root",
    title: "Custos indiretos / OPEX",
    description:
      "Acompanhe totais de CIF e OPEX e cadastre despesas indiretas com centro de custo. Valores seguem as regras de rateio já existentes.",
  },
  {
    target: "indirect-cost-summary",
    title: "Resumo dos totais",
    description: "Visão rápida dos montantes mensais consolidados antes da lista detalhada.",
    optional: true,
  },
  {
    target: "indirect-cost-toolbar",
    title: "Busca e nova despesa",
    description: "Filtre por texto e registre novas linhas de despesa quando precisar.",
  },
  {
    target: "indirect-cost-table",
    title: "Tabela de despesas",
    description: "Lista categorias, valores e centros de custo; use as ações para editar ou inativar conforme o fluxo atual.",
  },
];
