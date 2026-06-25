import * as XLSX from "xlsx";
import { formatFinanceCalculatedStatus } from "./financeAccountsReceivableFormat.js";
import { formatCivilDate } from "./financeCivilDate.js";
import type { FinanceCashFlowDailyRadarExportPayload } from "./financeCashFlowDailyRadarExport.js";

export const FINANCE_CASH_FLOW_DAILY_RADAR_EXPORT_TITLE =
  "Fluxo de Caixa — Radar Diário de Caixa";

function formatDateBr(iso: string | null | undefined): string {
  return formatCivilDate(iso);
}

function formatDateTimeBr(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("pt-BR");
}

export function sanitizeDailyRadarExportSlug(label: string): string {
  return (
    label
      .normalize("NFD")
      .replace(/\p{M}/gu, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "faixa"
  );
}

export function buildFinanceCashFlowDailyRadarExportFilename(
  payload: Pick<FinanceCashFlowDailyRadarExportPayload, "level" | "rangeLabel" | "selectedDate">
): string {
  if (payload.level === "day" && payload.selectedDate) {
    const [year, month, day] = payload.selectedDate.split("-");
    if (year && month && day) {
      return `fluxo-caixa-radar-${day}-${month}-${year}.xlsx`;
    }
  }
  return `fluxo-caixa-radar-${sanitizeDailyRadarExportSlug(payload.rangeLabel)}.xlsx`;
}

const PAYABLE_COLUMNS = [
  "Fornecedor",
  "Empresa",
  "Descrição",
  "Documento",
  "Vencimento",
  "Valor",
  "Status",
  "Agendado",
  "Forma de pagamento",
] as const;

const RECEIVABLE_COLUMNS = [
  "Cliente",
  "Empresa",
  "Pedido/NF",
  "Descrição",
  "Vencimento",
  "Valor",
  "Status",
  "Origem",
] as const;

function applyGridSheetFormatting(
  ws: XLSX.WorkSheet,
  columnCount: number,
  headerRowIndex: number,
  lastRow: number
) {
  const lastCol = XLSX.utils.encode_col(columnCount - 1);
  ws["!freeze"] = {
    xSplit: 0,
    ySplit: headerRowIndex,
    topLeftCell: `A${headerRowIndex + 1}`,
    activePane: "bottomLeft",
    state: "frozen",
  };
  ws["!autofilter"] = { ref: `A${headerRowIndex}:${lastCol}${lastRow}` };
}

function mapPayableRow(row: FinanceCashFlowDailyRadarExportPayload["payables"]["rows"][number]) {
  return {
    Fornecedor: row.supplier ?? "",
    Empresa: row.company ?? "",
    Descrição: row.description ?? "",
    Documento: row.document ?? "",
    Vencimento: formatDateBr(row.operationalDate),
    Valor: row.amount,
    Status: formatFinanceCalculatedStatus(row.status),
    Agendado: row.rescheduled ? "Sim" : "—",
    "Forma de pagamento": row.paymentMethod ?? "",
  };
}

function mapReceivableRow(
  row: FinanceCashFlowDailyRadarExportPayload["receivables"]["rows"][number]
) {
  return {
    Cliente: row.customer ?? "",
    Empresa: row.company ?? "",
    "Pedido/NF": row.document ?? "",
    Descrição: row.description ?? "",
    Vencimento: formatDateBr(row.operationalDate),
    Valor: row.amount,
    Status: formatFinanceCalculatedStatus(row.status),
    Origem: row.invoiceIssued ? "Com NF" : "Sem NF",
  };
}

function appendSummaryMetric(
  rows: Array<{ Campo: string; Valor: string | number }>,
  prefix: string,
  summary: FinanceCashFlowDailyRadarExportPayload["payables"]["summary"]
) {
  rows.push(
    { Campo: `${prefix} — Quantidade de títulos`, Valor: summary.count },
    { Campo: `${prefix} — Total`, Valor: summary.total },
    { Campo: `${prefix} — Vencido`, Valor: summary.overdueTotal },
    { Campo: `${prefix} — A vencer`, Valor: summary.upcomingTotal },
    { Campo: `${prefix} — Maior título`, Valor: summary.maxAmount },
    { Campo: `${prefix} — Ticket médio`, Valor: summary.averageAmount }
  );
}

export function buildFinanceCashFlowDailyRadarExportWorkbook(
  payload: FinanceCashFlowDailyRadarExportPayload
): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  const dayLabel = payload.selectedDate
    ? formatDateBr(payload.selectedDate)
    : "Todos os dias da faixa";

  const resumoRows: Array<{ Campo: string; Valor: string | number }> = [
    { Campo: "Relatório", Valor: FINANCE_CASH_FLOW_DAILY_RADAR_EXPORT_TITLE },
    { Campo: "Faixa selecionada", Valor: payload.rangeLabel },
    { Campo: "Dia selecionado", Valor: dayLabel },
    { Campo: "Data-base operacional", Valor: formatDateBr(payload.operationalBaseDate) },
    { Campo: "Gerado em", Valor: formatDateTimeBr(payload.generatedAt) },
    { Campo: "Usuário", Valor: payload.userName ?? "—" },
    { Campo: "", Valor: "" },
    { Campo: "Filtros aplicados", Valor: "" },
    ...payload.appliedFilters.map((line) => ({ Campo: line.label, Valor: line.value })),
    { Campo: "", Valor: "" },
    { Campo: "Entradas", Valor: payload.entriesTotal },
    { Campo: "Saídas", Valor: payload.exitsTotal },
    { Campo: "Saldo líquido", Valor: payload.netTotal },
    { Campo: "Quantidade de contas a receber", Valor: payload.receivableCount },
    { Campo: "Quantidade de contas a pagar", Valor: payload.payableCount },
    { Campo: "", Valor: "" },
  ];

  appendSummaryMetric(resumoRows, "Contas a Pagar", payload.payables.summary);
  resumoRows.push({ Campo: "", Valor: "" });
  appendSummaryMetric(resumoRows, "Contas a Receber", payload.receivables.summary);

  if (payload.level === "range" && payload.daySummaries.length > 0) {
    resumoRows.push({ Campo: "", Valor: "" });
    resumoRows.push({ Campo: "Resumo diário da faixa", Valor: "" });
    for (const day of payload.daySummaries) {
      resumoRows.push(
        { Campo: `Dia ${formatDateBr(day.date)}`, Valor: day.weekday },
        { Campo: "  Entradas", Valor: day.receivableTotal },
        { Campo: "  Saídas", Valor: day.payableTotal },
        { Campo: "  Saldo", Valor: day.netTotal },
        { Campo: "  Qtd. AR", Valor: day.receivableCount },
        { Campo: "  Qtd. AP", Valor: day.payableCount }
      );
    }
  }

  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(resumoRows), "Resumo");

  const payableObjects = payload.payables.rows.map(mapPayableRow);
  payableObjects.push({
    Fornecedor: `Total (${payload.payables.summary.count} título(s))`,
    Empresa: "",
    Descrição: "",
    Documento: "",
    Vencimento: "",
    Valor: payload.payables.summary.total,
    Status: "",
    Agendado: "",
    "Forma de pagamento": "",
  });
  const payableSheet = XLSX.utils.json_to_sheet(payableObjects, { header: [...PAYABLE_COLUMNS] });
  payableSheet["!cols"] = [
    { wch: 22 },
    { wch: 16 },
    { wch: 28 },
    { wch: 14 },
    { wch: 12 },
    { wch: 14 },
    { wch: 12 },
    { wch: 10 },
    { wch: 16 },
  ];
  const payableHeaderRow = 1;
  applyGridSheetFormatting(
    payableSheet,
    PAYABLE_COLUMNS.length,
    payableHeaderRow,
    payableObjects.length + payableHeaderRow
  );
  XLSX.utils.book_append_sheet(wb, payableSheet, "Contas a Pagar");

  const receivableObjects = payload.receivables.rows.map(mapReceivableRow);
  receivableObjects.push({
    Cliente: `Total (${payload.receivables.summary.count} título(s))`,
    Empresa: "",
    "Pedido/NF": "",
    Descrição: "",
    Vencimento: "",
    Valor: payload.receivables.summary.total,
    Status: "",
    Origem: "",
  });
  const receivableSheet = XLSX.utils.json_to_sheet(receivableObjects, {
    header: [...RECEIVABLE_COLUMNS],
  });
  receivableSheet["!cols"] = [
    { wch: 22 },
    { wch: 16 },
    { wch: 14 },
    { wch: 28 },
    { wch: 12 },
    { wch: 14 },
    { wch: 12 },
    { wch: 10 },
  ];
  const receivableHeaderRow = 1;
  applyGridSheetFormatting(
    receivableSheet,
    RECEIVABLE_COLUMNS.length,
    receivableHeaderRow,
    receivableObjects.length + receivableHeaderRow
  );
  XLSX.utils.book_append_sheet(wb, receivableSheet, "Contas a Receber");

  return wb;
}

export function buildFinanceCashFlowDailyRadarExportBuffer(
  payload: FinanceCashFlowDailyRadarExportPayload
): Buffer {
  const wb = buildFinanceCashFlowDailyRadarExportWorkbook(payload);
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}
