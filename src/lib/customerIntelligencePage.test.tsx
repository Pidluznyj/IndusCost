import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { CustomerIntelligenceReport } from "./customerIntelligenceTypes.js";
import { CustomerIntelligenceDataQuality } from "../components/crm/customer-intelligence/CustomerIntelligenceDataQuality.js";
import { CustomerIntelligenceKpiGrid } from "../components/crm/customer-intelligence/CustomerIntelligenceKpiGrid.js";
import { CustomerIntelligenceTabs } from "../components/crm/customer-intelligence/CustomerIntelligenceTabs.js";
import { CustomerIntelligenceHeader } from "../components/crm/customer-intelligence/CustomerIntelligenceHeader.js";
import { CustomerIntelligencePurchasesTab } from "../components/crm/customer-intelligence/CustomerIntelligencePurchasesTab.js";
import { CustomerIntelligenceProductsTab } from "../components/crm/customer-intelligence/CustomerIntelligenceProductsTab.js";
import { CustomerIntelligenceFinancialTab } from "../components/crm/customer-intelligence/CustomerIntelligenceFinancialTab.js";
import { CustomerIntelligenceCrmTab } from "../components/crm/customer-intelligence/CustomerIntelligenceCrmTab.js";
import { FINANCE_AR_OVERDUE_FISCAL_BACKING_NOTE } from "./financeAccountsReceivableDashboard.js";

function mockFinancial(
  overrides: Partial<CustomerIntelligenceReport["financial"]> = {}
): CustomerIntelligenceReport["financial"] {
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
      warnings: ["Financeiro (AR) não vinculado — CNPJ do cliente ausente ou sem títulos."],
      staleExcludedCount: 0,
      overdueWithoutFiscalExcludedCount: 0,
      syncCutoffAt: null,
      fiscalBackingNote: FINANCE_AR_OVERDUE_FISCAL_BACKING_NOTE,
    },
    linkedByCnpj: false,
    financialStatus: "unlinked",
    riskAlert: null,
    ...overrides,
  };
}

function mockCrm(
  overrides: Partial<CustomerIntelligenceReport["crm"]> = {}
): CustomerIntelligenceReport["crm"] {
  return {
    commercialOwner: "Maria",
    lastContactAt: "2026-05-01T10:00:00.000Z",
    lastActivityAt: "2026-05-01T10:00:00.000Z",
    nextTaskAt: "2026-06-20T10:00:00.000Z",
    openTasksCount: 1,
    overdueTasksCount: 0,
    daysSinceLastContact: 47,
    activities: [
      {
        id: "act-1",
        activityType: "CALL",
        subject: "Ligação comercial",
        description: "Retorno sobre proposta",
        status: "OPEN",
        contactDate: "2026-05-01T10:00:00.000Z",
        scheduledAt: null,
        completedAt: null,
        nextActionAt: "2026-06-20T10:00:00.000Z",
        nextActionDescription: "Enviar proposta revisada",
        channel: "phone",
        outcome: "Cliente interessado",
        assignedTo: "Maria",
        createdAt: "2026-05-01T10:00:00.000Z",
        isOverdue: false,
      },
    ],
    tasks: [
      {
        id: "act-1",
        subject: "Ligação comercial",
        nextActionAt: "2026-06-20T10:00:00.000Z",
        nextActionDescription: "Enviar proposta revisada",
        assignedTo: "Maria",
        status: "OPEN",
        isOverdue: false,
      },
    ],
    notes: [{ text: "Cliente interessado", source: "activity", recordedAt: "2026-05-01" }],
    relationshipStatus: "ativo",
    dataQuality: {
      sources: ["CommercialActivity"],
      warnings: [],
      activitiesLoaded: 1,
      profileLoaded: false,
    },
    actions: [
      {
        id: "open-crm",
        label: "Abrir CRM Comercial",
        kind: "link",
        href: "/crm-commercial?customerId=11111111-1111-4111-8111-111111111111",
        reason: null,
      },
      {
        id: "register-contact",
        label: "Registrar contato",
        kind: "disabled",
        href: null,
        reason: "Use o CRM Comercial",
      },
    ],
    ...overrides,
  };
}

