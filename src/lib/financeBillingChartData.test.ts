import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildBillingAccumulatedByYear,
  buildBillingMultiYearMonthlyPoints,
  buildBillingMultiYearSummaries,
} from "./financeBillingChartData.js";

describe("financeBillingChartData", () => {
  it("mês a mês retorna séries por ano sem zero falso em meses futuros", () => {
    const maps = new Map<number, Map<number, number>>();
    maps.set(2025, new Map([[1, 100], [6, 200]]));
    maps.set(2026, new Map([[1, 150], [6, 250]]));

    const points = buildBillingMultiYearMonthlyPoints(2026, maps, 6, true);
    assert.equal(points.length, 12);
    assert.equal(points[0]!.values[2026], 150);
    assert.equal(points[5]!.values[2026], 250);
    assert.equal(points[6]!.values[2026], null);
    assert.equal(points[0]!.values[2025], 100);
  });

  it("acumulado não coloca zero falso em meses futuros", () => {
    const maps = new Map<number, Map<number, number>>();
    maps.set(2026, new Map([[1, 100], [2, 50], [6, 200]]));
    const points = buildBillingMultiYearMonthlyPoints(2026, maps, 6, true);
    const accumulated = buildBillingAccumulatedByYear(points, 2026);
    assert.equal(accumulated[0]!.accumulated, 100);
    assert.equal(accumulated[5]!.accumulated, 350);
    assert.equal(accumulated[6]!.accumulated, null);
  });

  it("summaries calculam YTD e total por ano", () => {
    const maps = new Map<number, Map<number, number>>();
    maps.set(2025, new Map([[6, 800]]));
    maps.set(2026, new Map([[1, 100], [6, 200]]));
    const summaries = buildBillingMultiYearSummaries(2026, maps, 6, true);
    const s2026 = summaries.find((s) => s.year === 2026);
    assert.ok(s2026);
    assert.equal(s2026!.ytdTotal, 300);
    assert.equal(s2026!.yearTotal, 300);
    assert.equal(s2026!.currentMonthValue, 200);
  });

  it("valores numéricos são finitos", () => {
    const maps = new Map<number, Map<number, number>>();
    maps.set(2026, new Map([[6, 1000]]));
    const points = buildBillingMultiYearMonthlyPoints(2026, maps, 6, true);
    for (const p of points) {
      for (const v of Object.values(p.values)) {
        if (v != null) assert.ok(Number.isFinite(v));
      }
      assert.ok(Number.isFinite(p.targetValue));
    }
  });
});
