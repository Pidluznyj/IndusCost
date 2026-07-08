import type { FinanceArAnalyticalUiFilters } from "./financeAccountsReceivableDashboardTypes.js";
import { FINANCE_AR_MONTH_OPTIONS, FINANCE_AR_STATUS_OPTIONS } from "./financeAccountsReceivableDashboardTypes.js";
import { safeTrim } from "./safeTrim.js";

export const FINANCE_AR_TITLES_PRINT_TITLE = "Contas a Receber — Títulos";
export const FINANCE_AR_TITLES_PRINT_SUBTITLE = "Relatório analítico de títulos filtrados";
export const FINANCE_AR_TITLES_PRINT_DATA_SOURCE = "Contas a Receber Nomus";
export const FINANCE_AR_TITLES_PRINT_DISCLAIMER =
  "Relatório gerado a partir dos dados oficiais de Contas a Receber do Nomus.";
export const FINANCE_AR_TITLES_PRINT_FOOTER_NOTE =
  "Documento gerado pelo IndusCost · Origem: Nomus Contas a Receber";

const COVER_SECTIONS = [
  "Resumo executivo",
  "Filtros aplicados",
  "Detalhamento analítico dos títulos",
] as const;

export function getFinanceArTitlesPrintCoverSections(): readonly string[] {
  return COVER_SECTIONS;
}

function monthLabel(month: string): string {
  return FINANCE_AR_MONTH_OPTIONS.find((o) => o.value === month)?.label ?? month;
}

function statusLabel(status: string): string {
  return FINANCE_AR_STATUS_OPTIONS.find((o) => o.value === status)?.label ?? status;
}

export function buildFinanceArTitlesPrintFilterLines(
  filters: FinanceArAnalyticalUiFilters
): string[] {
  const lines: string[] = [];
  const customerName = safeTrim(filters.customerName) || safeTrim(filters.personName);
  const companyName = safeTrim(filters.companyName);
  const year = safeTrim(filters.year);
  const month = safeTrim(filters.month);
  const document = safeTrim(filters.document);

  if (customerName) lines.push(`Cliente: ${customerName}`);
  if (companyName) lines.push(`Empresa: ${companyName}`);
  if (year) lines.push(`Ano vencimento: ${year}`);
  if (month) lines.push(`Mês vencimento: ${monthLabel(month)}`);
  if (filters.status !== "all") lines.push(`Status: ${statusLabel(filters.status)}`);
  if (filters.invoiceIssued !== "all") {
    lines.push(`NF emitida: ${filters.invoiceIssued === "yes" ? "Sim" : "Não"}`);
  }
  if (safeTrim(filters.dueDateFrom) || safeTrim(filters.dueDateTo)) {
    lines.push(
      `Vencimento: ${safeTrim(filters.dueDateFrom) || "…"} — ${safeTrim(filters.dueDateTo) || "…"}`
    );
  }
  if (safeTrim(filters.issueDateFrom) || safeTrim(filters.issueDateTo)) {
    lines.push(
      `Emissão: ${safeTrim(filters.issueDateFrom) || "…"} — ${safeTrim(filters.issueDateTo) || "…"}`
    );
  }
  if (document) lines.push(`Documento: ${document}`);
  if (safeTrim(filters.minValue)) lines.push(`Valor mínimo: ${safeTrim(filters.minValue)}`);
  if (safeTrim(filters.maxValue)) lines.push(`Valor máximo: ${safeTrim(filters.maxValue)}`);
  if (filters.origin !== "all") {
    lines.push(`Origem: ${filters.origin === "withNfe" ? "Com NF" : "Sem NF"}`);
  }
  if (filters.delaySituation !== "all") lines.push(`Situação: ${filters.delaySituation}`);

  return lines;
}
