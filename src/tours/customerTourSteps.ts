import type { GuidedTourStep } from "@/src/components/tour/GuidedTour";

export const CUSTOMER_TOUR_STEPS: GuidedTourStep[] = [
  {
    target: "customers-root",
    title: "Cadastro de clientes",
    description: "Base de clientes B2B usada nas propostas e relatórios. Use a busca para achar por razão social, fantasia ou documento.",
  },
  {
    target: "customers-toolbar",
    title: "Ações da lista",
    description:
      "Exporte a grade com o filtro atual em Excel ou PDF, consulte CNPJ, importe planilhas ou cadastre um **Novo cliente**.",
  },
  {
    target: "customers-table",
    title: "Lista",
    description:
      "Documento, contato, localização e status. Pelas ações da linha você edita o cadastro ou abre o painel comercial quando disponível.",
  },
];
