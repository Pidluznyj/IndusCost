import { fleetRowsToCsv } from "./fleetCsv.js";
import type { FinanceBillingNfeListItem } from "./financeBillingNfeList.js";

export const FINANCE_BILLING_NFE_EXPORT_HEADERS = [
  "ID Nomus",
  "Número",
  "Série",
  "Status",
  "Classificação",
  "CNPJ destinatário",
  "Natureza operação",
  "Data fiscal",
  "Data processamento",
  "Valor líquido",
  "Mercado",
  "Última sync",
] as const;

function formatExportDate(value: string | null): string {
  if (!value) return "";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("pt-BR");
}

function formatExportDateTime(value: string): string {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString("pt-BR");
}

function formatMoney(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "";
  return value.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function buildFinanceBillingNfeExportCsv(items: FinanceBillingNfeListItem[]): string {
  const rows = items.map((item) => [
    String(item.externalId),
    item.numero ?? "",
    item.serie ?? "",
    item.status != null ? String(item.status) : "",
    item.billingClassification ?? "",
    item.xmlDestCnpjCpf ?? "",
    item.xmlNatOp ?? "",
    formatExportDate(item.fiscalDate),
    formatExportDate(item.dataProcessamento),
    formatMoney(item.valorLiquido),
    item.isMarketSale ? "Sim" : "Não",
    formatExportDateTime(item.syncedAt),
  ]);
  return fleetRowsToCsv([...FINANCE_BILLING_NFE_EXPORT_HEADERS], rows);
}

export function financeBillingNfeExportFilename(year: number): string {
  const stamp = new Date().toISOString().slice(0, 10);
  return `faturamento-nfe-${year}-${stamp}.csv`;
}
