import type { GuidedTourStep } from "@/src/components/tour/GuidedTour";

export const MACHINE_TOUR_STEPS: GuidedTourStep[] = [
  {
    target: "machines-root",
    title: "Máquinas",
    description: "Cadastro de equipamentos com custos e indicadores usados no roteiro e no custeio de HM.",
  },
  {
    target: "machines-toolbar",
    title: "Busca e nova máquina",
    description: "Filtre por nome ou código e cadastre equipamentos novos quando necessário.",
  },
  {
    target: "machines-grid",
    title: "Cartões de máquina",
    description: "Cada cartão resume a máquina; use editar para manter dados e custos alinhados à operação.",
  },
];
