import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { buildCustomerIntelligenceReport } from "./customerIntelligence.js";
import { createDefaultCustomerIntelligenceFilters } from "./customerIntelligenceUtils.js";
import type {
  CustomerIntelligenceBuildInput,
  CustomerIntelligenceOrderInput,
  CustomerIntelligenceReport,
} from "./customerIntelligenceTypes.js";
import { buildCustomerIntelligenceApiQuery } from "./customerIntelligencePageFilters.js";
import { CustomerIntelligenceOverviewTab } from "../components/crm/customer-intelligence/CustomerIntelligenceOverviewTab.js";
import { CustomerIntelligenceFinancialTab } from "../components/crm/customer-intelligence/CustomerIntelligenceFinancialTab.js";
import { CustomerIntelligenceCrmTab } from "../components/crm/customer-intelligence/CustomerIntelligenceCrmTab.js";
import { CustomerIntelligenceOpportunitiesTab } from "../components/crm/customer-intelligence/CustomerIntelligenceOpportunitiesTab.js";

const NOW = new Date("2026-06-17T12:00:00.000Z");
const CUSTOMER_ID = "11111111-1111-4111-8111-111111111111";

function baseOrder(
  overrides: Partial<CustomerIntelligenceOrderInput> & Pick<CustomerIntelligenceOrderInput, "id">
): CustomerIntelligenceOrderInput {
  return {
    orderCode: "PV-100",
    status: "SENT_TO_NOMUS",
    issueDate: new Date("2025-03-15T12:00:00.000Z"),
    updatedAt: new Date("2025-03-16T12:00:00.000Z"),
    responsible: "Carlos",
    totalNetValue: 5000,
    totalMarginValue: 500,
    totalMarginPerc: 10,
    hasInvoicing: true,
    items: [
      {
        productId: "p1",
        quantity: 2,
        totalNetValue: 5000,
        Product: { id: "p1", sku: "SKU-A", name: "Produto A", type: "FINAL" },
      },
    ],
    ...overrides,
  };
}

function buildInput(
  overrides: Partial<CustomerIntelligenceBuildInput> = {}
): CustomerIntelligenceBuildInput {
  return {
    customer: {
      id: CUSTOMER_ID,
      companyName: "Cliente Teste LTDA",
      tradeName: "Cliente Teste",
      taxId: "12.345.678/0001-90",
      city: "Curitiba",
      state: "PR",
      accountOwner: "Maria",
      createdAt: new Date("2024-01-10T00:00:00.000Z"),
    },
    orders: [],
    activities: [],
    crmProfile: null,
    arRows: [],
    arSyncCutoff: null,
    arLinkedByCnpj: false,
    filters: createDefaultCustomerIntelligenceFilters(NOW),
    now: NOW,
    ...overrides,
  };
}

function assertFullPayload(report: CustomerIntelligenceReport) {
  assert.ok(report.customer.id);
  assert.ok(report.filters);
  assert.ok(report.dataQuality);
  assert.ok(report.commercialSummary);
  assert.ok(report.history);
  assert.ok(report.seasonality);
  assert.ok(report.products);
  assert.ok(report.repurchase);
  assert.ok(report.financial);
  assert.ok(report.crm);
  assert.ok(report.scoring);
  assert.ok(Array.isArray(report.opportunities));
  assert.ok(Array.isArray(report.executiveNarrative));
  assert.ok(Number.isFinite(report.scoring.score));
  assert.ok(!Number.isNaN(report.scoring.score));
}

describe("customerIntelligenceEndToEnd — payload consolidado", () => {
  it("endpoint assembler retorna payload completo com pedidos", () => {
    const report = buildCustomerIntelligenceReport(
      buildInput({
        filters: { ...createDefaultCustomerIntelligenceFilters(NOW), year: null },
        orders: [baseOrder({ id: "o1" }), baseOrder({ id: "o2", issueDate: new Date("2025-08-01T12:00:00.000Z") })],
      })
    );
    assertFullPayload(report);
    assert.ok(report.commercialSummary.validOrdersCount >= 2);
    assert.ok(report.scoring.score >= 0 && report.scoring.score <= 100);
    assert.ok(report.opportunities.length >= 0);
  });

  it("cliente sem pedidos retorna empty state seguro", () => {
    const report = buildCustomerIntelligenceReport(buildInput());
    assertFullPayload(report);
    assert.equal(report.commercialSummary.validOrdersCount, 0);
    assert.equal(report.scoring.healthClassification, "historico_insuficiente");
    assert.ok(report.executiveNarrative.length > 0);
  });

  it("cliente sem financeiro vinculado não mascara valores", () => {
    const report = buildCustomerIntelligenceReport(
      buildInput({
        customer: {
          id: CUSTOMER_ID,
          companyName: "Cliente Teste LTDA",
          tradeName: "Cliente Teste",
          taxId: "",
          city: "Curitiba",
          state: "PR",
          accountOwner: "Maria",
          createdAt: new Date("2024-01-10T00:00:00.000Z"),
        },
        orders: [baseOrder({ id: "o1" })],
        arLinkedByCnpj: false,
        arRows: [],
      })
    );
    assert.equal(report.financial.linkedByCnpj, false);
    assert.equal(report.financial.receivableOpenAmount, null);
    assert.equal(report.financial.overdueAmount, null);
  });

  it("cliente sem CRM retorna sem histórico", () => {
    const report = buildCustomerIntelligenceReport(
      buildInput({ orders: [baseOrder({ id: "o1" })], activities: [] })
    );
    assert.equal(report.crm.relationshipStatus, "sem_historico");
    assert.equal(report.crm.lastContactAt, null);
  });

  it("filtros alteram query da API", () => {
    const query = buildCustomerIntelligenceApiQuery({
      startDate: "2025-01-01",
      endDate: "2025-12-31",
      year: "",
      status: "SENT_TO_NOMUS",
      responsible: "Carlos",
      productId: "",
      minNetValue: "1000",
      maxNetValue: "",
      customerType: "external",
    });
    assert.ok(query.includes("startDate=2025-01-01"));
    assert.ok(query.includes("status=SENT_TO_NOMUS"));
    assert.ok(query.includes("responsible=Carlos"));
  });

  it("sem hardcode por cliente/CNPJ/valor no assembler", () => {
    const assemblerSrc = readFileSync(join(process.cwd(), "src/lib/customerIntelligence.ts"), "utf8");
    assert.ok(!assemblerSrc.includes("12.345.678"));
    assert.ok(!assemblerSrc.includes("11111111-1111"));
  });

  it("fontes comerciais usam SalesOrder — não Propostas como receita principal", () => {
    const assemblerSrc = readFileSync(join(process.cwd(), "src/lib/customerIntelligence.ts"), "utf8");
    const routesSrc = readFileSync(join(process.cwd(), "src/lib/customerIntelligenceRoutes.ts"), "utf8");
    assert.ok(assemblerSrc.includes("SalesOrder"));
    assert.ok(routesSrc.includes("salesOrder.findMany"));
    assert.ok(!assemblerSrc.includes("proposal.totalNetValue"));
  });
});

