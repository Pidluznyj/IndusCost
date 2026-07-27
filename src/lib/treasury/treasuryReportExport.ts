/**
 * Exportações da Central de Relatórios da Tesouraria.
 * CSV (anti formula-injection) + XLSX + PDF minimalista (sem serviço externo).
 * Sem Prisma / sem I/O — testável e reutilizável no server.
 */

import * as XLSX from "xlsx";
import { buildMinimalPdfDocument } from "@/src/lib/minimalPdfWriter.js";
import type {
  TreasuryReportCompositionItemDto,
  TreasuryReportDto,
  TreasuryReportRowDto,
} from "./contracts/treasuryDto.js";
import type { TreasuryReportKey } from "./contracts/treasuryEnums.js";
import { TREASURY_REPORT_KEYS } from "./contracts/treasuryEnums.js";
import {
  TREASURY_REPORT_LABELS,
  type TreasuryReportExportFormat,
} from "./treasuryReportsUi.js";

export { TREASURY_REPORT_LABELS };
export type { TreasuryReportExportFormat };

export type TreasuryReportAppliedFilter = {
  label: string;
  value: string;
};

export type TreasuryReportExportPayload = {
  report: TreasuryReportDto;
  generatedAt: string;
  appliedFilters: TreasuryReportAppliedFilter[];
  title?: string;
};

/** Prefixo que neutraliza fórmula em Excel/LibreOffice (OWASP CSV Injection). */
const CSV_FORMULA_RE = /^[=+\-@\t\r]/;

export function neutralizeTreasuryCsvFormulaInjection(
  value: string
): string {
  if (!value) return value;
  if (CSV_FORMULA_RE.test(value)) return `'${value}`;
  return value;
}

