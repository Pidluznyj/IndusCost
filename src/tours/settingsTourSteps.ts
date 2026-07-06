import type { GuidedTourStep } from "@/src/components/tour/GuidedTour";

export const SETTINGS_TOUR_STEPS: GuidedTourStep[] = [
  {
    target: "settings-root",
    title: "Configurações",
    description:
      "Parâmetros de cargos, encargos e valores globais (energia, horas, HH) usados pelo custeio. Alterações aqui seguem as regras já implementadas no backend.",
  },
  {
    target: "settings-subtabs",
    title: "Submódulos",
    description: "Alterne entre **Cargos**, **Encargos/Benefícios** e **Parâmetros globais** conforme o que precisa ajustar.",
  },
  {
    target: "settings-main-panel",
    title: "Conteúdo ativo",
    description:
      "Cartões e formulários mudam conforme a aba: cadastre cargos/componentes ou edite energia, horas e override de HH nos globais.",
    optional: true,
  },
];
