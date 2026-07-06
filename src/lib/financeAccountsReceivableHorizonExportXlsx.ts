import * as XLSX from "xlsx";
import { formatFinanceCalculatedStatus } from "./financeAccountsReceivableFormat.js";
import type { FinanceArHorizonExportPayload } from "./financeAccountsReceivableHorizonExport.js";

export const FINANCE_AR_HORIZON_EXPORT_TITLE = "Contas a Receber — Horizonte financeiro";

function formatDateBr(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("pt-BR");
}

function formatDateTimeBr(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("pt-BR");
}

function originLabel(origin: string): string {
  return origin === "WITH_NFE" ? "Com NF" : "Sem NF";
}

export function sanitizeArHorizonExportSlug(label: string): string {
  return label
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "faixa";
}

export function buildFinanceArHorizonExportFilename(
  bucketLabel: string,
  referenceDate = new Date()
): string {
  const slug = sanitizeArHorizonExportSlug(bucketLabel);
  const year = referenceDate.getFullYear();
  return `contas-a-receber-horizonte-${slug}-${year}.xlsx`;
}

const TITLE_COLUMNS = [
  "Faixa",
  "Cliente",
  "Empresa",
  "Documento",
  "Pedido/NF",
  "Vencimento",
  "Dias",
  "Valor a receber",
  "Saldo",
  "Status",
  "Descrição do lançamento",
  "Origem",
] as const;

function applyTitlesSheetFormatting(ws: XLSX.WorkSheet, headerRowIndex: number, lastRow: number) {
  const lastCol = XLSX.utils.encode_col(TITLE_COLUMNS.length - 1);
  ws["!cols"] = [
    { wch: 14 },
    { wch: 22 },
    { wch: 16 },
    { wch: 14 },
    { wch: 14 },
    { wch: 12 },
    { wch: 8 },
    { wch: 14 },
    { wch: 14 },
    { wch: 12 },
    { wch: 28 },
    { wch: 10 },
  ];
  ws["!freeze"] = {
    xSplit: 0,
    ySplit: headerRowIndex,
    topLeftCell: `A${headerRowIndex + 1}`,
    activePane: "bottomLeft",
    state: "frozen",
  };
  ws["!autofilter"] = { ref: `A${headerRowIndex}:${lastCol}${lastRow}` };
}

function mapTitleRow(row: FinanceArHorizonExportPayload["items"][number], includeBucket: boolean) {
  const base = {
    Cliente: row.personName ?? "",
    Empresa: row.companyName ?? "",
    Documento: row.sourceInvoiceNumber ?? (row.sourceInvoiceId != null ? String(row.sourceInvoiceId) : ""),
    "Pedido/NF": row.sourceInvoiceNumber ?? "",
    Vencimento: formatDateBr(row.dueDate),
    Dias: row.daysOverdue,
    "Valor a receber": row.amountReceivable,
    Saldo: row.balanceReceivable,
    Status: formatFinanceCalculatedStatus(row.calculatedStatus),
    "Descrição do lançamento": row.description ?? "",
    Origem: originLabel(row.origin),
  };
  if (includeBucket) {
    return { Faixa: row.bucketLabel ?? "", ...base };
  }
  return base;
}

export function buildFinanceArHorizonExportWorkbook(payload: FinanceArHorizonExportPayload): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  const { summary, horizon } = payload;
  const bucketLabel =
    payload.scope === "full" ? "Todas as faixas" : (payload.bucket?.label ?? "—");

  const resumoRows = [
    { Campo: "Relatório", Valor: FINANCE_AR_HORIZON_EXPORT_TITLE },
    { Campo: "Faixa selecionada", Valor: bucketLabel },
    { Campo: "Data-base operacional", Valor: formatDateBr(horizon.today) },
    { Campo: "Gerado em", Valor: formatDateTimeBr(payload.generatedAt) },
    { Campo: "Usuário", Valor: payload.userName ?? "—" },
    { Campo: "Valor total da faixa", Valor: summary.totalOpenBalance },
    { Campo: "Quantidade de títulos", Valor: summary.titlesCount },
    { Campo: "Valor vencido", Valor: summary.overdueAmount },
    { Campo: "Valor a vencer", Valor: summary.upcomingAmount },
    { Campo: "Maior cliente", Valor: summary.topCustomerName ?? "—" },
    { Campo: "Maior título", Valor: summary.maxTitleAmount },
    { Campo: "Ticket médio", Valor: summary.averageTicket },
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(resumoRows), "Resumo");

  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(
      payload.appliedFilters.map((line) => ({ Filtro: line.label, Valor: line.value }))
    ),
    "Filtros aplicados"
  );

  if (payload.scope === "full") {
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(
        payload.bucketSummaries.map((bucket) => ({
          Faixa: bucket.label,
          "Qtd. títulos": bucket.titlesCount,
          Valor: bucket.amount,
        }))
      ),
      "Resumo por faixa"
    );
  }

  const includeBucket = payload.scope === "full";
  const titleObjects = payload.items.map((row) => mapTitleRow(row, includeBucket));
  const columns = includeBucket ? [...TITLE_COLUMNS] : TITLE_COLUMNS.filter((c) => c !== "Faixa");

  titleObjects.push({
    ...(includeBucket ? { Faixa: "Total" } : {}),
    Cliente: "",
    Empresa: "",
    Documento: "",
    "Pedido/NF": "",
    Vencimento: "",
    Dias: `${summary.titlesCount} título(s)`,
    "Valor a receber": summary.totalOpenBalance,
    Saldo: summary.totalOpenBalance,
    Status: "",
    "Descrição do lançamento": "",
    Origem: "",
  } as Record<string, string | number>);

  const titlesSheet = XLSX.utils.json_to_sheet(titleObjects, { header: [...columns] });
  const headerRowIndex = 1;
  const lastRow = titleObjects.length + headerRowIndex;
  applyTitlesSheetFormatting(titlesSheet, headerRowIndex, lastRow);
  XLSX.utils.book_append_sheet(wb, titlesSheet, "Títulos");

  return wb;
}

export function buildFinanceArHorizonExportBuffer(payload: FinanceArHorizonExportPayload): Buffer {
  const wb = buildFinanceArHorizonExportWorkbook(payload);
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}
