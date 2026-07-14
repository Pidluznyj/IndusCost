/**
 * Exportação XLSX do Relatório Comercial > Pedidos de Venda.
 * Espelha o padrão de `financeAccountsReceivableTitlesExport.ts`.
 * Usa SheetJS (`xlsx`) para não introduzir nova dependência.
 */
import * as XLSX from "xlsx";
import {
  SALES_ORDER_REPORT_PRINT_DATA_SOURCE,
  SALES_ORDER_REPORT_PRINT_TITLE,
} from "./salesOrderReportPrintMeta.js";
import type {
  SalesOrderReportPayload,
  SalesOrderReportRow,
} from "./salesOrderReport.js";

function formatDateBr(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  return d.toLocaleDateString("pt-BR");
}

function formatDateTimeBr(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  return d.toLocaleString("pt-BR");
}

function nfeDocumentText(row: SalesOrderReportRow): string {
  if (!row.nfeNumbers.length) return "";
  return row.nfeNumbers.filter(Boolean).join(", ");
}

function mapReportRowToDetail(row: SalesOrderReportRow): Record<string, string | number> {
  // Ordem canônica das colunas do XLSX (2026-07). A coluna "Empresa"
  // (`row.companyName`) foi removida — só era populada a partir do
  // `nomusRawResponse` e aparecia vazia na maioria dos pedidos. O emissor
  // institucional continua no cabeçalho do relatório e no PDF.
  return {
    Cliente: row.customerName,
    "CNPJ/CPF": row.customerCnpj ?? "",
    Pedido: row.orderCode,
    "ID Nomus pedido": row.externalSalesOrderCode ?? "",
    "Data emissão": formatDateBr(row.issueDate),
    "Entrega prevista": formatDateBr(row.expectedDeliveryDate),
    "Vendedor pedido": row.sellerName,
    "ID Nomus vendedor": row.sellerExternalId ?? "",
    "Responsável comercial": row.commercialResponsibleName ?? "—",
    "Responsável operacional": row.operationalResponsibleName ?? "—",
    Faturamento: row.billingStatusLabel,
    "Status pedido": row.statusLabel,
    "Condição de pagamento": row.paymentConditionLabel,
    "Forma de pagamento": row.paymentMethodLabel,
    "Quantidade de itens": row.itemsCount,
    "Itens ativos": row.activeItemsCount,
    "Itens cancelados": row.canceledItemsCount,
    "Itens com corte": row.cutItemsCount,
    "Valor original": row.originalValue,
    "Valor cancelado": row.canceledValue,
    "Valor cortado": row.cutValue,
    "Valor ativo": row.activeValue,
    "Valor faturado": row.invoicedValue,
    "Saldo pendente ativo": row.pendingBalance,
    "NF emitida": row.hasInvoice ? "Sim" : "Não",
    "Qtde NF-e": row.nfeCount,
    "Última NF processada em": formatDateBr(row.lastNfeDate),
    "Documentos de saída/NF": nfeDocumentText(row),
    "Alertas principais": row.alertsSummary || "",
  };
}

function applyReportSheetFormatting(ws: XLSX.WorkSheet, rowCount: number, colCount: number) {
  const widths = [
    30, // Cliente (recebeu +2 dos 18 liberados pela remoção de "Empresa")
    18, // CNPJ/CPF
    14, // Pedido   (recebeu +2 dos 18 liberados)
    14, // ID Nomus pedido
    12, // Data emissão
    14, // Entrega prevista
    26, // Vendedor pedido
    14, // ID Nomus vendedor
    22, // Responsável comercial
    22, // Responsável operacional
    20, // Faturamento
    18, // Status pedido
    24, // Condição de pagamento
    18, // Forma de pagamento
    10, // Quantidade de itens
    10, // Itens ativos
    12, // Itens cancelados
    12, // Itens com corte
    14, // Valor original
    14, // Valor cancelado
    14, // Valor cortado
    14, // Valor ativo
    14, // Valor faturado
    16, // Saldo pendente ativo
    10, // NF emitida
    10, // Qtde NF-e
    18, // Última NF
    26, // Documentos NF
    32, // Alertas
  ];
  ws["!cols"] = widths.slice(0, colCount).map((wch) => ({ wch }));
  ws["!freeze"] = {
    xSplit: 0,
    ySplit: 1,
    topLeftCell: "A2",
    activePane: "bottomLeft",
    state: "frozen",
  };
  if (rowCount > 1) {
    const lastCol = XLSX.utils.encode_col(colCount - 1);
    ws["!autofilter"] = { ref: `A1:${lastCol}${rowCount}` };
  }
}

