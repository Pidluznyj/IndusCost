import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildFinanceCashFlowDashboard,
  buildFinanceCashFlowMonthlySeries,
  financeCashFlowMetricsAreFinite,
  type FinanceCashFlowApRow,
  type FinanceCashFlowArRow,
} from "./financeCashFlowDashboard.js";

const REF = new Date(2026, 5, 9);

function arRow(overrides: Partial<FinanceCashFlowArRow> = {}): FinanceCashFlowArRow {
  return {
    externalId: 1,
    companyName: "Empresa A",
    personName: "Cliente X",
    personCnpj: "11111111000111",
    description: null,
    dueDate: new Date(2026, 5, 15),
    settlementDate: null,
    competenceDate: new Date(2026, 5, 1),
    amountReceivable: 1000,
    amountReceived: 0,
    balanceReceivable: 1000,
    paymentMethodName: "Boleto",
    bankAccountName: "Conta 1",
    sourceInvoiceId: null,
    sourceInvoiceNumber: null,
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
    description: null,
    dueDate: new Date(2026, 5, 20),
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

describe("financeCashFlowDashboard", () => {
  it("entrada prevista usa saldo em aberto e vencimento", () => {
    const payload = buildFinanceCashFlowDashboard(
      [arRow({ balanceReceivable: 3000, dueDate: new Date(2026, 2, 10) })],
      [],
      { viewMode: "projected", dateBase: "due", status: "all", year: 2026 },
      REF
    );
    const mar = payload.monthlySeries.find((p) => p.month === 3);
    assert.ok(mar);
    assert.equal(mar!.inflowAmount, 3000);
    assert.equal(mar!.outflowAmount, 0);
  });

  it("saída prevista usa balancePayable positivo como outflow", () => {
    const payload = buildFinanceCashFlowDashboard(
      [],
      [apRow({ balancePayable: 800, dueDate: new Date(2026, 3, 5) })],
      { viewMode: "projected", dateBase: "due", status: "all", year: 2026 },
      REF
    );
    const abr = payload.monthlySeries.find((p) => p.month === 4);
    assert.ok(abr);
    assert.equal(abr!.outflowAmount, 800);
    assert.ok(abr!.outflowAmount > 0);
  });

  it("fluxo líquido = entradas - saídas", () => {
    const payload = buildFinanceCashFlowDashboard(
      [arRow({ balanceReceivable: 2000, dueDate: new Date(2026, 0, 10) })],
      [apRow({ balancePayable: 700, dueDate: new Date(2026, 0, 12) })],
      { viewMode: "projected", dateBase: "due", status: "all", year: 2026 },
      REF
    );
    const jan = payload.monthlySeries.find((p) => p.month === 1);
    assert.ok(jan);
    assert.equal(jan!.netFlowAmount, 1300);
    assert.equal(payload.cards.netFlowAmount, 1300);
  });

  it("saldo acumulado soma fluxo líquido mês a mês", () => {
    const series = buildFinanceCashFlowMonthlySeries(
      [arRow({ balanceReceivable: 100, dueDate: new Date(2026, 0, 5) })],
      [apRow({ balancePayable: 40, dueDate: new Date(2026, 1, 5) })],
      { viewMode: "projected", dateBase: "due", status: "all", year: 2026 },
      REF
    );
    assert.equal(series[0]!.accumulatedBalance, 100);
    assert.equal(series[1]!.accumulatedBalance, 60);
  });

  it("filtros por ano/mês/empresa/status", () => {
    const rows = [
      arRow({
        companyName: "Empresa B",
        balanceReceivable: 900,
        dueDate: new Date(2026, 4, 1),
      }),
      arRow({
        externalId: 3,
        companyName: "Empresa A",
        balanceReceivable: 100,
        dueDate: new Date(2026, 4, 1),
      }),
    ];
    const payload = buildFinanceCashFlowDashboard(
      rows,
      [],
      {
        viewMode: "projected",
        dateBase: "due",
        status: "open",
        year: 2026,
        month: 5,
        companyName: "Empresa A",
      },
      REF
    );
    assert.equal(payload.cards.inflowAmount, 100);
    assert.equal(payload.cards.arRecords, 1);
  });

  it("entrada realizada usa settlementDate e amountReceived", () => {
    const payload = buildFinanceCashFlowDashboard(
      [
        arRow({
          balanceReceivable: 0,
          amountReceived: 1500,
          settlementDate: new Date(2026, 1, 8),
        }),
      ],
      [],
      { viewMode: "realized", dateBase: "settlement", status: "all", year: 2026 },
      REF
    );
    const fev = payload.monthlySeries.find((p) => p.month === 2);
    assert.ok(fev);
    assert.equal(fev!.inflowAmount, 1500);
  });

  it("meses futuros null no modo realizado (ano corrente)", () => {
    const payload = buildFinanceCashFlowDashboard(
      [
        arRow({
          amountReceived: 100,
          balanceReceivable: 0,
          settlementDate: new Date(2026, 5, 1),
        }),
      ],
      [],
      { viewMode: "realized", dateBase: "settlement", status: "all", year: 2026 },
      REF
    );
    const jul = payload.monthlySeries.find((p) => p.month === 7);
    assert.ok(jul);
    assert.equal(jul!.inflowAmount, null);
    assert.equal(jul!.accumulatedBalance, null);
  });

  it("ausência de NaN/Infinity", () => {
    const payload = buildFinanceCashFlowDashboard(
      [arRow()],
      [apRow()],
      { viewMode: "combined", dateBase: "due", status: "all", year: 2026 },
      REF
    );
    assert.equal(financeCashFlowMetricsAreFinite(payload), true);
  });

  it("total a receber e a pagar refletem saldos abertos filtrados", () => {
    const payload = buildFinanceCashFlowDashboard(
      [arRow({ balanceReceivable: 1200 })],
      [apRow({ balancePayable: 450 })],
      { viewMode: "projected", dateBase: "due", status: "all", year: 2026 },
      REF
    );
    assert.equal(payload.cards.totalReceivableOpen, 1200);
    assert.equal(payload.cards.totalPayableOpen, 450);
    assert.equal(payload.cards.hasInitialBankBalance, false);
  });

  it("vencidos impactam caixa", () => {
    const payload = buildFinanceCashFlowDashboard(
      [arRow({ dueDate: new Date(2026, 4, 1), balanceReceivable: 200 })],
      [apRow({ dueDate: new Date(2026, 3, 1), balancePayable: 100 })],
      { viewMode: "projected", dateBase: "due", status: "all", year: 2026 },
      REF
    );
    assert.equal(payload.cards.overdueReceivableAmount, 200);
    assert.equal(payload.cards.overduePayableAmount, 100);
    assert.equal(payload.cards.overdueCashImpact, 300);
  });

  it("netCashPosition = receber aberto − pagar aberto", () => {
    const payload = buildFinanceCashFlowDashboard(
      [arRow({ balanceReceivable: 1200 })],
      [apRow({ balancePayable: 450 })],
      { viewMode: "projected", dateBase: "due", status: "all", year: 2026 },
      REF
    );
    assert.equal(payload.cards.netCashPosition, 750);
    assert.equal(payload.cards.netCashPositionStatus, "surplus");
    assert.equal(payload.cards.netCashPositionLabel, "Superávit projetado");
    assert.equal(payload.cards.cashNeedAmount, 0);
    assert.equal(payload.cards.cashNeedLabel, "Folga projetada");
  });

  it("déficit projeta necessidade de caixa", () => {
    const payload = buildFinanceCashFlowDashboard(
      [arRow({ balanceReceivable: 300 })],
      [apRow({ balancePayable: 900 })],
      { viewMode: "projected", dateBase: "due", status: "all", year: 2026 },
      REF
    );
    assert.equal(payload.cards.netCashPosition, -600);
    assert.equal(payload.cards.netCashPositionStatus, "deficit");
    assert.equal(payload.cards.cashNeedAmount, 600);
    assert.equal(payload.cards.cashNeedLabel, "Necessidade de caixa");
  });

  it("série mensal marca status positivo e negativo", () => {
    const payload = buildFinanceCashFlowDashboard(
      [arRow({ balanceReceivable: 2000, dueDate: new Date(2026, 0, 10) })],
      [apRow({ balancePayable: 700, dueDate: new Date(2026, 0, 12) })],
      { viewMode: "projected", dateBase: "due", status: "all", year: 2026 },
      REF
    );
    const jan = payload.monthlySeries.find((p) => p.month === 1);
    assert.equal(jan?.status, "positive");

    const negative = buildFinanceCashFlowDashboard(
      [arRow({ balanceReceivable: 200, dueDate: new Date(2026, 1, 10) })],
      [apRow({ balancePayable: 900, dueDate: new Date(2026, 1, 12) })],
      { viewMode: "projected", dateBase: "due", status: "all", year: 2026 },
      REF
    );
    const fev = negative.monthlySeries.find((p) => p.month === 2);
    assert.equal(fev?.status, "negative");
  });

  it("executiveReading é determinístico e não vazio", () => {
    const payload = buildFinanceCashFlowDashboard(
      [arRow({ balanceReceivable: 500 })],
      [apRow({ balancePayable: 900 })],
      { viewMode: "projected", dateBase: "due", status: "all", year: 2026 },
      REF
    );
    assert.ok(payload.executiveReading.length > 0);
    assert.ok(payload.executiveReading.some((l) => l.includes("déficit")));
  });
});
