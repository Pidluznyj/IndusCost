/**
 * Gráficos mensais da listagem: independência de filtros + população anual.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  resolveSalesOrderListChartsCalendarYear,
} from "./salesOrderListMarginSummary.server.js";

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

  it("cenário C — filtros da tela não entram nos gráficos", () => {
    const module = read("src/components/SalesOrdersModule.tsx");
    const charts = read("src/components/sales/SalesOrderListMonthlyCharts.tsx");
    const chartsBlock = module.slice(
      module.indexOf("const monthlyChartsFilters"),
      module.indexOf("listFilterDraftRef")
    );
    assert.match(chartsBlock, /year:\s*currentYear/);
    assert.doesNotMatch(chartsBlock, /appliedFilters/);
    assert.doesNotMatch(chartsBlock, /status:/);
    assert.doesNotMatch(chartsBlock, /customerId/);
    assert.doesNotMatch(chartsBlock, /sellerKey/);
    assert.doesNotMatch(chartsBlock, /minNetValue/);
    assert.doesNotMatch(chartsBlock, /startDate/);

    assert.match(charts, /getSalesOrderResultApiPath/);
    assert.doesNotMatch(charts, /filters\.status/);
    assert.doesNotMatch(charts, /filters\.customerId/);
    assert.doesNotMatch(charts, /filters\.minNetValue/);
    assert.match(charts, /month:\s*undefined/);
  });

  it("gráfico de margem usa margem comercial (não gerencial)", () => {
    const chart = read(
      "src/components/sales/SalesOrderListMonthlyMarginPercentChart.tsx"
    );
    assert.match(chart, /Margem comercial/);
    assert.doesNotMatch(chart, /Margem gerencial oficial/);
    assert.doesNotMatch(chart, /YTD/);
    const charts = read("src/components/sales/SalesOrderListMonthlyCharts.tsx");
    assert.match(charts, /payload\.monthlyCommercialMargin/);
    assert.match(charts, /commercial-margin-charts-v3/);
    const module = read("src/components/SalesOrdersModule.tsx");
    assert.doesNotMatch(module, /monthlyCommercialMargin=\{marginSummary/);
    const adapter = read("src/lib/salesMarginRulesAdapter.ts");
    assert.match(adapter, /buildMonthlyCommercialMarginRows/);
    assert.match(adapter, /monthlyCommercialMargin/);
    assert.match(adapter, /ordersForMonthlySeries/);
    const types = read("src/lib/salesOrderListMarginSummary.ts");
    assert.match(types, /monthlyCommercialMargin/);
    assert.match(types, /isPartial/);
    assert.match(types, /coveredNetValue/);
    const engine = read("src/lib/salesOrderResultEngine.server.ts");
    assert.match(engine, /buildMonthlyCommercialMarginRows/);
    assert.match(engine, /loadSalesOrderListChartYearOrders/);
    const loader = read("src/lib/salesOrderListMarginSummary.server.ts");
    assert.match(loader, /loadSalesOrderListChartYearOrders/);
    assert.match(loader, /resolveSalesOrderOperationalPopulationWhere/);
    assert.doesNotMatch(loader, /yearWideQuery/);
  });

  it("cenário E — população do gráfico exclui CANCELLED via where canônico", () => {
    const listSummary = read("src/lib/salesOrdersListSummary.ts");
    assert.match(listSummary, /status:\s*\{\s*not:\s*"CANCELLED"\s*\}/);
    const loader = read("src/lib/salesOrderListMarginSummary.server.ts");
    assert.match(loader, /listFilters:\s*\{\s*year,\s*month:\s*null\s*\}/);
  });

  it("cenário H — ano dos gráficos é o civil corrente", () => {
    const fixed = new Date(2026, 6, 29);
    assert.equal(resolveSalesOrderListChartsCalendarYear(fixed), 2026);
    const module = read("src/components/SalesOrdersModule.tsx");
    assert.match(module, /year:\s*currentYear/);
  });

  it("engine de results expõe monthlySalesComparison YoY", () => {
    const engine = read("src/lib/salesOrderResultEngine.server.ts");
    assert.match(engine, /monthlySalesComparison/);
    assert.match(engine, /previousYear/);
    const types = read("src/lib/salesOrderResultTypes.ts");
    assert.match(types, /SalesOrderResultMonthlySalesComparisonRow/);
  });
});
