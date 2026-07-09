import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const ROOT = process.cwd();

function read(path: string): string {
  return readFileSync(join(ROOT, path), "utf8");
}

describe("auditoria gestão pedidos venda — fontes", () => {
  it("documento de auditoria existe", () => {
    const doc = "docs/auditoria-gestao-pedidos-venda-fontes.md";
    assert.ok(existsSync(join(ROOT, doc)));
    const text = read(doc);
    assert.match(text, /GET \/api\/sales-orders\/management/);
    assert.match(text, /calculateOfficialSalesOrderMarginsForOrders/);
    assert.match(text, /Valor faturado/);
  });

  it("gestão usa SalesOrder e motor oficial, não Proposal", () => {
    const routes = read("src/lib/salesOrderIntelligenceRoutes.ts");
    assert.match(routes, /loadSalesOrderManagementPage/);
    assert.match(routes, /buildOfficialSalesOrderManagementCore/);
    assert.match(routes, /calculateSalesOrderMarginsForOrders/);
    assert.match(routes, /prisma\.salesOrder\.findMany/);
    assert.doesNotMatch(routes, /prisma\.proposal/i);

    const page = read("src/components/sales/SalesOrderManagementPage.tsx");
    assert.match(page, /getSalesOrderManagementApiPath/);
    assert.doesNotMatch(page, /Proposal/);
  });

  it("valor vendido na UI vem de fulfillmentKpis, não de cálculo local", () => {
    const dashboard = read("src/components/sales/SalesOrderManagementKpiDashboard.tsx");
    assert.match(dashboard, /fulfillmentKpis\?\.totalSoldValue/);
    assert.doesNotMatch(dashboard, /formatCurrency\(.*totalNetValue/s);
  });

  it("margem consolidada vem de marginEconomics backend", () => {
    const margin = read("src/components/sales/SalesOrderManagementMarginOverview.tsx");
    assert.match(margin, /marginEconomics\?\.consolidated/);
    assert.doesNotMatch(margin, /calculateSalesOrderItemMargin/);
    assert.doesNotMatch(margin, /aggregateSalesOrderMarginSummaries/);
  });

  it("financeiro compartilha motor oficial de pedidos", () => {
    const finance = read("src/lib/financeSalesOrdersDashboard.ts");
    assert.match(finance, /buildOfficialSalesOrderRulesResult/);
    assert.match(finance, /SALES_ORDER_RULES_PRISMA_SELECT/);
    assert.match(finance, /mapOfficialFinancePortfolioFromManagementRows/);
  });

  it("export interno gestão usa margem oficial", () => {
    const exp = read("src/lib/salesOrderInternalMarginExport.server.ts");
    assert.match(exp, /calculateSalesOrderMarginsForOrders/);
    assert.match(exp, /scope === "management"/);
  });

  it("divergência marginStatus documentada na rota", () => {
    const routes = read("src/lib/salesOrderIntelligenceRoutes.ts");
    assert.match(routes, /marginFilteredRows/);
    assert.match(routes, /officialCore\.fulfillmentKpis/);
    assert.match(routes, /marginEconomics/);
  });
});
