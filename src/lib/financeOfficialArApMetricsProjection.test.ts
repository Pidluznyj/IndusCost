import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildFinanceAccountsReceivableDashboard,
  type FinanceArDashboardRow,
} from "./financeAccountsReceivableDashboard.js";
import {
  buildOfficialAccountsReceivableRulesResult,
  computeOfficialArMetrics,
} from "./financeAccountsReceivableRulesAdapter.js";
import type { FinanceAccountsReceivableMetrics } from "./financeAccountsReceivableRulesEngine.js";
import {
  buildFinanceAccountsPayableDashboard,
  type FinanceApDashboardRow,
} from "./financeAccountsPayableDashboard.js";
import {
  buildOfficialAccountsPayableRulesResult,
  computeOfficialApMetrics,
} from "./financeAccountsPayableRulesAdapter.js";
import type { FinanceAccountsPayableMetrics } from "./financeAccountsPayableRulesEngine.js";
import { buildNomusArReportSyncCutoff } from "./financeNomusArReportFreshness.js";

const REF = new Date(2026, 5, 6, 12, 0, 0, 0);

function arRow(
  partial: Partial<FinanceArDashboardRow> & Pick<FinanceArDashboardRow, "externalId">
): FinanceArDashboardRow {
  return {
    companyName: "Empresa A",
    personId: null,
    comments: null,
    personName: "Cliente X",
    personCnpj: "12.345.678/0001-90",
    dueDate: new Date(2026, 5, 15),
    settlementDate: null,
    competenceDate: null,
    amountReceivable: 1000,
    amountReceived: 0,
    balanceReceivable: 1000,
    paymentMethodName: "Boleto",
    bankAccountName: "Bradesco",
    sourceInvoiceId: 100,
    sourceInvoiceNumber: "NF-100",
    suspendCollection: false,
    description: null,
    nomusStatus: true,
    syncedAt: new Date("2026-06-06T12:00:00.000Z"),
    ...partial,
  };
}

function apRow(
  partial: Partial<FinanceApDashboardRow> & Pick<FinanceApDashboardRow, "externalId">
): FinanceApDashboardRow {
  return {
    companyName: "Empresa A",
    personName: "Fornecedor X",
    personCnpj: "12.345.678/0001-90",
    dueDate: new Date(2026, 5, 15),
    scheduleDate: null,
    type: null,
    settlementDate: null,
    paymentDate: null,
    amountPayable: 1000,
    amountPaid: 0,
    balancePayable: 1000,
    paymentMethodName: "PIX",
    bankAccountName: "Bradesco",
    sourceInvoiceId: null,
    documentNumber: "DOC-1",
    suspendPayment: false,
    description: null,
    nomusStatus: true,
    syncedAt: new Date("2026-06-06T12:00:00.000Z"),
    ...partial,
  };
}

function assertArMetricsEqual(
  metrics: FinanceAccountsReceivableMetrics,
  full: FinanceAccountsReceivableMetrics
) {
  assert.deepEqual(metrics, full);
}

function assertApMetricsEqual(
  metrics: FinanceAccountsPayableMetrics,
  full: FinanceAccountsPayableMetrics
) {
  assert.deepEqual(metrics, full);
}

function assertArCashFlowCards(metricsCards: { totalOpenAmount: number; totalReceivedAmount: number; overdueAmount: number }, fullCards: { totalOpenAmount: number; totalReceivedAmount: number; overdueAmount: number }) {
  assert.equal(metricsCards.totalOpenAmount, fullCards.totalOpenAmount);
  assert.equal(metricsCards.totalReceivedAmount, fullCards.totalReceivedAmount);
  assert.equal(metricsCards.overdueAmount, fullCards.overdueAmount);
}

function compareAr(
  rows: FinanceArDashboardRow[],
  input: Partial<Parameters<typeof computeOfficialArMetrics>[0]> = {}
) {
  const full = buildOfficialAccountsReceivableRulesResult({
    rows,
    referenceDate: REF,
    ...input,
  });
  const metrics = computeOfficialArMetrics({
    rows,
    referenceDate: REF,
    ...input,
  });
  assertArMetricsEqual(metrics.metrics, full.metrics);
  assertArCashFlowCards(metrics.cards, full.cards);
  assert.equal(metrics.projection, "metrics");
  assert.equal(full.projection, "full");
  assert.equal(metrics.cards.totalOpenAmount, full.fullDashboard.cards.totalOpenAmount);
  return { full, metrics };
}

