import type { GuidedTourStep } from "@/src/components/tour/GuidedTour";

export const SIMULATION_TOUR_STEPS: GuidedTourStep[] = [
  {
    target: "simulation-root",
    title: "Cenários e simulações",
    description:
      "Teste variações de preço e custo sem alterar dados oficiais. Cada cenário fica listado para comparar depois.",
  },
  {
    target: "simulation-header",
    title: "Novo cenário",
    description: "Abra **Novo cenário** para definir produto, regras e percentuais de ajuste em um formulário dedicado.",
  },
  {
    target: "simulation-grid",
    title: "Cenários salvos",
    description: "Os cartões mostram resumo do cenário; use as ações para revisar, comparar ou excluir conforme permitido.",
  },
];
