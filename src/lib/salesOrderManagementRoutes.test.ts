import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { getSalesOrderManagementApiPath } from "./salesOrderManagementTypes.js";

function read(relPath: string): string {
  return readFileSync(join(process.cwd(), relPath), "utf8");
}

describe("salesOrderManagementRoutes", () => {
  it("rota da tela redireciona sem montar a página", () => {
    const app = read("src/App.tsx");
    assert.match(app, /sales-orders\/management/);
    assert.match(app, /Navigate to="\/sales-orders" replace/);
    assert.doesNotMatch(app, /SalesOrderManagementPage/);
  });

  it("menu Gestão de Pedidos não aparece", () => {
    const app = read("src/App.tsx");
    assert.doesNotMatch(app, /to="\/sales-orders\/management"/);
    assert.doesNotMatch(app, />\s*Gestão de Pedidos\s*</);
  });

  it("endpoint GET /api/sales-orders/management existe", () => {
    assert.match(read("server.ts"), /registerSalesOrderIntelligenceRoutes/);
    const routes = read("src/lib/salesOrderIntelligenceRoutes.ts");
    assert.match(routes, /app\.get\(\s*"\/?api\/sales-orders\/management"/);
    assert.match(routes, /status\(410\)/);
    assert.doesNotMatch(
      routes.slice(routes.indexOf('"/api/sales-orders/management"'), routes.indexOf('"/api/sales-orders/:id/intelligence"')),
      /loadSalesOrderManagementPage\(/
    );
    assert.match(routes, /buildOfficialSalesOrderManagementCore/);
    assert.match(read("src/lib/salesOrderRulesAdapter.ts"), /buildOfficialSalesOrderListPayload/);
    assert.match(routes, /loadSalesOrderManagementPage/);
    assert.equal(getSalesOrderManagementApiPath(), "/api/sales-orders/management");
    assert.equal(
      getSalesOrderManagementApiPath("page=1"),
      "/api/sales-orders/management?page=1"
    );
  });

  it("management registrado antes de :id no server", () => {
    const server = read("server.ts");
    const registerIdx = server.indexOf("registerSalesOrderIntelligenceRoutes(app");
    const detailIdx = server.indexOf('app.get("/api/sales-orders/:id"');
    assert.ok(registerIdx > 0 && detailIdx > 0);
    assert.ok(registerIdx < detailIdx);
  });

  it("endpoint de inteligência sob demanda", () => {
    const routes = read("src/lib/salesOrderIntelligenceRoutes.ts");
    assert.match(routes, /\/api\/sales-orders\/:id\/intelligence/);
    assert.match(routes, /loadSalesOrderIntelligence/);
  });

  it("não usa Proposal como fonte", () => {
    const mgmt = read("src/lib/salesOrderManagement.ts");
    const intel = read("src/lib/salesOrderIntelligence.ts");
    assert.doesNotMatch(mgmt, /Proposal/);
    assert.doesNotMatch(intel, /prisma\.proposal/i);
  });
});
