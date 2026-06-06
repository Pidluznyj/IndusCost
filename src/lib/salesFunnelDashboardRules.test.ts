import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  classifySalesFunnelOrder,
  computeDaysOpen,
  computeFunnelPercent,
  isOpenPortfolioSalesFunnelOrder,
  isOrderIssuedInYear,
} from "./salesFunnelDashboardRules.js";

const TODAY = new Date("2026-06-10T12:00:00.000Z");
const YEAR = 2026;

function baseOrder(overrides?: Partial<Parameters<typeof classifySalesFunnelOrder>[0]>) {
  return {
    status: "READY_TO_SEND",
    issueDate: new Date(2026, 2, 5),
    expectedDeliveryDate: new Date(2026, 4, 1),
    totalNetValue: 10_000,
    hasNfeDataProcessamento: false,
    selectedYear: YEAR,
    today: TODAY,
    ...overrides,
  };
}

describe("salesFunnelDashboardRules", () => {
  it("includes only orders issued in selected year", () => {
    assert.equal(isOrderIssuedInYear(new Date(2026, 1, 1), 2026), true);
    assert.equal(isOrderIssuedInYear(new Date(2025, 11, 31), 2026), false);
  });

  it("classifies overdue 2026 order without NF", () => {
    const result = classifySalesFunnelOrder(baseOrder());
    assert.equal(result.emitted, true);
    assert.equal(result.valid, true);
    assert.equal(result.openPortfolio, true);
    assert.equal(result.overdue, true);
    assert.equal(result.invoiced, false);
  });

  it("excludes 2025 order when selected year is 2026", () => {
    const result = classifySalesFunnelOrder(
      baseOrder({ issueDate: new Date(2025, 2, 5), expectedDeliveryDate: new Date(2025, 4, 1) })
    );
    assert.equal(result.emitted, false);
    assert.equal(result.overdue, false);
  });

  it("excludes invoiced 2026 order from overdue", () => {
    const result = classifySalesFunnelOrder(baseOrder({ hasNfeDataProcessamento: true }));
    assert.equal(result.invoiced, true);
    assert.equal(result.openPortfolio, false);
    assert.equal(result.overdue, false);
  });

  it("excludes cancelled 2026 order", () => {
    const result = classifySalesFunnelOrder(baseOrder({ status: "CANCELLED" }));
    assert.equal(result.valid, false);
    assert.equal(result.cancelled, true);
    assert.equal(result.overdue, false);
  });

  it("year filter changes overdue eligibility", () => {
    const order = baseOrder({
      issueDate: new Date(2025, 2, 5),
      expectedDeliveryDate: new Date(2025, 4, 1),
      selectedYear: 2025,
    });
    assert.equal(classifySalesFunnelOrder(order).overdue, true);
    assert.equal(classifySalesFunnelOrder({ ...order, selectedYear: 2026 }).overdue, false);
  });

  it("open portfolio requires valid and not invoiced", () => {
    assert.equal(
      isOpenPortfolioSalesFunnelOrder({ status: "READY_TO_SEND", hasNfeDataProcessamento: false }),
      true
    );
    assert.equal(
      isOpenPortfolioSalesFunnelOrder({ status: "READY_TO_SEND", hasNfeDataProcessamento: true }),
      false
    );
  });

  it("computeFunnelPercent avoids divide by zero", () => {
    assert.equal(computeFunnelPercent(5, 0), null);
    assert.equal(computeFunnelPercent(25, 100), 25);
  });

  it("computeDaysOpen counts calendar days", () => {
    assert.equal(computeDaysOpen(new Date(2026, 5, 1), new Date(2026, 5, 10)), 9);
  });
});