describe("customerIntelligenceEndToEnd — frontend", () => {
  const pageSrc = readFileSync(
    join(process.cwd(), "src/components/crm/CustomerIntelligencePage.tsx"),
    "utf8"
  );

  it("tela renderiza com payload completo (overview)", () => {
    const report = buildCustomerIntelligenceReport(
      buildInput({
        filters: { ...createDefaultCustomerIntelligenceFilters(NOW), year: null },
        orders: [baseOrder({ id: "o1" }), baseOrder({ id: "o2", issueDate: new Date("2025-09-01T12:00:00.000Z") })],
      })
    );
    const html = renderToStaticMarkup(<CustomerIntelligenceOverviewTab report={report} />);
    assert.ok(html.includes("Saúde comercial") || html.includes("Score"));
    assert.ok(html.includes("Resumo executivo") || html.includes("Receita"));
  });

  it("tela renderiza financeiro não vinculado", () => {
    const report = buildCustomerIntelligenceReport(
      buildInput({
        customer: {
          id: CUSTOMER_ID,
          companyName: "Cliente Teste LTDA",
          tradeName: "Cliente Teste",
          taxId: "",
          city: "Curitiba",
          state: "PR",
          accountOwner: "Maria",
          createdAt: new Date("2024-01-10T00:00:00.000Z"),
        },
        filters: { ...createDefaultCustomerIntelligenceFilters(NOW), year: null },
        orders: [baseOrder({ id: "o1" })],
        arLinkedByCnpj: false,
        arRows: [],
      })
    );
    const html = renderToStaticMarkup(<CustomerIntelligenceFinancialTab report={report} />);
    assert.ok(html.includes("Financeiro não vinculado"));
  });

  it("tela renderiza CRM empty state", () => {
    const report = buildCustomerIntelligenceReport(
      buildInput({ orders: [baseOrder({ id: "o1" })], activities: [] })
    );
    const html = renderToStaticMarkup(<CustomerIntelligenceCrmTab report={report} />);
    assert.ok(html.includes("Sem histórico de CRM"));
  });

  it("score e oportunidades aparecem na aba dedicada", () => {
    const report = buildCustomerIntelligenceReport(
      buildInput({
        filters: { ...createDefaultCustomerIntelligenceFilters(NOW), year: null },
        orders: [baseOrder({ id: "o1" }), baseOrder({ id: "o2", issueDate: new Date("2025-09-01T12:00:00.000Z") })],
      })
    );
    const html = renderToStaticMarkup(<CustomerIntelligenceOpportunitiesTab report={report} />);
    assert.ok(html.includes("Oportunidades"));
    assert.ok(html.includes("Score") || html.includes("Saúde comercial"));
  });

  it("frontend não importa Prisma/backend assembler na página", () => {
    assert.ok(!pageSrc.includes("@prisma/client"));
    assert.ok(!pageSrc.includes("buildCustomerIntelligenceReport"));
    assert.ok(!pageSrc.includes("prisma"));
  });

  it("página possui loading, erro, impressão e abas", () => {
    assert.ok(pageSrc.includes("Carregando inteligência"));
    assert.ok(pageSrc.includes("Não foi possível carregar"));
    assert.ok(pageSrc.includes("window.print"));
    assert.ok(pageSrc.includes("CustomerIntelligenceTabs"));
    assert.ok(pageSrc.includes("Imprimir ficha"));
  });

  it("componente página registrado no App", () => {
    const appSrc = readFileSync(join(process.cwd(), "src/App.tsx"), "utf8");
    assert.ok(appSrc.includes("CustomerIntelligencePage"));
  });
});