function mockReport(overrides: Partial<CustomerIntelligenceReport> = {}): CustomerIntelligenceReport {
  return {
    customer: {
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
      lastOrderDate: "2025-12-01",
      commercialOwner: "Maria",
    },
    filters: {
      startDate: null,
      endDate: null,
      year: 2026,
      status: null,
      responsible: null,
      productId: null,
      minNetValue: null,
      maxNetValue: null,
      customerType: "external",
      topN: 10,
    },
    dataQuality: {
      warnings: ["Financeiro (AR) não vinculado — CNPJ do cliente ausente ou sem títulos."],
      missingFields: [],
      sources: ["SalesOrder", "SalesOrderItem", "Customer"],
    },
    commercialSummary: {
      revenue: 15000,
      ordersCount: 3,
      validOrdersCount: 2,
      billedOrdersCount: 1,
      openPortfolioAmount: 5000,
      averageTicket: 7500,
      averageMarginPercent: 12.5,
      totalMarginAmount: 1800,
      lastOrderDate: "2025-12-01",
      daysSinceLastOrder: 45,
      leadingProduct: {
        productId: "p1",
        sku: "SKU-A",
        name: "Produto A",
        revenue: 10000,
      },
    },
    history: {
      byYear: [
        {
          year: 2025,
          ordersCount: 2,
          validOrdersCount: 2,
          revenue: 12000,
          averageTicket: 6000,
          marginAmount: 1200,
          marginPercent: 10,
          growthPercentVsPreviousYear: 20,
        },
      ],
      byMonth: [
        {
          year: 2025,
          month: 5,
          label: "Mai/2025",
          ordersCount: 2,
          revenue: 12000,
          averageTicket: 6000,
          marginAmount: 1200,
          marginPercent: 10,
        },
      ],
      strongestMonths: [
        {
          month: 5,
          monthName: "Maio",
          totalRevenue: 12000,
          ordersCount: 2,
          recurrenceScore: 1,
          rankByRevenue: 1,
          rankByQuantity: 1,
        },
      ],
      analysis: {
        bestYear: 2025,
        bestYearRevenue: 12000,
        declinedYear: 2025,
        declinedYearRevenue: 12000,
        referenceYear: 2025,
        referenceYearRevenue: 12000,
        growthPercentVsPreviousYear: 20,
        growthStatus: "growth",
        trendReading: "Crescimento de 20.0% em 2025 vs ano anterior.",
      },
    },
    seasonality: {
      strongestMonth: {
        month: 5,
        monthName: "Maio",
        totalRevenue: 12000,
        ordersCount: 2,
      },
      weakestMonth: {
        month: 5,
        monthName: "Maio",
        totalRevenue: 12000,
        ordersCount: 2,
      },
      activeMonthsCount: 1,
      hasSeasonality: false,
      reading: "Compras distribuídas em 1 mês(es); sem sazonalidade marcante. Mês mais forte: Maio.",
      peakMonths: [],
      lowMonths: [],
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
    repurchase: {
      status: "INSUFICIENTE",
      averageDaysBetweenOrders: null,
      medianDaysBetweenOrders: null,
      estimatedNextPurchaseDate: null,
      daysOverExpected: null,
      confidence: null,
      detail: "Histórico insuficiente",
    },
    financial: mockFinancial(),
    crm: mockCrm(),
    opportunities: [
      {
        type: "INFO",
        severity: "MEDIUM",
        title: "Sem pedidos válidos",
        description: "Teste",
      },
    ],
    executiveNarrative: ["Cliente Teste registrou 2 pedido(s) válido(s)."],
    ...overrides,
  };
}

describe("customerIntelligencePage — apresentação (sem recálculo)", () => {
  const pageSrc = readFileSync(
    join(process.cwd(), "src/components/crm/CustomerIntelligencePage.tsx"),
    "utf8"
  );

  it("página consome endpoint consolidado via fetchJsonOk", () => {
    assert.ok(pageSrc.includes("fetchJsonOk"));
    assert.ok(pageSrc.includes("buildCustomerIntelligenceApiPath"));
    const navSrc = readFileSync(
      join(process.cwd(), "src/lib/customerIntelligenceNavigation.ts"),
      "utf8"
    );
    assert.ok(navSrc.includes("/api/crm/customers/"));
  });

  it("mostra loading", () => {
    assert.ok(pageSrc.includes("Carregando inteligência do cliente"));
    assert.ok(pageSrc.includes("Loader2"));
  });

  it("mostra erro amigável", () => {
    assert.ok(pageSrc.includes("Não foi possível carregar os dados"));
    assert.ok(pageSrc.includes("Tentar novamente"));
  });

  it("não recalcula receita/pedidos localmente", () => {
    assert.ok(!pageSrc.includes("computeCommercialPhase2FromSalesOrders"));
    assert.ok(!pageSrc.includes("buildCustomerIntelligenceReport"));
    assert.ok(!pageSrc.includes("@prisma/client"));
    assert.ok(!pageSrc.includes("prisma"));
  });

  it("mostra dataQuality warnings", () => {
    const html = renderToStaticMarkup(
      <CustomerIntelligenceDataQuality dataQuality={mockReport().dataQuality} />
    );
    assert.ok(html.includes("Financeiro (AR) não vinculado"));
  });

  it("mostra cards principais a partir do payload", () => {
    const html = renderToStaticMarkup(<CustomerIntelligenceKpiGrid report={mockReport()} />);
    assert.ok(html.includes("Receita (filtro)"));
    assert.ok(html.includes("Pedidos válidos"));
    assert.ok(html.includes("Ticket médio"));
    assert.ok(html.includes("Carteira em aberto (AR)"));
    assert.ok(html.includes("Status financeiro"));
  });

  it("mostra abas", () => {
    const html = renderToStaticMarkup(
      <CustomerIntelligenceTabs activeTab="overview" onChange={() => {}} />
    );
    assert.ok(html.includes("Visão Geral"));
    assert.ok(html.includes("Compras"));
    assert.ok(html.includes("Financeiro"));
    assert.ok(html.includes("Oportunidades"));
  });

  it("header exibe dados cadastrais do payload", () => {
    const html = renderToStaticMarkup(<CustomerIntelligenceHeader report={mockReport()} />);
    assert.ok(html.includes("Cliente Teste"));
    assert.ok(html.includes("Curitiba"));
    assert.ok(html.includes("Maria"));
    assert.ok(html.includes("Histórico insuficiente"));
  });

  it("frontend não importa Prisma/backend assembler", () => {
    const kpiSrc = readFileSync(
      join(process.cwd(), "src/components/crm/customer-intelligence/CustomerIntelligenceKpiGrid.tsx"),
      "utf8"
    );
    assert.ok(!kpiSrc.includes("customerIntelligence.ts"));
    assert.ok(!kpiSrc.includes("prisma"));
  });

  it("aba Compras exibe tabela anual e leitura gerencial", () => {
    assert.ok(pageSrc.includes("CustomerIntelligencePurchasesTab"));
    const html = renderToStaticMarkup(<CustomerIntelligencePurchasesTab report={mockReport()} />);
    assert.ok(html.includes("Pedidos por ano"));
    assert.ok(html.includes("Receita por ano"));
    assert.ok(html.includes("Leitura gerencial"));
    assert.ok(html.includes("Maio"));
    assert.ok(html.includes("Melhor ano"));
  });

  it("aba Compras mostra empty state sem histórico", () => {
    const empty = mockReport({
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
      seasonality: {
        strongestMonth: null,
        weakestMonth: null,
        activeMonthsCount: 0,
        hasSeasonality: false,
        reading: null,
        peakMonths: [],
        lowMonths: [],
      },
    });
    const html = renderToStaticMarkup(<CustomerIntelligencePurchasesTab report={empty} />);
    assert.ok(html.includes("Sem histórico de compras"));
  });

  it("aba Compras exibe ranking de meses mais fortes", () => {
    const html = renderToStaticMarkup(<CustomerIntelligencePurchasesTab report={mockReport()} />);
    assert.ok(html.includes("Ranking — meses mais fortes"));
    assert.ok(html.includes("Matriz de sazonalidade"));
  });

  it("aba Produtos exibe tabelas e cards", () => {
    assert.ok(pageSrc.includes("CustomerIntelligenceProductsTab"));
    const withProducts = mockReport({
      products: {
        topByRevenue: [
          {
            productId: "p1",
            productCode: "SKU-A",
            productName: "Produto A",
            type: "FINAL",
            ordersCount: 2,
            quantity: 10,
            revenue: 10000,
            averageTicket: 5000,
            marginAmount: 1000,
            marginPercent: 10,
            firstPurchaseDate: "2025-01-01",
            lastPurchaseDate: "2025-12-01",
            daysSinceLastPurchase: 45,
            shareOfCustomerRevenue: 66.7,
            confidence: "high",
          },
        ],
        topByQuantity: [],
        topByMargin: [],
        abandonedProducts: [],
        recurringProducts: [
          {
            productId: "p1",
            productCode: "SKU-A",
            productName: "Produto A",
            type: "FINAL",
            ordersCount: 2,
            quantity: 10,
            revenue: 10000,
            averageTicket: 5000,
            marginAmount: 1000,
            marginPercent: 10,
            firstPurchaseDate: "2025-01-01",
            lastPurchaseDate: "2025-12-01",
            daysSinceLastPurchase: 45,
            shareOfCustomerRevenue: 66.7,
            confidence: "high",
          },
        ],
        newProducts: [],
        concentration: {
          top1RevenueSharePercent: 66.7,
          top3RevenueSharePercent: 100,
          top5RevenueSharePercent: 100,
          distinctProductsCount: 1,
        },
        productOpportunities: [
          {
            kind: "low_mix",
            severity: "MEDIUM",
            title: "Mix baixo",
            description: "Apenas 1 produto distinto.",
            productId: null,
            productCode: null,
            productName: null,
            confidence: "low",
          },
        ],
      },
    });
    const html = renderToStaticMarkup(<CustomerIntelligenceProductsTab report={withProducts} />);
    assert.ok(html.includes("Top produtos por receita"));
    assert.ok(html.includes("Produto líder"));
    assert.ok(html.includes("Oportunidades por produto"));
    assert.ok(html.includes("Mix baixo"));
  });

  it("aba Produtos mostra empty state", () => {
    const html = renderToStaticMarkup(<CustomerIntelligenceProductsTab report={mockReport()} />);
    assert.ok(html.includes("Sem produtos no filtro aplicado"));
  });

  it("aba Financeiro exibe cards e texto sobre vencidos sem NF", () => {
    assert.ok(pageSrc.includes("CustomerIntelligenceFinancialTab"));
    const withFinancial = mockReport({
      financial: mockFinancial({
        linkedByCnpj: true,
        financialStatus: "overdue",
        receivableOpenAmount: 5000,
        overdueAmount: 2000,
        upcomingAmount: 3000,
        openTitlesCount: 3,
        overdueTitlesCount: 1,
        maxDaysOverdue: 15,
        averageDaysOverdue: 15,
        nextDueDate: "2026-07-01",
        riskAlert: "Inadimplência",
        agingBuckets: [
          { key: "overdue1to7", label: "1 a 7 dias vencido", amount: 0, count: 0 },
          { key: "overdue8to15", label: "8 a 15 dias vencido", amount: 2000, count: 1 },
        ],
        openTitles: [
          {
            externalId: 1,
            description: "NF",
            dueDate: "2026-06-01T00:00:00.000Z",
            balanceReceivable: 2000,
            amountReceivable: 2000,
            amountReceived: 0,
            sourceInvoiceNumber: "NF-1",
            daysOverdue: 16,
            status: "overdue",
            isForecast: false,
          },
        ],
        overdueTitles: [
          {
            externalId: 1,
            description: "NF",
            dueDate: "2026-06-01T00:00:00.000Z",
            balanceReceivable: 2000,
            amountReceivable: 2000,
            amountReceived: 0,
            sourceInvoiceNumber: "NF-1",
            daysOverdue: 16,
            status: "overdue",
            isForecast: false,
          },
        ],
        dataQuality: {
          linkedByCnpj: true,
          linkMethod: "cnpj",
          warnings: [],
          staleExcludedCount: 0,
          overdueWithoutFiscalExcludedCount: 0,
          syncCutoffAt: "2026-06-17T10:00:00.000Z",
          fiscalBackingNote: FINANCE_AR_OVERDUE_FISCAL_BACKING_NOTE,
        },
      }),
    });
    const html = renderToStaticMarkup(<CustomerIntelligenceFinancialTab report={withFinancial} />);
    assert.ok(html.includes("Total a receber"));
    assert.ok(html.includes("Alerta de risco financeiro"));
    assert.ok(html.includes("Títulos vencidos sem NF"));
    assert.ok(html.includes("Aging de vencidos"));
  });

  it("aba Financeiro mostra empty state sem CNPJ", () => {
    const html = renderToStaticMarkup(<CustomerIntelligenceFinancialTab report={mockReport()} />);
    assert.ok(html.includes("Financeiro não vinculado"));
  });

  it("aba CRM integrada na página", () => {
    assert.ok(pageSrc.includes("CustomerIntelligenceCrmTab"));
    const html = renderToStaticMarkup(<CustomerIntelligenceTabs activeTab="crm" onChange={() => {}} />);
    assert.ok(html.includes("CRM"));
  });

  it("aba CRM exibe cards, timeline e ações", () => {
    const html = renderToStaticMarkup(<CustomerIntelligenceCrmTab report={mockReport()} />);
    assert.ok(html.includes("CRM / Relacionamento"));
    assert.ok(html.includes("Responsável"));
    assert.ok(html.includes("Último contato"));
    assert.ok(html.includes("Próxima tarefa"));
    assert.ok(html.includes("Timeline de atividades"));
    assert.ok(html.includes("Abrir CRM Comercial"));
    assert.ok(html.includes("Registrar contato"));
    assert.ok(html.includes("Origem dos dados"));
  });

  it("aba CRM mostra empty state sem histórico", () => {
    const empty = mockReport({
      crm: mockCrm({
        relationshipStatus: "sem_historico",
        activities: [],
        tasks: [],
        notes: [],
        lastContactAt: null,
        lastActivityAt: null,
        nextTaskAt: null,
        openTasksCount: 0,
        overdueTasksCount: 0,
        daysSinceLastContact: null,
        dataQuality: {
          sources: ["CommercialActivity"],
          warnings: ["Nenhuma CommercialActivity registrada para este cliente."],
          activitiesLoaded: 0,
          profileLoaded: false,
        },
      }),
    });
    const html = renderToStaticMarkup(<CustomerIntelligenceCrmTab report={empty} />);
    assert.ok(html.includes("Sem histórico de CRM para este cliente"));
    assert.ok(html.includes("Abrir CRM Comercial"));
  });
});
