import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import * as XLSX from "xlsx";
import {
  buildFinanceCashFlowDailyRadar,
} from "./financeCashFlowDailyRadar.js";
import type { FinanceCashFlowApRow, FinanceCashFlowArRow } from "./financeCashFlowDashboard.js";
import {
  buildFinanceCashFlowDailyRadarExportPayload,
  buildDailyRadarExportQueryString,
  FinanceCashFlowDailyRadarExportError,
  parseDailyRadarExportQuery,
} from "./financeCashFlowDailyRadarExport.js";
import {
  buildFinanceCashFlowDailyRadarExportFilename,
  buildFinanceCashFlowDailyRadarExportWorkbook,
  FINANCE_CASH_FLOW_DAILY_RADAR_EXPORT_TITLE,
  sanitizeDailyRadarExportSlug,
} from "./financeCashFlowDailyRadarExportXlsx.js";

const BASE = new Date(2026, 5, 9);

function read(rel: string): string {
  return readFileSync(join(process.cwd(), rel), "utf8");
}

function arRow(overrides: Partial<FinanceCashFlowArRow> = {}): FinanceCashFlowArRow {
  return {
    externalId: 1,
    companyName: "Empresa A",
    personName: "Cliente X",
    personCnpj: "11111111000111",
    description: "Recebível teste",
    dueDate: new Date(2026, 5, 9),
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

function apRow(overrides: Partial<FinanceCashFlowApRow> = {}): FinanceCashFlowApRow {
  return {
    externalId: 2,
    companyName: "Empresa A",
    personName: "Fornecedor Y",
    personCnpj: "22222222000122",
    description: "Pagável teste",
    dueDate: new Date(2026, 5, 9),
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
    documentNumber: "DOC-1",
    suspendPayment: false,
    nomusStatus: true,
    syncedAt: new Date(2026, 5, 8),
    ...overrides,
  };
}

function exportPayload(
  arRows: FinanceCashFlowArRow[],
  apRows: FinanceCashFlowApRow[],
  query: Record<string, string>
) {
  const parsed = parseDailyRadarExportQuery({ baseDate: "2026-06-09", ...query });
  return buildFinanceCashFlowDailyRadarExportPayload(arRows, apRows, parsed, { userName: "Paulo" }, BASE);
}

describe("financeCashFlowDailyRadarExport", () => {
  it("botões Exportar Excel/PDF aparecem quando uma faixa é selecionada", () => {
    const radar = read("src/components/finance/cash-flow/FinanceCashFlowDailyRadar.tsx");
    const buttons = read("src/components/finance/cash-flow/FinanceCashFlowDailyRadarExportButtons.tsx");
    assert.ok(radar.includes("FinanceCashFlowDailyRadarExportButtons"));
    assert.ok(buttons.includes("cash-flow-radar-export-excel"));
    assert.ok(buttons.includes("cash-flow-radar-export-pdf"));
    assert.ok(buttons.includes("Exportar Excel"));
    assert.ok(buttons.includes("Exportar PDF"));
  });

  it("botões Exportar Excel/PDF aparecem quando um dia é selecionado", () => {
    const radar = read("src/components/finance/cash-flow/FinanceCashFlowDailyRadar.tsx");
    assert.ok(radar.includes("selectedDate={detail.date}"));
    assert.ok(radar.includes("Detalhe do dia —"));
    assert.ok(radar.includes("Limpar dia"));
  });

  it("exportação Excel envia range correto", () => {
    const qs = buildDailyRadarExportQueryString({ range: "0-7" });
    assert.match(qs, /range=0-7/);
    const buttons = read("src/components/finance/cash-flow/FinanceCashFlowDailyRadarExportButtons.tsx");
    assert.ok(buttons.includes("/daily-radar/export.xlsx?"));
    assert.ok(buttons.includes("buildDailyRadarExportQueryString"));
  });

  it("exportação PDF envia range correto", () => {
    const buttons = read("src/components/finance/cash-flow/FinanceCashFlowDailyRadarExportButtons.tsx");
    assert.ok(buttons.includes("/daily-radar/export-data?"));
    assert.ok(buttons.includes("cash-flow-daily-radar-print-route"));
    assert.ok(buttons.includes("window.print"));
  });

  it("exportação Excel envia selectedDate quando dia estiver selecionado", () => {
    const qs = buildDailyRadarExportQueryString({ range: "0-7", day: "2026-06-11" });
    assert.match(qs, /day=2026-06-11/);
  });

  it("exportação PDF envia selectedDate quando dia estiver selecionado", () => {
    const qs = buildDailyRadarExportQueryString({
      range: "0-7",
      day: "2026-06-24",
      search: "patrimonial",
    });
    assert.match(qs, /day=2026-06-24/);
    assert.match(qs, /search=patrimonial/);
  });

  it("exportação respeita busca interna", () => {
    const arRows = [
      arRow({ externalId: 1, personName: "Maria Eliana", balanceReceivable: 100, dueDate: new Date(2026, 5, 9) }),
      arRow({ externalId: 2, personName: "Gislene Lima", balanceReceivable: 200, dueDate: new Date(2026, 5, 11) }),
    ];
    const apRows = [
      apRow({ externalId: 10, personName: "Maria Eliana", balancePayable: 40, dueDate: new Date(2026, 5, 10) }),
      apRow({ externalId: 11, personName: "Outro Fornecedor", balancePayable: 60, dueDate: new Date(2026, 5, 14) }),
    ];
    const payload = exportPayload(arRows, apRows, { range: "0-7", search: "maria" });
    assert.equal(payload.receivables.rows.length, 1);
    assert.equal(payload.payables.rows.length, 1);
    assert.equal(payload.entriesTotal, 100);
    assert.equal(payload.exitsTotal, 40);
  });

  it("exportação de faixa inclui AP e AR da faixa", () => {
    const arRows = [
      arRow({ externalId: 1, balanceReceivable: 100, dueDate: new Date(2026, 5, 9) }),
      arRow({ externalId: 2, balanceReceivable: 200, dueDate: new Date(2026, 5, 11) }),
    ];
    const apRows = [
      apRow({ externalId: 10, balancePayable: 40, dueDate: new Date(2026, 5, 10) }),
      apRow({ externalId: 11, balancePayable: 60, dueDate: new Date(2026, 5, 14) }),
    ];
    const payload = exportPayload(arRows, apRows, { range: "0-7" });
    assert.equal(payload.level, "range");
    assert.equal(payload.receivables.rows.length, 2);
    assert.equal(payload.payables.rows.length, 2);
    assert.equal(payload.netTotal, 200);
  });

  it("exportação de dia inclui AP e AR do dia", () => {
    const arRows = [
      arRow({ externalId: 1, balanceReceivable: 100, dueDate: new Date(2026, 5, 9) }),
      arRow({ externalId: 2, balanceReceivable: 200, dueDate: new Date(2026, 5, 11) }),
    ];
    const apRows = [apRow({ externalId: 10, balancePayable: 40, dueDate: new Date(2026, 5, 11) })];
    const payload = exportPayload(arRows, apRows, { range: "0-7", day: "2026-06-11" });
    assert.equal(payload.level, "day");
    assert.equal(payload.selectedDate, "2026-06-11");
    assert.equal(payload.receivables.rows.length, 1);
    assert.equal(payload.payables.rows.length, 1);
    assert.equal(payload.netTotal, 160);
  });

  it("totalizadores AP batem com o grid", () => {
    const apRows = [
      apRow({ externalId: 10, balancePayable: 900, dueDate: new Date(2026, 5, 1) }),
      apRow({ externalId: 11, balancePayable: 100, dueDate: new Date(2026, 5, 3) }),
    ];
    const grid = buildFinanceCashFlowDailyRadar([], apRows, {
      baseDate: BASE,
      rangeKey: "overdue",
      page: 1,
      pageSize: 25,
    }, BASE);
    const payload = exportPayload([], apRows, { range: "overdue" });
    assert.equal(payload.payables.summary.total, grid.selectedDetail!.payables.summary.total);
    assert.equal(payload.payables.summary.count, grid.selectedDetail!.payables.summary.count);
    assert.equal(payload.payables.summary.overdueTotal, grid.selectedDetail!.payables.summary.overdueTotal);
    assert.equal(payload.payables.summary.maxAmount, grid.selectedDetail!.payables.summary.maxAmount);
  });

  it("totalizadores AR batem com o grid", () => {
    const arRows = [
      arRow({ externalId: 1, balanceReceivable: 1000, dueDate: new Date(2026, 5, 9) }),
      arRow({ externalId: 2, balanceReceivable: 250, dueDate: new Date(2026, 5, 9) }),
    ];
    const grid = buildFinanceCashFlowDailyRadar(arRows, [], {
      baseDate: BASE,
      rangeKey: "0-7",
      day: "2026-06-09",
      page: 1,
      pageSize: 25,
    }, BASE);
    const payload = exportPayload(arRows, [], { range: "0-7", day: "2026-06-09" });
    assert.equal(payload.receivables.summary.total, grid.selectedDetail!.receivables.summary.total);
    assert.equal(payload.receivables.summary.count, grid.selectedDetail!.receivables.summary.count);
  });

  it("saldo líquido = entradas - saídas", () => {
    const payload = exportPayload(
      [arRow({ balanceReceivable: 300, dueDate: new Date(2026, 5, 9) })],
      [apRow({ balancePayable: 120, dueDate: new Date(2026, 5, 9) })],
      { range: "0-7", day: "2026-06-09" }
    );
    assert.equal(payload.netTotal, payload.entriesTotal - payload.exitsTotal);
  });

  it("PDF é gerado em A4 paisagem", () => {
    const css = read("src/components/finance/cash-flow/finance-cash-flow-daily-radar-print.css");
    assert.match(css, /size:\s*A4 landscape/);
    const printDoc = read("src/components/finance/cash-flow/FinanceCashFlowDailyRadarPrintDocument.tsx");
    assert.ok(printDoc.includes("cash-flow-daily-radar-print-root"));
    assert.ok(printDoc.includes("Filtros aplicados"));
  });

  it("Excel contém abas Resumo, Contas a Pagar e Contas a Receber", () => {
    const payload = exportPayload(
      [arRow({ balanceReceivable: 100, dueDate: new Date(2026, 5, 9) })],
      [apRow({ balancePayable: 50, dueDate: new Date(2026, 5, 10) })],
      { range: "0-7" }
    );
    const wb = buildFinanceCashFlowDailyRadarExportWorkbook(payload);
    assert.ok(wb.Sheets.Resumo);
    assert.ok(wb.Sheets["Contas a Pagar"]);
    assert.ok(wb.Sheets["Contas a Receber"]);
    const resumo = XLSX.utils.sheet_to_json<{ Campo: string; Valor: string | number }>(wb.Sheets.Resumo);
    assert.ok(
      resumo.some((row) => row.Campo === "Relatório" && row.Valor === FINANCE_CASH_FLOW_DAILY_RADAR_EXPORT_TITLE)
    );
  });

  it("Excel exporta todos os títulos da faixa, não apenas os visíveis", () => {
    const arRows = Array.from({ length: 30 }, (_, index) =>
      arRow({
        externalId: index + 1,
        balanceReceivable: 100 + index,
        dueDate: new Date(2026, 5, 10),
        personName: `Cliente ${index + 1}`,
      })
    );
    const grid = buildFinanceCashFlowDailyRadar(arRows, [], {
      baseDate: BASE,
      rangeKey: "0-7",
      page: 1,
      pageSize: 25,
    }, BASE);
    const payload = exportPayload(arRows, [], { range: "0-7" });
    assert.equal(grid.selectedDetail!.receivables.rows.length, 25);
    assert.equal(payload.receivables.rows.length, 30);
  });

  it("não altera cálculo original dos cards do radar", () => {
    const arRows = [
      arRow({ externalId: 1, balanceReceivable: 100, dueDate: new Date(2026, 5, 9) }),
      arRow({ externalId: 2, balanceReceivable: 200, dueDate: new Date(2026, 5, 11) }),
    ];
    const apRows = [apRow({ balancePayable: 40, dueDate: new Date(2026, 5, 10) })];
    const before = buildFinanceCashFlowDailyRadar(arRows, apRows, { baseDate: BASE }, BASE);
    exportPayload(arRows, apRows, { range: "0-7" });
    const after = buildFinanceCashFlowDailyRadar(arRows, apRows, { baseDate: BASE }, BASE);
    assert.deepEqual(before.ranges, after.ranges);
  });

  it("parse exige faixa para exportação", () => {
    assert.throws(
      () => parseDailyRadarExportQuery({}),
      (error: unknown) => error instanceof FinanceCashFlowDailyRadarExportError
    );
  });

  it("rotas expõem export.xlsx e export-data do radar diário", () => {
    const routes = read("src/lib/financeCashFlowRoutes.ts");
    assert.ok(routes.includes("/api/finance/cash-flow/daily-radar/export.xlsx"));
    assert.ok(routes.includes("/api/finance/cash-flow/daily-radar/export-data"));
    assert.ok(routes.includes("buildFinanceCashFlowDailyRadarExportPayload"));
  });

  it("nome de arquivo sanitiza faixa e dia", () => {
    assert.equal(sanitizeDailyRadarExportSlug("0 a 7 dias"), "0-a-7-dias");
    assert.equal(
      buildFinanceCashFlowDailyRadarExportFilename({
        level: "range",
        rangeLabel: "0 a 7 dias",
        selectedDate: null,
      }),
      "fluxo-caixa-radar-0-a-7-dias.xlsx"
    );
    assert.equal(
      buildFinanceCashFlowDailyRadarExportFilename({
        level: "day",
        rangeLabel: "0 a 7 dias",
        selectedDate: "2026-06-24",
      }),
      "fluxo-caixa-radar-24-06-2026.xlsx"
    );
  });

  it("frontend não importa Prisma nos componentes de exportação", () => {
    const files = [
      "src/components/finance/cash-flow/FinanceCashFlowDailyRadarExportButtons.tsx",
      "src/components/finance/cash-flow/FinanceCashFlowDailyRadarPrintDocument.tsx",
      "src/components/finance/cash-flow/FinanceCashFlowDailyRadar.tsx",
    ];
    for (const file of files) {
      const src = read(file);
      assert.doesNotMatch(src, /@prisma\/client/);
      assert.doesNotMatch(src, /lib\/prisma/);
    }
  });

  it("exportação aceita período personalizado", () => {
    const arRows = [arRow({ balanceReceivable: 100, dueDate: new Date(2026, 5, 10) })];
    const parsed = parseDailyRadarExportQuery({
      baseDate: "2026-06-09",
      range: "custom",
      customStartDate: "2026-06-09",
      customEndDate: "2026-06-15",
    });
    const payload = buildFinanceCashFlowDailyRadarExportPayload(
      arRows,
      [],
      parsed,
      { userName: "Teste" },
      BASE
    );
    assert.equal(payload.rangeKey, "custom");
    assert.equal(payload.entriesTotal, 100);
  });

  it("exportação rejeita período personalizado inválido", () => {
    assert.throws(
      () =>
        parseDailyRadarExportQuery({
          range: "custom",
          customStartDate: "2026-06-20",
          customEndDate: "2026-06-10",
        }),
      (err: unknown) => err instanceof FinanceCashFlowDailyRadarExportError
    );
  });
});
