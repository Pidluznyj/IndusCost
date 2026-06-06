import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assertDistinctSeriesColors,
  EXECUTIVE_DASHBOARD_SERIES_COLORS,
  getExecutiveChartColors,
} from "./executiveDashboardChartTheme.js";

describe("EXECUTIVE_DASHBOARD_SERIES_COLORS", () => {
  it("defines distinct colors per series for sales orders", () => {
    const colors = getExecutiveChartColors("salesOrders");
    assert.ok(assertDistinctSeriesColors(colors));
    assert.equal(colors.previousYearBar, "#ED7D31");
    assert.equal(colors.currentYearBar, "#1B5E20");
  });

  it("defines distinct colors per series for billing", () => {
    const colors = EXECUTIVE_DASHBOARD_SERIES_COLORS.billing;
    assert.ok(assertDistinctSeriesColors(colors));
    assert.notEqual(colors.previousYearBar, colors.currentYearBar);
    assert.notEqual(colors.projectedLine, colors.currentYearBar);
  });

  it("centralizes palette without per-component hardcoding", () => {
    assert.equal(EXECUTIVE_DASHBOARD_SERIES_COLORS.billing.projectedLine, "#1565C0");
  });
});