function applyMoneyFormatToDetailSheet(
  ws: XLSX.WorkSheet,
  headers: string[],
  rowCount: number
): void {
  const moneyColumns = new Set([
    "Valor original",
    "Valor cancelado",
    "Valor cortado",
    "Valor ativo",
    "Valor faturado",
    "Saldo pendente ativo",
  ]);
  const format = "R$ #,##0.00";
  headers.forEach((header, colIndex) => {
    if (!moneyColumns.has(header)) return;
    for (let r = 1; r < rowCount; r += 1) {
      const address = XLSX.utils.encode_cell({ r, c: colIndex });
      const cell = ws[address];
      if (cell && typeof cell.v === "number") {
        cell.t = "n";
        cell.z = format;
      }
    }
  });
}

export function buildSalesOrderReportExportWorkbook(
  payload: SalesOrderReportPayload
): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  const { summary } = payload;

  const resumoRows = [
    { Campo: "Relatório", Valor: SALES_ORDER_REPORT_PRINT_TITLE },
    { Campo: "Origem", Valor: SALES_ORDER_REPORT_PRINT_DATA_SOURCE },
    { Campo: "Gerado em", Valor: formatDateTimeBr(payload.generatedAt) },
    { Campo: "Emitido por", Valor: payload.emitterName?.trim() || "—" },
    { Campo: "Cliente", Valor: payload.filters.customerName ?? "Todos" },
    { Campo: "Qtd pedidos", Valor: summary.ordersCount },
    { Campo: "Qtd itens (total)", Valor: summary.totalItemsCount },
    { Campo: "Itens ativos", Valor: summary.activeItemsCount },
    { Campo: "Itens cancelados", Valor: summary.canceledItemsCount },
    { Campo: "Itens com corte", Valor: summary.cutItemsCount },
    { Campo: "Valor original total", Valor: summary.originalValue },
    { Campo: "Valor cancelado total", Valor: summary.canceledValue },
    { Campo: "Valor cortado total", Valor: summary.cutValue },
    { Campo: "Valor ativo total", Valor: summary.activeValue },
    { Campo: "Valor faturado total", Valor: summary.invoicedValue },
    { Campo: "Saldo pendente ativo", Valor: summary.pendingBalance },
    { Campo: "Ticket médio (ativo)", Valor: summary.averageTicket },
    { Campo: "Pedidos com NF", Valor: summary.invoicedCount },
    { Campo: "Pedidos sem NF", Valor: summary.notInvoicedCount },
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(resumoRows), "Resumo");

  const detailRows = payload.rows.map(mapReportRowToDetail);
  const detailSheet = XLSX.utils.json_to_sheet(detailRows);
  const headers = detailRows.length > 0 ? Object.keys(detailRows[0]!) : [];
  applyReportSheetFormatting(detailSheet, detailRows.length + 1, headers.length);
  applyMoneyFormatToDetailSheet(detailSheet, headers, detailRows.length + 1);
  XLSX.utils.book_append_sheet(wb, detailSheet, "Pedidos de venda");

  if (payload.filterLabels.length > 0) {
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(
        payload.filterLabels.map((line) => ({ Filtro: line.label, Valor: line.value }))
      ),
      "Filtros"
    );
  }

  return wb;
}

export function salesOrderReportWorkbookToBytes(workbook: XLSX.WorkBook): Uint8Array {
  const arr = XLSX.write(workbook, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
  return new Uint8Array(arr);
}

export function buildSalesOrderReportExportBuffer(payload: SalesOrderReportPayload): Buffer {
  const wb = buildSalesOrderReportExportWorkbook(payload);
  return Buffer.from(salesOrderReportWorkbookToBytes(wb));
}
