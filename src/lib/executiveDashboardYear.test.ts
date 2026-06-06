import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  EXECUTIVE_DASHBOARD_MIN_YEAR,
  parseExecutiveDashboardYear,
  resolveExecutiveDashboardYearContext,
} from "./executiveDashboardYear.js";

const NOW_2026 = new Date("2026-06-05T12:00:00.000Z");

describe("parseExecutiveDashboardYear", () => {
  it("uses current calendar year when param is missing", () => {
    assert.equal(parseExecutiveDashboardYear(undefined, NOW_2026), 2026);
    assert.equal(parseExecutiveDashboardYear("", NOW_2026), 2026);
  });

  it("accepts valid year within bounds", () => {
    assert.equal(parseExecutiveDashboardYear("2026", NOW_2026), 2026);
    assert.equal(parseExecutiveDashboardYear(2025, NOW_2026), 2025);
    assert.equal(parseExecutiveDashboardYear(String(EXECUTIVE_DASHBOARD_MIN_YEAR), NOW_2026), EXECUTIVE_DASHBOARD_MIN_YEAR);
    assert.equal(parseExecutiveDashboardYear("2027", NOW_2026), 2027);
  });

  it("falls back to current year for invalid values", () => {
    assert.equal(parseExecutiveDashboardYear("abc", NOW_2026), 2026);
    assert.equal(parseExecutiveDashboardYear("2019", NOW_2026), 2026);
    assert.equal(parseExecutiveDashboardYear("2028", NOW_2026), 2026);
    assert.equal(parseExecutiveDashboardYear("2026.5", NOW_2026), 2026);
  });
});

describe("resolveExecutiveDashboardYearContext", () => {
  it("returns selectedYear and previousYear for valid input", () => {
    const ctx = resolveExecutiveDashboardYearContext("2026", NOW_2026);
    assert.equal(ctx.selectedYear, 2026);
    assert.equal(ctx.previousYear, 2025);
    assert.equal(ctx.isSelectedYearCurrent, true);
    assert.equal(ctx.ytdMonthLimit, 6);
  });

  it("uses full year YTD when selected year is not current", () => {
    const ctx = resolveExecutiveDashboardYearContext("2025", NOW_2026);
    assert.equal(ctx.selectedYear, 2025);
    assert.equal(ctx.previousYear, 2024);
    assert.equal(ctx.isSelectedYearCurrent, false);
    assert.equal(ctx.ytdMonthLimit, 12);
    assert.equal(ctx.referenceDate.getFullYear(), 2025);
  });

  it("falls back to current year when param is invalid", () => {
    const ctx = resolveExecutiveDashboardYearContext("invalid", NOW_2026);
    assert.equal(ctx.selectedYear, 2026);
    assert.equal(ctx.previousYear, 2025);
  });
});
