import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  buildManagementDashboardSourceInfo,
  mergeOfficialOrderMetricsIntoManagementSummary,
  resolveManagementDashboardPeriod,
} from "@/src/lib/crmManagementDashboardOfficialOrders";
import {
  CRM_SALES_ORDER_METRICS_SOURCE,
  type CrmSalesOrderMetricsResult,
} from "@/src/lib/commercial/crmSalesOrderMetricsService";
import {
  CRM_OFFICIAL_UI_MESSAGES,
  CRM_PORTFOLIO_AXIS,
  SALES_ORDER_SELLER_AXIS,
} from "@/src/lib/crmCommercialOfficialConcepts";
import { OFFICIAL_SO_RULES_SOURCE } from "@/src/lib/salesOrderRulesAdapter";
import type { ManagementDashboardSummary } from "@/src/components/crmManagementTypes";

function emptyMetrics(
  overrides: Partial<CrmSalesOrderMetricsResult> = {}
): CrmSalesOrderMetricsResult {
  return {
    totalOrders: 0,
    totalOrderValue: 0,
    openPortfolioOrders: 0,
    openPortfolioValue: 0,
    invoicedOrders: 0,
    invoicedValue: 0,
    canceledOrders: 0,
    averageTicket: 0,
    customersWithOrders: 0,
    leadingProduct: null,
    topCustomers: [],
    topProducts: [],
    topCommercialOwners: [],
    ordersWithoutNomusSeller: 0,
    ordersWithoutCustomerLink: 0,
    customerRankingTotals: { groups: 0, value: 0, orders: 0, truncatedForDisplay: false },
    commercialOwnerRankingTotals: { groups: 0, value: 0, orders: 0, truncatedForDisplay: false },
    customersWithoutCommercialResponsible: 0,
    ordersWithResponsibleDifferentFromOrderSeller: 0,
    debug: {
      sourceInfo: CRM_SALES_ORDER_METRICS_SOURCE,
      metricsSource: OFFICIAL_SO_RULES_SOURCE,
      portfolioAxis: CRM_PORTFOLIO_AXIS,
      orderSellerAxis: SALES_ORDER_SELLER_AXIS,
      rulesEngineVersion: "test",
      filtersApplied: {},
      universeOrderCount: 0,
      messages: CRM_OFFICIAL_UI_MESSAGES,
    },
    ...overrides,
  };
}

const baseSummary: ManagementDashboardSummary = {
  totalCustomers: 100,
  customersWithContactLast30Days: 10,
  customersWithoutContactLast30Days: 90,
  customersWithoutContactLast60Days: 80,
  customersWithoutContactLast90Days: 70,
  customersWithoutValidPurchase: 5,
  customersWithoutPurchase90Days: 20,
  customersWithoutPurchase180Days: 30,
  contactsLast7Days: 4,
  contactsLast30Days: 12,
  overdueFollowUps: 2,
  upcomingFollowUpsNext7Days: 3,
  upcomingFollowUpsNext30Days: 8,
  openOrdersCount: 0,
  openOrdersValue: 0,
  ordersWithoutFollowUpCount: 1,
  customersAtHighRisk: 2,
};

