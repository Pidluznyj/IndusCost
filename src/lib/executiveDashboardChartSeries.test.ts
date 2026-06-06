import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildChartSeriesConfig,
  buildMonthlySeriesPoints,
} from "./executiveDashboardChartSeries.js";
import { resolveExecutiveDashboardYearContext } from "./executiveDashboardYear.js";
import { formatExecutiveCurrency } from "./executiveDashboardFormatters.js";
import { TARGET_GROWTH_FACTOR } from "./salesOrderDashboardRules.js";

const NOW_2026 = new Date("2026-06-05T12:00:00.000Z");

describe("buildChartSeriesConfig", () => {
  it("marks target as line and uses year-aware labels for sales orders", () => {
    const ctx = resolveExecutiveDashboardYearContext("2026", NOW_2026);
    const config = buildChartSeriesConfig("salesOrders", ctx);

    assert.equal(config.targetAsLine, true);
    assert.equal(config.selectedYear, 2026);
    assert.equal(config.previousYear, 2025);
    assert.equal(config.labels.previousYearBar, "Pedidos 2025");
    assert.equal(config.labels.currentYearBar, "Pedidos 2026 YTD");
    assert.equal(config.labels.targetLine, "Meta 2026 (+30%)");
    assert.equal(config.colors.previousYearBar, "#ED7D31");
    assert.equal(config.colors.currentYearBar, "#1B5E20");
    assert.equal(config.colors.targetLine, "#43A047");
  });

  it("uses billing palette and projection label", () => {
    const ctx = resolveExecutiveDashboardYearContext("2026", NOW_2026);
    const config = buildChartSeriesConfig("billing", ctx);

    assert.equal(config.labels.previousYearBar, "Faturamento 2025");
    assert.equal(config.labels.currentYearBar, "Faturamento 2026 YTD");
    assert.equal(config.labels.projectedLine, "Projeção 2026");
    assert.equal(config.colors.previousYearBar, "#D4A017");
    assert.equal(config.colors.currentYearBar, "#2E7D32");
    assert.equal(config.colors.targetLine, "#C62828");
    assert.equal(config.colors.projectedLine, "#1565C0");
  });

  it("uses distinct colors for each billing series", () => {
    const ctx = resolveExecutiveDashboardYearContext("2026", NOW_2026);
    const config = buildChartSeriesConfig("billing", ctx);
    const values = [
      config.colors.previousYearBar,
      config.colors.currentYearBar,
      config.colors.targetLine,
      config.colors.projectedLine,
    ];
    assert.equal(new Set(values).size, values.length);
  });

  it("uses distinct colors for each sales orders series", () => {
    const ctx = resolveExecutiveDashboardYearContext("2026", NOW_2026);
    const config = buildChartSeriesConfig("salesOrders", ctx);
    const values = [
      config.colors.previousYearBar,
      config.colors.currentYearBar,
      config.colors.targetLine,
    ];
    assert.equal(new Set(values).size, values.length);
    assert.match(config.labels.currentYearBar, /YTD/);
  });
});

describe("buildMonthlySeriesPoints", () => {
  it("computes monthly target as previous year × 1.30", () => {
    const ctx = resolveExecutiveDashboardYearContext("2026", NOW_2026);
    const previous = new Map<number, number>([[3, 100_000]]);
    const current = new Map<number, number>([[3, 120_000]]);

    const series = buildMonthlySeriesPoints(ctx, current, previous);
    const march = series.find((p) => p.month === 3);
    assert.ok(march);
    assert.equal(march!.previousYearValue, 100_000);
    assert.equal(march!.currentYearValue, 120_000);
    assert.equal(march!.targetValue, 100_000 * TARGET_GROWTH_FACTOR);
    assert.equal(march!.achievementPercent, (120_000 / (100_000 * TARGET_GROWTH_FACTOR)) * 100);
  });

  it("sets null for future months in the selected year (no false zero bars)", () => {
    const ctx = resolveExecutiveDashboardYearContext("2026", NOW_2026);
    const series = buildMonthlySeriesPoints(ctx, new Map(), new Map());

    const june = series.find((p) => p.month === 6);
    const july = series.find((p) => p.month === 7);
    assert.ok(june);
    assert.ok(july);
    assert.notEqual(june!.currentYearValue, null);
    assert.equal(july!.currentYearValue, null);
    assert.ok(july!.targetValue > 0 || july!.targetValue === 0);
  });

  it("returns achievement and difference only when current month has value", () => {
    const ctx = resolveExecutiveDashboardYearContext("2026", NOW_2026);
    const series = buildMonthlySeriesPoints(ctx, new Map(), new Map([[8, 50_000]]));
    const august = series.find((p) => p.month === 8);

    assert.ok(august);
    assert.equal(august!.currentYearValue, null);
    assert.equal(august!.achievementPercent, null);
    assert.equal(august!.differenceToTarget, null);
    assert.equal(august!.targetValue, 50_000 * TARGET_GROWTH_FACTOR);
  });

  it("formats tooltip currency without six decimal places", () => {
    const ctx = resolveExecutiveDashboardYearContext("2026", NOW_2026);
    const series = buildMonthlySeriesPoints(
      ctx,
      new Map([[1, 8917179.210019]]),
      new Map([[1, 7000000.123456]])
    );
    const jan = series[0];
    const formatted = formatExecutiveCurrency(jan.currentYearValue ?? 0);
    assert.doesNotMatch(formatted, /210019/);
    assert.doesNotMatch(formatted, /123456/);
    assert.match(formatted, /,\d{2}$/);
  });
});
