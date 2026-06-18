import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  SALES_ORDER_DETAIL_PERMISSIONS,
  SALES_ORDER_VIEW_PERMISSIONS,
} from "./salesOrderIntelligenceRoutes.js";
import {
  getSalesOrderIntelligenceApiPath,
  getSalesOrderManagementApiPath,
} from "./salesOrderManagementTypes.js";

function readServer(): string {
  return readFileSync(join(process.cwd(), "server.ts"), "utf8");
}

describe("salesOrderIntelligenceRoutes", () => {
  it("endpoint de inteligência registrado", () => {
    const server = readServer();
    assert.match(server, /registerSalesOrderIntelligenceRoutes/);
    const routes = readFileSync(
      join(process.cwd(), "src", "lib", "salesOrderIntelligenceRoutes.ts"),
      "utf8"
    );
    assert.match(routes, /\/api\/sales-orders\/:id\/intelligence/);
    assert.match(routes, /\/api\/sales-orders\/management/);
  });

  it("requer permissão de visualização", () => {
    assert.ok(SALES_ORDER_VIEW_PERMISSIONS.includes("sales_orders.view"));
    assert.ok(
      SALES_ORDER_DETAIL_PERMISSIONS.some((p) =>
        ["sales_orders.detail.view", "sales_orders.view"].includes(p)
      )
    );
    const routes = readFileSync(
      join(process.cwd(), "src", "lib", "salesOrderIntelligenceRoutes.ts"),
      "utf8"
    );
    assert.match(routes, /requireAnyPermission\(SALES_ORDER_VIEW_PERMISSIONS\)/);
    assert.match(routes, /requireAnyPermission\(SALES_ORDER_DETAIL_PERMISSIONS\)/);
  });

  it("retorna payload tipado via loader", () => {
    const routes = readFileSync(
      join(process.cwd(), "src", "lib", "salesOrderIntelligenceRoutes.ts"),
      "utf8"
    );
    assert.match(routes, /buildSalesOrderIntelligencePayload/);
    assert.match(routes, /loadSalesOrderIntelligence/);
    assert.match(routes, /loadSalesOrderManagementPage/);
  });

  it("404 para pedido inexistente", () => {
    const routes = readFileSync(
      join(process.cwd(), "src", "lib", "salesOrderIntelligenceRoutes.ts"),
      "utf8"
    );
    assert.match(routes, /res\.status\(404\)/);
    assert.match(routes, /Pedido não encontrado/);
  });

  it("paths de API estáveis", () => {
    assert.equal(getSalesOrderIntelligenceApiPath("abc"), "/api/sales-orders/abc/intelligence");
    assert.equal(getSalesOrderManagementApiPath(), "/api/sales-orders/management");
    assert.equal(
      getSalesOrderManagementApiPath("year=2026"),
      "/api/sales-orders/management?year=2026"
    );
  });
});
