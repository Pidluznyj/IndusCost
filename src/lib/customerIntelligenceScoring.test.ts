import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildCustomerIntelligenceScoring,
  resolveHealthClassification,
  scoreCrm,
  scoreFinancial,
  scorePurchaseFrequency,
  scorePurchaseRecency,
  scoreRepurchase,
} from "./customerIntelligenceScoring.js";
import type {
  CustomerIntelligenceCommercialSummary,
  CustomerIntelligenceCrm,
  CustomerIntelligenceFinancial,
  CustomerIntelligencePurchaseHistory,
  CustomerIntelligenceRepurchase,
} from "./customerIntelligenceTypes.js";

const NOW = new Date("2026-06-17T12:00:00.000Z");

function baseCommercialSummary(
  overrides: Partial<CustomerIntelligenceCommercialSummary> = {}
): CustomerIntelligenceCommercialSummary {
  return {
    revenue: 50_000,
    ordersCount: 4,
    validOrdersCount: 4,
    billedOrdersCount: 3,
    openPortfolioAmount: 0,
    averageTicket: 12_500,
    averageMarginPercent: 12,
    totalMarginAmount: 6000,
    lastOrderDate: "2026-05-01",
    daysSinceLastOrder: 47,
    leadingProduct: null,
    ...overrides,
  };
}

function baseHistory(): CustomerIntelligencePurchaseHistory {
  return {
    byYear: [],
    byMonth: [],
    strongestMonths: [],
    analysis: {
      bestYear: 2025,
      bestYearRevenue: 50_000,
      declinedYear: null,
      declinedYearRevenue: null,
      referenceYear: 2025,
      referenceYearRevenue: 50_000,
      growthPercentVsPreviousYear: 15,
      growthStatus: "growth",
      trendReading: "Crescimento de 15% vs ano anterior.",
    },
  };
}

function baseRepurchase(
  overrides: Partial<CustomerIntelligenceRepurchase> = {}
): CustomerIntelligenceRepurchase {
  return {
    status: "DENTRO_JANELA",
    averageDaysBetweenOrders: 60,
    medianDaysBetweenOrders: 55,
    estimatedNextPurchaseDate: "2026-07-01T00:00:00.000Z",
    daysOverExpected: null,
    confidence: "medium",
    detail: "Dentro da janela.",
    ...overrides,
  };
}

function baseFinancial(
  overrides: Partial<CustomerIntelligenceFinancial> = {}
): CustomerIntelligenceFinancial {
  return {
    receivableOpenAmount: 0,
    overdueAmount: 0,
    upcomingAmount: 0,
    openTitlesCount: 0,
    overdueTitlesCount: 0,
    maxDaysOverdue: null,
    averageDaysOverdue: null,
    nextDueDate: null,
    agingBuckets: [],
    openTitles: [],
    overdueTitles: [],
    paymentHistory: [],
    dataQuality: {
      linkedByCnpj: true,
      linkMethod: "cnpj",
      warnings: [],
      staleExcludedCount: 0,
      overdueWithoutFiscalExcludedCount: 0,
      syncCutoffAt: null,
      fiscalBackingNote: "",
    },
    linkedByCnpj: true,
    financialStatus: "healthy",
    riskAlert: null,
    ...overrides,
  };
}

function baseCrm(overrides: Partial<CustomerIntelligenceCrm> = {}): CustomerIntelligenceCrm {
  return {
    commercialOwner: "Maria",
    lastContactAt: "2026-05-10T10:00:00.000Z",
    lastActivityAt: "2026-05-10T10:00:00.000Z",
    nextTaskAt: null,
    openTasksCount: 0,
    overdueTasksCount: 0,
    daysSinceLastContact: 38,
    activities: [],
    tasks: [],
    notes: [],
    relationshipStatus: "ativo",
    dataQuality: { sources: ["CommercialActivity"], warnings: [], activitiesLoaded: 1, profileLoaded: false },
    actions: [],
    ...overrides,
  };
}

