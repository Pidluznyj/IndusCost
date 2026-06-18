import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { getSalesOrderManagementApiPath } from "./salesOrderManagementTypes.js";

function read(relPath: string): string {
  return readFileSync(join(process.cwd(), relPath), "utf8");
}

describe("salesOrderManagementRoutes", () => {
  it("rota da tela existe", () => {
    const app = read("src/App.tsx");
    assert.match(app, /sales-orders\/management/);
    assert.match(app, /SalesOrderManagementPage/);
  });

  it("menu Gestão de Pedidos aparece", () => {
    const app = read("src/App.tsx");
    assert.match(app, /Gestão de Pedidos/);
    assert.match(app, /to="\/sales-orders\/management"/);
  });

  it("endpoint GET /api/sales-orders/management existe", () => {
    assert.match(read("server.ts"), /registerSalesOrderIntelligenceRoutes/);
    const routes = read("src/lib/salesOrderIntelligenceRoutes.ts");
    assert.match(routes, /app\.get\(\s*"\/?api\/sales-orders\/management"/);
    assert.match(routes, /loadSalesOrderManagementPage/);
    assert.equal(getSalesOrderManagementApiPath(), "/api/sales-orders/management");
    assert.equal(
      getSalesOrderManagementApiPath("page=1"),
      "/api/sales-orders/management?page=1"
    );
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
