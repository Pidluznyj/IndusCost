import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

describe("financeSalesOrdersRoutes", () => {
  it("endpoint registrado no server", () => {
    const server = readFileSync(join(process.cwd(), "server.ts"), "utf8");
    assert.match(server, /registerFinanceSalesOrdersRoutes/);
  });

  it("GET /api/finance/sales-orders/dashboard", () => {
    const routes = readFileSync(join(process.cwd(), "src/lib/financeSalesOrdersRoutes.ts"), "utf8");
    assert.match(routes, /\/api\/finance\/sales-orders\/dashboard/);
    assert.match(routes, /buildFinanceSalesOrdersDashboard/);
    assert.match(routes, /FINANCE_SALES_ORDERS_VIEW_PERMISSIONS/);
  });

  it("export endpoint", () => {
    const routes = readFileSync(join(process.cwd(), "src/lib/financeSalesOrdersRoutes.ts"), "utf8");
    assert.match(routes, /\/api\/finance\/sales-orders\/export/);
  });

  it("retorna erro claro em falha", () => {
    const routes = readFileSync(join(process.cwd(), "src/lib/financeSalesOrdersRoutes.ts"), "utf8");
    assert.match(routes, /Erro ao carregar dashboard de pedidos de venda/);
    assert.match(routes, /status\(500\)/);
    assert.match(routes, /financeApiErrorJson/);
    assert.match(routes, /console\.error/);
  });

  it("SQL de NF usa helper tolerante a formatos Nomus", () => {
    const invoicing = readFileSync(join(process.cwd(), "src/lib/salesOrderInvoicingSql.ts"), "utf8");
    assert.match(invoicing, /nomusNfesJsonbArraySql/);
    assert.match(invoicing, /jsonb_typeof\(\$\{raw\}\) = 'array'/);
  });

  it("não usa Proposal", () => {
    const routes = readFileSync(join(process.cwd(), "src/lib/financeSalesOrdersRoutes.ts"), "utf8");
    assert.doesNotMatch(routes, /Proposal/);
  });
});
