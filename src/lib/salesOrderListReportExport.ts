/**
 * Exportação Comercial de Pedidos de Venda — XLSX / PDF (sem Prisma).
 */
import * as XLSX from "xlsx";
import { buildMinimalPdfDocument } from "./minimalPdfWriter.js";
import { formatSalesOrderListInvoicedLabel } from "./salesOrderListInvoicing.js";
import { SALES_ORDER_LIST_STATUS_LABELS } from "./salesOrderListUi.js";

export const SALES_ORDER_LIST_REPORT_TITLE =
  "Relatório de Pedidos de Venda por Vendedor";

export type SalesOrderListReportExportRow = {
  orderCode: string;
  customerName: string;
  sellerName: string;
  issueDate: string;
  status: string;
  statusLabel: string;
  hasInvoice: boolean;
  netValue: number;
  marginPercent: number | null;
  marginValue: number | null;
  itemsCount: number;
  nfeDocument: string;
  externalSalesOrderCode: string;
};

export type SalesOrderListReportExportSummary = {
  sellerLabel: string;
  periodLabel: string;
  ordersCount: number;
  totalNetAmount: number;
  totalItems: number;
  averageTicket: number;
  averageMarginPercent: number | null;
  invoicedCount: number;
  notInvoicedCount: number;
};

export type SalesOrderListReportExportPayload = {
  generatedAt: string;
  appliedFilters: Array<{ label: string; value: string }>;
  summary: SalesOrderListReportExportSummary;
  rows: SalesOrderListReportExportRow[];
};

const ORDER_COLUMNS = [
  "Pedido",
  "Cliente",
  "Vendedor",
  "Emissão",
  "Situação",
  "Faturado",
  "Valor líquido",
  "Margem %",
  "Margem valor",
  "Itens",
  "NF/documento",
  "Código Nomus",
] as const;

function formatDateBr(value: string | null | undefined): string {
  if (!value?.trim()) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("pt-BR");
}

function formatDateTimeBr(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("pt-BR");
}

function numOrBlank(v: number | null | undefined): number | "" {
  if (v == null || !Number.isFinite(v)) return "";
  return v;
}

function pdfSafeText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x20-\x7E]/g, "?");
}

function mapOrderRow(row: SalesOrderListReportExportRow): Record<string, string | number> {
  return {
    Pedido: row.orderCode,
    Cliente: row.customerName,
    Vendedor: row.sellerName,
    Emissão: row.issueDate,
    Situação: row.statusLabel || SALES_ORDER_LIST_STATUS_LABELS[row.status] || row.status,
    Faturado: formatSalesOrderListInvoicedLabel(row.hasInvoice),
    "Valor líquido": row.netValue,
    "Margem %": numOrBlank(row.marginPercent),
    "Margem valor": numOrBlank(row.marginValue),
    Itens: row.itemsCount,
    "NF/documento": row.nfeDocument,
    "Código Nomus": row.externalSalesOrderCode,
  };
}

function applyOrdersSheetFormatting(ws: XLSX.WorkSheet, rowCount: number) {
  ws["!cols"] = [
    { wch: 12 },
    { wch: 28 },
    { wch: 22 },
    { wch: 12 },
    { wch: 16 },
    { wch: 10 },
    { wch: 14 },
    { wch: 10 },
    { wch: 14 },
    { wch: 8 },
    { wch: 18 },
    { wch: 14 },
  ];
  ws["!freeze"] = {
    xSplit: 0,
    ySplit: 1,
    topLeftCell: "A2",
    activePane: "bottomLeft",
    state: "frozen",
  };
  if (rowCount > 1) {
    ws["!autofilter"] = { ref: `A1:L${rowCount}` };
  }
}

export function buildSalesOrderListReportExportWorkbook(
  payload: SalesOrderListReportExportPayload
): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  const { summary } = payload;

  const resumoRows = [
    { Campo: "Relatório", Valor: SALES_ORDER_LIST_REPORT_TITLE },
    { Campo: "Gerado em", Valor: formatDateTimeBr(payload.generatedAt) },
    { Campo: "Vendedor", Valor: summary.sellerLabel },
    { Campo: "Período", Valor: summary.periodLabel },
    { Campo: "Qtd pedidos", Valor: summary.ordersCount },
    { Campo: "Valor vendido", Valor: summary.totalNetAmount },
    { Campo: "Itens", Valor: summary.totalItems },
    { Campo: "Ticket médio", Valor: summary.averageTicket },
    { Campo: "Margem média %", Valor: numOrBlank(summary.averageMarginPercent) },
    { Campo: "Qtd faturada", Valor: summary.invoicedCount },
    { Campo: "Qtd não faturada", Valor: summary.notInvoicedCount },
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(resumoRows), "Resumo");

  const orderRows = payload.rows.map(mapOrderRow);
  const ordersSheet = XLSX.utils.json_to_sheet(orderRows);
  applyOrdersSheetFormatting(ordersSheet, orderRows.length + 1);
  XLSX.utils.book_append_sheet(wb, ordersSheet, "Pedidos");

  if (payload.appliedFilters.length > 0) {
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(
        payload.appliedFilters.map((row) => ({ Filtro: row.label, Valor: row.value }))
      ),
      "Filtros"
    );
  }

  return wb;
}

