import type { GuidedTourStep } from "@/src/components/tour/GuidedTour";

export const MATERIAL_TOUR_STEPS: GuidedTourStep[] = [
  {
    target: "materials-root",
    title: "Materiais (Suprimentos)",
    description:
      "Cadastro de matérias-primas e insumos com custos de referência usados na engenharia e compras. Valores exibidos vêm do cadastro e APIs já existentes.",
  },
  {
    target: "materials-toolbar",
    title: "Busca e cadastro",
    description: "Filtre por código, descrição ou fornecedor; importe em lote ou crie um **Novo material**.",
  },
  {
    target: "materials-table",
    title: "Custos e status",
    description:
      "Confira custo atual, monitoramento de mercado e status. Use as ações para editar ou manter o cadastro.",
  },
];
