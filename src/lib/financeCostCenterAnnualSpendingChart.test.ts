import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyCostCenterAnnualSpendingTopN,
  buildCostCenterAnnualSpendingChart,
  resolveCostCenterAnnualSpendingPeriodCopy,
  resolveCostCenterChartColorHex,
} from "./financeCostCenterAnnualSpendingChart.js";
import { parseFinanceCostCenterDashboardFilters } from "./financeCostCenterDashboard.js";

describe("financeCostCenterAnnualSpendingChart", () => {
  const baseRows = [
    {
      costCenterId: "cc-a",
      code: "ADM",
      name: "Administrativo",
      amount: 500,
      openAmount: 100,
      overdueAmount: 50,
      paidAmount: 400,
      titlesCount: 2,
      sharePercentage: 50,
    },
    {
      costCenterId: "cc-b",
      code: "PROD",
      name: "Produção",
      amount: 300,
      openAmount: 80,
      overdueAmount: 0,
      paidAmount: 220,
      titlesCount: 1,
      sharePercentage: 30,
    },
    {
      costCenterId: "cc-c",
      code: "MKT",
      name: "Marketing",
      amount: 200,
      openAmount: 20,
      overdueAmount: 10,
      paidAmount: 180,
      titlesCount: 1,
      sharePercentage: 20,
    },
  ];

  it("ordena do maior para o menor e soma total", () => {
    const filters = parseFinanceCostCenterDashboardFilters({ year: 2026, status: "all" });
    const chart = buildCostCenterAnnualSpendingChart(baseRows, filters);
    assert.equal(chart.totalAmount, 1000);
    assert.equal(chart.rows[0]?.costCenterCode, "ADM");
    assert.equal(chart.rows[1]?.costCenterCode, "PROD");
    assert.equal(chart.rows[2]?.costCenterCode, "MKT");
    assert.equal(chart.rows[0]?.rank, 1);
    assert.equal(chart.periodScope, "annual");
    assert.match(chart.title, /2026/);
  });

  it("título mensal quando filtro de mês está ativo", () => {
    const copy = resolveCostCenterAnnualSpendingPeriodCopy({ year: 2026, month: 6 });
    assert.equal(copy.periodScope, "monthly");
    assert.match(copy.title, /Junho\/2026/);
  });

  it("cores estáveis por código do centro", () => {
    const a = resolveCostCenterChartColorHex("ADM");
    const b = resolveCostCenterChartColorHex("ADM");
    const c = resolveCostCenterChartColorHex("PROD");
    assert.equal(a, b);
    assert.notEqual(a, c);
  });

  it("Top N agrupa excedente em Outros", () => {
    const rows = Array.from({ length: 12 }, (_, index) => ({
      costCenterId: `cc-${index}`,
      code: `C${index}`,
      name: `Centro ${index}`,
      amount: 1000 - index * 10,
      openAmount: 0,
      overdueAmount: 0,
      paidAmount: 0,
      titlesCount: 1,
      sharePercentage: 0,
    }));
    const filters = parseFinanceCostCenterDashboardFilters({ year: 2026, status: "all" });
    const chart = buildCostCenterAnnualSpendingChart(rows, filters, { topN: 10 });
    assert.equal(chart.displayRows.length, 11);
    assert.equal(chart.displayRows.at(-1)?.isOthersBucket, true);
    assert.equal(chart.othersIncludedCount, 2);
    const sumDisplay = chart.displayRows.reduce((s, row) => s + row.totalAmount, 0);
    assert.equal(sumDisplay, chart.totalAmount);
  });

  it("applyCostCenterAnnualSpendingTopN mantém soma", () => {
    const filters = parseFinanceCostCenterDashboardFilters({ year: 2026, status: "all" });
    const chart = buildCostCenterAnnualSpendingChart(baseRows, filters);
    const top = applyCostCenterAnnualSpendingTopN(chart.rows, 2);
    assert.equal(top.displayRows.length, 3);
    const sum = top.displayRows.reduce((s, row) => s + row.totalAmount, 0);
    assert.equal(sum, chart.totalAmount);
  });
});
