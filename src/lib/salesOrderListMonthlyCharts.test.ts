/**
 * Regressão: gráficos mensais na listagem Comercial > Pedidos.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

function read(rel: string): string {
  return readFileSync(join(process.cwd(), rel), "utf8");
}

describe("SalesOrdersModule — gráficos mensais antes do grid", () => {
  it("renderiza SalesOrderListMonthlyCharts entre summary e tabela", () => {
    const module = read("src/components/SalesOrdersModule.tsx");
    assert.match(module, /SalesOrderListMonthlyCharts/);
    const summaryIdx = module.indexOf("<SalesOrderListSummaryCards");
    const chartsIdx = module.indexOf("<SalesOrderListMonthlyCharts");
    const tableIdx = module.indexOf("<SalesOrderListTable");
    assert.ok(summaryIdx > 0 && chartsIdx > summaryIdx && tableIdx > chartsIdx);
  });

  it("consome API results (mesma população OP-02) e gráfico de margem condicional", () => {
    const charts = read("src/components/sales/SalesOrderListMonthlyCharts.tsx");
    assert.match(charts, /getSalesOrderResultApiPath/);
    assert.match(charts, /FinanceSalesOrdersMonthlyChart/);
    assert.match(charts, /SalesOrderListMonthlyMarginPercentChart/);
    assert.match(charts, /showMarginChart/);
    assert.match(charts, /monthlySalesComparison/);
    assert.match(charts, /monthlyCommercialMargin/);
  });

  it("gráfico de margem da listagem usa margem comercial (não gerencial)", () => {
    const chart = read(
      "src/components/sales/SalesOrderListMonthlyMarginPercentChart.tsx"
    );
    assert.match(chart, /Margem comercial/);
    assert.doesNotMatch(chart, /Margem gerencial oficial/);
    const charts = read("src/components/sales/SalesOrderListMonthlyCharts.tsx");
    assert.match(charts, /monthlyCommercialMargin/);
    assert.doesNotMatch(charts, /monthlyCommercialMargin \?\? payload\.monthlyMargin/);
    assert.match(charts, /commercial-margin-v2/);
    // Preferência: série do card (mesmo motor) sobre /results.
    assert.match(charts, /monthlyCommercialMargin != null/);
    const module = read("src/components/SalesOrdersModule.tsx");
    assert.match(module, /marginSummary\.monthlyCommercialMargin/);
    const adapter = read("src/lib/salesMarginRulesAdapter.ts");
    assert.match(adapter, /buildMonthlyCommercialMarginRows/);
    assert.match(adapter, /monthlyCommercialMargin/);
    const types = read("src/lib/salesOrderListMarginSummary.ts");
    assert.match(types, /monthlyCommercialMargin/);
    const engine = read("src/lib/salesOrderResultEngine.server.ts");
    assert.match(engine, /buildMonthlyCommercialMarginRows/);
    assert.match(engine, /monthlyCommercialMargin/);
  });

  it("engine de results expõe monthlySalesComparison YoY", () => {
    const engine = read("src/lib/salesOrderResultEngine.server.ts");
    assert.match(engine, /monthlySalesComparison/);
    assert.match(engine, /previousYear/);
    const types = read("src/lib/salesOrderResultTypes.ts");
    assert.match(types, /SalesOrderResultMonthlySalesComparisonRow/);
  });
});
