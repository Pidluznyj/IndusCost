import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildCustomerIntelligenceOpportunities,
  computeOpportunityPriorityScore,
  sortCustomerIntelligenceOpportunities,
} from "./customerIntelligenceOpportunities.js";
import { buildCustomerIntelligenceScoring } from "./customerIntelligenceScoring.js";
import type {
  CustomerIntelligenceCommercialSummary,
  CustomerIntelligenceCrm,
  CustomerIntelligenceDataQuality,
  CustomerIntelligenceFinancial,
  CustomerIntelligenceOpportunity,
  CustomerIntelligenceProductMix,
  CustomerIntelligenceProfile,
  CustomerIntelligenceRepurchase,
} from "./customerIntelligenceTypes.js";

function baseProfile(): CustomerIntelligenceProfile {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    code: "12.345.678/0001-90",
    name: "Cliente Teste",
    legalName: "Cliente Teste LTDA",
    cnpj: "12.345.678/0001-90",
    city: "Curitiba",
    state: "PR",
    region: "Sul",
    registrationDate: "2024-01-01",
    firstOrderDate: "2024-06-01",
    lastOrderDate: "2024-01-01",
    commercialOwner: "Maria",
  };
}

function baseCommercialSummary(
  overrides: Partial<CustomerIntelligenceCommercialSummary> = {}
): CustomerIntelligenceCommercialSummary {
  return {
    revenue: 80_000,
    ordersCount: 5,
    validOrdersCount: 5,
    billedOrdersCount: 4,
    openPortfolioAmount: 0,
    averageTicket: 16_000,
    averageMarginPercent: 10,
    totalMarginAmount: 8000,
    lastOrderDate: "2024-01-01",
    daysSinceLastOrder: 500,
    leadingProduct: {
      productId: "p1",
      sku: "SKU-A",
      name: "Produto A",
      revenue: 50_000,
    },
    ...overrides,
  };
}

function emptyProducts(overrides: Partial<CustomerIntelligenceProductMix> = {}): CustomerIntelligenceProductMix {
  return {
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
    ...overrides,
  };
}

function baseRepurchase(): CustomerIntelligenceRepurchase {
  return {
    status: "INSUFICIENTE",
    averageDaysBetweenOrders: null,
    medianDaysBetweenOrders: null,
    estimatedNextPurchaseDate: null,
    daysOverExpected: null,
    confidence: null,
    detail: "Histórico insuficiente para estimar recompra.",
  };
}

function baseFinancial(
  overrides: Partial<CustomerIntelligenceFinancial> = {}
): CustomerIntelligenceFinancial {
  return {
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
    ...overrides,
  };
}

function baseCrm(): CustomerIntelligenceCrm {
  return {
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
    relationshipStatus: "sem_historico",
    dataQuality: { sources: [], warnings: [], activitiesLoaded: 0, profileLoaded: false },
    actions: [],
  };
}

function baseDataQuality(): CustomerIntelligenceDataQuality {
  return { warnings: [], missingFields: [], sources: ["SalesOrder"] };
}

