import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildFinanceBillingActionItems } from "./financeBillingActions.js";
import type { BillingDashboardTab } from "./executiveDashboardTypes.js";
import type { FinanceBillingComparisonPayload } from "./financeBillingNfeComparison.js";

function minimalTab(achievement: number): BillingDashboardTab {
  return {
    available: true,
    periodLabel: "junho de 2026",
    yearLabel: 2026,
    source: "NomusNfe",
    summaryCards: [],
    target: {
      actual: 1000,
      previousPeriod: 800,
      target: 1040,
      gap: -40,
      achievementPercent: achievement,
      formatted: {
        actual: "R$ 1.000",
        previousPeriod: "R$ 800",
        target: "R$ 1.040",
        gap: "-R$ 40",
        achievementPercent: `${achievement}%`,
      },
    },
    projection: {
      dailyAverage: 50,
      projectedMonth: 1100,
      projectedYear: 12000,
      workdaysElapsed: 120,
      workdaysInMonth: 22,
      workdaysInYear: 252,
      ytdDailyAverageHint: "hint",
      formatted: { dailyAverage: "R$ 50", projectedMonth: "R$ 1.100", projectedYear: "R$ 12.000" },
    },
    yearComparison: {
      yearToDateCurrent: 5000,
      yearToDatePrevious: 4500,
      previousYearTotal: 9000,
      annualTarget: 11700,
      formatted: {
        yearToDateCurrent: "R$ 5.000",
        yearToDatePrevious: "R$ 4.500",
        previousYearTotal: "R$ 9.000",
        annualTarget: "R$ 11.700",
      },
    },
    realizedVsProjected: {
      realized: 1000,
      projected: 1100,
      target: 1040,
      formatted: { realized: "R$ 1.000", projected: "R$ 1.100", target: "R$ 1.040" },
    },
    monthlySeries: [],
    chartSeries: {
      kind: "billing",
      selectedYear: 2026,
      previousYear: 2025,
      ytdMonthLimit: 6,
      targetAsLine: true,
      labels: { previousYearBar: "2025", currentYearBar: "2026", targetLine: "Meta" },
      colors: { previousYearBar: "#888", currentYearBar: "#000", targetLine: "#f00" },
    },
    cumulativeBilling: [],
    accumulatedEvolution: [],
    multiYearMonthly: [],
    multiYearSummary: [],
    topCustomers: [
      {
        customerId: "1",
        customerName: "Cliente A",
        orderCount: 10,
        totalNetValue: 60000,
      },
      {
        customerId: "2",
        customerName: "Cliente B",
        orderCount: 5,
        totalNetValue: 40000,
      },
    ],
    recentInvoicedOrders: [],
    intercompanyExclusionApplied: true,
    marketBillingNote: "test",
    forecast: null,
  };
}

describe("financeBillingActions", () => {
  it("alerta faturamento abaixo da meta", () => {
    const items = buildFinanceBillingActionItems({ tab: minimalTab(70) });
    assert.ok(items.some((i) => i.id === "below-target"));
  });

  it("alerta divergência NF-e x SalesOrder", () => {
    const comparison: FinanceBillingComparisonPayload = {
      year: 2026,
      generatedAt: new Date().toISOString(),
      note: "test",
      dashboardSource: "SalesOrder.nomusRawResponse.nfes",
      nfeSource: "NomusNfe",
      months: [],
      yearTotalSalesOrder: 100000,
      yearTotalNomusNfe: 70000,
      yearDifference: -30000,
    };
    const items = buildFinanceBillingActionItems({ comparison });
    assert.ok(items.some((i) => i.id === "nfe-so-divergence"));
  });

  it("alerta concentração por cliente", () => {
    const items = buildFinanceBillingActionItems({ tab: minimalTab(100) });
    assert.ok(items.some((i) => i.id === "customer-concentration"));
  });
});
