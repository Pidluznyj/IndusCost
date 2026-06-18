import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildCustomerIntelligenceExecutiveNarrative,
  ensureNarrativeNotEmpty,
} from "./customerIntelligenceNarrative.js";
import type {
  CustomerIntelligenceCommercialSummary,
  CustomerIntelligenceCrm,
  CustomerIntelligenceFinancial,
  CustomerIntelligenceOpportunity,
  CustomerIntelligenceProductMix,
  CustomerIntelligenceProfile,
  CustomerIntelligenceRepurchase,
  CustomerIntelligenceScoring,
} from "./customerIntelligenceTypes.js";

function baseProfile(): CustomerIntelligenceProfile {
  return {
    id: "1",
    code: "CNPJ",
    name: "Cliente Teste",
    legalName: "Cliente Teste LTDA",
    cnpj: "CNPJ",
    city: "Curitiba",
    state: "PR",
    region: "Sul",
    registrationDate: "2024-01-01",
    firstOrderDate: "2022-01-01",
    lastOrderDate: "2024-01-01",
    commercialOwner: "Maria",
  };
}

function baseScoring(overrides: Partial<CustomerIntelligenceScoring> = {}): CustomerIntelligenceScoring {
  return {
    score: 45,
    healthClassification: "atencao",
    commercialClassification: "reativacao",
    criteria: [],
    summary: "Score 45/100 — saúde atencao; classificação reativacao.",
    ...overrides,
  };
}

