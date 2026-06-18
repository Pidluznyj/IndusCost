import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  SALES_ORDER_DETAIL_PERMISSIONS,
  SALES_ORDER_VIEW_PERMISSIONS,
} from "./salesOrderIntelligenceRoutes.js";
import { getSalesOrderIntelligenceApiPath } from "./salesOrderManagementTypes.js";

function read(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("salesOrderIntelligenceRoutes", () => {
  it("endpoint registrado", () => {
    assert.match(read("server.ts"), /registerSalesOrderIntelligenceRoutes/);
    assert.match(read("src/lib/salesOrderIntelligenceRoutes.ts"), /\/api\/sales-orders\/:id\/intelligence/);
  });

  it("requer autenticação e permissão", () => {
    const routes = read("src/lib/salesOrderIntelligenceRoutes.ts");
    assert.match(routes, /requireAppAuth/);
    assert.match(routes, /requireAnyPermission\(SALES_ORDER_DETAIL_PERMISSIONS\)/);
    assert.ok(SALES_ORDER_VIEW_PERMISSIONS.includes("sales_orders.view"));
    assert.ok(SALES_ORDER_DETAIL_PERMISSIONS.includes("sales_orders.detail.view"));
  });

  it("retorna 404 para pedido inexistente", () => {
    const routes = read("src/lib/salesOrderIntelligenceRoutes.ts");
    assert.match(routes, /res\.status\(404\)/);
    assert.match(routes, /Pedido não encontrado/);
  });

  it("retorna payload tipado via loader", () => {
    const routes = read("src/lib/salesOrderIntelligenceRoutes.ts");
    assert.match(routes, /buildSalesOrderIntelligencePayload/);
    assert.match(routes, /loadSalesOrderIntelligence/);
  });

  it("respeita padrão de permissão de detalhe do módulo", () => {
    const server = read("server.ts");
    const salesDetail = server.slice(
      server.indexOf('app.get("/api/sales-orders/:id"'),
      server.indexOf('app.get("/api/sales-orders/:id"') + 400
    );
    const routes = read("src/lib/salesOrderIntelligenceRoutes.ts");
    assert.match(salesDetail, /sales_orders\.detail\.view/);
    assert.match(routes, /SALES_ORDER_DETAIL_PERMISSIONS/);
  });

  it("não importa Prisma no frontend de inteligência", () => {
    const drawer = read("src/components/sales/SalesOrderIntelligenceDrawer.tsx");
    const page = read("src/components/sales/SalesOrderManagementPage.tsx");
    const types = read("src/lib/salesOrderManagementTypes.ts");
    for (const src of [drawer, page, types]) {
      assert.doesNotMatch(src, /@prisma\/client/);
      assert.doesNotMatch(src, /from ["'].*prisma/);
    }
    assert.equal(getSalesOrderIntelligenceApiPath("id-1"), "/api/sales-orders/id-1/intelligence");
  });
});
