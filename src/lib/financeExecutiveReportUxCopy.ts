/**
 * Textos de UX do Relatório Presidencial — sem lógica financeira.
 */
import { formatFinanceDateTime } from "./financeAccountsReceivableFormat.js";
import type { FinanceExecutiveReportDataQuality } from "./financeExecutiveReportTypes.js";

export const EXECUTIVE_REPORT_SOURCES_LABEL =
  "Fontes: Nomus, IndusCost, Contas a Receber, Contas a Pagar, NF-e, Pedidos de Venda";

export const EXECUTIVE_REPORT_NO_TARGET_MESSAGE =
  "Meta não cadastrada para este período; indicadores de atingimento podem ficar indisponíveis.";

export const EXECUTIVE_REPORT_SECTION_INTROS: Record<string, string> = {
  summary:
    "Panorama consolidado do período com faturamento comparativo e leitura rápida dos indicadores principais.",
  "billing-comparison":
    "Faturamento oficial (NF-e) mês a mês, usando o mesmo motor da tela de Faturamento.",
  "billing-projection":
    "Média diária, realizado, projeção e meta anual — sem recálculo paralelo no frontend.",
  "accounts-receivable":
    "Carteira de recebíveis saneada Nomus, alinhada à tela oficial de Contas a Receber.",
  "accounts-payable":
    "Compromissos a pagar consolidados, com as mesmas regras da tela de Contas a Pagar.",
  "cash-flow":
    "Entradas, saídas e saldo líquido projetados pelo motor oficial de Fluxo de Caixa.",
  "sales-orders":
    "Pedidos de venda (SalesOrder/SalesOrderItem) com metas e projeção comercial.",
  conclusion:
    "Síntese executiva, alertas de qualidade e pontos de atenção para decisão presidencial.",
};

export function formatExecutiveReportGeneratedFooter(generatedAt: string): string {
  return `Documento gerado pelo IndusCost em ${formatFinanceDateTime(generatedAt)}`;
}

export function formatExecutiveReportStaleSyncWarning(
  sourceLabel: string,
  syncAt: string
): string {
  return `Atenção: última sincronização de ${sourceLabel} ocorreu em ${formatFinanceDateTime(syncAt)}.`;
}

export function formatExecutiveReportBillingYearsSubtitle(years: number[]): string {
  if (years.length === 0) {
    return "Comparativo multi-ano — valores em R$ mil / R$ Mi";
  }
  return `Comparativo ${years.join(" · ")} — valores em R$ mil / R$ Mi`;
}

export function buildExecutiveReportStaleSyncNotices(
  dataQuality: FinanceExecutiveReportDataQuality
): string[] {
  const { sync, freshness } = dataQuality;
  const notices: string[] = [];

  if (freshness.arStaleExcluded && sync.accountsReceivableLastSyncAt) {
    notices.push(
      formatExecutiveReportStaleSyncWarning("Contas a Receber", sync.accountsReceivableLastSyncAt)
    );
  }
  if (freshness.apStaleExcluded && sync.accountsPayableLastSyncAt) {
    notices.push(
      formatExecutiveReportStaleSyncWarning("Contas a Pagar", sync.accountsPayableLastSyncAt)
    );
  }
  if (sync.nfeLastSyncAt && dataQuality.targetsDerived) {
    notices.push(formatExecutiveReportStaleSyncWarning("NF-e", sync.nfeLastSyncAt));
  }

  return notices;
}
