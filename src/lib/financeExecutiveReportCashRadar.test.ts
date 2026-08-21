import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import type { FinanceCashFlowApRow, FinanceCashFlowArRow } from "./financeCashFlowDashboard.js";
import {
  buildCashFlowDailyRadarData,
  EXECUTIVE_REPORT_DEFAULT_CASH_RADAR_RANGE_KEY,
} from "./financeCashFlowDailyRadar.js";
import {
  buildExecutiveReportCashRadarBlock,
  buildExecutiveReportCashRadarFilterLines,
  buildExecutiveReportDailyRadarCashFlowFilters,
  parseExecutiveReportCashRadarRangeKey,
} from "./financeExecutiveReportCashRadar.js";
import type { FinanceExecutiveReportFilters } from "./financeExecutiveReportTypes.js";

const BASE = new Date(2026, 6, 1);

function arRow(overrides: Partial<FinanceCashFlowArRow> = {}): FinanceCashFlowArRow {
  return {
    externalId: 1,
    companyName: "Lazarios",
    personName: "Cliente X",
    personCnpj: "11111111000111",
    description: "Recebível teste",
    dueDate: new Date(2026, 6, 3),
    settlementDate: null,
    competenceDate: new Date(2026, 6, 1),
    amountReceivable: 1000,
    amountReceived: 0,
    balanceReceivable: 1000,
    paymentMethodName: "Boleto",
    bankAccountName: "Conta 1",
    sourceInvoiceId: 100,
    sourceInvoiceNumber: "NF-100",
    suspendCollection: false,
    nomusStatus: true,
    syncedAt: new Date(2026, 6, 1),
    ...overrides,
  };
}

function apRow(overrides: Partial<FinanceCashFlowApRow> = {}): FinanceCashFlowApRow {
  return {
    externalId: 2,
    companyName: "Lazarios",
    personName: "Fornecedor Y",
    personCnpj: "22222222000122",
    description: "Pagável teste",
    dueDate: new Date(2026, 6, 5),
    scheduleDate: null,
    type: null,
    settlementDate: null,
    paymentDate: null,
    competenceDate: new Date(2026, 6, 1),
    amountPayable: 500,
    amountPaid: 0,
    balancePayable: 500,
    paymentMethodName: "PIX",
    bankAccountName: "Conta 2",
    sourceInvoiceId: null,
    documentNumber: "DOC-1",
    suspendPayment: false,
    nomusStatus: true,
    syncedAt: new Date(2026, 6, 1),
    ...overrides,
  };
}

const filters: FinanceExecutiveReportFilters = {
  year: 2026,
  month: 7,
  asOfDate: "2026-07-01",
  company: "lazarios",
  customerType: "external",
  invoiceIssuedFilter: "all",
  topN: 50,
  mode: "live",
};

