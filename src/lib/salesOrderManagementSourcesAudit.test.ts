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
    const layout = "docs/gestao-pedidos-venda-fontes-e-layout.md";
    assert.ok(existsSync(join(ROOT, doc)));
    assert.ok(existsSync(join(ROOT, layout)));
    const text = read(doc);
    assert.match(text, /GET \/api\/sales-orders\/management/);
    const layoutText = read(layout);
    assert.match(layoutText, /SystemTotalizerCard/);
    assert.match(layoutText, /activeRows/);
  });

  it("gestão usa service centralizado e motor oficial", () => {
    const server = read("src/lib/salesOrderManagementMetrics.server.ts");
    assert.match(server, /loadSalesOrderManagementMetrics/);
    assert.match(server, /calculateSalesOrderMarginsForOrders/);
    assert.match(server, /buildOfficialSalesOrderManagementCore/);
    assert.doesNotMatch(server, /prisma\.proposal/i);

    const routes = read("src/lib/salesOrderIntelligenceRoutes.ts");
    assert.match(routes, /salesOrderManagementMetrics\.server/);

    const page = read("src/components/sales/SalesOrderManagementPage.tsx");
    assert.match(page, /getSalesOrderManagementApiPath/);
    assert.doesNotMatch(page, /Proposal/);
  });

  it("cards e tabela compartilham dataset via metrics bundle", () => {
    const server = read("src/lib/salesOrderManagementMetrics.server.ts");
    assert.match(server, /buildOfficialManagementMetricsBundle/);
    assert.match(server, /activeRows/);
    assert.match(server, /marginFilteredRows|filters\.marginStatus/);
    const metrics = read("src/lib/salesOrderManagementMetrics.ts");
    assert.match(metrics, /fulfillmentKpis = buildFulfillmentKpis\(activeRows\)/);
  });

  it("valor vendido na UI vem de officialMetrics/fulfillmentKpis backend", () => {
    const dashboard = read("src/components/sales/SalesOrderManagementKpiDashboard.tsx");
    assert.match(dashboard, /officialMetrics\?\.soldAmount|soldAmount/);
    assert.doesNotMatch(dashboard, /formatCurrency\(.*totalNetValue/s);
  });

  it("margem consolidada vem de marginEconomics backend", () => {
    const margin = read("src/components/sales/SalesOrderManagementMarginOverview.tsx");
    assert.match(margin, /marginEconomics\?\.consolidated/);
    assert.doesNotMatch(margin, /calculateSalesOrderItemMargin/);
  });

  it("export interno gestão usa service centralizado", () => {
    const exp = read("src/lib/salesOrderInternalMarginExport.server.ts");
    assert.match(exp, /loadSalesOrderManagementMetrics/);
    assert.match(exp, /calculateSalesOrderMarginsForOrders/);
  });

  it("auditoria de fonte exposta na página", () => {
    const page = read("src/components/sales/SalesOrderManagementPage.tsx");
    assert.match(page, /sales-order-management-source-audit/);
    assert.match(page, /sourceAudit\.marginSource/);
  });
});
