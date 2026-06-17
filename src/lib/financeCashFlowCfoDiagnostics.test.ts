import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildCashFlowDailyCalendar,
  buildCashFlowExecutiveInsights,
  buildCashHealthScore,
  cashFlowCfoMetricsAreFinite,
  CFO_CONCENTRATION_ALERT_PERCENT,
} from "./financeCashFlowCfoDiagnostics.js";
import {
  buildFinanceCashFlowDashboard,
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

const defaultFilters = {
  viewMode: "projected" as const,
  dateBase: "due" as const,
  status: "all" as const,
  year: 2026,
};

describe("financeCashFlowCfoDiagnostics", () => {
  it("score saudável com superávit e poucos riscos", () => {
    const payload = buildFinanceCashFlowDashboard(
      [arRow({ balanceReceivable: 5000, dueDate: new Date(2026, 6, 10) })],
      [apRow({ balancePayable: 1000, dueDate: new Date(2026, 6, 20) })],
      defaultFilters,
      REF
    );
    assert.ok(payload.cashHealthScore.score >= 60);
    assert.equal(payload.cashHealthScore.classification, "healthy");
    assert.ok(payload.cashHealthScore.explanation.length > 0);
  });

  it("score crítico com déficit e vencidos", () => {
    const payload = buildFinanceCashFlowDashboard(
      [
        arRow({
          balanceReceivable: 200,
          dueDate: new Date(2026, 4, 1),
          personName: "Cliente Pequeno",
        }),
      ],
      [
        apRow({
          balancePayable: 9000,
          dueDate: new Date(2026, 3, 1),
          personName: "Fornecedor Crítico",
        }),
        apRow({
          externalId: 3,
          balancePayable: 5000,
          dueDate: new Date(2026, 5, 25),
        }),
      ],
      defaultFilters,
      REF
    );
    assert.ok(payload.cashHealthScore.score < 60);
    assert.ok(["risk", "critical", "attention"].includes(payload.cashHealthScore.classification));
    assert.equal(payload.executiveInsights.riskLevel, payload.cashHealthScore.classification);
  });

  it("classificação de risco por faixas de score", () => {
    const healthy = buildCashHealthScore({
      cards: {
        totalReceivableOpen: 10000,
        totalPayableOpen: 2000,
        netCashPosition: 8000,
        netCashPositionStatus: "surplus",
        netCashPositionAbs: 8000,
        overdueReceivableAmount: 0,
        overduePayableAmount: 0,
        negativeBalanceMonthsCount: 0,
        cashNeedAmount: 0,
      } as never,
      cashForecast: {
        horizons: {
          currentMonth: { projectedNet: 1000 },
          next3Months: { projectedNet: 3000 },
        },
      } as never,
      conservativeScenario: { cashNeedConservative: 0 } as never,
      topCustomers: [{ percentOfTotal: 20 } as never],
      topSuppliers: [{ percentOfTotal: 15 } as never],
    });
    assert.ok(healthy.score >= 80);
    assert.equal(healthy.classification, "healthy");
  });

  it("alertas de déficit e concentração", () => {
    const payload = buildFinanceCashFlowDashboard(
      [
        arRow({ balanceReceivable: 500, personName: "Cliente Único" }),
        arRow({ externalId: 10, balanceReceivable: 100, personName: "Outro" }),
      ],
      [apRow({ balancePayable: 2000, personName: "Fornecedor Único" })],
      defaultFilters,
      REF
    );
    assert.ok(payload.executiveInsights.alerts.length > 0);
    assert.ok(
      payload.executiveInsights.alerts.some(
        (a) => a.title.includes("Déficit") || a.severity === "critical"
      )
    );
    const highConcentration = buildFinanceCashFlowDashboard(
      [arRow({ balanceReceivable: 9000, personName: "Esmaltec S/A" })],
      [apRow({ balancePayable: 100 })],
      defaultFilters,
      REF
    );
    if (
      (highConcentration.topCustomers[0]?.percentOfTotal ?? 0) >=
      CFO_CONCENTRATION_ALERT_PERCENT
    ) {
      assert.ok(
        highConcentration.executiveInsights.alerts.some((a) =>
          a.title.toLowerCase().includes("concentração")
        )
      );
    }
  });

  it("oportunidades de cobrança com vencidos", () => {
    const payload = buildFinanceCashFlowDashboard(
      [arRow({ balanceReceivable: 3000, dueDate: new Date(2026, 4, 1), personName: "Esmaltec S/A" })],
      [],
      defaultFilters,
      REF
    );
    assert.ok(payload.executiveInsights.opportunities.length > 0);
    assert.ok(
      payload.executiveInsights.opportunities.some((o) =>
        o.title.toLowerCase().includes("cobrar")
      )
    );
  });

  it("plano de ação ordenado por impacto (até 5 itens)", () => {
    const payload = buildFinanceCashFlowDashboard(
      [
        arRow({ balanceReceivable: 8000, dueDate: new Date(2026, 4, 1) }),
        arRow({ externalId: 11, balanceReceivable: 2000, dueDate: new Date(2026, 5, 10) }),
      ],
      [apRow({ balancePayable: 12000, dueDate: new Date(2026, 3, 1) })],
      defaultFilters,
      REF
    );
    const actions = payload.executiveInsights.recommendedActions;
    assert.ok(actions.length > 0);
    assert.ok(actions.length <= 5);
    for (let i = 1; i < actions.length; i += 1) {
      const prev = actions[i - 1]!.relatedAmount ?? 0;
      const cur = actions[i]!.relatedAmount ?? 0;
      assert.ok(prev >= cur);
    }
  });

  it("watchlist inclui mês de pressão quando aplicável", () => {
    const payload = buildFinanceCashFlowDashboard(
      [arRow({ balanceReceivable: 100, dueDate: new Date(2026, 8, 10) })],
      [apRow({ balancePayable: 900, dueDate: new Date(2026, 5, 15) })],
      defaultFilters,
      REF
    );
    if (payload.cashForecast.horizons.next12Months.worstMonth) {
      assert.ok(payload.executiveInsights.watchItems.length > 0);
    }
  });

  it("calendário diário agrupa por dia com status", () => {
    const days = buildCashFlowDailyCalendar(
      [arRow({ balanceReceivable: 1000, dueDate: new Date(2026, 5, 15) })],
      [apRow({ balancePayable: 600, dueDate: new Date(2026, 5, 15) })],
      { ...defaultFilters, month: 6 },
      REF
    );
    assert.ok(days.length >= 1);
    const jun15 = days.find((d) => d.date.endsWith("-15"));
    assert.ok(jun15);
    assert.equal(jun15!.inflowAmount, 1000);
    assert.equal(jun15!.outflowAmount, 600);
    assert.equal(jun15!.netAmount, 400);
    assert.equal(jun15!.status, "positive");
    assert.ok(jun15!.summary.includes("Saldo"));
  });

  it("calendário vazio sem movimentos no mês", () => {
    const days = buildCashFlowDailyCalendar(
      [arRow({ dueDate: new Date(2026, 7, 10) })],
      [],
      { ...defaultFilters, month: 6 },
      REF
    );
    assert.equal(days.length, 0);
  });

  it("sem NaN/Infinity no payload CFO", () => {
    const payload = buildFinanceCashFlowDashboard([arRow()], [apRow()], defaultFilters, REF);
    assert.equal(financeCashFlowMetricsAreFinite(payload), true);
    assert.equal(cashFlowCfoMetricsAreFinite(payload.executiveInsights), true);
  });

  it("filtros por empresa respeitados no diagnóstico", () => {
    const payload = buildFinanceCashFlowDashboard(
      [
        arRow({ companyName: "A", balanceReceivable: 1000 }),
        arRow({ externalId: 12, companyName: "B", balanceReceivable: 9000 }),
      ],
      [],
      { ...defaultFilters, companyName: "A" },
      REF
    );
    assert.equal(payload.cards.totalReceivableOpen, 1000);
    assert.ok(payload.executiveInsights.summary.length > 0);
  });

  it("buildCashFlowExecutiveInsights retorna summary e riskLevel", () => {
    const payload = buildFinanceCashFlowDashboard([arRow()], [apRow()], defaultFilters, REF);
    const { executiveInsights } = payload;
    assert.ok(executiveInsights.summary.length > 10);
    assert.ok(["healthy", "attention", "risk", "critical"].includes(executiveInsights.riskLevel));
    assert.ok(executiveInsights.diagnostics.shortTermRisk.length === 3);
  });
});
