import { fleetCsvEscape, fleetRowsToCsv } from "./fleetCsv.js";
import {
  classifyFinanceArTitle,
  computeDaysOverdue,
  filterFinanceArRows,
  roundMoney,
  type FinanceArDashboardFilters,
  type FinanceArDashboardRow,
} from "./financeAccountsReceivableDashboard.js";
import { formatFinanceCalculatedStatus } from "./financeAccountsReceivableFormat.js";

export const FINANCE_AR_EXPORT_HEADERS = [
  "ID Nomus",  "Empresa",
  "Cliente",
  "CNPJ",
  "Descrição lançamento",
  "NF origem",
  "Data vencimento",
  "Data baixa",
  "Valor original",
  "Valor recebido",
  "Saldo",
  "Forma pagamento",
  "Conta bancária",
  "Status calculado",
  "Dias em atraso",
  "Cobrança suspensa",
  "Última sync",
] as const;

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

function nfOrigem(row: FinanceArDashboardRow): string {
  if (row.sourceInvoiceNumber?.trim()) return row.sourceInvoiceNumber.trim();
  if (row.sourceInvoiceId != null) return String(row.sourceInvoiceId);
  return "";
}

export function mapFinanceArRowToExportCells(
  row: FinanceArDashboardRow,
  referenceDate: Date = new Date()
): string[] {
  const status = classifyFinanceArTitle(row, referenceDate);
  const days = computeDaysOverdue(row.dueDate, referenceDate);
  return [
    String(row.externalId),
    row.companyName?.trim() ?? "",
    row.personName?.trim() ?? "",
    row.personCnpj?.trim() ?? "",
    row.description?.trim() ?? "",
    nfOrigem(row),
    formatExportDate(row.dueDate),
    formatExportDate(row.settlementDate),
    formatExportMoney(row.amountReceivable),
    formatExportMoney(row.amountReceived),
    formatExportMoney(row.balanceReceivable),
    row.paymentMethodName?.trim() ?? "",
    row.bankAccountName?.trim() ?? "",
    formatFinanceCalculatedStatus(status),
    days > 0 ? String(days) : "",
    row.suspendCollection === true ? "Sim" : row.suspendCollection === false ? "Não" : "",
    formatExportDateTime(row.syncedAt),
  ];
}

export function buildFinanceArExportCsv(
  rows: FinanceArDashboardRow[],
  filters: FinanceArDashboardFilters,
  referenceDate: Date = new Date()
): string {
  const filtered = filterFinanceArRows(rows, filters, referenceDate);
  const dataRows = filtered.map((row) => mapFinanceArRowToExportCells(row, referenceDate));
  return fleetRowsToCsv([...FINANCE_AR_EXPORT_HEADERS], dataRows);
}

/** Valida que nenhuma célula exportada contenha NaN/undefined literais. */
export function financeArExportCellsSafe(cells: string[]): boolean {
  return cells.every((cell) => {
    const t = String(cell ?? "").trim();
    return t !== "NaN" && t !== "undefined" && t !== "null";
  });
}

export { fleetCsvEscape };
