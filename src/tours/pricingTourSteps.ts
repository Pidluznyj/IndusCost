import type { GuidedTourStep } from "@/src/components/tour/GuidedTour";

/** Precificação — modo unitário vs lote têm DOM diferente; passos específicos são opcionais. */
export const PRICING_TOUR_STEPS: GuidedTourStep[] = [
  {
    target: "pricing-root",
    title: "Formação de preço",
    description:
      "Configure premissas de margem, comissão e frete por produto ou processe simulações em lote. O motor de custo existente não é alterado por este tour.",
  },
  {
    target: "pricing-mode-toggle",
    title: "Unitário ou lote",
    description:
      "**Gestão unitária** lista premissas salvas por produto. **Processamento em lote** seleciona vários produtos e aplica parâmetros comuns.",
  },
  {
    target: "pricing-unit-panel",
    title: "Lista unitária",
    description:
      "Veja premissas por produto, regra fiscal, margem e comissão; use calcular, editar ou excluir conforme necessário.",
    optional: true,
  },
  {
    target: "pricing-batch-panel",
    title: "Fluxo em lote",
    description:
      "Selecione produtos, defina parâmetros fiscais e de margem, rode a simulação e revise resultados antes de gravar oficialmente.",
    optional: true,
  },
];
