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

  it("Commercial 360 consome officialOrderMetrics da API", () => {
    const page = read("src/components/customers/CustomerCommercial360.tsx");
    assert.match(page, /officialOrderMetrics/);
    assert.match(page, /usesOfficialOrderMetrics/);
  });
});
