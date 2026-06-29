import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

function read(rel: string): string {
  return readFileSync(join(process.cwd(), rel), "utf8");
}

describe("salesOrderRulesConsumptionAudit", () => {
  it("endpoints principais usam motor oficial ou adapter", () => {
    const server = read("server.ts");
    assert.match(server, /buildOfficialSalesOrderListPayload/);
    assert.match(server, /resolveOfficialScopedOrderMetrics/);
    const mgmt = read("src/lib/salesOrderIntelligenceRoutes.ts");
    assert.match(mgmt, /buildOfficialSalesOrderManagementCore/);
    const finance = read("src/lib/financeSalesOrdersDashboard.ts");
    assert.match(finance, /buildOfficialSalesOrderRulesResult/);
    const result = read("src/lib/salesOrderResultEngine.server.ts");
    assert.match(result, /buildOfficialSalesOrderResultSalesBundle/);
    const executive = read("src/lib/salesOrdersDashboardMetrics.ts");
    assert.match(executive, /resolveOfficialSalesOrderExecutiveMetrics/);
  });

  it("CRM seller dashboard summary usa motor oficial", () => {
    const src = read("src/lib/crmSellerDashboardService.ts");
    assert.match(src, /resolveOfficialScopedOrderMetrics/);
    assert.match(src, /OFFICIAL_SO_RULES_SOURCE/);
  });

  it("CRM commercial intelligence usa motor para carteira e 12m", () => {
    const src = read("src/lib/crmCommercialIntelligence.ts");
    assert.match(src, /resolveOfficialScopedOrderMetrics/);
    assert.doesNotMatch(src, /openOrdersValue = openPortfolioRows\.reduce/);
  });

  it("Cliente 360 intelligence usa motor para receita", () => {
    const src = read("src/lib/customerIntelligence.ts");
    assert.match(src, /resolveOfficialCustomerIntelligenceOrderMetrics/);
    assert.match(src, /resolveOfficialScopedOrderMetrics/);
  });

  it("SalesOrdersModule não recalcula summary client-side", () => {
    const src = read("src/components/SalesOrdersModule.tsx");
    assert.doesNotMatch(src, /totalNetAmount \+= Number\(row\.totalNetValue\)/);
    assert.match(src, /EMPTY_SALES_ORDER_LIST_SUMMARY/);
  });

  it("SALES_ORDER_RULES_PRISMA_SELECT não referencia campo inexistente em SalesOrderItem", () => {
    const adapter = read("src/lib/salesOrderRulesAdapter.ts");
    assert.match(adapter, /SALES_ORDER_RULES_PRISMA_SELECT/);
    assert.doesNotMatch(adapter, /items:\s*\{[\s\S]*status:\s*true/);
  });

  it("salesOrderResultEngine usa select central sem items.status", () => {
    const resultEngine = read("src/lib/salesOrderResultEngine.server.ts");
    assert.match(resultEngine, /SALES_ORDER_RULES_PRISMA_SELECT/);
    assert.doesNotMatch(resultEngine, /items:\s*\{[\s\S]*status:\s*true/);
  });

  it("GET /api/reports/data consome motor oficial", () => {
    const server = read("server.ts");
    assert.match(server, /buildReportsDataPayload/);
    const service = read("src/lib/reportsDataService.ts");
    assert.match(service, /buildOfficialReportsCommercialPayload/);
    assert.match(service, /OFFICIAL_SO_RULES_SOURCE/);
  });

  it("ABC Cliente 360 usa motor oficial sem groupBy Prisma", () => {
    const server = read("server.ts");
    assert.match(server, /loadOfficialPortfolioAbcRevenueRows/);
    assert.doesNotMatch(server, /salesOrder\.groupBy/);
    const loader = read("src/lib/officialSalesOrderPortfolioLoaders.server.ts");
    assert.match(loader, /buildOfficialCustomerRevenueByCustomer/);
  });

  it("Financeiro Pedidos usa top sellers do motor oficial", () => {
    const finance = read("src/lib/financeSalesOrdersDashboard.ts");
    assert.match(finance, /mapOfficialSellerBreakdownToFinanceTopSellers/);
    assert.match(finance, /buildOfficialSellerBreakdownFromManagementRows/);
    assert.doesNotMatch(finance, /topSellers: extended\.topSellers/);
  });

  it("Funil comercial usa status breakdown oficial", () => {
    const funnel = read("src/lib/salesFunnelDashboardMetrics.ts");
    assert.match(funnel, /buildOfficialStatusBreakdownFromOrders/);
    assert.doesNotMatch(funnel, /\$queryRaw/);
  });

  it("auditoria de Pedidos registra resolver de margem antes da gestão", () => {
    const script = read("scripts/audit-sales-order-rules-consumption.ts");
    const mainBody = script.slice(script.indexOf("async function main"));
    assert.match(mainBody, /await registerOfficialServerResolversForAuditScripts/);
    assert.match(mainBody, /loadSalesOrderManagementPage/);
    const registerAt = mainBody.indexOf("await registerOfficialServerResolversForAuditScripts");
    const managementAt = mainBody.indexOf("loadSalesOrderManagementPage");
    assert.ok(registerAt >= 0 && managementAt > registerAt);
  });

  it("auditoria de Margem registra resolver antes do contexto de margem", () => {
    const script = read("scripts/audit-sales-margin-rules-consumption.ts");
    const mainBody = script.slice(script.indexOf("async function main"));
    assert.match(mainBody, /await registerOfficialServerResolversForAuditScripts/);
    const registerAt = mainBody.indexOf("await registerOfficialServerResolversForAuditScripts");
    const contextAt = mainBody.indexOf("buildSalesOrderMarginContext");
    assert.ok(registerAt >= 0 && contextAt > registerAt);
  });
});
