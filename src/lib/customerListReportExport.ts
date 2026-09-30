/**
 * Exportação Comercial > Clientes — XLSX (sem Prisma) e payload do PDF institucional.
 */
import * as XLSX from "xlsx";
import { buildMinimalPdfDocument } from "./minimalPdfWriter.js";
import { formatCustomerLastPurchaseMonth, type CustomerLastPurchaseStatus } from "./commercial/customerLastPurchase.js";
import {
  CUSTOMER_CNPJ_RISK_NO_LOOKUP_LABEL,
  formatCustomerCnpjRiskTagLabel,
  type CustomerCnpjRiskSummary,
} from "./customerCnpjRiskSummary.js";
import {
  formatCustomerCadastralStatus,
  isCustomerSalesBlockIdentityUnresolved,
  type CustomerSalesBlockPublic,
} from "./commercial/customerSalesBlockView.js";
import {
  CUSTOMER_LIST_REPORT_CLASSIFICATION,
  CUSTOMER_LIST_REPORT_PRINT_NOTICE,
  type CustomerListReportCopyControl,
} from "./customerListReportPrintMeta.js";

export const CUSTOMER_LIST_REPORT_TITLE = "Relatório de Clientes";
export const CUSTOMER_LIST_REPORT_SOURCE = "Comercial > Clientes";
export const CUSTOMER_LIST_EXPORT_MAX = 8_000;
export const CUSTOMER_LIST_PDF_MAX_ROWS = 40;
export const CUSTOMER_LIST_EXPORT_OWNER_EMPTY_LABEL = "Sem responsável";
export const CUSTOMER_LIST_EXPORT_OWNER_ALL_LABEL = "Todos os responsáveis";
export const CUSTOMER_LIST_EXPORT_SEARCH_ALL_LABEL = "Todos";
export const CUSTOMER_LIST_EXPORT_NO_SEGMENT_LABEL = "Sem segmento";

export type CustomerListReportExportRow = {
  companyName: string;
  tradeName: string;
  taxId: string;
  cnpjScore: string;
  commercialOwnerName: string;
  /** Competência "MM/AAAA" da última compra válida, "Nunca" ou "—" (NF sem data utilizável). */
  lastPurchase: string;
  city: string;
  state: string;
  segment: string;
  status: string;
  salesBlock: string;
};

export type CustomerListReportExportSummary = {
  customersCount: number;
  exportedCount: number;
  truncated: boolean;
  withCnpjScoreCount: number;
  withoutCnpjScoreCount: number;
  salesBlockedCount: number;
  activeCount: number;
};

export type CustomerListReportExportPayload = {
  generatedAt: string;
  appliedFilters: Array<{ label: string; value: string }>;
  summary: CustomerListReportExportSummary;
  rows: CustomerListReportExportRow[];
  copyControl: CustomerListReportCopyControl;
};

export function formatCustomerListExportCnpjScore(
  risk: CustomerCnpjRiskSummary | null | undefined
): string {
  if (!risk) return CUSTOMER_CNPJ_RISK_NO_LOOKUP_LABEL;
  const label = formatCustomerCnpjRiskTagLabel(risk);
  return risk.expired ? `${label} (consulta vencida)` : label;
}

export function formatCustomerListExportOwner(name: string | null | undefined): string {
  const trimmed = name?.trim();
  return trimmed ? trimmed : CUSTOMER_LIST_EXPORT_OWNER_EMPTY_LABEL;
}

export function formatCustomerListExportSalesBlock(
  block: Pick<CustomerSalesBlockPublic, "blocked" | "reason"> | null | undefined
): string {
  if (!block?.blocked) return "";
  if (isCustomerSalesBlockIdentityUnresolved(block)) {
    return "Venda bloqueada — identidade financeira não validada";
  }
  return "Venda bloqueada";
}

export function formatCustomerListExportSegment(segment: string | null | undefined): string {
  const trimmed = segment?.trim();
  return trimmed ? trimmed : CUSTOMER_LIST_EXPORT_NO_SEGMENT_LABEL;
}

export function resolveCustomerListExportOwnerFilterLabel(input: {
  ownerKey: string;
  options: Array<{ key: string; name: string }>;
}): string {
  const key = input.ownerKey.trim();
  if (!key) return CUSTOMER_LIST_EXPORT_OWNER_ALL_LABEL;
  if (key === "none") return CUSTOMER_LIST_EXPORT_OWNER_EMPTY_LABEL;
  return input.options.find((option) => option.key === key)?.name.trim() || key;
}

export function buildCustomerListReportAppliedFilters(input: {
  search: string;
  ownerKey: string;
  ownerOptions: Array<{ key: string; name: string }>;
}): Array<{ label: string; value: string }> {
  return [
    { label: "Busca", value: input.search.trim() || CUSTOMER_LIST_EXPORT_SEARCH_ALL_LABEL },
    {
      label: "Responsável comercial",
      value: resolveCustomerListExportOwnerFilterLabel({
        ownerKey: input.ownerKey,
        options: input.ownerOptions,
      }),
    },
  ];
}

