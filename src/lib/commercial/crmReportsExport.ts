/**
 * Exportação de CRM > Relatórios — CSV e XLSX (módulo puro, sem Prisma).
 *
 * Só FORMATA linhas já produzidas pelo MESMO pipeline da tela (mesmo spec de
 * filtros/visões): não há consulta paralela nem regra própria aqui.
 *
 * Todo arquivo carrega os metadados de rastreabilidade: data/hora, usuário,
 * escopo, filtros, clientes excluídos/selecionados, fonte (população
 * canônica de Pedido de Venda) e eixo de data (SalesOrder.issueDate, dia
 * civil local).
 *
 * CSV no padrão do repositório (BOM UTF-8, linhas `# ` de cabeçalho, `;`,
 * CRLF) com vírgula decimal — coerente com o `;` do Excel pt-BR.
 */

import * as XLSX from "xlsx";
import type {
  CrmReportsCustomerSelectionMode,
  CrmReportsUniverse,
} from "@/src/lib/commercial/crmReportsTypes.js";

export const CRM_REPORTS_EXPORT_FORMATS = ["csv", "xlsx"] as const;
export type CrmReportsExportFormat = (typeof CRM_REPORTS_EXPORT_FORMATS)[number];

export type CrmReportsExportColumnFormat =
  | "text"
  | "money"
  | "integer"
  | "date"
  | "days"
  | "decimal-days"
  | "boolean";

export type CrmReportsExportColumn = { key: string; label: string; format: CrmReportsExportColumnFormat };

export type CrmReportsExportValue = string | number | boolean | null;

export type CrmReportsExportTable = {
  columns: CrmReportsExportColumn[];
  rows: Array<Record<string, CrmReportsExportValue>>;
  /** Linha de total geral — depois das linhas, fora da contagem e do autofiltro. */
  footer?: Record<string, CrmReportsExportValue> | null;
};

export type CrmReportsExportMetadata = {
  title: string;
  generatedAt: Date;
  timeZone: string;
  userLabel: string;
  scopeLabel: string;
  filterLines: Array<{ label: string; value: string }>;
  selectionMode: CrmReportsCustomerSelectionMode;
  /** EXCLUDE: clientes ocultados; ONLY: clientes mantidos. */
  selectedCustomers: Array<{ id: string; label: string }>;
  source: string;
  dateAxis: string;
  repurchaseVersion: string;
  windowsLabel: string;
  universe: CrmReportsUniverse;
  notes: string[];
};

