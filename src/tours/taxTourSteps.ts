import type { GuidedTourStep } from "@/src/components/tour/GuidedTour";

export const TAX_TOUR_STEPS: GuidedTourStep[] = [
  {
    target: "tax-rules-root",
    title: "Regras fiscais",
    description: "Conjunto de regras tributárias usadas na precificação e propostas. Este tour só indica onde navegar.",
  },
  {
    target: "tax-rules-toolbar",
    title: "Busca e nova regra",
    description: "Localize regras existentes ou crie uma **Nova regra fiscal** para combinar com produtos e operações.",
  },
  {
    target: "tax-rules-grid",
    title: "Cartões de regra",
    description: "Cada cartão resume operação e componentes de imposto; edite para manter alíquotas e escopos corretos.",
  },
];
