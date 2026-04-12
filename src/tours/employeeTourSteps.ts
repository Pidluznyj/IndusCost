import type { GuidedTourStep } from "@/src/components/tour/GuidedTour";

export const EMPLOYEE_TOUR_STEPS: GuidedTourStep[] = [
  {
    target: "employees-root",
    title: "Colaboradores",
    description: "Lista da folha com custos derivados de cargos e encargos cadastrados nas configurações.",
  },
  {
    target: "employees-toolbar",
    title: "Busca e cadastro",
    description: "Pesquise por nome, cargo ou setor; abra **Configurar verbas** ou **Novo funcionário** conforme necessário.",
  },
  {
    target: "employees-table",
    title: "Custos e HH",
    description: "Visualize salário, custo mensal estimado e custo/hora produtivo por colaborador.",
  },
];
