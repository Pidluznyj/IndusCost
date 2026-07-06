import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  billingAccumulatedChartHasData,
  billingMonthlyChartHasData,
  mapBillingAccumulatedChartData,
  mapBillingMonthlyChartData,
} from "./financeBillingChartRender.js";

describe("financeBillingChartRender", () => {
  it("detecta dados na série acumulada quando há YTD", () => {
    const series = [
      {
        month: 6,
        monthLabel: "Jun",
        periodLabel: "Jun/2026",
        previousYearAccumulated: 500,
        currentYearAccumulated: 1000,
        accumulatedTarget: 1100,
        projectedAccumulated: 1200,
        differenceToTarget: -100,
        achievementPercent: 90,
      },
    ];
    assert.equal(billingAccumulatedChartHasData(series), true);
    const data = mapBillingAccumulatedChartData(series);
    assert.equal(data[0]!.current, 1000);
  });

  it("detecta dados no comparativo mensal multi-ano", () => {
    const points = [
      { month: 6, monthLabel: "Jun", values: { 2025: 800, 2026: 1000 }, targetValue: 1040 },
    ];
    assert.equal(billingMonthlyChartHasData(points, [2025, 2026]), true);
    const data = mapBillingMonthlyChartData(points, [2025, 2026], true);
    assert.equal(data[0]!["y2026"], 1000);
  });

  it("componentes de gráfico usam altura explícita no ResponsiveContainer", () => {
    for (const file of [
      "FinanceBillingAccumulatedChart.tsx",
      "FinanceBillingMonthlyComparisonChart.tsx",
      "FinanceBillingProjectionChart.tsx",
      "FinanceBillingForecastCharts.tsx",
    ]) {
      const src = readFileSync(
        join(process.cwd(), "src", "components", "finance", "billing", file),
        "utf8"
      );
      assert.ok(src.includes("FINANCE_BILLING_CHART_HEIGHT"), file);
      assert.ok(src.includes("height={FINANCE_BILLING_CHART_HEIGHT}"), file);
    }
  });
});