function compareAp(
  rows: FinanceApDashboardRow[],
  input: Partial<Parameters<typeof computeOfficialApMetrics>[0]> = {}
) {
  const full = buildOfficialAccountsPayableRulesResult({
    rows,
    referenceDate: REF,
    ...input,
  });
  const metrics = computeOfficialApMetrics({
    rows,
    referenceDate: REF,
    ...input,
  });
  assertApMetricsEqual(metrics.metrics, full.metrics);
  assert.equal(metrics.cards.totalOpenAmount, full.cards.totalOpenAmount);
  assert.equal(metrics.cards.totalPayableAmount, full.cards.totalPayableAmount);
  assert.equal(metrics.cards.overdueAmount, full.cards.overdueAmount);
  assert.equal(metrics.cards.paidThisMonthAmount, full.cards.paidThisMonthAmount);
  assert.equal(metrics.projection, "metrics");
  assert.equal(full.projection, "full");
  return { full, metrics };
}

describe("PERF 3.3 official AR/AP metrics vs full engine", () => {
  it("AR vazio", () => {
    compareAr([]);
  });

  it("AP vazio", () => {
    compareAp([]);
  });

  it("AR um título aberto", () => {
    compareAr([arRow({ externalId: 1 })]);
  });

  it("AP um título aberto", () => {
    compareAp([apRow({ externalId: 1 })]);
  });

  it("AR vencido, futuro, recebido e parcial", () => {
    compareAr([
      arRow({
        externalId: 1,
        dueDate: new Date(2026, 4, 1),
        balanceReceivable: 400,
        amountReceivable: 400,
      }),
      arRow({
        externalId: 2,
        dueDate: new Date(2026, 7, 1),
        balanceReceivable: 250,
        amountReceivable: 250,
      }),
      arRow({
        externalId: 3,
        dueDate: new Date(2026, 2, 1),
        settlementDate: new Date(2026, 5, 2),
        balanceReceivable: 0,
        amountReceived: 800,
        amountReceivable: 800,
      }),
      arRow({
        externalId: 4,
        dueDate: new Date(2026, 5, 20),
        amountReceivable: 1000,
        amountReceived: 350.555,
        balanceReceivable: 649.445,
      }),
    ]);
  });

  it("AP vencido, futuro, pago e parcial", () => {
    compareAp([
      apRow({
        externalId: 1,
        dueDate: new Date(2026, 4, 1),
        balancePayable: 400,
        amountPayable: 400,
      }),
      apRow({
        externalId: 2,
        dueDate: new Date(2026, 7, 1),
        balancePayable: 250,
        amountPayable: 250,
      }),
      apRow({
        externalId: 3,
        dueDate: new Date(2026, 2, 1),
        paymentDate: new Date(2026, 5, 2),
        settlementDate: new Date(2026, 5, 2),
        balancePayable: 0,
        amountPaid: 800,
        amountPayable: 800,
      }),
      apRow({
        externalId: 4,
        dueDate: new Date(2026, 5, 20),
        amountPayable: 1000,
        amountPaid: 350.555,
        balancePayable: 649.445,
      }),
    ]);
  });

  it("AR múltiplos meses e virada de ano", () => {
    compareAr(
      [
        arRow({
          externalId: 1,
          dueDate: new Date(2025, 11, 31),
          balanceReceivable: 90,
          amountReceivable: 90,
        }),
        arRow({
          externalId: 2,
          dueDate: new Date(2026, 0, 1),
          balanceReceivable: 110,
          amountReceivable: 110,
        }),
        arRow({
          externalId: 3,
          dueDate: new Date(2026, 11, 15),
          balanceReceivable: 70,
          amountReceivable: 70,
        }),
      ],
      { filters: { status: "all", year: 2026 }, year: 2026 }
    );
  });

  it("AP múltiplos meses e virada de ano", () => {
    compareAp(
      [
        apRow({
          externalId: 1,
          dueDate: new Date(2025, 11, 31),
          balancePayable: 90,
          amountPayable: 90,
        }),
        apRow({
          externalId: 2,
          dueDate: new Date(2026, 0, 1),
          balancePayable: 110,
          amountPayable: 110,
        }),
      ],
      { filters: { status: "all", year: 2026 }, year: 2026 }
    );
  });

  it("AR filtro de carteira e período", () => {
    const rows = [
      arRow({ externalId: 1, companyName: "Empresa A", personName: "Cliente A" }),
      arRow({
        externalId: 2,
        companyName: "Empresa B",
        personName: "Cliente B",
        personCnpj: "99.999.999/0001-99",
      }),
    ];
    compareAr(rows, { filters: { status: "all", companyName: "Empresa A" } });
    compareAr(rows, { filters: { status: "open", year: 2026, month: 6 } });
  });

  it("AP filtro de carteira e período", () => {
    const rows = [
      apRow({ externalId: 1, companyName: "Empresa A", personName: "Fornecedor A" }),
      apRow({
        externalId: 2,
        companyName: "Empresa B",
        personName: "Fornecedor B",
        personCnpj: "99.999.999/0001-99",
      }),
    ];
    compareAp(rows, { filters: { status: "all", companyName: "Empresa A" } });
    compareAp(rows, { filters: { status: "open", year: 2026, month: 6 } });
  });

  it("AR cutoff stale exclui título antigo", () => {
    const fresh = new Date("2026-06-06T12:00:00.000Z");
    const stale = new Date("2026-06-06T08:00:00.000Z");
    const rows = [
      arRow({ externalId: 1, syncedAt: fresh, balanceReceivable: 500, amountReceivable: 500 }),
      arRow({ externalId: 2, syncedAt: stale, balanceReceivable: 700, amountReceivable: 700 }),
    ];
    const cutoff = buildNomusArReportSyncCutoff(fresh);
    const { metrics } = compareAr(rows, { syncCutoff: cutoff });
    assert.equal(metrics.metrics.openAmount, 500);
  });

  it("AR exclui fantasma, grupo interno e vencido sem NF", () => {
    const rows = [
      arRow({ externalId: 1, balanceReceivable: 300, amountReceivable: 300 }),
      arRow({
        externalId: 2,
        amountReceivable: 900,
        amountReceived: 0,
        balanceReceivable: 0,
      }),
      arRow({
        externalId: 3,
        personCnpj: "72569510000195",
        personName: "Lazarios Comercio de Plasticos LTDA",
        balanceReceivable: 400,
        amountReceivable: 400,
      }),
      arRow({
        externalId: 4,
        dueDate: new Date(2026, 4, 1),
        sourceInvoiceId: null,
        sourceInvoiceNumber: null,
        balanceReceivable: 250,
        amountReceivable: 250,
      }),
    ];
    const { metrics } = compareAr(rows);
    assert.equal(metrics.metrics.openAmount, 300);
  });

  it("AP exclui agenda de pedido de compra e intercompany", () => {
    const rows = [
      apRow({ externalId: 1, balancePayable: 300, amountPayable: 300 }),
      apRow({
        externalId: 2,
        type: 2,
        description: "Pedido de compra PC 99",
        balancePayable: 800,
        amountPayable: 800,
      }),
      apRow({
        externalId: 3,
        companyName: "Lazarios Comercio de Plasticos LTDA",
        personCnpj: "72569510000195",
        personName: "Lazarios Comercio de Plasticos LTDA",
        balancePayable: 400,
        amountPayable: 400,
      }),
    ];
    const { metrics } = compareAp(rows);
    assert.equal(metrics.metrics.openAmount, 300);
  });

  it("projeção cards do dashboard oficial preserva cards do full", () => {
    const arRows = [
      arRow({ externalId: 1, dueDate: new Date(2026, 4, 1), balanceReceivable: 120 }),
      arRow({ externalId: 2, dueDate: new Date(2026, 5, 20), balanceReceivable: 80 }),
    ];
    const arFull = buildFinanceAccountsReceivableDashboard(arRows, { status: "all" }, REF);
    const arCards = buildFinanceAccountsReceivableDashboard(arRows, { status: "all" }, REF, null, {
      projection: "cards",
    });
    assert.deepEqual(arCards.cards, arFull.cards);
    assert.equal(arCards.agingBuckets.length, 0);
    assert.equal(arCards.customerRanking.length, 0);
    assert.equal(arFull.agingBuckets.length > 0, true);

    const apRows = [
      apRow({ externalId: 1, dueDate: new Date(2026, 4, 1), balancePayable: 120 }),
      apRow({ externalId: 2, dueDate: new Date(2026, 5, 20), balancePayable: 80 }),
    ];
    const apFull = buildFinanceAccountsPayableDashboard(apRows, { status: "all" }, REF);
    const apCards = buildFinanceAccountsPayableDashboard(apRows, { status: "all" }, REF, null, {
      projection: "cards",
    });
    const { topSupplier: _fullTop, ...fullCards } = apFull.cards;
    const { topSupplier: _cardsTop, ...metricsCards } = apCards.cards;
    assert.deepEqual(metricsCards, fullCards);
    assert.equal(apCards.agingBuckets.length, 0);
    assert.equal(apFull.agingBuckets.length > 0, true);
  });
});
