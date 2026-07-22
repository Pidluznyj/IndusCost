import type { FinanceApUiFilters } from "./financeAccountsPayableDashboardTypes.js";
import {
  FINANCE_AP_STATUS_OPTIONS,
  FINANCE_AP_SUSPEND_PAYMENT_OPTIONS,
} from "./financeAccountsPayableDashboardTypes.js";
import { safeTrim } from "./safeTrim.js";

export const FINANCE_AP_TITLES_PRINT_TITLE = "Contas a Pagar — Títulos";
export const FINANCE_AP_TITLES_PRINT_SUBTITLE = "Relatório analítico de títulos filtrados";
export const FINANCE_AP_TITLES_PRINT_DATA_SOURCE = "Contas a Pagar Nomus";
export const FINANCE_AP_TITLES_PRINT_DISCLAIMER =
  "Relatório gerado a partir dos dados oficiais de Contas a Pagar do Nomus.";
export const FINANCE_AP_TITLES_PRINT_FOOTER_NOTE =
  "Documento gerado pelo IndusCost · Origem: Nomus Contas a Pagar";

/** Limites da logo no PDF — alinhado ao grid institucional (28mm × 22mm). */
export const FINANCE_AP_TITLES_PRINT_LOGO_MAX_WIDTH_PX = 106;
export const FINANCE_AP_TITLES_PRINT_LOGO_MAX_HEIGHT_PX = 83;

const MONTH_LABELS: Record<string, string> = {
  "1": "Janeiro",
  "2": "Fevereiro",
  "3": "Março",
  "4": "Abril",
  "5": "Maio",
  "6": "Junho",
  "7": "Julho",
  "8": "Agosto",
  "9": "Setembro",
  "10": "Outubro",
  "11": "Novembro",
  "12": "Dezembro",
};

function statusLabel(status: string): string {
  return FINANCE_AP_STATUS_OPTIONS.find((o) => o.value === status)?.label ?? status;
}

function suspendLabel(value: string): string {
  return FINANCE_AP_SUSPEND_PAYMENT_OPTIONS.find((o) => o.value === value)?.label ?? value;
}

export function buildFinanceApTitlesPrintFilterLines(filters: FinanceApUiFilters): string[] {
  const lines: string[] = [];
  const personName = safeTrim(filters.personName);
  const companyName = safeTrim(filters.companyName);
  const year = safeTrim(filters.year);
  const month = safeTrim(filters.month);
  const document = safeTrim(filters.documentQuery);
  const paymentMethod = safeTrim(filters.paymentMethodName);
  const bankAccount = safeTrim(filters.bankAccountName);

  if (personName) lines.push(`Fornecedor: ${personName}`);
  if (companyName) lines.push(`Empresa: ${companyName}`);
  if (year) lines.push(`Ano vencimento: ${year}`);
  if (month) lines.push(`Mês vencimento: ${MONTH_LABELS[month] ?? month}`);
  if (filters.status !== "all") lines.push(`Status: ${statusLabel(filters.status)}`);
  if (safeTrim(filters.dueDateFrom) || safeTrim(filters.dueDateTo)) {
    lines.push(
      `Vencimento: ${safeTrim(filters.dueDateFrom) || "…"} — ${safeTrim(filters.dueDateTo) || "…"}`
    );
  }
  if (document) lines.push(`Documento: ${document}`);
  if (paymentMethod) lines.push(`Forma pagamento: ${paymentMethod}`);
  if (bankAccount) lines.push(`Conta bancária: ${bankAccount}`);
  if (filters.suspendPayment !== "all") {
    lines.push(`Pagamento suspenso: ${suspendLabel(filters.suspendPayment)}`);
  }
  if (safeTrim(filters.costCenterId)) lines.push(`Centro de custo: ${safeTrim(filters.costCenterId)}`);
  if (safeTrim(filters.supplierId)) lines.push(`Fornecedor consolidado: ${safeTrim(filters.supplierId)}`);
  if (safeTrim(filters.classificationStatus) && filters.classificationStatus !== "all") {
    lines.push(`Classificação: ${safeTrim(filters.classificationStatus)}`);
  }

  return lines;
}
