import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import * as XLSX from "xlsx";
import {
  buildFinanceCashFlowDailyRadar,
  DAILY_RADAR_PAYABLE_GRID_COLUMNS,
  formatDailyRadarPayableScheduledDisplay,
} from "./financeCashFlowDailyRadar.js";
import type { FinanceCashFlowApRow, FinanceCashFlowArRow } from "./financeCashFlowDashboard.js";
import {
  buildFinanceCashFlowDailyRadarExportPayload,
  parseDailyRadarExportQuery,
} from "./financeCashFlowDailyRadarExport.js";
import {
  buildFinanceCashFlowDailyRadarExportWorkbook,
  DAILY_RADAR_PAYABLE_EXPORT_COLUMNS,
} from "./financeCashFlowDailyRadarExportXlsx.js";

const BASE = new Date(2026, 5, 9);

function read(rel: string): string {
  return readFileSync(join(process.cwd(), rel), "utf8");
}

function payablesGridSource(): string {
  const radar = read("src/components/finance/cash-flow/FinanceCashFlowDailyRadar.tsx");
  const start = radar.indexOf("function PayablesGrid");
  const end = radar.indexOf("function ReceivablesGrid");
  assert.ok(start >= 0 && end > start);
  return radar.slice(start, end);
}

function apRow(overrides: Partial<FinanceCashFlowApRow> = {}): FinanceCashFlowApRow {
  return {
    externalId: 2,
    companyName: "Empresa A",
    personName: "Fornecedor Y",
    personCnpj: "22222222000122",
    description: "COFINS (Parcela 5 de 11)",
    dueDate: new Date(2026, 5, 26),
    scheduleDate: null,
    type: null,
    settlementDate: null,
    paymentDate: null,
    competenceDate: new Date(2026, 5, 2),
    amountPayable: 500,
    amountPaid: 0,
    balancePayable: 500,
    paymentMethodName: "PIX",
    bankAccountName: "Conta 2",
    sourceInvoiceId: null,
    documentNumber: "DOC-8425",
    suspendPayment: false,
    nomusStatus: true,
    syncedAt: new Date(2026, 5, 8),
    ...overrides,
  };
}

function arRow(overrides: Partial<FinanceCashFlowArRow> = {}): FinanceCashFlowArRow {
  return {
    externalId: 1,
    companyName: "Empresa A",
    personName: "Cliente X",
    personCnpj: "11111111000111",
    description: "Recebível teste",
    dueDate: new Date(2026, 5, 26),
    settlementDate: null,
    competenceDate: new Date(2026, 5, 1),
    amountReceivable: 1000,
    amountReceived: 0,
    balanceReceivable: 1000,
    paymentMethodName: "Boleto",
    bankAccountName: "Conta 1",
    sourceInvoiceId: 100,
    sourceInvoiceNumber: "NF-100",
    suspendCollection: false,
    nomusStatus: true,
    syncedAt: new Date(2026, 5, 8),
    ...overrides,
  };
}

