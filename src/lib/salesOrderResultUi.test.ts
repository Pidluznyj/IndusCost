import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

function read(rel: string): string {
  return readFileSync(join(process.cwd(), rel), "utf8");
}

describe("salesOrderResult UI", () => {
  it("rota Resultado registrada no App", () => {
    const app = read("src/App.tsx");
    assert.match(app, /path="sales-orders\/result"/);
    assert.match(app, /SalesOrderResultPage/);
    assert.match(app, /Resultado/);
  });

  it("página consome API dedicada e não recalcula margem", () => {
    const page = read("src/components/sales/SalesOrderResultPage.tsx");
    assert.match(page, /getSalesOrderResultApiPath/);
    assert.match(page, /sales-order-result-kpis/);
    assert.match(page, /SystemTotalizerCard/);
    assert.match(page, /SYSTEM_TOTALIZER_GRID_CLASS/);
    assert.doesNotMatch(page, /calculateSalesOrderItemMargin/);
    assert.doesNotMatch(page, /calculateSalePriceFromCost/);
  });

  it("gráficos renderizam", () => {
    assert.match(read("src/components/sales/SalesOrderResultMonthlyMarginChart.tsx"), /ComposedChart/);
    const projection = read("src/components/sales/SalesOrderResultProjectionChart.tsx");
    assert.match(projection, /ComposedChart/);
    assert.match(projection, /SystemTotalizerCard/);
    assert.match(projection, /SYSTEM_TOTALIZER_GRID_CLASS/);
    assert.doesNotMatch(projection, /MetricCard/);
  });

  it("permissão de margem respeitada", () => {
    const page = read("src/components/sales/SalesOrderResultPage.tsx");
    assert.match(page, /canViewSalesOrderMarginEconomics/);
    assert.match(page, /sales-order-result-denied/);
  });

  it("endpoint registrado no server", () => {
    assert.match(read("server.ts"), /registerSalesOrderResultRoutes/);
    assert.match(read("src/lib/salesOrderResultRoutes.ts"), /\/api\/sales-orders\/results/);
  });
});