describe("buildCustomerIntelligenceOpportunities", () => {
  it("produto abandonado gera oportunidade", () => {
    const scoring = buildCustomerIntelligenceScoring({
      commercialSummary: baseCommercialSummary({ daysSinceLastOrder: 120, validOrdersCount: 3 }),
      history: {
        byYear: [],
        byMonth: [],
        strongestMonths: [],
        analysis: {
          bestYear: null,
          bestYearRevenue: null,
          declinedYear: null,
          declinedYearRevenue: null,
          referenceYear: null,
          referenceYearRevenue: null,
          growthPercentVsPreviousYear: null,
          growthStatus: "insufficient",
          trendReading: null,
        },
      },
      repurchase: baseRepurchase(),
      financial: baseFinancial(),
      crm: baseCrm(),
    });

    const opportunities = buildCustomerIntelligenceOpportunities({
      customer: baseProfile(),
      commercialSummary: baseCommercialSummary({ daysSinceLastOrder: 120, validOrdersCount: 3 }),
      products: emptyProducts({
        abandonedProducts: [
          {
            productId: "p2",
            productCode: "SKU-B",
            productName: "Produto B",
            type: "FINAL",
            ordersCount: 2,
            quantity: 5,
            revenue: 3000,
            averageTicket: 1500,
            marginAmount: 300,
            marginPercent: 10,
            firstPurchaseDate: "2023-01-01",
            lastPurchaseDate: "2024-01-01",
            daysSinceLastPurchase: 500,
            shareOfCustomerRevenue: 10,
            confidence: "high",
          },
        ],
      }),
      repurchase: baseRepurchase(),
      financial: baseFinancial(),
      crm: baseCrm(),
      dataQuality: baseDataQuality(),
      scoring,
    });

    assert.ok(opportunities.some((o) => o.kind === "ofertar_produto_abandonado"));
  });

  it("mix concentrado gera oportunidade ampliar mix", () => {
    const scoring = buildCustomerIntelligenceScoring({
      commercialSummary: baseCommercialSummary({ daysSinceLastOrder: 60, validOrdersCount: 4 }),
      history: {
        byYear: [],
        byMonth: [],
        strongestMonths: [],
        analysis: {
          bestYear: 2025,
          bestYearRevenue: 80_000,
          declinedYear: null,
          declinedYearRevenue: null,
          referenceYear: 2025,
          referenceYearRevenue: 80_000,
          growthPercentVsPreviousYear: 10,
          growthStatus: "growth",
          trendReading: null,
        },
      },
      repurchase: { ...baseRepurchase(), status: "DENTRO_JANELA" },
      financial: baseFinancial(),
      crm: baseCrm(),
    });

    const opportunities = buildCustomerIntelligenceOpportunities({
      customer: baseProfile(),
      commercialSummary: baseCommercialSummary({ daysSinceLastOrder: 60, validOrdersCount: 4 }),
      products: emptyProducts({
        concentration: {
          top1RevenueSharePercent: 60,
          top3RevenueSharePercent: 85,
          top5RevenueSharePercent: 95,
          distinctProductsCount: 4,
        },
      }),
      repurchase: { ...baseRepurchase(), status: "DENTRO_JANELA" },
      financial: baseFinancial(),
      crm: baseCrm(),
      dataQuality: baseDataQuality(),
      scoring,
    });

    assert.ok(opportunities.some((o) => o.kind === "ampliar_mix"));
  });

  it("histórico insuficiente não sugere recompra previsível", () => {
    const scoring = buildCustomerIntelligenceScoring({
      commercialSummary: baseCommercialSummary({ validOrdersCount: 1, daysSinceLastOrder: 30, revenue: 5000 }),
      history: {
        byYear: [],
        byMonth: [],
        strongestMonths: [],
        analysis: {
          bestYear: null,
          bestYearRevenue: null,
          declinedYear: null,
          declinedYearRevenue: null,
          referenceYear: null,
          referenceYearRevenue: null,
          growthPercentVsPreviousYear: null,
          growthStatus: "insufficient",
          trendReading: null,
        },
      },
      repurchase: baseRepurchase(),
      financial: baseFinancial(),
      crm: baseCrm(),
    });

    const opportunities = buildCustomerIntelligenceOpportunities({
      customer: baseProfile(),
      commercialSummary: baseCommercialSummary({ validOrdersCount: 1, daysSinceLastOrder: 30, revenue: 5000 }),
      products: emptyProducts(),
      repurchase: baseRepurchase(),
      financial: baseFinancial(),
      crm: baseCrm(),
      dataQuality: baseDataQuality(),
      scoring,
    });

    assert.ok(!opportunities.some((o) => o.kind === "ligar_antes_recompra"));
  });

  it("inadimplência gera acionar cobrança", () => {
    const scoring = buildCustomerIntelligenceScoring({
      commercialSummary: baseCommercialSummary({ daysSinceLastOrder: 45 }),
      history: {
        byYear: [],
        byMonth: [],
        strongestMonths: [],
        analysis: {
          bestYear: 2025,
          bestYearRevenue: 80_000,
          declinedYear: null,
          declinedYearRevenue: null,
          referenceYear: 2025,
          referenceYearRevenue: 80_000,
          growthPercentVsPreviousYear: null,
          growthStatus: "stable",
          trendReading: null,
        },
      },
      repurchase: { ...baseRepurchase(), status: "DENTRO_JANELA" },
      financial: baseFinancial({ linkedByCnpj: true, overdueAmount: 2500, financialStatus: "overdue", overdueTitlesCount: 1 }),
      crm: baseCrm(),
    });

    const opportunities = buildCustomerIntelligenceOpportunities({
      customer: baseProfile(),
      commercialSummary: baseCommercialSummary({ daysSinceLastOrder: 45 }),
      products: emptyProducts(),
      repurchase: { ...baseRepurchase(), status: "DENTRO_JANELA" },
      financial: baseFinancial({ linkedByCnpj: true, overdueAmount: 2500, financialStatus: "overdue", overdueTitlesCount: 1 }),
      crm: baseCrm(),
      dataQuality: baseDataQuality(),
      scoring,
    });

    assert.ok(opportunities.some((o) => o.kind === "acionar_cobranca"));
  });

  it("oportunidades ordenadas por prioridade", () => {
    const items: CustomerIntelligenceOpportunity[] = [
      {
        kind: "atualizar_cadastro",
        type: "INFO",
        severity: "LOW",
        title: "Baixa",
        description: "d",
        suggestedAction: "a",
        evidence: [],
        relatedProduct: null,
        priorityScore: 30,
      },
      {
        kind: "acionar_cobranca",
        type: "RISK",
        severity: "HIGH",
        title: "Alta",
        description: "d",
        suggestedAction: "a",
        evidence: [],
        relatedProduct: null,
        priorityScore: 95,
      },
    ];

    const sorted = sortCustomerIntelligenceOpportunities(items);
    assert.equal(sorted[0]!.kind, "acionar_cobranca");
    assert.ok(sorted[0]!.priorityScore >= sorted[1]!.priorityScore);
  });

  it("computeOpportunityPriorityScore é finito", () => {
    const score = computeOpportunityPriorityScore({
      severity: "HIGH",
      type: "RISK",
      daysSinceLastOrder: 800,
      overdueAmount: 1000,
      repurchaseStatus: "ATRASADO",
    });
    assert.ok(Number.isFinite(score));
  });
});
