/** Formatadores da UI Financeiro > Contas a Pagar (reutiliza base AR). */
export {
  safeFinanceNumber,
  formatFinanceCurrency,
  formatFinanceCurrencyCompact,
  formatFinancePercent,
  formatFinanceInteger,
  formatFinanceDate,
  formatFinanceDateTime,
  formatFinanceDaysOverdue,
  formatFinanceMonthLabel,
  displayFinanceText,
} from "./financeAccountsReceivableFormat.js";

const AP_STATUS_LABELS: Record<string, string> = {
  open: "Em aberto",
  overdue: "Atrasado",
  dueToday: "Vence hoje",
  upcoming: "A vencer",
  settled: "Pago/Baixado",
  suspended: "Pagamento suspenso",
  unknown: "Indefinido",
  all: "Todos",
};

export function formatFinanceCalculatedStatus(status: string | null | undefined): string {
  if (!status) return "—";
  return AP_STATUS_LABELS[status] ?? status;
}

export function financeApExportFilename(referenceDate: Date = new Date()): string {
  const y = referenceDate.getFullYear();
  const m = String(referenceDate.getMonth() + 1).padStart(2, "0");
  const d = String(referenceDate.getDate()).padStart(2, "0");
  return `contas-a-pagar-${y}-${m}-${d}.csv`;
}
