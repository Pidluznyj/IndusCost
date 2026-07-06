import type { DueRadarMode } from "@/src/lib/financeDueRadarFilters";

export function getDueRadarApiBase(mode: DueRadarMode): string {
  return mode === "receivable"
    ? "/api/finance/accounts-receivable/due-radar"
    : "/api/finance/accounts-payable/due-radar";
}

export function buildDueRadarApiUrl(
  mode: DueRadarMode,
  dashboardQuery: string,
  radarQuery: string
): string {
  const merged = dashboardQuery ? `${dashboardQuery}&${radarQuery}` : radarQuery;
  return `${getDueRadarApiBase(mode)}?${merged}`;
}

export const DUE_RADAR_COPY = {
  receivable: {
    title: "Radar de Recebimentos",
    subtitle:
      "Distribuição dos títulos a receber por vencimento, respeitando os filtros aplicados na tela.",
    dayHint: "Clique em um dia para ver os títulos a receber.",
    searchPlaceholder: "Buscar cliente, descrição, documento, NF ou pedido…",
    emptyMessage: "Nenhum título a receber encontrado para a faixa selecionada.",
    totalLabel: "Total a receber",
    amountLabel: "Valor a receber",
    testId: "ar-due-radar",
  },
  payable: {
    title: "Radar de Pagamentos",
    subtitle:
      "Distribuição dos títulos a pagar por vencimento, respeitando os filtros aplicados na tela.",
    dayHint: "Clique em um dia para ver os títulos a pagar.",
    searchPlaceholder: "Buscar fornecedor, descrição ou documento…",
    emptyMessage: "Nenhum título a pagar encontrado para a faixa selecionada.",
    totalLabel: "Total a pagar",
    amountLabel: "Valor a pagar",
    testId: "ap-due-radar",
  },
} as const;
