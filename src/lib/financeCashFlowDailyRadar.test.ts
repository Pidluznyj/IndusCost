import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  buildFinanceCashFlowDashboard,
  type FinanceCashFlowApRow,
  type FinanceCashFlowArRow,
} from "./financeCashFlowDashboard.js";
import {
  buildFinanceCashFlowDailyRadar,
  createDailyRadarDashboardFilters,
  dailyRadarDayCardLabel,
  DAILY_RADAR_RANGES,
} from "./financeCashFlowDailyRadar.js";

const BASE = new Date(2026, 5, 9);

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

describe("financeCashFlowDailyRadar", () => {
  it("retorna ranges sem depender de filtros globais de ano/mês", () => {
    const arRows = [
      arRow({ externalId: 1, balanceReceivable: 100, dueDate: new Date(2026, 5, 9) }),
      arRow({ externalId: 2, balanceReceivable: 200, dueDate: new Date(2027, 0, 5) }),
    ];
    const apRows = [apRow({ balancePayable: 50, dueDate: new Date(2026, 5, 10) })];

    const radar = buildFinanceCashFlowDailyRadar(arRows, apRows, { baseDate: BASE }, BASE);
    assert.equal(radar.ranges.length, DAILY_RADAR_RANGES.length);
    assert.ok(radar.ranges.every((r) => Number.isFinite(r.netTotal)));

    const dashboard2026 = buildFinanceCashFlowDashboard(
      arRows,
      apRows,
      { viewMode: "projected", dateBase: "due", status: "open", year: 2026 },
      BASE
    );
    const dashboard2027 = buildFinanceCashFlowDashboard(
      arRows,
      apRows,
      { viewMode: "projected", dateBase: "due", status: "open", year: 2027 },
      BASE
    );
    assert.notEqual(dashboard2026.cards.inflowAmount, dashboard2027.cards.inflowAmount);

    const radarAgain = buildFinanceCashFlowDailyRadar(arRows, apRows, { baseDate: BASE }, BASE);
    assert.deepEqual(radar.ranges, radarAgain.ranges);
  });

  it("faixa 0-7 retorna exatamente D0..D7", () => {
    const arRows = [arRow({ balanceReceivable: 100, dueDate: new Date(2026, 5, 12) })];
    const payload = buildFinanceCashFlowDailyRadar(
      arRows,
      [],
      { baseDate: BASE, rangeKey: "0-7" },
      BASE
    );
    assert.ok(payload.selectedRange);
    assert.equal(payload.selectedRange!.key, "0-7");
    assert.equal(payload.selectedRange!.days.length, 8);
    assert.deepEqual(
      payload.selectedRange!.days.map((d) => d.dayOffset),
      [0, 1, 2, 3, 4, 5, 6, 7]
    );
    assert.equal(dailyRadarDayCardLabel(0), "Hoje");
    assert.equal(dailyRadarDayCardLabel(1), "Amanhã");
    assert.equal(dailyRadarDayCardLabel(3), "D+3");
  });

  it("soma da faixa bate com soma dos subcards diários", () => {
    const arRows = [
      arRow({ externalId: 1, balanceReceivable: 100, dueDate: new Date(2026, 5, 9) }),
      arRow({ externalId: 2, balanceReceivable: 200, dueDate: new Date(2026, 5, 11) }),
      arRow({ externalId: 3, balanceReceivable: 300, dueDate: new Date(2026, 5, 15) }),
    ];
    const apRows = [
      apRow({ externalId: 10, balancePayable: 40, dueDate: new Date(2026, 5, 10) }),
      apRow({ externalId: 11, balancePayable: 60, dueDate: new Date(2026, 5, 14) }),
    ];
    const payload = buildFinanceCashFlowDailyRadar(
      arRows,
      apRows,
      { baseDate: BASE, rangeKey: "0-7" },
      BASE
    );
    const range = payload.ranges.find((r) => r.key === "0-7");
    assert.ok(range);
    const days = payload.selectedRange!.days;
    const sumReceivable = days.reduce((s, d) => s + d.receivableTotal, 0);
    const sumPayable = days.reduce((s, d) => s + d.payableTotal, 0);
    assert.equal(range!.receivableTotal, sumReceivable);
    assert.equal(range!.payableTotal, sumPayable);
    assert.equal(range!.netTotal, sumReceivable - sumPayable);
  });

  it("detalhe do dia bate com grids AP/AR e saldo líquido", () => {
    const arRows = [
      arRow({ externalId: 1, balanceReceivable: 1000, dueDate: new Date(2026, 5, 9) }),
      arRow({ externalId: 2, balanceReceivable: 250, dueDate: new Date(2026, 5, 9) }),
    ];
    const apRows = [apRow({ balancePayable: 400, dueDate: new Date(2026, 5, 9) })];
    const payload = buildFinanceCashFlowDailyRadar(
      arRows,
      apRows,
      { baseDate: BASE, rangeKey: "0-7", day: "2026-06-09" },
      BASE
    );
    assert.ok(payload.selectedDay);
    const day = payload.selectedDay!;
    assert.equal(day.receivables.total, 1250);
    assert.equal(day.payables.total, 400);
    assert.equal(day.receivables.count, 2);
    assert.equal(day.payables.count, 1);
    const daySummary = payload.selectedRange?.days.find((d) => d.date === "2026-06-09");
    assert.ok(daySummary);
    assert.equal(daySummary!.receivableTotal, day.receivables.total);
    assert.equal(daySummary!.payableTotal, day.payables.total);
    assert.equal(daySummary!.netTotal, day.receivables.total - day.payables.total);
  });

  it("vencidos ficam na faixa overdue, não em D0", () => {
    const apRows = [apRow({ balancePayable: 900, dueDate: new Date(2026, 5, 1) })];
    const payload = buildFinanceCashFlowDailyRadar(
      [],
      apRows,
      { baseDate: BASE, rangeKey: "0-7" },
      BASE
    );
    const overdue = payload.ranges.find((r) => r.key === "overdue");
    assert.ok(overdue);
    assert.equal(overdue!.payableTotal, 900);
    const d0 = payload.selectedRange!.days.find((d) => d.dayOffset === 0);
    assert.ok(d0);
    assert.equal(d0!.payableTotal, 0);
  });

  it("empty states: dia sem AP ou AR", () => {
    const payloadArOnly = buildFinanceCashFlowDailyRadar(
      [arRow({ balanceReceivable: 100, dueDate: new Date(2026, 5, 9) })],
      [],
      { baseDate: BASE, day: "2026-06-09" },
      BASE
    );
    assert.equal(payloadArOnly.selectedDay!.payables.count, 0);
    assert.equal(payloadArOnly.selectedDay!.payables.rows.length, 0);

    const payloadApOnly = buildFinanceCashFlowDailyRadar(
      [],
      [apRow({ balancePayable: 100, dueDate: new Date(2026, 5, 9) })],
      { baseDate: BASE, day: "2026-06-09" },
      BASE
    );
    assert.equal(payloadApOnly.selectedDay!.receivables.count, 0);
  });

  it("createDailyRadarDashboardFilters não inclui ano/mês/empresa", () => {
    const filters = createDailyRadarDashboardFilters();
    assert.equal(filters.viewMode, "projected");
    assert.equal(filters.status, "open");
    assert.equal(filters.year, undefined);
    assert.equal(filters.month, undefined);
    assert.equal(filters.companyName, undefined);
  });

  it("FinanceCashFlowPage usa Radar Diário e não Detalhamento operacional na visão geral", () => {
    const page = readFileSync(
      join(process.cwd(), "src", "components", "finance", "FinanceCashFlowPage.tsx"),
      "utf8"
    );
    const radar = readFileSync(
      join(
        process.cwd(),
        "src",
        "components",
        "finance",
        "cash-flow",
        "FinanceCashFlowDailyRadar.tsx"
      ),
      "utf8"
    );
    assert.ok(page.includes("FinanceCashFlowDailyRadar"));
    assert.ok(page.includes("cash-flow-daily-radar") || radar.includes("cash-flow-daily-radar"));
    assert.ok(!page.includes("FinanceCashFlowDetailTable"));
    assert.ok(radar.includes("/api/finance/cash-flow/daily-radar"));
  });

  it("rotas expõem endpoint daily-radar", () => {
    const routes = readFileSync(
      join(process.cwd(), "src", "lib", "financeCashFlowRoutes.ts"),
      "utf8"
    );
    assert.ok(routes.includes("/api/finance/cash-flow/daily-radar"));
    assert.ok(routes.includes("loadDailyRadarPortfolioRows"));
  });
});
