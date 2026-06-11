import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { buildFinanceCashFlowDashboard } from "./financeCashFlowDashboard.js";
import { buildFinanceCashFlowExportQuery } from "./financeCashFlowDashboardTypes.js";
import {
  cashFlowMonthlySeriesHasData,
  computeCashFlowNetPosition,
} from "./financeCashFlowDisplay.js";
import type { FinanceCashFlowApRow, FinanceCashFlowArRow } from "./financeCashFlowDashboard.js";

const REF = new Date(2026, 5, 9);

function arRow(overrides: Partial<FinanceCashFlowArRow> = {}): FinanceCashFlowArRow {
  return {
    externalId: 1,
    companyName: "Empresa A",
    personName: "Cliente X",
    personCnpj: null,
    description: null,
    dueDate: new Date(2026, 5, 15),
    settlementDate: null,
    competenceDate: null,
    amountReceivable: 1000,
    amountReceived: 0,
    balanceReceivable: 1000,
    paymentMethodName: null,
    bankAccountName: null,
    sourceInvoiceId: null,
    sourceInvoiceNumber: null,
    suspendCollection: false,
    nomusStatus: true,
    syncedAt: new Date(),
    ...overrides,
  };
}

function apRow(overrides: Partial<FinanceCashFlowApRow> = {}): FinanceCashFlowApRow {
  return {
    externalId: 2,
    companyName: "Empresa A",
    personName: "Fornecedor Y",
    personCnpj: null,
    description: null,
    dueDate: new Date(2026, 5, 20),
    scheduleDate: null,
    type: null,
    settlementDate: null,
    paymentDate: null,
    competenceDate: null,
    amountPayable: 500,
    amountPaid: 0,
    balancePayable: 500,
    paymentMethodName: null,
    bankAccountName: null,
    sourceInvoiceId: null,
    documentNumber: null,
    suspendPayment: false,
    nomusStatus: true,
    syncedAt: new Date(),
    ...overrides,
  };
}

const filters = {
  viewMode: "projected" as const,
  dateBase: "due" as const,
  status: "all" as const,
  year: 2026,
};

describe("financeCashFlowValidation — auditoria final", () => {
  it("Control Room rejeitado não existe no repositório", () => {
    const rejected = [
      "src/finance-control-room.css",
      "src/lib/financeControlRoomTheme.ts",
      "scripts/cash-flow-page-formatted.html",
    ];
    for (const path of rejected) {
      assert.equal(existsSync(join(process.cwd(), path)), false, `${path} não deve existir`);
    }
    const page = readFileSync(
      join(process.cwd(), "src", "components", "finance", "FinanceCashFlowPage.tsx"),
      "utf8"
    );
    assert.ok(!page.includes("financeControlRoomTheme"));
    assert.ok(!page.includes("finance-control-room"));
  });

  it("empty state quando série sem movimentos", () => {
    const empty = buildFinanceCashFlowDashboard([], [], filters, REF);
    assert.equal(cashFlowMonthlySeriesHasData(empty.monthlySeries), false);
    assert.equal(empty.cards.totalReceivableOpen, 0);
    assert.equal(empty.cards.totalPayableOpen, 0);
  });

  it("gráfico com dados quando há títulos filtrados", () => {
    const payload = buildFinanceCashFlowDashboard([arRow()], [apRow()], filters, REF);
    assert.equal(cashFlowMonthlySeriesHasData(payload.monthlySeries), true);
  });

  it("contrato funcional — payload cobre perguntas gerenciais", () => {
    const payload = buildFinanceCashFlowDashboard(
      [
        arRow({ balanceReceivable: 3000, dueDate: new Date(2026, 4, 1) }),
        arRow({ externalId: 3, balanceReceivable: 2000, dueDate: new Date(2026, 5, 10) }),
      ],
      [apRow({ balancePayable: 4500, dueDate: new Date(2026, 5, 25) })],
      filters,
      REF
    );

    assert.equal(
      payload.cards.netCashPosition,
      computeCashFlowNetPosition(
        payload.cards.totalReceivableOpen,
        payload.cards.totalPayableOpen
      )
    );
    assert.ok(payload.cards.totalReceivableOpen > 0);
    assert.ok(payload.cards.totalPayableOpen > 0);
    assert.ok(payload.cashForecast.horizons.next12Months);
    assert.ok(payload.conservativeScenario.disclaimer.includes("conservador"));
    assert.ok(payload.stressScenario.disclaimer.includes("crítico"));
    assert.ok(payload.cashHealthScore.score >= 0 && payload.cashHealthScore.score <= 100);
    assert.ok(payload.executiveInsights.recommendedActions.length > 0);
    assert.ok(payload.topCustomers.length > 0);
    assert.ok(payload.topSuppliers.length > 0);
    assert.ok(payload.overdueReceivables.length > 0 || payload.overduePayables.length >= 0);
    assert.ok(payload.operationalRecommendations.length > 0);
    assert.ok(payload.dailyCalendar.length >= 0);
    assert.ok(payload.executiveYtd.scopeLabel.length > 0);
    assert.ok(payload.executiveYtdReading.length > 0);
  });

  it("export query usa filtros sem format isolado quebrado", () => {
    const q = buildFinanceCashFlowExportQuery({ year: "2026", month: "6" });
    assert.ok(q.includes("format=csv"));
    assert.ok(q.includes("year=2026"));
    assert.ok(q.includes("month=6"));
  });
});
