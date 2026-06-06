import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatExecutiveCompactCurrency,
  formatExecutiveCurrency,
  formatExecutiveDecimal,
  formatExecutiveInteger,
  formatExecutivePercent,
  formatMetricCount,
  formatMetricCurrency,
} from "./executiveDashboardFormatters.js";
import {
  canSeeCommercial,
  canSeeCustomers,
  canSeeFleet,
  canSeeNomus,
  canSeeSalesOrders,
  decimalToNumber,
  safeMetricNumber,
} from "./executiveDashboardHelpers.js";
import {
  countWorkdaysElapsedInMonth,
  countWorkdaysElapsedInYear,
  countWorkdaysInRange,
  countWorkdaysInYear,
  isWeekday,
} from "./executiveDashboardWorkdays.js";
import {
  computeAchievementPercent,
  computeDailyAverageByWorkday,
  computeGrowthTarget,
  computeMonthProjection,
  computeYearProjection,
  computeYtdDailyAverageByWorkday,
  computeTicketAverage,
  EXECUTIVE_SALES_YTD_DAILY_AVERAGE_HINT,
  isOpenPortfolioOrder,
  isOverdueSalesOrder,
  isSalesOrderInvoiced,
  TARGET_GROWTH_FACTOR,
} from "./salesOrderDashboardRules.js";
import type { AppAuthContext } from "./appAuth.js";

function mockUser(perms: string[]): AppAuthContext {
  return {
    id: "u1",
    name: "Test",
    email: "t@test.com",
    role: "ADMIN",
    permissions: perms,
    effectivePermissions: perms,
    isActive: true,
    externalSellerId: null,
    sellerResponsibleName: null,
    lastLoginAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    sessionId: "s1",
  };
}

describe("executiveDashboardFormatters", () => {
  it("formatExecutiveInteger shows integers without decimal places", () => {
    assert.equal(formatExecutiveInteger(1027), "1.027");
    assert.doesNotMatch(formatExecutiveInteger(1027), /,\d{2}$/);
  });

  it("formatExecutiveCurrency always uses 2 decimal places", () => {
    assert.equal(formatExecutiveCurrency(8917179.210019), "R$\u00a08.917.179,21");
  });

  it("formatExecutiveCompactCurrency abbreviates large values", () => {
    assert.match(formatExecutiveCompactCurrency(8_520_000), /Mi$/);
    assert.match(formatExecutiveCompactCurrency(76_040), /mil$/);
    assert.doesNotMatch(formatExecutiveCompactCurrency(8_917_179.210019), /210019/);
  });

  it("formatExecutiveDecimal caps at 2 decimal places", () => {
    assert.equal(formatExecutiveDecimal(123.456789), "123,46");
  });

  it("formatExecutivePercent uses max 2 decimals", () => {
    assert.equal(formatExecutivePercent(12.3456, 2), "12,35");
  });

  it("formatMetric aliases use executive formatting", () => {
    assert.equal(formatMetricCount(1500), "1.500");
    assert.equal(formatMetricCurrency(8917179.210019), "R$\u00a08.917.179,21");
  });
});

describe("executiveDashboardHelpers", () => {
  it("safeMetricNumber rejects NaN and null", () => {
    assert.equal(safeMetricNumber(null), null);
    assert.equal(safeMetricNumber(NaN), null);
    assert.equal(safeMetricNumber(42), 42);
  });

  it("decimalToNumber handles Prisma-like decimals", () => {
    assert.equal(decimalToNumber({ toNumber: () => 12.5 }), 12.5);
  });

  it("canSeeSalesOrders requires sales_orders.view or reports.view", () => {
    assert.equal(canSeeSalesOrders(mockUser(["dashboard.view"])), false);
    assert.equal(canSeeSalesOrders(mockUser(["sales_orders.view"])), true);
  });

  it("canSeeCommercial accepts commercial permissions", () => {
    assert.equal(canSeeCommercial(mockUser(["proposals.view"])), true);
    assert.equal(canSeeCommercial(mockUser(["machines.view"])), false);
  });

  it("canSeeCustomers requires customers.view", () => {
    assert.equal(canSeeCustomers(mockUser(["customers.view"])), true);
  });

  it("canSeeFleet accepts fleet.view", () => {
    assert.equal(canSeeFleet(mockUser(["fleet.view"])), true);
  });

  it("canSeeNomus accepts products.view", () => {
    assert.equal(canSeeNomus(mockUser(["products.view"])), true);
  });
});

