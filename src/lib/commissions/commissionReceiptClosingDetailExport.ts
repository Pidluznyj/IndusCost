import * as XLSX from "xlsx";
import type { ReceiptClosingApiLine, ReceiptClosingPagePayload } from "./commissionReceiptClosingApi.js";

export const RECEIPT_CLOSING_DETAIL_EXPORT_TITLE =
  "Fechamento por recebimento — detalhamento da prévia";

const DETAIL_COLUMNS = [
  "CR",
  "NF",
  "Pedido",
  "Cliente",
  "Vendedor Raw",
  "Vendedor Canônico",
  "Data de recebimento",
  "Valor recebido",
  "Schedule Comissão",
  "Comissão liberada",
  "Status",
  "Motivo",
  "Cliente excluído?",
  "Vendedor resolvido?",
  "ID interno do título",
  "ID externo/Nomus",
  "Data de vencimento",
  "Data de baixa/recebimento",
  "Parcela",
  "Origem do dado",
] as const;

function formatDateBr(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("pt-BR");
}

function formatCurrencyBr(value: number): string {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function formatCustomerExcluded(line: ReceiptClosingApiLine): string {
  if (line.status === "GROUP_COMPANY_EXCLUDED") return "Empresa do grupo";
  return line.status === "CUSTOMER_EXCLUDED" || line.exclusionReason != null ? "Sim" : "Não";
}

function formatSellerResolved(line: ReceiptClosingApiLine): string {
  if (line.sellerResolutionStatus === "NO_SELLER" || line.sellerResolutionStatus === "SELLER_UNRESOLVED") {
    return "Não";
  }
  if (line.canonicalSellerId != null || line.canonicalSellerName != null) return "Sim";
  return "Não";
}

function sourceLabel(source: string): string {
  switch (source) {
    case "MATERIALIZED_SCHEDULE":
      return "Schedule materializado";
    case "PERSISTED_SCHEDULE":
      return "Schedule persistido";
    case "PERSISTED_LEDGER":
      return "Ledger fechado";
    case "CALCULATED":
      return "Calculado";
    case "EXCEPTION":
      return "Exceção";
    default:
      return source;
  }
}

function mapDetailRow(line: ReceiptClosingApiLine) {
  const receivedDisplay =
    line.uniqueReceivedAmount > 0 ? formatCurrencyBr(line.uniqueReceivedAmount) : "";
  return {
    CR: line.receivableNumber ?? (line.nomusReceivableId != null ? String(line.nomusReceivableId) : ""),
    NF: line.nfeNumber ?? "",
    Pedido: line.orderCode ?? "",
    Cliente: line.customerName ?? "",
    "Vendedor Raw": line.rawSellerName ?? "",
    "Vendedor Canônico": line.canonicalSellerName ?? "",
    "Data de recebimento": formatDateBr(line.settlementDate),
    "Valor recebido": receivedDisplay,
    "Schedule Comissão":
      line.scheduledCommissionAmount != null
        ? formatCurrencyBr(line.scheduledCommissionAmount)
        : "",
    "Comissão liberada": formatCurrencyBr(line.releasedCommissionAmount),
    Status: line.status,
    Motivo: line.statusReason ?? "",
    "Cliente excluído?": formatCustomerExcluded(line),
    "Vendedor resolvido?": formatSellerResolved(line),
    "ID interno do título": line.lineKey,
    "ID externo/Nomus": line.nomusReceivableId != null ? String(line.nomusReceivableId) : "",
    "Data de vencimento": formatDateBr(line.dueDate),
    "Data de baixa/recebimento": formatDateBr(line.settlementDate),
    Parcela: line.installmentNumber != null ? String(line.installmentNumber) : "",
    "Origem do dado": sourceLabel(line.source),
  };
}

function buildResumoRows(payload: ReceiptClosingPagePayload) {
  const { year, month, cards, materializationSummary } = payload;
  return [
    { Campo: "Relatório", Valor: RECEIPT_CLOSING_DETAIL_EXPORT_TITLE },
    { Campo: "Ano", Valor: year },
    { Campo: "Mês", Valor: month },
    {
      Campo: "Total de títulos recebidos",
      Valor: materializationSummary.totalReceivablesCount,
    },
    { Campo: "Com schedule", Valor: materializationSummary.receivablesWithScheduleCount },
    { Campo: "Sem schedule", Valor: materializationSummary.receivablesWithoutScheduleCount },
    { Campo: "Clientes excluídos", Valor: materializationSummary.excludedCustomerCount },
    {
      Campo: "Empresas do grupo excluídas",
      Valor: materializationSummary.groupCompanyExcludedCount,
    },
    {
      Campo: "Recebido empresas do grupo (auditoria)",
      Valor: formatCurrencyBr(materializationSummary.groupCompanyExcludedReceivedAmount),
    },
    { Campo: "Vendedor não resolvido", Valor: materializationSummary.sellerUnresolvedCount },
    { Campo: "Total recebido no mês", Valor: formatCurrencyBr(cards.totalReceivedAmount) },
    { Campo: "Recebido com schedule", Valor: formatCurrencyBr(cards.receivedWithScheduleAmount) },
    { Campo: "Recebido sem schedule", Valor: formatCurrencyBr(cards.receivedWithoutScheduleAmount) },
    { Campo: "Base comissionável", Valor: formatCurrencyBr(cards.commissionableBaseAmount) },
    { Campo: "Comissão bruta", Valor: formatCurrencyBr(cards.grossCommissionAmount) },
    { Campo: "Comissão excluída", Valor: formatCurrencyBr(cards.excludedCommissionAmount) },
    { Campo: "Comissão final a pagar", Valor: formatCurrencyBr(cards.finalCommissionAmount) },
  ];
}

function applyDetailSheetFormatting(ws: XLSX.WorkSheet, headerRowIndex: number, lastRow: number) {
  const colCount = DETAIL_COLUMNS.length;
  const lastCol = XLSX.utils.encode_col(colCount - 1);
  ws["!cols"] = [
    { wch: 12 },
    { wch: 10 },
    { wch: 12 },
    { wch: 24 },
    { wch: 18 },
    { wch: 20 },
    { wch: 14 },
    { wch: 16 },
    { wch: 16 },
    { wch: 16 },
    { wch: 18 },
    { wch: 28 },
    { wch: 14 },
    { wch: 14 },
    { wch: 36 },
    { wch: 14 },
    { wch: 14 },
    { wch: 18 },
    { wch: 8 },
    { wch: 20 },
  ];
  ws["!freeze"] = {
    xSplit: 0,
    ySplit: headerRowIndex,
    topLeftCell: `A${headerRowIndex + 1}`,
    activePane: "bottomLeft",
    state: "frozen",
  };
  ws["!autofilter"] = {
    ref: `A${headerRowIndex}:${lastCol}${lastRow}`,
  };
}

export function buildReceiptClosingDetailExportFilename(
  year: number,
  month: number,
  exportMode: "PREVIEW" | "CLOSED" | "NONE"
): string {
  const mm = String(month).padStart(2, "0");
  const suffix = exportMode === "CLOSED" ? "fechado" : "previa";
  return `commission-receipt-closing-detalhamento-${year}-${mm}-${suffix}.xlsx`;
}

export function buildReceiptClosingDetailExportWorkbook(
  payload: ReceiptClosingPagePayload
): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(buildResumoRows(payload)),
    "Resumo"
  );

  const detailObjects = payload.lines.map(mapDetailRow);
  const detailSheet = XLSX.utils.json_to_sheet(detailObjects, { header: [...DETAIL_COLUMNS] });
  const headerRowIndex = 1;
  const lastRow = detailObjects.length + headerRowIndex;
  applyDetailSheetFormatting(detailSheet, headerRowIndex, lastRow);
  XLSX.utils.book_append_sheet(wb, detailSheet, "Detalhamento");

  return wb;
}

export function buildReceiptClosingDetailExportBuffer(payload: ReceiptClosingPagePayload): Buffer {
  const wb = buildReceiptClosingDetailExportWorkbook(payload);
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}
