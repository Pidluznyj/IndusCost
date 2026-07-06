import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  formatChartCurrencyLabel,
  shouldShowChartValueLabel,
} from "./chartValueLabels.js";

describe("financeExecutiveReportChartLabels", () => {
  it("formatChartCurrencyLabel usa formato compacto", () => {
    assert.match(formatChartCurrencyLabel(1_200_000), /Mi/);
    assert.match(formatChartCurrencyLabel(284_000), /mil/);
    assert.equal(formatChartCurrencyLabel(0), "");
  });

  it("valores negativos são formatados corretamente", () => {
    const label = formatChartCurrencyLabel(-650_000);
    assert.match(label, /^- /);
    assert.match(label, /mil|Mi/);
  });

  it("valores nulos não quebram", () => {
    assert.equal(formatChartCurrencyLabel(null), "");
    assert.equal(formatChartCurrencyLabel(undefined), "");
    assert.equal(shouldShowChartValueLabel(null), false);
    assert.equal(shouldShowChartValueLabel(0), false);
  });

  it("labels não exibem NaN/Infinity", () => {
    assert.equal(formatChartCurrencyLabel(NaN), "");
    assert.equal(formatChartCurrencyLabel(Infinity), "");
    assert.equal(shouldShowChartValueLabel(NaN), false);
  });

  it("gráficos executivos usam LabelList", () => {
    const charts = [
      "src/components/finance/executive-report/charts/ExecutiveBarComparisonChart.tsx",
      "src/components/finance/executive-report/charts/ExecutiveRealizedProjectedChart.tsx",
      "src/components/finance/executive-report/charts/ExecutiveScheduleChart.tsx",
      "src/components/finance/executive-report/charts/ExecutiveSalesOrdersChart.tsx",
      "src/components/finance/FinanceCashFlowPlannedChart.tsx",
    ];
    for (const path of charts) {
      const src = readFileSync(join(process.cwd(), path), "utf8");
      assert.match(src, /LabelList/, `${path} sem LabelList`);
      assert.match(src, /ChartBarValueLabel|ChartLineValueLabel/, `${path} sem label custom`);
    }
  });

  it("ExecutiveChartShell aceita scenarioText", () => {
    const shell = readFileSync(
      join(process.cwd(), "src/components/finance/executive-report/charts/ExecutiveChartShell.tsx"),
      "utf8"
    );
    assert.match(shell, /scenarioText/);
    assert.match(shell, /ExecutiveChartScenario/);
  });
});