export function isCrmReportsExportFormat(value: unknown): value is CrmReportsExportFormat {
  return typeof value === "string" && (CRM_REPORTS_EXPORT_FORMATS as readonly string[]).includes(value);
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** dd/mm/aaaa HH:mm no fuso operacional do servidor (o mesmo das datas do relatório). */
export function formatCrmReportsExportTimestamp(date: Date): string {
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** YYYY-MM-DD → dd/mm/aaaa (dia civil, sem fuso). */
export function formatCrmReportsBusinessDate(value: string | null | undefined): string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return "";
  return `${value.slice(8, 10)}/${value.slice(5, 7)}/${value.slice(0, 4)}`;
}

function formatIsoDateTime(value: string): string {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : formatCrmReportsExportTimestamp(d);
}

function selectionLabel(mode: CrmReportsCustomerSelectionMode, count: number): string {
  if (mode === "EXCLUDE") return `Excluir selecionados (${count})`;
  if (mode === "ONLY") return `Somente selecionados (${count})`;
  return "Todos os clientes";
}

/** Linhas de metadados (as mesmas no CSV e na aba "Metadados" do XLSX). */
export function buildCrmReportsExportMetadataRows(
  meta: CrmReportsExportMetadata,
  rowCount: number
): Array<{ label: string; value: string }> {
  const u = meta.universe;
  return [
    { label: "Relatório", value: meta.title },
    { label: "Gerado em", value: `${formatCrmReportsExportTimestamp(meta.generatedAt)} (${meta.timeZone})` },
    { label: "Usuário", value: meta.userLabel },
    { label: "Escopo", value: meta.scopeLabel },
    { label: "Fonte", value: meta.source },
    { label: "Eixo de data", value: meta.dateAxis },
    { label: "Motor de recompra", value: meta.repurchaseVersion },
    { label: "Janelas", value: meta.windowsLabel },
    {
      label: "Universo",
      value: `permitido ${u.authorizedCustomers} · após filtros ${u.matchedBeforeExclusions} · ocultados ${u.manuallyExcluded} · analisados ${u.analyzedCustomers}`,
    },
    ...meta.filterLines.map((line) => ({ label: `Filtro — ${line.label}`, value: line.value })),
    { label: "Seleção de clientes", value: selectionLabel(meta.selectionMode, meta.selectedCustomers.length) },
    ...meta.notes.map((note) => ({ label: "Observação", value: note })),
    { label: "Linhas exportadas", value: String(rowCount) },
  ];
}

function csvEscape(value: string): string {
  return /[";\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** Proteção contra CSV formula injection — mesmo padrão da Tesouraria/Fornecedores. */
const CSV_FORMULA_RE = /^[=+\-@\t\r]/;

function neutralizeFormula(value: string): string {
  return CSV_FORMULA_RE.test(value) ? `'${value}` : value;
}

function decimalComma(value: number, digits: number): string {
  return value.toFixed(digits).replace(".", ",");
}

export function formatCrmReportsCsvCell(value: CrmReportsExportValue, format: CrmReportsExportColumnFormat): string {
  if (value == null || value === "") return "";
  switch (format) {
    case "money":
      return typeof value === "number" ? decimalComma(value, 2) : String(value);
    case "decimal-days":
      return typeof value === "number" ? decimalComma(value, 2) : String(value);
    case "integer":
    case "days":
      return typeof value === "number" ? String(Math.trunc(value)) : String(value);
    case "date":
      return typeof value === "string" && value.includes("T")
        ? formatIsoDateTime(value)
        : formatCrmReportsBusinessDate(String(value)) || String(value);
    case "boolean":
      return value === true ? "Sim" : value === false ? "Não" : String(value);
    default:
      // Texto livre (nome, fantasia, cidade…) vem do ERP: nunca vira fórmula no Excel.
      return neutralizeFormula(String(value));
  }
}

export function buildCrmReportsExportCsv(meta: CrmReportsExportMetadata, table: CrmReportsExportTable): string {
  const lines: string[] = [];
  for (const row of buildCrmReportsExportMetadataRows(meta, table.rows.length)) {
    lines.push(`# ${row.label}: ${row.value}`.replace(/[\r\n]+/g, " "));
  }
  if (meta.selectedCustomers.length > 0) {
    const label = meta.selectionMode === "ONLY" ? "Cliente selecionado" : "Cliente excluído";
    for (const customer of meta.selectedCustomers) lines.push(`# ${label}: ${customer.label} (${customer.id})`);
  }
  lines.push("");
  lines.push(table.columns.map((c) => csvEscape(c.label)).join(";"));
  for (const row of table.footer ? [...table.rows, table.footer] : table.rows) {
    lines.push(table.columns.map((c) => csvEscape(formatCrmReportsCsvCell(row[c.key] ?? null, c.format))).join(";"));
  }
  return `\uFEFF${lines.join("\r\n")}`;
}

function xlsxCellValue(value: CrmReportsExportValue, format: CrmReportsExportColumnFormat): string | number | null {
  if (value == null || value === "") return null;
  if (format === "date") {
    return typeof value === "string" && value.includes("T")
      ? formatIsoDateTime(value)
      : formatCrmReportsBusinessDate(String(value)) || String(value);
  }
  if (format === "boolean") return value === true ? "Sim" : value === false ? "Não" : String(value);
  if (typeof value === "number") return value;
  return String(value);
}

const XLSX_NUMBER_FORMATS: Partial<Record<CrmReportsExportColumnFormat, string>> = {
  money: "#,##0.00",
  "decimal-days": "0.00",
  integer: "0",
  days: "0",
};

export function buildCrmReportsExportWorkbook(
  meta: CrmReportsExportMetadata,
  table: CrmReportsExportTable
): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();

  const aoa: Array<Array<string | number | null>> = [table.columns.map((c) => c.label)];
  for (const row of table.footer ? [...table.rows, table.footer] : table.rows) {
    aoa.push(table.columns.map((c) => xlsxCellValue(row[c.key] ?? null, c.format)));
  }
  const sheet = XLSX.utils.aoa_to_sheet(aoa);
  table.columns.forEach((column, colIndex) => {
    const numberFormat = XLSX_NUMBER_FORMATS[column.format];
    if (!numberFormat) return;
    for (let r = 1; r < aoa.length; r += 1) {
      const cell = sheet[XLSX.utils.encode_cell({ r, c: colIndex })];
      if (cell && cell.t === "n") cell.z = numberFormat;
    }
  });
  sheet["!cols"] = table.columns.map((c) => ({ wch: Math.min(Math.max(c.label.length + 2, c.format === "text" ? 24 : 12), 48) }));
  if (table.rows.length > 0) {
    // Só cabeçalho + linhas de dados: o total geral fica fora do filtro.
    sheet["!autofilter"] = {
      ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: table.rows.length, c: table.columns.length - 1 } }),
    };
  }
  XLSX.utils.book_append_sheet(wb, sheet, "Relatório");

  const metaRows = buildCrmReportsExportMetadataRows(meta, table.rows.length).map((row) => ({
    Campo: row.label,
    Valor: row.value,
  }));
  const metaSheet = XLSX.utils.json_to_sheet(metaRows);
  metaSheet["!cols"] = [{ wch: 28 }, { wch: 110 }];
  XLSX.utils.book_append_sheet(wb, metaSheet, "Metadados");

  if (meta.selectedCustomers.length > 0) {
    const selectedSheet = XLSX.utils.json_to_sheet(
      meta.selectedCustomers.map((customer) => ({ Cliente: customer.label, ID: customer.id }))
    );
    selectedSheet["!cols"] = [{ wch: 48 }, { wch: 40 }];
    XLSX.utils.book_append_sheet(
      wb,
      selectedSheet,
      meta.selectionMode === "ONLY" ? "Clientes selecionados" : "Clientes excluídos"
    );
  }
  return wb;
}

export function crmReportsWorkbookToBytes(workbook: XLSX.WorkBook): Uint8Array {
  const arr = XLSX.write(workbook, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
  return new Uint8Array(arr);
}

/** Nome do arquivo: `crm-relatorio-<slug>-AAAAMMDD-HHmm.<ext>`. */
export function crmReportsExportFilename(slug: string, format: CrmReportsExportFormat, generatedAt: Date): string {
  const stamp = `${generatedAt.getFullYear()}${pad(generatedAt.getMonth() + 1)}${pad(generatedAt.getDate())}-${pad(generatedAt.getHours())}${pad(generatedAt.getMinutes())}`;
  const safe = slug.replace(/[^a-z0-9-]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase() || "relatorio";
  return `crm-relatorio-${safe}-${stamp}.${format}`;
}