describe("customerIntelligenceScoring — partial scores", () => {
  it("compra recente pontua mais que compra antiga", () => {
    assert.ok(scorePurchaseRecency(20) > scorePurchaseRecency(400));
  });

  it("frequência recorrente pontua mais", () => {
    assert.ok(scorePurchaseFrequency(8) > scorePurchaseFrequency(1));
  });

  it("inadimplência reduz score financeiro", () => {
    const healthy = scoreFinancial(baseFinancial({ overdueAmount: 0 }));
    const overdue = scoreFinancial(baseFinancial({ overdueAmount: 15_000, financialStatus: "overdue" }));
    assert.ok(healthy > overdue);
  });

  it("tarefa vencida reduz score CRM", () => {
    const active = scoreCrm(baseCrm());
    const overdue = scoreCrm(baseCrm({ overdueTasksCount: 2, relationshipStatus: "tarefa_vencida" }));
    assert.ok(active > overdue);
  });

  it("recompra atrasada reduz score", () => {
    assert.ok(scoreRepurchase(baseRepurchase()) > scoreRepurchase(baseRepurchase({ status: "ATRASADO" })));
  });
});

describe("buildCustomerIntelligenceScoring", () => {
  it("cliente recente e recorrente tem score maior que inativo", () => {
    const healthy = buildCustomerIntelligenceScoring({
      commercialSummary: baseCommercialSummary({ daysSinceLastOrder: 30, validOrdersCount: 6 }),
      history: baseHistory(),
      repurchase: baseRepurchase(),
      financial: baseFinancial(),
      crm: baseCrm(),
    });

    const inactive = buildCustomerIntelligenceScoring({
      commercialSummary: baseCommercialSummary({ daysSinceLastOrder: 800, validOrdersCount: 2, revenue: 5000 }),
      history: { ...baseHistory(), analysis: { ...baseHistory().analysis, growthStatus: "decline" } },
      repurchase: baseRepurchase({ status: "ATRASADO" }),
      financial: baseFinancial({ overdueAmount: 5000, financialStatus: "overdue" }),
      crm: baseCrm({ overdueTasksCount: 1, relationshipStatus: "tarefa_vencida" }),
    });

    assert.ok(healthy.score > inactive.score);
    assert.ok(Number.isFinite(healthy.score));
    assert.ok(Number.isFinite(inactive.score));
  });

  it("histórico insuficiente classifica corretamente", () => {
    const scoring = buildCustomerIntelligenceScoring({
      commercialSummary: baseCommercialSummary({ validOrdersCount: 0, revenue: 0, daysSinceLastOrder: null }),
      history: { ...baseHistory(), analysis: { ...baseHistory().analysis, growthStatus: "insufficient" } },
      repurchase: baseRepurchase({ status: "INSUFICIENTE" }),
      financial: baseFinancial({ linkedByCnpj: false, financialStatus: "unlinked" }),
      crm: baseCrm({ relationshipStatus: "sem_historico" }),
    });

    assert.equal(scoring.healthClassification, "historico_insuficiente");
  });

  it("não retorna NaN/Infinity", () => {
    const scoring = buildCustomerIntelligenceScoring({
      commercialSummary: baseCommercialSummary({
        averageMarginPercent: null,
        daysSinceLastOrder: null,
        revenue: Number.NaN as unknown as number,
      }),
      history: baseHistory(),
      repurchase: baseRepurchase(),
      financial: baseFinancial(),
      crm: baseCrm(),
    });

    assert.ok(Number.isFinite(scoring.score));
    for (const c of scoring.criteria) {
      assert.ok(Number.isFinite(c.partialScore));
      assert.ok(Number.isFinite(c.earnedPoints));
    }
  });

  it("resolveHealthClassification é determinístico", () => {
    const a = resolveHealthClassification({
      score: 85,
      validOrdersCount: 5,
      daysSinceLastOrder: 20,
      repurchaseStatus: "DENTRO_JANELA",
      hasOverdueFinancial: false,
      overdueTasksCount: 0,
    });
    const b = resolveHealthClassification({
      score: 85,
      validOrdersCount: 5,
      daysSinceLastOrder: 20,
      repurchaseStatus: "DENTRO_JANELA",
      hasOverdueFinancial: false,
      overdueTasksCount: 0,
    });
    assert.equal(a, b);
    assert.equal(a, "excelente");
  });
});
