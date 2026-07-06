import type { GuidedTourStep } from "@/src/components/tour/GuidedTour";

/** Propostas — lista ou formulário; âncoras ausentes em uma vista são ignoradas (opcional). */
export const PROPOSAL_TOUR_STEPS: GuidedTourStep[] = [
  {
    target: "proposals-root",
    title: "Propostas comerciais",
    description:
      "Negociações com itens, valores e status. Nada abre sozinho — este guia só orienta quando você clicar em **Como usar**.",
  },
  {
    target: "proposals-toolbar",
    title: "Busca e nova proposta",
    description: "Na lista, filtre por número, cliente ou título e crie uma **Nova proposta**.",
    optional: true,
  },
  {
    target: "proposals-table",
    title: "Lista de propostas",
    description:
      "Acompanhe valor líquido, margem, status e datas. Use as ações da linha para editar ou excluir conforme sua rotina.",
    optional: true,
  },
  {
    target: "proposals-form-actions",
    title: "Status e gravação",
    description:
      "No formulário, ajuste o **status** do funil comercial e salve quando terminar as alterações.",
    optional: true,
  },
  {
    target: "proposals-form-items",
    title: "Itens e totais",
    description:
      "Adicione produtos, revise preços negociados, impostos, frete e veja a margem consolidada no rodapé da grade.",
    optional: true,
  },
];