export function escapeTreasuryCsvCell(value: unknown): string {
  if (value == null) return "";
  const raw = String(value);
  const safe = neutralizeTreasuryCsvFormulaInjection(raw);
  if (/[",\n\r]/.test(safe)) return `"${safe.replace(/"/g, '""')}"`;
  return safe;
}

export function isTreasuryReportKey(value: string): value is TreasuryReportKey {
  return (TREASURY_REPORT_KEYS as readonly string[]).includes(value);
}

export function treasuryReportLabel(reportKey: TreasuryReportKey): string {
  return TREASURY_REPORT_LABELS[reportKey] ?? reportKey;
}

function formatDateTimeBr(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
}

function pdfSafeText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, "?");
}

export function buildTreasuryReportAppliedFilters(
  report: TreasuryReportDto
): TreasuryReportAppliedFilter[] {
  const filters: TreasuryReportAppliedFilter[] = [
    { label: "Relatório", value: treasuryReportLabel(report.reportKey) },
    { label: "Período de", value: report.period.from },
    { label: "Período até", value: report.period.to },
  ];
  if (report.scenario) {
    filters.push({ label: "Cenário", value: String(report.scenario) });
  }
  if (report.accountIds?.length) {
    filters.push({
      label: "Contas solicitadas",
      value: report.accountIds.join(", "),
    });
  }
  if (report.authorizedAccountIds.length) {
    filters.push({
      label: "Contas autorizadas",
      value: String(report.authorizedAccountIds.length),
    });
  }
  for (const [key, value] of Object.entries(report.filters ?? {})) {
    if (value == null || value === "") continue;
    if (key === "scenario" && report.scenario) continue;
    filters.push({ label: key, value: String(value) });
  }
  return filters;
}

export function buildTreasuryReportExportFilename(
  reportKey: TreasuryReportKey,
  format: TreasuryReportExportFormat,
  generatedAtIso?: string
): string {
  const stamp = (generatedAtIso ?? new Date().toISOString()).slice(0, 10);
  return `tesouraria-${reportKey}-${stamp}.${format === "xlsx" ? "xlsx" : format}`;
}

function compositionRows(items: TreasuryReportCompositionItemDto[]) {
  return items.map((item) => ({
    Chave: item.key,
    Rótulo: item.label,
    Valor: item.amount,
    Quantidade: item.count,
    "Participação %": item.sharePercent ?? "",
  }));
}

function detailRows(rows: TreasuryReportRowDto[]) {
  return rows.map((row) => ({
    Id: row.id,
    Rótulo: row.label,
    Valor: row.amount,
    Quantidade: row.count ?? "",
    Data: row.civilDate ?? "",
    Conta: row.accountId ?? "",
    Status: row.status ?? "",
  }));
}

export function buildTreasuryReportExportCsv(
  payload: TreasuryReportExportPayload
): string {
  const title =
    payload.title ?? treasuryReportLabel(payload.report.reportKey);
  const lines: string[] = [];
  lines.push(
    ["Campo", "Valor"]
      .map(escapeTreasuryCsvCell)
      .join(",")
  );
  lines.push(
    ["Relatório", title].map(escapeTreasuryCsvCell).join(",")
  );
  lines.push(
    ["Gerado em", formatDateTimeBr(payload.generatedAt)]
      .map(escapeTreasuryCsvCell)
      .join(",")
  );
  for (const f of payload.appliedFilters) {
    lines.push(
      [f.label, f.value].map(escapeTreasuryCsvCell).join(",")
    );
  }
  lines.push("");
  lines.push(
    ["Totais — valor", payload.report.totals.amount]
      .map(escapeTreasuryCsvCell)
      .join(",")
  );
  lines.push(
    ["Totais — quantidade", String(payload.report.totals.count)]
      .map(escapeTreasuryCsvCell)
      .join(",")
  );
  lines.push("");
  lines.push(
    ["Chave", "Rótulo", "Valor", "Quantidade", "Participação %"]
      .map(escapeTreasuryCsvCell)
      .join(",")
  );
  for (const item of payload.report.composition) {
    lines.push(
      [
        item.key,
        item.label,
        item.amount,
        String(item.count),
        item.sharePercent ?? "",
      ]
        .map(escapeTreasuryCsvCell)
        .join(",")
    );
  }
  if (payload.report.rows.length) {
    lines.push("");
    lines.push(
      ["Id", "Rótulo", "Valor", "Quantidade", "Data", "Conta", "Status"]
        .map(escapeTreasuryCsvCell)
        .join(",")
    );
    for (const row of payload.report.rows) {
      lines.push(
        [
          row.id,
          row.label,
          row.amount,
          row.count == null ? "" : String(row.count),
          row.civilDate ?? "",
          row.accountId ?? "",
          row.status ?? "",
        ]
          .map(escapeTreasuryCsvCell)
          .join(",")
      );
    }
  }
  // BOM UTF-8 para Excel
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}

export function buildTreasuryReportExportWorkbook(
  payload: TreasuryReportExportPayload
): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  const title =
    payload.title ?? treasuryReportLabel(payload.report.reportKey);

  const meta = [
    { Campo: "Relatório", Valor: title },
    { Campo: "Gerado em", Valor: formatDateTimeBr(payload.generatedAt) },
    {
      Campo: "Total valor",
      Valor: payload.report.totals.amount,
    },
    {
      Campo: "Total quantidade",
      Valor: payload.report.totals.count,
    },
  ];
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(meta),
    "Resumo"
  );
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(
      payload.appliedFilters.map((f) => ({
        Filtro: f.label,
        Valor: f.value,
      }))
    ),
    "Filtros"
  );
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(compositionRows(payload.report.composition)),
    "Composição"
  );
  if (payload.report.rows.length) {
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(detailRows(payload.report.rows)),
      "Detalhe"
    );
  }
  return wb;
}

export function treasuryReportWorkbookToBytes(
  workbook: XLSX.WorkBook
): Uint8Array {
  const arr = XLSX.write(workbook, {
    bookType: "xlsx",
    type: "array",
  }) as ArrayBuffer;
  return new Uint8Array(arr);
}

export function buildTreasuryReportExportPdf(
  payload: TreasuryReportExportPayload
): Buffer {
  const title =
    payload.title ?? treasuryReportLabel(payload.report.reportKey);
  const lines: string[] = [
    `Gerado em: ${formatDateTimeBr(payload.generatedAt)}`,
    "",
  ];
  if (payload.appliedFilters.length) {
    lines.push("Filtros aplicados:");
    for (const f of payload.appliedFilters) {
      lines.push(`- ${f.label}: ${f.value}`);
    }
    lines.push("");
  }
  lines.push("Totais:");
  lines.push(`Valor: ${payload.report.totals.amount}`);
  lines.push(`Quantidade: ${payload.report.totals.count}`);
  lines.push("");
  lines.push("Composição:");
  for (const item of payload.report.composition) {
    lines.push(
      `- ${item.label}: ${item.amount} (qtd ${item.count}${
        item.sharePercent != null ? `; ${item.sharePercent}%` : ""
      })`
    );
  }
  if (payload.report.rows.length) {
    lines.push("");
    lines.push("Detalhe:");
    for (const row of payload.report.rows.slice(0, 80)) {
      lines.push(
        `- ${row.label}: ${row.amount}${
          row.status ? ` [${row.status}]` : ""
        }`
      );
    }
    if (payload.report.rows.length > 80) {
      lines.push(
        `... (${payload.report.rows.length - 80} linhas omitidas no PDF)`
      );
    }
  }
  return buildMinimalPdfDocument({
    title: pdfSafeText(title),
    lines: lines.map((line) => pdfSafeText(line)),
  });
}

export function buildTreasuryReportExportPayload(
  report: TreasuryReportDto,
  generatedAt: string = new Date().toISOString()
): TreasuryReportExportPayload {
  return {
    report,
    generatedAt,
    appliedFilters: buildTreasuryReportAppliedFilters(report),
    title: treasuryReportLabel(report.reportKey),
  };
}
