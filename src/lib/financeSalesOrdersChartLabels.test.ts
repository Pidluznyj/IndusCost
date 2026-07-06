import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { formatChartCurrencyLabel } from "./chartValueLabels.js";

describe("financeSalesOrdersChartLabels", () => {
  it("labels compactos sem NaN", () => {
    assert.match(formatChartCurrencyLabel(1_200_000), /Mi/);
    assert.equal(formatChartCurrencyLabel(NaN), "");
  });

  it("gráficos financeiros usam LabelList", () => {
    for (const path of [
      "src/components/finance/sales-orders/FinanceSalesOrdersMonthlyChart.tsx",
      "src/components/finance/sales-orders/FinanceSalesOrdersProjectionChart.tsx",
    ]) {
      const src = readFileSync(join(process.cwd(), path), "utf8");
      assert.match(src, /LabelList/);
      assert.match(src, /ChartBarValueLabel/);
    }
  });
});
