import type { GuidedTourStep } from "@/src/components/tour/GuidedTour";

/** Produtos (engenharia) — foco na lista principal; detalhe no modal é opcional. */
export const PRODUCT_TOUR_STEPS: GuidedTourStep[] = [
  {
    target: "products-root",
    title: "Itens de engenharia",
    description:
      "Cadastro de produtos, componentes e estrutura (BOM / roteiro / custo) no IndusCost. O tour cobre a lista; ao editar um item, use as abas dentro do modal.",
  },
  {
    target: "products-toolbar",
    title: "Busca e ações",
    description: "Filtre por SKU ou nome, importe planilha em lote ou abra um **Novo item** para cadastrar.",
  },
  {
    target: "products-table",
    title: "Lista e ações",
    description:
      "Veja tipo, versão, estrutura (BOM/etapas), status e use editar ou excluir. Com linhas selecionadas, a exclusão em lote pode aparecer aqui.",
  },
  {
    target: "products-modal-tabs",
    title: "Abas no cadastro (ao editar)",
    description:
      "Ao abrir um item, as abas **Informações**, **BOM**, **Roteiro**, **Custo** e **Árvore** concentram o detalhe técnico — só visíveis com o modal aberto.",
    optional: true,
  },
];
