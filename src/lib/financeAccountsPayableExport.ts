import { fleetCsvEscape, fleetRowsToCsv } from "./fleetCsv.js";
import {
  classifyFinanceApTitle,
  computeDaysOverdue,
  filterFinanceApRows,
  roundMoney,
  type FinanceApDashboardFilters,
  type FinanceApDashboardRow,
} from "./financeAccountsPayableDashboard.js";
import { formatFinanceCalculatedStatus } from "./financeAccountsPayableFormat.js";

export const FINANCE_AP_EXPORT_HEADERS = [
  "ID Nomus",
  "Empresa",
  "Fornecedor",
  "CNPJ",
  "Descrição",
  "Documento/NF",
  "Data vencimento",
  "Baixa/Pagamento",
  "Valor original",
  "Valor pago",
  "Saldo",
  "Forma pagamento",
  "Conta bancária",
  "Status calculado",
  "Status Nomus",
  "Dias em atraso",
  "Pagamento suspenso",
  "Última sync",
] as const;

function formatExportNomusStatus(status: boolean | null): string {
  if (status === true) return "Pago/Baixado (Nomus)";
  if (status === false) return "Em aberto (Nomus)";
  return "";
}

function formatExportDate(value: Date | null): string {
  if (!value) return "";
  if (Number.isNaN(value.getTime())) return "";
  return value.toLocaleDateString("pt-BR");
}

function formatExportMoney(value: number): string {
  if (!Number.isFinite(value)) return "";
  return roundMoney(value).toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatExportDateTime(value: Date): string {
  if (Number.isNaN(value.getTime())) return "";
  return value.toLocaleString("pt-BR");
}

function nfOrigem(row: FinanceApDashboardRow): string {
  if (row.documentNumber?.trim()) return row.documentNumber.trim();
  if (row.sourceInvoiceId != null) return String(row.sourceInvoiceId);
  return "";
}

export function mapFinanceApRowToExportCells(
  row: FinanceApDashboardRow,
  referenceDate: Date = new Date()
): string[] {
  const status = classifyFinanceApTitle(row, referenceDate);
  const days = computeDaysOverdue(row.dueDate, referenceDate);
  return [
    String(row.externalId),
    row.companyName?.trim() ?? "",
    row.personName?.trim() ?? "",
    row.personCnpj?.trim() ?? "",
    row.description?.trim() ?? "",
    nfOrigem(row),
    formatExportDate(row.dueDate),
    formatExportDate(row.paymentDate ?? row.settlementDate),
    formatExportMoney(row.amountPayable),
    formatExportMoney(row.amountPaid),
    formatExportMoney(row.balancePayable),
    row.paymentMethodName?.trim() ?? "",
    row.bankAccountName?.trim() ?? "",
    formatFinanceCalculatedStatus(status),
    formatExportNomusStatus(row.nomusStatus),
    days > 0 ? String(days) : "",
    row.suspendPayment === true ? "Sim" : row.suspendPayment === false ? "Não" : "",
    formatExportDateTime(row.syncedAt),
  ];
}

export function buildFinanceApExportCsv(
  rows: FinanceApDashboardRow[],
  filters: FinanceApDashboardFilters,
  referenceDate: Date = new Date()
): string {
  const filtered = filterFinanceApRows(rows, filters, referenceDate);
  const dataRows = filtered.map((row) => mapFinanceApRowToExportCells(row, referenceDate));
  return fleetRowsToCsv([...FINANCE_AP_EXPORT_HEADERS], dataRows);
}

/** Valida que nenhuma célula exportada contenha NaN/undefined literais. */
export function financeApExportCellsSafe(cells: string[]): boolean {
  return cells.every((cell) => {
    const t = String(cell ?? "").trim();
    return t !== "NaN" && t !== "undefined" && t !== "null";
  });
}

export { fleetCsvEscape };
