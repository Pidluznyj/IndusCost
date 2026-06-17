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
    history: { byYear: [], byMonth: [], strongestMonths: [] },
    seasonality: { peakMonths: [], lowMonths: [], seasonalityNote: null },
    products: {
      topByRevenue: [],
      topByQuantity: [],
      abandonedProducts: [],
      recurringProducts: [],
      concentration: {
        top1RevenueSharePercent: null,
        top3RevenueSharePercent: null,
        distinctProductsCount: 0,
      },
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
    financial: {
      receivableOpenAmount: null,
      overdueAmount: null,
      upcomingAmount: null,
      overdueTitlesCount: null,
      maxDaysOverdue: null,
      averageDaysOverdue: null,
      linkedByCnpj: false,
    },
    crm: {
      lastContactAt: null,
      nextTaskAt: null,
      openTasksCount: 0,
      overdueTasksCount: 0,
      lastNotes: [],
    },
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
    assert.ok(html.includes("Valor vencido (AR)"));
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
});
