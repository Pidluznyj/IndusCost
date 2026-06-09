import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { billingTabMetricsAreFinite } from "./financeBillingDashboard.js";
import type { BillingDashboardTab } from "./executiveDashboardTypes.js";

function minimalTab(): BillingDashboardTab {
  return {
    available: true,
    periodLabel: "junho de 2026",
    yearLabel: 2026,
    source: "SalesOrder",
    summaryCards: [{ id: "billing-month", label: "Mês", value: 1000, formatted: "R$ 1.000" }],
    target: {
      actual: 1000,
      previousPeriod: 800,
      target: 1040,
      gap: -40,
      achievementPercent: 96.15,
      formatted: {
        actual: "R$ 1.000",
        previousPeriod: "R$ 800",
        target: "R$ 1.040",
        gap: "-R$ 40",
        achievementPercent: "96,2%",
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
    monthlySeries: [
      {
        month: 6,
        monthLabel: "Jun",
        periodLabel: "Jun/2026",
        previousYearValue: 800,
        currentYearValue: 1000,
        targetValue: 1040,
        projectedValue: 1100,
        achievementPercent: 96,
        differenceToTarget: -40,
      },
    ],
    chartSeries: {
      kind: "billing",
      selectedYear: 2026,
      previousYear: 2025,
      ytdMonthLimit: 6,
      targetAsLine: true,
      labels: { previousYearBar: "2025", currentYearBar: "2026", targetLine: "Meta" },
      colors: { previousYearBar: "#888", currentYearBar: "#000", targetLine: "#f00" },
    },
    cumulativeBilling: [{ month: 6, label: "Jun", currentYear: 1000, previousYear: 800 }],
    accumulatedEvolution: [
      {
        month: 6,
        monthLabel: "Jun",
        periodLabel: "Jun/2026",
        previousYearAccumulated: 800,
        currentYearAccumulated: 1000,
        accumulatedTarget: 1040,
        projectedAccumulated: 1100,
        differenceToTarget: -40,
        achievementPercent: 96,
      },
    ],
    multiYearMonthly: [{ month: 6, monthLabel: "jun", values: { 2025: 800, 2026: 1000 }, targetValue: 1040 }],
    multiYearSummary: [
      { year: 2026, yearTotal: 10000, currentMonthValue: 1000, ytdTotal: 5000 },
    ],
    topCustomers: [],
    recentInvoicedOrders: [],
    intercompanyExclusionApplied: true,
    marketBillingNote: "test",
  };
}

describe("financeBillingCalculationAudit", () => {
  it("métricas do tab executivo são finitas", () => {
    assert.equal(billingTabMetricsAreFinite(minimalTab()), true);
  });

  it("UI billing possui resumo executivo, export e erro de comparativo", () => {
    const page = readFileSync(
      join(process.cwd(), "src", "components", "finance", "FinanceBillingPage.tsx"),
      "utf8"
    );
    assert.ok(page.includes("Resumo executivo"));
    assert.ok(page.includes("alwaysVisible"));
    assert.ok(page.includes("buildFinanceBillingExportQuery"));
    assert.ok(page.includes("comparisonError"));
    assert.ok(page.includes("FINANCE_BILLING_YTD_SCOPE"));
    assert.ok(page.includes("FINANCE_BILLING_PROJECTION_SCOPE"));
    const panel = readFileSync(
      join(
        process.cwd(),
        "src",
        "components",
        "finance",
        "billing",
        "FinanceBillingComparisonPanel.tsx"
      ),
      "utf8"
    );
    assert.ok(panel.includes("Falha ao carregar comparativo"));
  });
});
