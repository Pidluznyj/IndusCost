import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildCashFlowForecast,
  buildCashFlowOperationalRecommendations,
  buildConservativeScenario,
  buildScenarioChartPoints,
  buildStressScenario,
  CONSERVATIVE_OPEN_RECEIVABLE_FACTOR,
  STRESS_OPEN_RECEIVABLE_FACTOR,
} from "./financeCashFlowForecast.js";
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

describe("financeCashFlowForecast", () => {
  it("horizontes 3, 6 e 12 meses agregam pontos mensais", () => {
    const ar = [
      arRow({ balanceReceivable: 1000, dueDate: new Date(2026, 5, 10) }),
      arRow({ externalId: 3, balanceReceivable: 2000, dueDate: new Date(2026, 7, 10) }),
      arRow({ externalId: 4, balanceReceivable: 3000, dueDate: new Date(2027, 2, 10) }),
    ];
    const ap = [apRow({ balancePayable: 500, dueDate: new Date(2026, 5, 15) })];
    const forecast = buildCashFlowForecast(ar, ap, defaultFilters, REF);

    assert.equal(forecast.monthlyPoints.length, 12);
    assert.equal(forecast.horizons.currentMonth.monthCount, 1);
    assert.equal(forecast.horizons.next3Months.monthCount, 3);
    assert.equal(forecast.horizons.next6Months.monthCount, 6);
    assert.equal(forecast.horizons.next12Months.monthCount, 12);
    assert.equal(forecast.horizons.currentMonth.projectedInflow, 1000);
    assert.equal(forecast.horizons.next3Months.projectedInflow, 3000);
  });

  it("cenário conservador reduz entradas vs base", () => {
    const ar = [arRow({ balanceReceivable: 1000, dueDate: new Date(2026, 5, 10) })];
    const ap = [apRow({ balancePayable: 900, dueDate: new Date(2026, 5, 15) })];
    const base = buildCashFlowForecast(ar, ap, defaultFilters, REF);
    const conservative = buildConservativeScenario(
      ar,
      ap,
      defaultFilters,
      REF,
      base.horizons.next12Months
    );

    assert.ok(conservative.projectedInflowConservative < base.horizons.next12Months.projectedInflow);
    assert.equal(conservative.projectedOutflow, base.horizons.next12Months.projectedOutflow);
    assert.ok(conservative.projectedNetConservative < base.horizons.next12Months.projectedNet);
    assert.ok(conservative.disclaimer.includes("conservador"));
    assert.ok(conservative.assumptions.some((a) => a.includes("80%")));
  });

  it("cenário crítico é mais pessimista que conservador", () => {
    const ar = [arRow({ balanceReceivable: 2000, dueDate: new Date(2026, 5, 10) })];
    const ap = [apRow({ balancePayable: 1500, dueDate: new Date(2026, 5, 15) })];
    const base = buildCashFlowForecast(ar, ap, defaultFilters, REF);
    const conservative = buildConservativeScenario(
      ar,
      ap,
      defaultFilters,
      REF,
      base.horizons.next12Months
    );
    const stress = buildStressScenario(ar, ap, defaultFilters, REF);

    assert.ok(stress.projectedInflowStress <= conservative.projectedInflowConservative);
    assert.ok(stress.disclaimer.includes("crítico"));
    assert.ok(stress.assumptions.some((a) => a.includes("60%")));
  });

  it("identifica necessidade máxima de caixa e primeiro mês negativo", () => {
    const ar = [arRow({ balanceReceivable: 200, dueDate: new Date(2026, 6, 10) })];
    const ap = [
      apRow({ balancePayable: 800, dueDate: new Date(2026, 5, 15) }),
      apRow({ externalId: 5, balancePayable: 600, dueDate: new Date(2026, 7, 15) }),
    ];
    const forecast = buildCashFlowForecast(ar, ap, defaultFilters, REF);
    const h12 = forecast.horizons.next12Months;

    assert.ok(h12.maxCashNeed >= 600);
    assert.ok(h12.negativeMonthsCount >= 1);
    assert.ok(h12.firstNegativeMonth != null);
    assert.ok(h12.worstMonth != null);
    assert.ok((h12.worstMonth?.projectedNet ?? 0) <= 0);
  });

  it("mês de maior pressão reflete pior projectedNet", () => {
    const ar = [arRow({ balanceReceivable: 100, dueDate: new Date(2026, 8, 10) })];
    const ap = [
      apRow({ balancePayable: 200, dueDate: new Date(2026, 5, 15) }),
      apRow({ externalId: 6, balancePayable: 900, dueDate: new Date(2026, 8, 15) }),
    ];
    const forecast = buildCashFlowForecast(ar, ap, defaultFilters, REF);
    const worst = forecast.horizons.next12Months.worstMonth;

    assert.ok(worst);
    assert.equal(worst!.month, 9);
    assert.equal(worst!.projectedNet, -800);
  });

  it("recomendações operacionais são determinísticas", () => {
    const payload = buildFinanceCashFlowDashboard(
      [
        arRow({
          balanceReceivable: 5000,
          dueDate: new Date(2026, 4, 1),
          personName: "Cliente Grande",
        }),
      ],
      [
        apRow({
          balancePayable: 9000,
          dueDate: new Date(2026, 3, 1),
          personName: "Fornecedor Z",
        }),
      ],
      defaultFilters,
      REF
    );

    assert.ok(payload.operationalRecommendations.length > 0);
    assert.ok(
      payload.operationalRecommendations.some((l) => l.includes("vencidos") || l.includes("cobrança"))
    );
    assert.ok(
      payload.operationalRecommendations.some((l) => l.includes("fornecedor") || l.includes("déficit"))
    );
  });

  it("sem NaN/Infinity no payload com forecast", () => {
    const payload = buildFinanceCashFlowDashboard(
      [arRow()],
      [apRow()],
      defaultFilters,
      REF
    );
    assert.equal(financeCashFlowMetricsAreFinite(payload), true);
  });

  it("filtros por empresa respeitados na previsão", () => {
    const ar = [
      arRow({ companyName: "Empresa A", balanceReceivable: 1000, dueDate: new Date(2026, 5, 10) }),
      arRow({
        externalId: 7,
        companyName: "Empresa B",
        balanceReceivable: 5000,
        dueDate: new Date(2026, 5, 10),
      }),
    ];
    const payload = buildFinanceCashFlowDashboard(
      ar,
      [],
      { ...defaultFilters, companyName: "Empresa A" },
      REF
    );
    assert.equal(payload.cashForecast.horizons.currentMonth.projectedInflow, 1000);
  });

  it("meses futuros null no modo realizado na previsão", () => {
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
    const jul = payload.cashForecast.monthlyPoints.find((p) => p.month === 7);
    assert.ok(jul);
    assert.equal(jul!.projectedNet, null);
  });

  it("scenarioChartPoints alinha base, conservador e crítico", () => {
    const ar = [arRow({ balanceReceivable: 1000 })];
    const ap = [apRow({ balancePayable: 600 })];
    const base = buildCashFlowForecast(ar, ap, defaultFilters, REF);
    const conservative = buildConservativeScenario(
      ar,
      ap,
      defaultFilters,
      REF,
      base.horizons.next12Months
    );
    const stress = buildStressScenario(ar, ap, defaultFilters, REF);
    const chart = buildScenarioChartPoints(
      base.monthlyPoints,
      conservative.monthlyPoints,
      stress.monthlyPoints
    );

    assert.equal(chart.length, 12);
    assert.equal(chart[0]!.base, base.monthlyPoints[0]!.projectedNet);
    assert.equal(chart[0]!.conservative, conservative.monthlyPoints[0]!.projectedNet);
    assert.equal(chart[0]!.stress, stress.monthlyPoints[0]!.projectedNet);
  });

  it("vencidos AR usam fator menor no conservador", () => {
    const ar = [
      arRow({
        balanceReceivable: 1000,
        dueDate: new Date(2026, 4, 1),
      }),
    ];
    const openAr = [
      arRow({
        externalId: 8,
        balanceReceivable: 1000,
        dueDate: new Date(2026, 6, 1),
      }),
    ];
    const baseOverdue = buildCashFlowForecast(ar, [], defaultFilters, REF);
    const baseOpen = buildCashFlowForecast(openAr, [], defaultFilters, REF);
    const consOverdue = buildConservativeScenario(
      ar,
      [],
      defaultFilters,
      REF,
      baseOverdue.horizons.next12Months
    );
    const consOpen = buildConservativeScenario(
      openAr,
      [],
      defaultFilters,
      REF,
      baseOpen.horizons.next12Months
    );

    const overdueInflow = consOverdue.projectedInflowConservative;
    const openInflow = consOpen.projectedInflowConservative;
    assert.ok(overdueInflow < openInflow);
    const openRatio =
      openInflow / baseOpen.horizons.next12Months.projectedInflow;
    assert.ok(Math.abs(openRatio - CONSERVATIVE_OPEN_RECEIVABLE_FACTOR) < 0.01);
  });

  it("buildCashFlowOperationalRecommendations com vencidos e déficit", () => {
    const base = buildCashFlowForecast(
      [arRow({ balanceReceivable: 300, dueDate: new Date(2026, 4, 1) })],
      [apRow({ balancePayable: 900 })],
      defaultFilters,
      REF
    );
    const conservative = buildConservativeScenario(
      [arRow({ balanceReceivable: 300 })],
      [apRow({ balancePayable: 900 })],
      defaultFilters,
      REF,
      base.horizons.next12Months
    );
    const lines = buildCashFlowOperationalRecommendations({
      cards: {
        netCashPositionAbs: 600,
        netCashPositionStatus: "deficit",
        cashNeedAmount: 600,
      },
      cashForecast: base,
      conservativeScenario: conservative,
      overdueReceivables: [
        {
          side: "inflow",
          externalId: 1,
          companyName: "Empresa A",
          personName: "Cliente X",
          personCnpj: null,
          amount: 300,
          dueDate: "2026-04-01",
          movementDate: null,
          daysOverdue: 39,
          documentLabel: null,
        },
      ],
      overduePayables: [],
      topSupplier: {
        personName: "Fornecedor Y",
        personCnpj: null,
        amount: 900,
        titlesCount: 1,
        percentOfTotal: 100,
      },
    });

    assert.ok(lines.some((l) => l.includes("Priorizar cobrança")));
    assert.ok(lines.some((l) => l.includes("Negociar prazo")));
    assert.ok(lines.some((l) => l.includes("Evitar assumir novas saídas")));
  });
});

describe("financeCashFlowDashboard forecast integration", () => {
  it("payload inclui cashForecast, cenários e recomendações", () => {
    const payload = buildFinanceCashFlowDashboard([arRow()], [apRow()], defaultFilters, REF);

    assert.ok(payload.cashForecast);
    assert.ok(payload.conservativeScenario);
    assert.ok(payload.stressScenario);
    assert.equal(payload.scenarioChartPoints.length, 12);
    assert.ok(Array.isArray(payload.operationalRecommendations));
    const consRatio =
      payload.conservativeScenario.projectedInflowConservative /
      payload.cashForecast.horizons.next12Months.projectedInflow;
    const stressRatio =
      payload.stressScenario.projectedInflowStress /
      payload.cashForecast.horizons.next12Months.projectedInflow;
    assert.ok(Math.abs(consRatio - CONSERVATIVE_OPEN_RECEIVABLE_FACTOR) < 0.01);
    assert.ok(Math.abs(stressRatio - STRESS_OPEN_RECEIVABLE_FACTOR) < 0.01);
  });
});
