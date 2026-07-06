import * as XLSX from "xlsx";
import type { CostCenterDetailExportPayload } from "./financeCostCenterDetailShared.js";
import { FINANCE_CC_DETAIL_EXPORT_TITLE } from "./financeCostCenterDetailExportMeta.js";

const TITLE_COLUMNS = [
  "AP",
  "Empresa",
  "Fornecedor",
  "CNPJ",
  "Classificação Nomus",
  "Descrição",
  "Documento",
  "Vencimento",
  "Competência",
  "Pagamento",
  "Status",
  "Valor",
  "Saldo",
  "Valor alocado",
  "% alocado",
  "Fonte alocação",
  "Locked manual",
  "Centro de custo",
  "Código centro de custo",
] as const;

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

function sourceLabel(source: string): string {
  switch (source) {
    case "AUTO_RULE":
      return "Auto rule";
    case "BATCH":
      return "Batch";
    case "MANUAL":
      return "Manual";
    default:
      return source;
  }
}

function mapTitleRow(row: CostCenterDetailExportPayload["rows"][number]) {
  return {
    AP: row.accountsPayableId,
    Empresa: row.companyName ?? "",
    Fornecedor: row.supplierName ?? row.personName ?? "",
    CNPJ: row.personCnpj ?? "",
    "Classificação Nomus": row.nomusClassification ?? "",
    Descrição: row.description ?? "",
    Documento: row.documentNumber ?? "",
    Vencimento: formatDateBr(row.dueDate),
    Competência: formatDateBr(row.competenceDate),
    Pagamento: formatDateBr(row.paymentDate ?? row.settlementDate),
    Status: row.statusLabel,
    Valor: row.amountPayable,
    Saldo: row.balancePayable,
    "Valor alocado": row.allocatedAmount,
    "% alocado": row.allocatedPercentage,
    "Fonte alocação": sourceLabel(row.allocationSource),
    "Locked manual": row.lockedManual ? "Sim" : "Não",
    "Centro de custo": row.costCenterName,
    "Código centro de custo": row.costCenterCode,
  };
}

function applyTitlesSheetFormatting(ws: XLSX.WorkSheet, headerRowIndex: number, lastRow: number) {
  const colCount = TITLE_COLUMNS.length;
  const lastCol = XLSX.utils.encode_col(colCount - 1);
  ws["!cols"] = [
    { wch: 8 },
    { wch: 16 },
    { wch: 22 },
    { wch: 16 },
    { wch: 14 },
    { wch: 28 },
    { wch: 14 },
    { wch: 12 },
    { wch: 12 },
    { wch: 12 },
    { wch: 12 },
    { wch: 12 },
    { wch: 12 },
    { wch: 12 },
    { wch: 10 },
    { wch: 12 },
    { wch: 10 },
    { wch: 20 },
    { wch: 18 },
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

export function buildCostCenterDetailExportWorkbook(
  payload: CostCenterDetailExportPayload
): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  const { summary, center } = payload;
  const generatedLabel = formatDateTimeBr(payload.generatedAt);

  const resumoRows = [
    { Campo: "Relatório", Valor: FINANCE_CC_DETAIL_EXPORT_TITLE },
    { Campo: "Centro de custo", Valor: center.name },
    { Campo: "Código", Valor: center.code },
    { Campo: "Centro pai", Valor: center.parentName ?? "—" },
    { Campo: "Gerado em", Valor: generatedLabel },
    { Campo: "Usuário", Valor: payload.userName ?? "—" },
    { Campo: "Total alocado", Valor: payload.totals.allocatedAmount },
    { Campo: "Pago/liquidado", Valor: summary.paidAmount },
    { Campo: "Vencido", Valor: summary.overdueAmount },
    { Campo: "A vencer", Valor: summary.upcomingAmount },
    { Campo: "Quantidade de títulos", Valor: summary.titlesCount },
    { Campo: "Média por título", Valor: summary.averageAllocatedPerTitle },
    { Campo: "Maior fornecedor", Valor: summary.topSupplierName ?? "—" },
    { Campo: "Maior classificação Nomus", Valor: summary.topNomusClassification ?? "—" },
    { Campo: "Total valor títulos", Valor: payload.totals.amountPayable },
    { Campo: "Total saldo em aberto", Valor: payload.totals.balancePayable },
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(resumoRows), "Resumo");

  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(
      payload.appliedFilters.map((line) => ({ Filtro: line.label, Valor: line.value }))
    ),
    "Filtros aplicados"
  );

  const titleObjects = payload.rows.map(mapTitleRow);
  const totalsRow = {
    AP: "Total",
    Empresa: "",
    Fornecedor: "",
    CNPJ: "",
    "Classificação Nomus": "",
    Descrição: "",
    Documento: "",
    Vencimento: "",
    Competência: "",
    Pagamento: "",
    Status: `${payload.rows.length} título(s)`,
    Valor: payload.totals.amountPayable,
    Saldo: payload.totals.balancePayable,
    "Valor alocado": payload.totals.allocatedAmount,
    "% alocado": "",
    "Fonte alocação": "",
    "Locked manual": "",
    "Centro de custo": "",
    "Código centro de custo": "",
  };
  titleObjects.push(totalsRow);

  const titlesSheet = XLSX.utils.json_to_sheet(titleObjects, { header: [...TITLE_COLUMNS] });
  const headerRowIndex = 1;
  const lastRow = titleObjects.length + headerRowIndex;
  applyTitlesSheetFormatting(titlesSheet, headerRowIndex, lastRow);
  XLSX.utils.book_append_sheet(wb, titlesSheet, "Títulos");

  return wb;
}

export function buildCostCenterDetailExportBuffer(payload: CostCenterDetailExportPayload): Buffer {
  const wb = buildCostCenterDetailExportWorkbook(payload);
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}