export function salesOrderListReportWorkbookToBytes(workbook: XLSX.WorkBook): Uint8Array {
  const arr = XLSX.write(workbook, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
  return new Uint8Array(arr);
}

export function salesOrderListReportExportFilename(format: "xlsx" | "pdf"): string {
  const stamp = new Date().toISOString().slice(0, 10);
  return format === "xlsx"
    ? `pedidos-venda-relatorio-${stamp}.xlsx`
    : `pedidos-venda-relatorio-${stamp}.pdf`;
}

export function buildSalesOrderListReportExportPdf(
  payload: SalesOrderListReportExportPayload
): Buffer {
  const lines: string[] = [
    `Gerado em: ${formatDateTimeBr(payload.generatedAt)}`,
    "",
  ];

  if (payload.appliedFilters.length > 0) {
    lines.push("Filtros aplicados:");
    for (const filter of payload.appliedFilters) {
      lines.push(`- ${filter.label}: ${filter.value}`);
    }
    lines.push("");
  }

  const { summary } = payload;
  lines.push("Resumo:");
  lines.push(`Vendedor: ${summary.sellerLabel}`);
  lines.push(`Período: ${summary.periodLabel}`);
  lines.push(`Qtd pedidos: ${summary.ordersCount}`);
  lines.push(`Valor vendido: ${summary.totalNetAmount.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}`);
  lines.push(`Itens: ${summary.totalItems}`);
  lines.push(`Ticket médio: ${summary.averageTicket.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}`);
  lines.push(
    `Margem média: ${
      summary.averageMarginPercent != null
        ? `${summary.averageMarginPercent.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`
        : "—"
    }`
  );
  lines.push(`Qtd faturada: ${summary.invoicedCount}`);
  lines.push(`Qtd não faturada: ${summary.notInvoicedCount}`);
  lines.push("");
  lines.push(ORDER_COLUMNS.join(" | "));

  for (const row of payload.rows.slice(0, 120)) {
    lines.push(
      [
        row.orderCode,
        row.customerName,
        row.sellerName,
        row.issueDate,
        row.statusLabel,
        formatSalesOrderListInvoicedLabel(row.hasInvoice),
        row.netValue.toLocaleString("pt-BR", { minimumFractionDigits: 2 }),
        row.marginPercent != null ? `${row.marginPercent.toFixed(2)}%` : "—",
        row.marginValue != null ? row.marginValue.toLocaleString("pt-BR", { minimumFractionDigits: 2 }) : "—",
        String(row.itemsCount),
        row.nfeDocument,
        row.externalSalesOrderCode,
      ].join(" | ")
    );
  }
  if (payload.rows.length > 120) {
    lines.push(`... (${payload.rows.length - 120} pedidos adicionais omitidos no PDF)`);
  }

  return buildMinimalPdfDocument({
    title: pdfSafeText(SALES_ORDER_LIST_REPORT_TITLE),
    lines: lines.map((line) => pdfSafeText(line)),
  });
}

export function buildSalesOrderListReportPeriodLabel(input: {
  year: number | null;
  month: number | null;
  startDate: Date | null;
  endDate: Date | null;
}): string {
  if (input.year && input.month) {
    return `${String(input.month).padStart(2, "0")}/${input.year}`;
  }
  if (input.year) return String(input.year);
  const parts: string[] = [];
  if (input.startDate) parts.push(`de ${formatDateBr(input.startDate.toISOString())}`);
  if (input.endDate) parts.push(`até ${formatDateBr(input.endDate.toISOString())}`);
  if (parts.length > 0) return parts.join(" ");
  return "Todos os períodos";
}

export function formatSalesOrderListReportIssueDate(
  value: Date | string | null | undefined
): string {
  if (!value) return "";
  const d = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(d.getTime())) return "";
  return d.toLocaleDateString("pt-BR");
}

export function formatSalesOrderListReportNfeDocument(
  nfeNumbers: string[] | null | undefined
): string {
  if (!nfeNumbers?.length) return "";
  return nfeNumbers.filter(Boolean).join(", ");
}
