import type { GuidedTourStep } from "@/src/components/tour/GuidedTour";

/** Compras — lista, formulário ou carregamento; passos específicos são opcionais conforme a vista. */
export const PURCHASE_TOUR_STEPS: GuidedTourStep[] = [
  {
    target: "purchases-root",
    title: "Solicitações de compra",
    description:
      "Aqui você acompanha demandas de compra classificadas. O tour não altera dados — só destaca a tela. Use **Como usar** quando precisar deste guia.",
  },
  {
    target: "purchases-toolbar",
    title: "Ações principais",
    description:
      "Nesta faixa ficam o guia rápido e as ações principais: nova solicitação na lista, ou voltar / salvar no formulário.",
  },
  {
    target: "purchases-new-request",
    title: "Nova solicitação",
    description: "Abre o formulário para registrar uma nova demanda de compra.",
    optional: true,
  },
  {
    target: "purchases-list",
    title: "Lista de solicitações",
    description: "Visualize número, status, solicitante, área, centro de custo e abra para ver ou editar.",
    optional: true,
  },
  {
    target: "purchases-header-block",
    title: "Cabeçalho",
    description:
      "Solicitante, departamento, prioridade, centro de custo padrão e observações. O CC dos itens pode herdar deste cabeçalho.",
    optional: true,
  },
  {
    target: "purchases-items-block",
    title: "Itens da solicitação",
    description:
      "Cada linha pode ser **Matéria-prima** (vínculo ao cadastro de materiais) ou **Indireto** (descrição livre). Adicione linhas e preencha quantidades e datas desejadas.",
    optional: true,
  },
];