describe("buildCustomerIntelligenceExecutiveNarrative", () => {
  it("menciona dias sem compra e reativação", () => {
    const lines = buildCustomerIntelligenceExecutiveNarrative({
      customer: baseProfile(),
      commercialSummary: {
        revenue: 100_000,
        ordersCount: 4,
        validOrdersCount: 4,
        billedOrdersCount: 3,
        openPortfolioAmount: 0,
        averageTicket: 25_000,
        averageMarginPercent: 12,
        totalMarginAmount: 12_000,
        lastOrderDate: "2024-01-01",
        daysSinceLastOrder: 779,
        leadingProduct: null,
      },
      repurchase: {
        status: "ATRASADO",
        averageDaysBetweenOrders: 120,
        medianDaysBetweenOrders: 110,
        estimatedNextPurchaseDate: null,
        daysOverExpected: 400,
        confidence: "medium",
        detail: "Atrasado.",
      },
      financial: {
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
          linkedByCnpj: false,
          linkMethod: "none",
          warnings: [],
          staleExcludedCount: 0,
          overdueWithoutFiscalExcludedCount: 0,
          syncCutoffAt: null,
          fiscalBackingNote: "",
        },
        linkedByCnpj: false,
        financialStatus: "unlinked",
        riskAlert: null,
      },
      crm: {
        commercialOwner: "Maria",
        lastContactAt: null,
        lastActivityAt: null,
        nextTaskAt: null,
        openTasksCount: 0,
        overdueTasksCount: 0,
        daysSinceLastContact: null,
        activities: [],
        tasks: [],
        notes: [],
        relationshipStatus: "reativacao",
        dataQuality: { sources: [], warnings: [], activitiesLoaded: 0, profileLoaded: false },
        actions: [],
      },
      products: {
        topByRevenue: [],
        topByQuantity: [],
        topByMargin: [],
        abandonedProducts: [],
        recurringProducts: [],
        newProducts: [],
        concentration: {
          top1RevenueSharePercent: 40,
          top3RevenueSharePercent: 80,
          top5RevenueSharePercent: 95,
          distinctProductsCount: 3,
        },
        productOpportunities: [],
      },
      scoring: baseScoring(),
      opportunities: [
        {
          kind: "reativar_cliente",
          type: "OPPORTUNITY",
          severity: "HIGH",
          title: "Reativar",
          description: "d",
          suggestedAction: "Contatar cliente.",
          evidence: [],
          relatedProduct: null,
          priorityScore: 90,
        },
      ],
    });

    assert.ok(lines.some((l) => l.includes("779 dias")));
    assert.ok(lines.some((l) => l.includes("reativação") || l.includes("Reativação") || l.includes("reativar")));
    assert.ok(lines.length > 0);
  });

  it("histórico insuficiente informa claramente", () => {
    const lines = buildCustomerIntelligenceExecutiveNarrative({
      customer: baseProfile(),
      commercialSummary: {
        revenue: 5000,
        ordersCount: 1,
        validOrdersCount: 1,
        billedOrdersCount: 1,
        openPortfolioAmount: 0,
        averageTicket: 5000,
        averageMarginPercent: 10,
        totalMarginAmount: 500,
        lastOrderDate: "2025-01-01",
        daysSinceLastOrder: 100,
        leadingProduct: null,
      },
      repurchase: {
        status: "INSUFICIENTE",
        averageDaysBetweenOrders: null,
        medianDaysBetweenOrders: null,
        estimatedNextPurchaseDate: null,
        daysOverExpected: null,
        confidence: null,
        detail: "Insuficiente.",
      },
      financial: {
        receivableOpenAmount: null,
        overdueAmount: null,
        upcomingAmount: null,
        openTitlesCount: null,
        overdueTitlesCount: null,
        maxDaysOverdue: null,
        averageDaysOverdue: null,
        nextDueDate: null,
        agingBuckets: [],
        openTitles: [],
        overdueTitles: [],
        paymentHistory: [],
        dataQuality: {
          linkedByCnpj: false,
          linkMethod: "none",
          warnings: [],
          staleExcludedCount: 0,
          overdueWithoutFiscalExcludedCount: 0,
          syncCutoffAt: null,
          fiscalBackingNote: "",
        },
        linkedByCnpj: false,
        financialStatus: "unlinked",
        riskAlert: null,
      },
      crm: {
        commercialOwner: null,
        lastContactAt: null,
        lastActivityAt: null,
        nextTaskAt: null,
        openTasksCount: 0,
        overdueTasksCount: 0,
        daysSinceLastContact: null,
        activities: [],
        tasks: [],
        notes: [],
        relationshipStatus: "sem_historico",
        dataQuality: { sources: [], warnings: [], activitiesLoaded: 0, profileLoaded: false },
        actions: [],
      },
      products: {
        topByRevenue: [],
        topByQuantity: [],
        topByMargin: [],
        abandonedProducts: [],
        recurringProducts: [],
        newProducts: [],
        concentration: {
          top1RevenueSharePercent: 100,
          top3RevenueSharePercent: 100,
          top5RevenueSharePercent: 100,
          distinctProductsCount: 1,
        },
        productOpportunities: [],
      },
      scoring: baseScoring({ healthClassification: "historico_insuficiente", score: 35 }),
      opportunities: [],
    });

    assert.ok(lines.some((l) => l.toLowerCase().includes("histórico insuficiente")));
  });

  it("valor vencido aparece na narrativa", () => {
    const lines = buildCustomerIntelligenceExecutiveNarrative({
      customer: baseProfile(),
      commercialSummary: {
        revenue: 20_000,
        ordersCount: 2,
        validOrdersCount: 2,
        billedOrdersCount: 2,
        openPortfolioAmount: 0,
        averageTicket: 10_000,
        averageMarginPercent: 8,
        totalMarginAmount: 1600,
        lastOrderDate: "2026-01-01",
        daysSinceLastOrder: 120,
        leadingProduct: null,
      },
      repurchase: {
        status: "INSUFICIENTE",
        averageDaysBetweenOrders: null,
        medianDaysBetweenOrders: null,
        estimatedNextPurchaseDate: null,
        daysOverExpected: null,
        confidence: null,
        detail: "Insuficiente.",
      },
      financial: {
        receivableOpenAmount: 5000,
        overdueAmount: 3000,
        upcomingAmount: 2000,
        openTitlesCount: 2,
        overdueTitlesCount: 1,
        maxDaysOverdue: 30,
        averageDaysOverdue: 30,
        nextDueDate: "2026-07-01",
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
        financialStatus: "overdue",
        riskAlert: "Inadimplência",
      },
      crm: {
        commercialOwner: "Maria",
        lastContactAt: null,
        lastActivityAt: null,
        nextTaskAt: null,
        openTasksCount: 0,
        overdueTasksCount: 0,
        daysSinceLastContact: null,
        activities: [],
        tasks: [],
        notes: [],
        relationshipStatus: "sem_contato_recente",
        dataQuality: { sources: [], warnings: [], activitiesLoaded: 0, profileLoaded: false },
        actions: [],
      },
      products: {
        topByRevenue: [],
        topByQuantity: [],
        topByMargin: [],
        abandonedProducts: [],
        recurringProducts: [],
        newProducts: [],
        concentration: {
          top1RevenueSharePercent: null,
          top3RevenueSharePercent: null,
          top5RevenueSharePercent: null,
          distinctProductsCount: 0,
        },
        productOpportunities: [],
      },
      scoring: baseScoring({ healthClassification: "risco", score: 38 }),
      opportunities: [],
    });

    assert.ok(lines.some((l) => l.includes("valor vencido") || l.includes("cobrança")));
  });

  it("ensureNarrativeNotEmpty evita narrativa vazia", () => {
    const lines = ensureNarrativeNotEmpty([], "Fallback executivo.");
    assert.equal(lines.length, 1);
    assert.equal(lines[0], "Fallback executivo.");
  });
});
