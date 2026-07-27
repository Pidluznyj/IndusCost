import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as XLSX from "xlsx";
import type { TreasuryReportDto } from "./contracts/treasuryDto.js";
import {
  buildTreasuryReportExportCsv,
  buildTreasuryReportExportFilename,
  buildTreasuryReportExportPayload,
  buildTreasuryReportExportPdf,
  buildTreasuryReportExportWorkbook,
  escapeTreasuryCsvCell,
  neutralizeTreasuryCsvFormulaInjection,
  treasuryReportWorkbookToBytes,
} from "./treasuryReportExport.js";

function sampleReport(): TreasuryReportDto {
  return {
    ok: true,
    reportKey: "exceptions",
    period: { from: "2026-07-01", to: "2026-07-27" },
    accountIds: null,
    authorizedAccountIds: ["acc-1"],
    scenario: "PROBABLE",
    filters: { status: "OPEN", companyCode: "LAZARIOS" },
    totals: {
      amount: "150.00",
      count: 2,
      extras: { bucketAmountSum: "150.00", bucketCountSum: 2 },
    },
    composition: [
      {
        key: "CRITICAL",
        label: "Crítico",
        amount: "100.00",
        count: 1,
        sharePercent: "66.67",
      },
      {
        key: "WARNING",
        label: "Alerta",
        amount: "50.00",
        count: 1,
        sharePercent: "33.33",
      },
    ],
    rows: [
      {
        id: "e1",
        label: "=CMD|' /C calc'!A0",
        amount: "100.00",
        status: "OPEN",
      },
      {
        id: "e2",
        label: "Normal",
        amount: "50.00",
        status: "OPEN",
      },
    ],
    pagination: null,
  };
}

describe("treasuryReportExport — CSV formula injection", () => {
  it("neutraliza células com = + - @ e prefixos de controle", () => {
    assert.equal(neutralizeTreasuryCsvFormulaInjection("=1+1"), "'=1+1");
    assert.equal(neutralizeTreasuryCsvFormulaInjection("+cmd"), "'+cmd");
    assert.equal(neutralizeTreasuryCsvFormulaInjection("-2+3"), "'-2+3");
    assert.equal(neutralizeTreasuryCsvFormulaInjection("@SUM(A1)"), "'@SUM(A1)");
    assert.equal(neutralizeTreasuryCsvFormulaInjection("\t=1"), "'\t=1");
    assert.equal(neutralizeTreasuryCsvFormulaInjection("ok"), "ok");
  });

  it("CSV escapa aspas e protege fórmulas nos valores", () => {
    const payload = buildTreasuryReportExportPayload(
      sampleReport(),
      "2026-07-27T15:00:00.000Z"
    );
    const csv = buildTreasuryReportExportCsv(payload);
    assert.match(csv, /Gerado em/);
    assert.match(csv, /'=CMD\|' \/C calc'!A0/);
    assert.doesNotMatch(csv, /(?:^|,)=CMD/m);
    assert.equal(escapeTreasuryCsvCell('a"b'), '"a""b"');
  });
});

describe("treasuryReportExport — XLSX / PDF", () => {
  it("gera workbook com abas Resumo/Filtros/Composição/Detalhe", () => {
    const payload = buildTreasuryReportExportPayload(
      sampleReport(),
      "2026-07-27T15:00:00.000Z"
    );
    const wb = buildTreasuryReportExportWorkbook(payload);
    assert.ok(wb.SheetNames.includes("Resumo"));
    assert.ok(wb.SheetNames.includes("Filtros"));
    assert.ok(wb.SheetNames.includes("Composição"));
    assert.ok(wb.SheetNames.includes("Detalhe"));
    const bytes = treasuryReportWorkbookToBytes(wb);
    assert.ok(bytes.byteLength > 100);
    const parsed = XLSX.read(bytes, { type: "array" });
    const filters = XLSX.utils.sheet_to_json<Record<string, string>>(
      parsed.Sheets.Filtros!
    );
    assert.ok(filters.some((f) => f.Filtro === "Relatório"));
  });

  it("gera PDF mínimo estável com %PDF e filtros/geração", () => {
    const payload = buildTreasuryReportExportPayload(
      sampleReport(),
      "2026-07-27T15:00:00.000Z"
    );
    const pdf = buildTreasuryReportExportPdf(payload);
    const text = pdf.toString("utf8");
    assert.match(text, /^%PDF-1\./);
    assert.match(text, /Gerado em/);
    assert.match(text, /Filtros aplicados/);
    assert.match(text, /Excecoes|Exceções|exceptions/i);
  });

  it("monta filename canônico por formato", () => {
    assert.equal(
      buildTreasuryReportExportFilename(
        "cash-bridge",
        "xlsx",
        "2026-07-27T12:00:00.000Z"
      ),
      "tesouraria-cash-bridge-2026-07-27.xlsx"
    );
    assert.equal(
      buildTreasuryReportExportFilename(
        "promises",
        "pdf",
        "2026-07-27T12:00:00.000Z"
      ),
      "tesouraria-promises-2026-07-27.pdf"
    );
  });
});