export function mapCustomerListReportExportRow(input: {
  companyName?: string | null;
  tradeName?: string | null;
  taxId?: string | null;
  city?: string | null;
  state?: string | null;
  segment?: string | null;
  status?: string | null;
  commercialOwnerName?: string | null;
  lastPurchaseAt?: string | null;
  lastPurchaseStatus?: CustomerLastPurchaseStatus | null;
  cnpjRisk?: CustomerCnpjRiskSummary | null;
  salesBlock?: Pick<CustomerSalesBlockPublic, "blocked" | "reason"> | null;
}): CustomerListReportExportRow {
  return {
    companyName: input.companyName?.trim() || "—",
    tradeName: input.tradeName?.trim() || "—",
    taxId: input.taxId?.trim() || "—",
    cnpjScore: formatCustomerListExportCnpjScore(input.cnpjRisk),
    commercialOwnerName: formatCustomerListExportOwner(input.commercialOwnerName),
    // Sem regra fiscal aqui: a data já vem resolvida pelo motor da rotina de 90 dias.
    lastPurchase: formatCustomerLastPurchaseMonth({
      lastPurchaseAt: input.lastPurchaseAt ?? null,
      lastPurchaseStatus: input.lastPurchaseStatus ?? (input.lastPurchaseAt ? "VALID" : "NEVER_INVOICED"),
    }),
    city: input.city?.trim() || "—",
    state: input.state?.trim() || "—",
    segment: formatCustomerListExportSegment(input.segment),
    status: formatCustomerCadastralStatus(input.status),
    salesBlock: formatCustomerListExportSalesBlock(input.salesBlock),
  };
}

function formatDateTimeBr(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("pt-BR");
}

function pdfSafeText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x20-\x7E]/g, "?");
}

function mapSheetRow(row: CustomerListReportExportRow): Record<string, string> {
  return {
    "Razão social": row.companyName,
    "Nome fantasia": row.tradeName,
    CNPJ: row.taxId,
    "Score CNPJ": row.cnpjScore,
    "Responsável comercial": row.commercialOwnerName,
    "Última compra": row.lastPurchase,
    Cidade: row.city,
    UF: row.state,
    Segmento: row.segment,
    Status: row.status,
    "Bloqueio de venda": row.salesBlock,
  };
}

function applyClientesSheetFormatting(ws: XLSX.WorkSheet, rowCount: number) {
  ws["!cols"] = [
    { wch: 36 },
    { wch: 28 },
    { wch: 20 },
    { wch: 28 },
    { wch: 24 },
    { wch: 14 },
    { wch: 18 },
    { wch: 6 },
    { wch: 22 },
    { wch: 12 },
    { wch: 42 },
  ];
  ws["!freeze"] = {
    xSplit: 0,
    ySplit: 1,
    topLeftCell: "A2",
    activePane: "bottomLeft",
    state: "frozen",
  };
  if (rowCount > 1) {
    ws["!autofilter"] = { ref: `A1:K${rowCount}` };
  }
}

export function buildCustomerListReportExportWorkbook(
  payload: CustomerListReportExportPayload
): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  const { summary } = payload;

  const copy = payload.copyControl;
  const resumoRows = [
    { Campo: "Relatório", Valor: CUSTOMER_LIST_REPORT_TITLE },
    { Campo: "Origem", Valor: CUSTOMER_LIST_REPORT_SOURCE },
    { Campo: "Classificação", Valor: copy.classification || CUSTOMER_LIST_REPORT_CLASSIFICATION },
    { Campo: "Código da cópia", Valor: copy.copyCode },
    { Campo: "SHA-256 da emissão", Valor: copy.fingerprint },
    { Campo: "Emitido por", Valor: copy.emitterName || "—" },
    { Campo: "E-mail do emitente", Valor: copy.emitterEmail || "—" },
    { Campo: "Gerado em", Valor: formatDateTimeBr(payload.generatedAt) },
    { Campo: "Qtd clientes (filtro)", Valor: summary.customersCount },
    { Campo: "Qtd exportada", Valor: summary.exportedCount },
    { Campo: "Com score CNPJ", Valor: summary.withCnpjScoreCount },
    { Campo: "Sem consulta CNPJ", Valor: summary.withoutCnpjScoreCount },
    { Campo: "Status ativo", Valor: summary.activeCount },
    { Campo: "Venda bloqueada", Valor: summary.salesBlockedCount },
    ...(summary.truncated
      ? [
          {
            Campo: "Aviso",
            Valor: `Exportação limitada a ${CUSTOMER_LIST_EXPORT_MAX} clientes. Refine o filtro para o conjunto completo.`,
          },
        ]
      : []),
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(resumoRows), "Resumo");

  const clientRows = payload.rows.map(mapSheetRow);
  const clientesSheet = XLSX.utils.json_to_sheet(clientRows);
  applyClientesSheetFormatting(clientesSheet, clientRows.length + 1);
  XLSX.utils.book_append_sheet(wb, clientesSheet, "Clientes");

  if (payload.appliedFilters.length > 0) {
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(
        payload.appliedFilters.map((row) => ({ Filtro: row.label, Valor: row.value }))
      ),
      "Filtros"
    );
  }

  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(
      CUSTOMER_LIST_REPORT_PRINT_NOTICE.map((line, index) => ({
        Ordem: index + 1,
        Texto: line,
      }))
    ),
    "Confidencialidade"
  );

  return wb;
}