describe("executiveDashboardWorkdays", () => {
  it("counts weekdays only", () => {
    const sunday = new Date(2026, 5, 7);
    assert.equal(sunday.getDay(), 0);
    assert.equal(isWeekday(sunday), false);
    assert.equal(isWeekday(new Date(2026, 5, 8)), true);
    const mon = new Date(2026, 5, 8);
    const fri = new Date(2026, 5, 12);
    assert.equal(countWorkdaysInRange(mon, fri), 5);
  });

  it("countWorkdaysElapsedInMonth does not divide by zero path in consumers", () => {
    const days = countWorkdaysElapsedInMonth(new Date(2026, 5, 5));
    assert.ok(days >= 1);
  });

  it("countWorkdaysElapsedInYear counts Monday to Friday only", () => {
    const ref = new Date(2026, 0, 9);
    assert.equal(countWorkdaysElapsedInYear(ref), 7);
  });

  it("countWorkdaysInYear returns total weekdays in calendar year", () => {
    assert.ok(countWorkdaysInYear(2026) >= 250);
  });
});

describe("salesOrderDashboardRules", () => {
  const today = new Date(2026, 5, 10);

  it("excludes cancelled orders from open portfolio", () => {
    assert.equal(
      isOpenPortfolioOrder({ status: "CANCELLED", hasNfeDataProcessamento: false }),
      false
    );
    assert.equal(
      isOpenPortfolioOrder({ status: "READY_TO_SEND", hasNfeDataProcessamento: false }),
      true
    );
  });

  it("carteira aberta requires no NF processada", () => {
    assert.equal(
      isOpenPortfolioOrder({ status: "SENT_TO_NOMUS", hasNfeDataProcessamento: true }),
      false
    );
  });

  it("overdue requires delivery date passed and no invoice", () => {
    assert.equal(
      isOverdueSalesOrder({
        status: "READY_TO_SEND",
        expectedDeliveryDate: new Date(2026, 5, 1),
        today,
        hasNfeDataProcessamento: false,
      }),
      true
    );
    assert.equal(
      isOverdueSalesOrder({
        status: "READY_TO_SEND",
        expectedDeliveryDate: new Date(2026, 5, 1),
        today,
        hasNfeDataProcessamento: true,
      }),
      false
    );
    assert.equal(
      isOverdueSalesOrder({
        status: "CANCELLED",
        expectedDeliveryDate: new Date(2026, 5, 1),
        today,
        hasNfeDataProcessamento: false,
      }),
      false
    );
  });

  it("invoiced orders are detected by dataProcessamento flag", () => {
    assert.equal(isSalesOrderInvoiced(true), true);
    assert.equal(isSalesOrderInvoiced(false), false);
  });

  it("month target equals same month previous year times 1.30", () => {
    assert.equal(computeGrowthTarget(100_000), 100_000 * TARGET_GROWTH_FACTOR);
  });

  it("annual target uses growth factor", () => {
    assert.equal(computeGrowthTarget(1_000_000), 1_300_000);
  });

  it("ticket average avoids divide by zero", () => {
    assert.equal(computeTicketAverage(0, 0), 0);
    assert.equal(computeTicketAverage(1000, 4), 250);
    assert.equal(computeTicketAverage(1000, null), null);
  });

  it("daily average by workday avoids divide by zero", () => {
    assert.equal(computeDailyAverageByWorkday(1000, 0), null);
    assert.equal(computeDailyAverageByWorkday(1000, 5), 200);
  });

  it("YTD daily average uses year total and year workdays elapsed", () => {
    assert.equal(computeYtdDailyAverageByWorkday(500_000, 100), 5000);
    assert.equal(computeYtdDailyAverageByWorkday(500_000, 0), null);
  });

  it("month projection uses YTD daily average not month-only average", () => {
    const ytdAvg = computeYtdDailyAverageByWorkday(600_000, 100)!;
    const monthAvg = computeDailyAverageByWorkday(30_000, 10)!;
    const projectedFromYtd = computeMonthProjection(ytdAvg, 22);
    const projectedFromMonth = computeMonthProjection(monthAvg, 22);
    assert.equal(projectedFromYtd, 6000 * 22);
    assert.equal(projectedFromMonth, 3000 * 22);
    assert.notEqual(projectedFromYtd, projectedFromMonth);
  });

  it("year projection equals YTD daily average times workdays in year", () => {
    const ytdAvg = computeYtdDailyAverageByWorkday(250_000, 50)!;
    assert.equal(computeYearProjection(ytdAvg, 252), 5000 * 252);
  });

  it("YTD daily average hint mentions year and workdays", () => {
    assert.match(EXECUTIVE_SALES_YTD_DAILY_AVERAGE_HINT, /ano selecionado/i);
    assert.match(EXECUTIVE_SALES_YTD_DAILY_AVERAGE_HINT, /dias úteis/i);
  });

  it("achievement percent handles zero target", () => {
    assert.equal(computeAchievementPercent(0, 0), 0);
    assert.equal(computeAchievementPercent(130, 100), 130);
  });
});

describe("executive dashboard service", async () => {
  it("exports buildExecutiveDashboardSummary", async () => {
    const { buildExecutiveDashboardSummary } = await import("./executiveDashboardService.js");
    assert.equal(typeof buildExecutiveDashboardSummary, "function");
  });
});