describe("financeCashFlowDailyRadarPayablesGrid", () => {
  const grid = payablesGridSource();

  for (const column of DAILY_RADAR_PAYABLE_GRID_COLUMNS) {
    it(`grid do detalhe do dia em Contas a Pagar mostra coluna ${column}`, () => {
      assert.ok(
        grid.includes(`label="${column}"`) ||
          grid.includes(column) ||
          grid.includes(`>${column}<`)
      );
    });
  }

  it("grid não mostra coluna Status em Contas a Pagar", () => {
    assert.doesNotMatch(grid, /label="Status"/);
  });

  it("grid não mostra coluna Forma Pag. em Contas a Pagar", () => {
    assert.doesNotMatch(grid, /Forma Pag/i);
  });

  it("Descrição usa title/tooltip com texto completo", () => {
    assert.match(grid, /title=\{row\.description/);
    assert.match(grid, /cash-flow-radar-payables-col-description/);
  });

  it("coluna Descrição tem largura ampliada via CSS dedicado", () => {
    const css = read("src/components/finance/cash-flow/finance-cash-flow-daily-radar-payables-grid.css");
    assert.match(css, /cash-flow-radar-payables-col-description[\s\S]*width:\s*32%/);
    assert.ok(read("src/components/finance/cash-flow/FinanceCashFlowDailyRadar.tsx").includes(
      "finance-cash-flow-daily-radar-payables-grid.css"
    ));
  });

  it("total da tabela continua correto", () => {
    const apRows = [
      apRow({ externalId: 10, balancePayable: 900, dueDate: new Date(2026, 5, 9) }),
      apRow({ externalId: 11, balancePayable: 100, dueDate: new Date(2026, 5, 9) }),
    ];
    const radar = buildFinanceCashFlowDailyRadar([], apRows, {
      baseDate: BASE,
      rangeKey: "0-7",
      day: "2026-06-09",
      page: 1,
      pageSize: 25,
    }, BASE);
    assert.equal(radar.selectedDetail!.payables.summary.total, 1000);
    assert.equal(radar.selectedDetail!.payables.summary.count, 2);
    assert.match(grid, /Total \(\{formatFinanceInteger\(detail\.summary\.count\)\} título\(s\)\)/);
    assert.match(grid, /formatFinanceCurrency\(detail\.summary\.total\)/);
  });

  it("busca continua funcionando por fornecedor", () => {
    const apRows = [
      apRow({ externalId: 10, personName: "Koppetel Invest", dueDate: new Date(2026, 5, 9) }),
      apRow({ externalId: 11, personName: "Outro Fornecedor", dueDate: new Date(2026, 5, 9) }),
    ];
    const radar = buildFinanceCashFlowDailyRadar([], apRows, {
      baseDate: BASE,
      rangeKey: "0-7",
      day: "2026-06-09",
      search: "koppetel",
      page: 1,
      pageSize: 25,
    }, BASE);
    assert.equal(radar.selectedDetail!.payables.rows.length, 1);
    assert.match(radar.selectedDetail!.payables.rows[0]!.supplier ?? "", /Koppetel/i);
  });

  it("busca continua funcionando por descrição", () => {
    const apRows = [
      apRow({ externalId: 10, description: "LIQUIDAÇÃO DÍVIDAS ITAU", dueDate: new Date(2026, 5, 9) }),
      apRow({ externalId: 11, description: "Outro lançamento", dueDate: new Date(2026, 5, 9) }),
    ];
    const radar = buildFinanceCashFlowDailyRadar([], apRows, {
      baseDate: BASE,
      rangeKey: "0-7",
      day: "2026-06-09",
      search: "itau",
      page: 1,
      pageSize: 25,
    }, BASE);
    assert.equal(radar.selectedDetail!.payables.rows.length, 1);
    assert.match(radar.selectedDetail!.payables.rows[0]!.description ?? "", /ITAU/i);
  });

  it("formatDailyRadarPayableScheduledDisplay mostra data ou em dash", () => {
    assert.equal(
      formatDailyRadarPayableScheduledDisplay({
        dataAgendada: "2026-06-25",
        scheduleDate: null,
      }),
      "25/06/2026"
    );
    assert.equal(
      formatDailyRadarPayableScheduledDisplay({
        dataAgendada: null,
        scheduleDate: "2026-06-25",
      }),
      "25/06/2026"
    );
    assert.equal(
      formatDailyRadarPayableScheduledDisplay({ dataAgendada: null, scheduleDate: null }),
      "—"
    );
  });

  it("Excel exporta as novas colunas na ordem correta", () => {
    assert.deepEqual([...DAILY_RADAR_PAYABLE_EXPORT_COLUMNS], [...DAILY_RADAR_PAYABLE_GRID_COLUMNS]);
    const parsed = parseDailyRadarExportQuery({ baseDate: "2026-06-09", range: "0-7", day: "2026-06-26" });
    const payload = buildFinanceCashFlowDailyRadarExportPayload(
      [],
      [apRow({ dueDate: new Date(2026, 5, 26) })],
      parsed,
      { userName: "Paulo" },
      BASE
    );
    const wb = buildFinanceCashFlowDailyRadarExportWorkbook(payload);
    const sheet = wb.Sheets["Contas a Pagar"];
    assert.ok(sheet);
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
    assert.equal(Object.keys(rows[0]!).join("|"), DAILY_RADAR_PAYABLE_EXPORT_COLUMNS.join("|"));
  });

  it("Excel não exporta Status nem Forma Pag. na tabela de Contas a Pagar", () => {
    const parsed = parseDailyRadarExportQuery({ baseDate: "2026-06-09", range: "0-7", day: "2026-06-26" });
    const payload = buildFinanceCashFlowDailyRadarExportPayload(
      [],
      [apRow({ dueDate: new Date(2026, 5, 26), paymentMethodName: "TED" })],
      parsed,
      {},
      BASE
    );
    const wb = buildFinanceCashFlowDailyRadarExportWorkbook(payload);
    const sheet = wb.Sheets["Contas a Pagar"]!;
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet);
    const keys = new Set(Object.keys(rows[0]!));
    assert.equal(keys.has("Status"), false);
    assert.equal(keys.has("Forma Pag."), false);
    assert.equal(keys.has("Forma de pagamento"), false);
  });

  it("PDF exporta as novas colunas na ordem correta", () => {
    const printDoc = read("src/components/finance/cash-flow/FinanceCashFlowDailyRadarPrintDocument.tsx");
    const payablesSection = printDoc.slice(
      printDoc.indexOf("finance-cash-flow-daily-radar-print-payables-table"),
      printDoc.indexOf("Contas a Receber")
    );
    const headers = ["Fornecedor", "Empresa", "Descrição", "Documento", "Vencimento", "Valor", "Agendado"];
    for (const header of headers) {
      assert.ok(payablesSection.includes(`>${header}<`), `PDF missing header ${header}`);
    }
    const fornecedorIdx = payablesSection.indexOf(">Fornecedor<");
    const agendadoIdx = payablesSection.indexOf(">Agendado<");
    assert.ok(fornecedorIdx >= 0 && agendadoIdx > fornecedorIdx);
  });

  it("PDF não exporta Status nem Forma Pag. na tabela de Contas a Pagar", () => {
    const printDoc = read("src/components/finance/cash-flow/FinanceCashFlowDailyRadarPrintDocument.tsx");
    const payablesStart = printDoc.indexOf("finance-cash-flow-daily-radar-print-payables-table");
    const receivablesStart = printDoc.indexOf("Contas a Receber", payablesStart);
    const payablesSection = printDoc.slice(payablesStart, receivablesStart);
    assert.doesNotMatch(payablesSection, />Status</);
    assert.doesNotMatch(payablesSection, /Forma Pag/i);
  });

  it("Contas a Receber não foi alterado indevidamente", () => {
    const radar = read("src/components/finance/cash-flow/FinanceCashFlowDailyRadar.tsx");
    const receivablesStart = radar.indexOf("function ReceivablesGrid");
    const receivables = radar.slice(receivablesStart);
    assert.ok(receivables.includes('label="Status"'));
    assert.ok(receivables.includes("NF emitida"));
    const printDoc = read("src/components/finance/cash-flow/FinanceCashFlowDailyRadarPrintDocument.tsx");
    const arSection = printDoc.slice(printDoc.indexOf("Contas a Receber"));
    assert.ok(arSection.includes(">Status<"));
  });

  it("build não reintroduz Prisma no frontend do radar diário", () => {
    const files = [
      "src/components/finance/cash-flow/FinanceCashFlowDailyRadar.tsx",
      "src/components/finance/cash-flow/FinanceCashFlowDailyRadarPrintDocument.tsx",
      "src/components/finance/cash-flow/FinanceCashFlowDailyRadarExportButtons.tsx",
      "src/lib/financeCashFlowDailyRadar.ts",
      "src/lib/financeCashFlowDailyRadarExportXlsx.ts",
    ];
    for (const file of files) {
      const src = read(file);
      assert.doesNotMatch(src, /@prisma\/client/);
      assert.doesNotMatch(src, /lib\/prisma/);
    }
  });
});