export function customerListReportWorkbookToBytes(workbook: XLSX.WorkBook): Uint8Array {
  const arr = XLSX.write(workbook, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
  return new Uint8Array(arr);
}

export function customerListReportExportFilename(
  format: "xlsx" | "pdf",
  referenceDate = new Date()
): string {
  const y = referenceDate.getFullYear();
  const m = String(referenceDate.getMonth() + 1).padStart(2, "0");
  const d = String(referenceDate.getDate()).padStart(2, "0");
  return format === "xlsx"
    ? `clientes-relatorio-${y}-${m}-${d}.xlsx`
    : `clientes-relatorio-${y}-${m}-${d}.pdf`;
}

export function buildCustomerListReportExportPdf(payload: CustomerListReportExportPayload): Buffer {
  const copy = payload.copyControl;
  const lines: string[] = [
    copy.classification || CUSTOMER_LIST_REPORT_CLASSIFICATION,
    `Copia controlada: ${copy.copyCode}`,
    `SHA-256: ${copy.fingerprint}`,
    `Emitido por: ${copy.emitterName} <${copy.emitterEmail}>`,
    `Gerado em: ${formatDateTimeBr(payload.generatedAt)}`,
    "",
  ];
  for (const line of CUSTOMER_LIST_REPORT_PRINT_NOTICE) {
    lines.push(line);
  }
  lines.push("");

  if (payload.appliedFilters.length > 0) {
    lines.push("Filtros aplicados:");
    for (const filter of payload.appliedFilters) {
      lines.push(`- ${filter.label}: ${filter.value}`);
    }
    lines.push("");
  }

  const { summary } = payload;
  lines.push("Resumo:");
  lines.push(`Qtd clientes (filtro): ${summary.customersCount}`);
  lines.push(`Qtd exportada: ${summary.exportedCount}`);
  lines.push(`Com score CNPJ: ${summary.withCnpjScoreCount}`);
  lines.push(`Sem consulta CNPJ: ${summary.withoutCnpjScoreCount}`);
  lines.push(`Status ativo: ${summary.activeCount}`);
  lines.push(`Venda bloqueada: ${summary.salesBlockedCount}`);
  if (summary.truncated) {
    lines.push(`Aviso: exportacao limitada a ${CUSTOMER_LIST_EXPORT_MAX} clientes.`);
  }
  lines.push("");
  lines.push(
    [
      "Razao social",
      "Nome fantasia",
      "CNPJ",
      "Score CNPJ",
      "Responsavel",
      "Ultima compra",
      "Cidade",
      "UF",
      "Status",
    ].join(" | ")
  );

  const pdfRows = payload.rows.slice(0, CUSTOMER_LIST_PDF_MAX_ROWS);
  for (const row of pdfRows) {
    lines.push(
      [
        row.companyName,
        row.tradeName,
        row.taxId,
        row.cnpjScore,
        row.commercialOwnerName,
        row.lastPurchase,
        row.city,
        row.state,
        row.status,
      ].join(" | ")
    );
  }
  if (payload.rows.length > CUSTOMER_LIST_PDF_MAX_ROWS) {
    lines.push(
      `... (${payload.rows.length - CUSTOMER_LIST_PDF_MAX_ROWS} clientes adicionais omitidos no PDF; use o Excel para a lista completa)`
    );
  }

  return buildMinimalPdfDocument({
    title: pdfSafeText(CUSTOMER_LIST_REPORT_TITLE),
    lines: lines.map((line) => pdfSafeText(line)),
  });
}

export function buildCustomerListReportExportSummary(
  rows: CustomerListReportExportRow[],
  totalMatched: number
): CustomerListReportExportSummary {
  return {
    customersCount: totalMatched,
    exportedCount: rows.length,
    truncated: totalMatched > rows.length,
    withCnpjScoreCount: rows.filter((row) => row.cnpjScore !== CUSTOMER_CNPJ_RISK_NO_LOOKUP_LABEL).length,
    withoutCnpjScoreCount: rows.filter((row) => row.cnpjScore === CUSTOMER_CNPJ_RISK_NO_LOOKUP_LABEL)
      .length,
    salesBlockedCount: rows.filter((row) => row.salesBlock.length > 0).length,
    activeCount: rows.filter((row) => row.status === "Ativo").length,
  };
}
