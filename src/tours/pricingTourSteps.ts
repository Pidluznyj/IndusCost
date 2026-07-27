import type { GuidedTourStep } from "@/src/components/tour/GuidedTour";

/** Precificação — consulta de preços publicados e ferramentas administrativas (sanfona Super Admin). */
export const PRICING_TOUR_STEPS: GuidedTourStep[] = [
  {
    target: "pricing-root",
    title: "Formação de preço",
    description:
      "Consulte os preços comerciais publicados vigentes. As ferramentas de geração e custo oficial ficam na sanfona superior (somente Super administrador).",
  },
  {
    target: "pricing-admin-tools-accordion",
    title: "Ferramentas administrativas",
    description:
      "Somente Super administrador pode abrir esta sanfona para gerar tabelas, gerir custos oficiais e auditar margem.",
    optional: true,
  },
  {
    target: "pricing-unit-panel",
    title: "Preços publicados",
    description:
      "Busque por produto ou SKU, filtre por regra fiscal/margem/comissão e consulte os valores publicados das tabelas vigentes.",
  },
];