describe("financeExecutiveReportCashRadar", () => {
  it("buildExecutiveReportCashRadarBlock inclui faixa 0-7 aberta com AR/AP", () => {
    const arRows = [arRow()];
    const apRows = [apRow()];
    const dashboardFilters = buildExecutiveReportDailyRadarCashFlowFilters(filters);

    const block = buildExecutiveReportCashRadarBlock({
      arRows,
      apRows,
      filters,
      referenceDate: BASE,
      arSyncCutoff: null,
      apSyncCutoff: null,
      dashboardFilters,
    });

    assert.equal(block.defaultOpenRange, EXECUTIVE_REPORT_DEFAULT_CASH_RADAR_RANGE_KEY);
    assert.ok(block.ranges.length >= 6);
    assert.ok(block.selectedRangeDetail);
    assert.equal(block.selectedRangeDetail?.rangeKey, "0-7");
    assert.ok(block.radarPayload.selectedRange);
    assert.equal(block.radarPayload.selectedRange?.days.length, 8);

    const range07 = block.ranges.find((r) => r.key === "0-7");
    assert.ok(range07);
    const daysTotalIn = block.radarPayload.selectedRange!.days.reduce(
      (s, d) => s + d.receivableTotal,
      0
    );
    const daysTotalOut = block.radarPayload.selectedRange!.days.reduce(
      (s, d) => s + d.payableTotal,
      0
    );
    assert.ok(Math.abs(daysTotalIn - range07!.receivableTotal) < 0.02);
    assert.ok(Math.abs(daysTotalOut - range07!.payableTotal) < 0.02);

    const detail = block.selectedRangeDetail!;
    assert.ok(Math.abs(detail.receivables.summary.total - detail.entriesTotal) < 0.02);
    assert.ok(Math.abs(detail.payables.summary.total - detail.exitsTotal) < 0.02);
    assert.ok(Math.abs(detail.netTotal - (detail.entriesTotal - detail.exitsTotal)) < 0.02);
  });

  it("buildCashFlowDailyRadarData é o helper compartilhado do motor oficial", () => {
    const payload = buildCashFlowDailyRadarData({
      arRows: [arRow()],
      apRows: [apRow()],
      baseDate: BASE,
      dashboardFilters: buildExecutiveReportDailyRadarCashFlowFilters(filters),
      query: { rangeKey: "0-7", exportAll: true },
    });
    assert.ok(payload.selectedDetail);
    assert.equal(payload.selectedDetail?.rangeKey, "0-7");
  });

  it("parseExecutiveReportCashRadarRangeKey aceita 0_7_DAYS", () => {
    assert.equal(parseExecutiveReportCashRadarRangeKey("0_7_DAYS"), "0-7");
    assert.equal(parseExecutiveReportCashRadarRangeKey("overdue"), "overdue");
  });

  it("filtros do relatório marcam ano/mês/topN como não aplicáveis", () => {
    const lines = buildExecutiveReportCashRadarFilterLines(filters);
    const yearLine = lines.find((l) => l.label === "Ano");
    const monthLine = lines.find((l) => l.label === "Mês");
    const topNLine = lines.find((l) => l.label === "Top N");
    assert.equal(yearLine?.notApplicable, true);
    assert.equal(monthLine?.notApplicable, true);
    assert.equal(topNLine?.notApplicable, true);
    const companyLine = lines.find((l) => l.label === "Empresa");
    assert.notEqual(companyLine?.notApplicable, true);
  });

  it("Relatório Presidencial renderiza seção Radar no documento e PDF", () => {
    const document = readFileSync(
      join(process.cwd(), "src", "components", "finance", "executive-report", "ExecutiveReportDocument.tsx"),
      "utf8"
    );
    const section = readFileSync(
      join(
        process.cwd(),
        "src",
        "components",
        "finance",
        "executive-report",
        "ExecutiveReportCashRadarSection.tsx"
      ),
      "utf8"
    );
    const printCss = readFileSync(
      join(
        process.cwd(),
        "src",
        "components",
        "finance",
        "executive-report",
        "finance-executive-report-print.css"
      ),
      "utf8"
    );
    const reportTypes = readFileSync(
      join(process.cwd(), "src", "lib", "financeExecutiveReportTypes.ts"),
      "utf8"
    );

    assert.match(document, /pageId="cash-radar"/);
    assert.match(document, /allowContentFlow/);
    assert.match(document, /report\.cashRadar/);
    assert.match(document, /ExecutiveReportCashRadarSection/);
    assert.match(section, /executive-report-cash-radar/);
    assert.match(section, /executive-report-cash-radar-print/);
    assert.match(section, /defaultOpenRange/);
    assert.doesNotMatch(section, /FinanceCashFlowDailyRadarPdfSection/);
    assert.match(printCss, /executive-print-page--flow/);
    assert.match(printCss, /executive-report-cash-radar-print/);
    assert.match(reportTypes, /cashRadar:/);
    assert.doesNotMatch(section, /buildFinanceCashFlowDailyRadar\(/);
  });

  it("assembler inclui cashRadar via motor oficial", () => {
    const assembler = readFileSync(join(process.cwd(), "src", "lib", "financeExecutiveReport.ts"), "utf8");
    assert.match(assembler, /buildExecutiveReportCashRadarBlock/);
    assert.match(assembler, /cashRadar,/);
    // O assembler delega a carga ao bloco do radar; o loader oficial das linhas
    // de carteira vive no módulo do radar (antes era chamado direto aqui).
    const radar = readFileSync(
      join(process.cwd(), "src", "lib", "financeExecutiveReportCashRadar.ts"),
      "utf8"
    );
    assert.match(radar, /loadExecutiveReportDailyRadarPortfolioRows/);
  });
});