describe("crmManagementDashboardOfficialOrders", () => {
  it("abre no ANO VIGENTE — mesma régua da tela Pedidos de Venda", () => {
    // Era "últimos 30 dias" enquanto Pedidos de Venda abre no ano: as duas
    // telas nunca falavam do mesmo período e nenhum número batia.
    const period = resolveManagementDashboardPeriod(
      {},
      new Date("2026-07-11T12:00:00.000Z")
    );
    assert.deepEqual(period, { dateFrom: "2026-01-01", dateTo: "2026-12-31" });
  });

  it("ano + mês recorta o mês inteiro (respeita fim de mês e bissexto)", () => {
    assert.deepEqual(resolveManagementDashboardPeriod({ year: 2026, month: 2 }), {
      dateFrom: "2026-02-01",
      dateTo: "2026-02-28",
    });
    assert.deepEqual(resolveManagementDashboardPeriod({ year: 2024, month: 2 }), {
      dateFrom: "2024-02-01",
      dateTo: "2024-02-29",
    });
    assert.deepEqual(resolveManagementDashboardPeriod({ year: 2026, month: 12 }), {
      dateFrom: "2026-12-01",
      dateTo: "2026-12-31",
    });
  });

  it("ano sem mês pega o ano inteiro", () => {
    assert.deepEqual(resolveManagementDashboardPeriod({ year: 2025 }), {
      dateFrom: "2025-01-01",
      dateTo: "2025-12-31",
    });
  });

  it("todos os anos vai da gênese até hoje", () => {
    const period = resolveManagementDashboardPeriod(
      { allYears: true },
      new Date("2026-07-11T12:00:00.000Z")
    );
    assert.equal(period.dateTo, "2026-07-11");
    assert.ok(period.dateFrom < "2020-01-01");
  });

  it("mês inválido é ignorado e cai no ano inteiro", () => {
    assert.deepEqual(resolveManagementDashboardPeriod({ year: 2026, month: 13 }), {
      dateFrom: "2026-01-01",
      dateTo: "2026-12-31",
    });
  });

  it("resolveManagementDashboardPeriod respeita dateFrom/dateTo", () => {
    const period = resolveManagementDashboardPeriod({
      dateFrom: "2026-01-01",
      dateTo: "2026-01-31",
    });
    assert.deepEqual(period, { dateFrom: "2026-01-01", dateTo: "2026-01-31" });
  });

  it("sourceInfo declara SalesOrder e propostasUsadas false", () => {
    const info = buildManagementDashboardSourceInfo({
      dateFrom: "2026-06-01",
      dateTo: "2026-06-30",
      metrics: emptyMetrics({
        debug: {
          sourceInfo: CRM_SALES_ORDER_METRICS_SOURCE,
          metricsSource: OFFICIAL_SO_RULES_SOURCE,
          portfolioAxis: CRM_PORTFOLIO_AXIS,
          orderSellerAxis: SALES_ORDER_SELLER_AXIS,
          rulesEngineVersion: "v1",
          filtersApplied: {},
          universeOrderCount: 0,
          messages: CRM_OFFICIAL_UI_MESSAGES,
        },
      }),
    });
    assert.equal(info.pedidosFonte, "SalesOrder");
    assert.equal(info.itensFonte, "SalesOrderItem");
    assert.equal(info.eixoCarteira, "Responsável Comercial do Cliente");
    assert.equal(
      info.vendedorComissionavel,
      "Vendedor do Pedido/Nomus, somente auditoria"
    );
    assert.equal(info.propostasUsadas, false);
    assert.deepEqual(info.period, { dateFrom: "2026-06-01", dateTo: "2026-06-30" });
  });

  it("merge não zera indicadores quando há pedidos", () => {
    const merged = mergeOfficialOrderMetricsIntoManagementSummary({
      base: baseSummary,
      metrics: emptyMetrics({
        totalOrders: 12,
        totalOrderValue: 48000,
        openPortfolioOrders: 5,
        openPortfolioValue: 15000,
        invoicedOrders: 4,
        invoicedValue: 20000,
        canceledOrders: 1,
        averageTicket: 4000,
        customersWithOrders: 8,
        ordersWithoutNomusSeller: 2,
        ordersWithoutCustomerLink: 0,
        customerRankingTotals: { groups: 0, value: 0, orders: 0, truncatedForDisplay: false },
        commercialOwnerRankingTotals: { groups: 0, value: 0, orders: 0, truncatedForDisplay: false },
        customersWithoutCommercialResponsible: 3,
        ordersWithResponsibleDifferentFromOrderSeller: 1,
      }),
      totalCustomers: 100,
    });
    assert.equal(merged.ordersIssued, 12);
    assert.equal(merged.ordersValue, 48000);
    assert.equal(merged.openOrdersCount, 5);
    assert.equal(merged.openOrdersValue, 15000);
    assert.equal(merged.customersWithOrders, 8);
    assert.equal(merged.customersWithoutOrderInPeriod, 92);
    assert.equal(merged.customersWithoutCommercialResponsible, 3);
    assert.notEqual(
      merged.customersWithoutCommercialResponsible,
      merged.customersWithoutOrderInPeriod
    );
  });

  it("serviço Gestão Geral usa loadCrmSalesOrderMetrics e não Proposal", () => {
    const service = readFileSync(
      join(process.cwd(), "src/lib/crmManagementDashboardService.ts"),
      "utf8"
    );
    assert.match(service, /loadCrmSalesOrderMetrics/);
    assert.match(service, /sourceInfo/);
    assert.match(service, /topCommercialOwners/);
    assert.equal(service.includes('"Proposal"'), false);
    assert.equal(/\bprisma\.proposal\b/i.test(service), false);
  });

  it("endpoint management-dashboard aceita ano/mês (vocabulário de Pedidos) e dateFrom/dateTo", () => {
    const server = readFileSync(join(process.cwd(), "server.ts"), "utf8");
    const start = server.indexOf("/api/crm/management-dashboard");
    assert.ok(start >= 0);
    const block = server.slice(start, start + 2200);
    assert.match(block, /dateFrom/);
    assert.match(block, /dateTo/);
    // Recorte principal do cockpit é o mesmo da tela Pedidos de Venda.
    assert.match(block, /req\.query\.year/);
    assert.match(block, /req\.query\.month/);
    assert.match(block, /allYears/);
    assert.match(block, /buildCrmManagementDashboardResponse/);
    assert.equal(block.includes('"Proposal"'), false);
  });
});
