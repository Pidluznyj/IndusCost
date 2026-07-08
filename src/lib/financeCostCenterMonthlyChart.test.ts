import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  buildCostCenterMonthlyChartQuery,
  buildCostCenterMonthlyChartSeries,
  formatCostCenterMonthlyChartPeriodLabel,
  parseCostCenterMonthlyChartCostCenterIds,
  type CostCenterMonthlyChartSourceRow,
} from "./financeCostCenterMonthlyChart.shared.js";

function monthlyRow(
  overrides: Partial<CostCenterMonthlyChartSourceRow> &
    Pick<CostCenterMonthlyChartSourceRow, "month" | "costCenterId">
): CostCenterMonthlyChartSourceRow {
  return {
    year: 2026,
    amount: 1000,
    paidAmount: 600,
    openAmount: 400,
    ...overrides,
  };
}

describe("financeCostCenterMonthlyChart", () => {
  it("monta 12 meses com zero quando não há dados", () => {
    const series = buildCostCenterMonthlyChartSeries({
      rows: [],
      costCenterIds: ["cc-a"],
      year: 2026,
    });
    assert.equal(series.length, 12);
    assert.equal(series[0]?.monthLabel, "Jan");
    assert.equal(series[11]?.monthLabel, "Dez");
    assert.ok(series.every((point) => point.paidAmount === 0 && point.openAmount === 0));
  });

  it("agrega pago e em aberto por mês e centro", () => {
    const rows: CostCenterMonthlyChartSourceRow[] = [
      monthlyRow({ month: 3, costCenterId: "cc-a", paidAmount: 200, openAmount: 50, amount: 250 }),
      monthlyRow({ month: 3, costCenterId: "cc-b", paidAmount: 100, openAmount: 25, amount: 125 }),
      monthlyRow({ month: 6, costCenterId: "cc-a", paidAmount: 80, openAmount: 20, amount: 100 }),
    ];
    const series = buildCostCenterMonthlyChartSeries({
      rows,
      costCenterIds: ["cc-a", "cc-b"],
      year: 2026,
      highlightMonth: 3,
    });
    assert.equal(series[2]?.paidAmount, 300);
    assert.equal(series[2]?.openAmount, 75);
    assert.equal(series[2]?.highlighted, true);
    assert.equal(series[5]?.paidAmount, 80);
    assert.equal(series[0]?.paidAmount, 0);
  });

  it("parseia costCenterIds da query", () => {
    assert.deepEqual(parseCostCenterMonthlyChartCostCenterIds({ costCenterIds: "a,b, c" }), [
      "a",
      "b",
      "c",
    ]);
    assert.deepEqual(parseCostCenterMonthlyChartCostCenterIds({ costCenterId: "solo" }), ["solo"]);
  });

  it("query do gráfico remove filtro de mês para série anual", () => {
    const qs = buildCostCenterMonthlyChartQuery(
      {
        year: 2026,
        month: 6,
        status: "all",
        companyName: "",
        costCenterId: "",
        supplierId: "",
        classification: "all",
      },
      ["cc-1"]
    );
    assert.match(qs, /year=2026/);
    assert.doesNotMatch(qs, /month=/);
    assert.match(qs, /costCenterIds=cc-1/);
  });

  it("formata rótulo de período com destaque de mês filtrado", () => {
    assert.match(formatCostCenterMonthlyChartPeriodLabel(2026, 6), /06\/2026/);
    assert.match(formatCostCenterMonthlyChartPeriodLabel(2026, null), /Ano 2026/);
  });

  it("mapa de gastos integra gráfico mensal no drilldown", () => {
    const section = readFileSync(
      join(
        process.cwd(),
        "src/components/finance/cost-centers/FinanceCostCenterExpenseMapSection.tsx"
      ),
      "utf8"
    );
    assert.match(section, /FinanceCostCenterMonthlyDrilldownChart/);
    assert.match(section, /monthly-chart/);
    assert.match(section, /finance-cc-expense-map-detail-header-kpis/);
  });

  it("rota monthly-chart registrada", () => {
    const routes = readFileSync(join(process.cwd(), "src/lib/financeCostCentersRoutes.ts"), "utf8");
    assert.match(routes, /\/api\/finance\/cost-centers\/monthly-chart/);
    assert.match(routes, /buildCostCenterMonthlyChartPayloadDefault/);
  });
});
