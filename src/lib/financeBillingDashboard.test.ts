import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  createEmptyFinanceHorizonSummary,
  FINANCE_HORIZON_BILLING_SCOPE_NOTE,
} from "./financeHorizonAggregation.js";
import { billingTabMetricsAreFinite } from "./financeBillingDashboard.js";
import {
  buildFinanceBillingDashboardQuery,
  createDefaultFinanceBillingYear,
  hasPendingFinanceBillingYearChange,
} from "./financeBillingDashboardTypes.js";
import type { BillingDashboardTab } from "./executiveDashboardTypes.js";

const REF = new Date(2026, 5, 6, 12, 0, 0, 0);

function minimalBillingTab(): BillingDashboardTab {
  return {
    available: true,
    periodLabel: "junho de 2026",
    yearLabel: 2026,
    source: "test",
    summaryCards: [
      {
        id: "billing-month",
        label: "Mês",
        value: 1000,
        formatted: "R$ 1.000,00",
      },
    ],
    target: {
      actual: 1000,
      previousPeriod: 800,
      target: 1040,
      gap: -40,
      achievementPercent: 96.15,
      formatted: {
        actual: "R$ 1.000,00",
        previousPeriod: "R$ 800,00",
        target: "R$ 1.040,00",
        gap: "-R$ 40,00",
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
      formatted: {
        dailyAverage: "R$ 50,00",
        projectedMonth: "R$ 1.100,00",
        projectedYear: "R$ 12.000,00",
      },
    },
    yearComparison: {
      yearToDateCurrent: 5000,
      yearToDatePrevious: 4500,
      previousYearTotal: 9000,
      annualTarget: 11700,
      formatted: {
        yearToDateCurrent: "R$ 5.000,00",
        yearToDatePrevious: "R$ 4.500,00",
        previousYearTotal: "R$ 9.000,00",
        annualTarget: "R$ 11.700,00",
      },
    },
    realizedVsProjected: {
      realized: 1000,
      projected: 1100,
      target: 1040,
      formatted: {
        realized: "R$ 1.000,00",
        projected: "R$ 1.100,00",
        target: "R$ 1.040,00",
      },
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
      labels: {
        previousYearBar: "2025",
        currentYearBar: "2026",
        targetLine: "Meta",
      },
      colors: {
        previousYearBar: "#888",
        currentYearBar: "#000",
        targetLine: "#f00",
      },
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
    multiYearMonthly: [
      {
        month: 6,
        monthLabel: "jun",
        values: { 2025: 800, 2026: 1000 },
        targetValue: 1040,
      },
    ],
    multiYearSummary: [
      { year: 2025, yearTotal: 8000, currentMonthValue: 800, ytdTotal: 4000 },
      { year: 2026, yearTotal: 1000, currentMonthValue: 1000, ytdTotal: 1000 },
    ],
    recentInvoicedOrders: [],
    topCustomers: [],
    intercompanyExclusionApplied: true,
    marketBillingNote: "nota",
    forecast: {
      dateField: "expectedDeliveryDate",
      portfolioAmount: 0,
      monthForecastAmount: 0,
      overdueAmount: 0,
      overdueCount: 0,
      ordersWithoutDateCount: 0,
      note: "nota",
      formatted: {
        portfolioAmount: "R$ 0",
        monthForecastAmount: "R$ 0",
        overdueAmount: "R$ 0",
        overdueCount: "0",
      },
      monthlyComparison: [],
      dailySeries: [],
      orders: [],
      financialHorizon: createEmptyFinanceHorizonSummary({
        title: "Horizonte de faturamento — próximos 60 dias",
        subtitle: "Previsão por carteira de pedidos ainda não faturados. Não representa NF-e já emitida.",
        scopeNote: FINANCE_HORIZON_BILLING_SCOPE_NOTE,
        countUnitLabel: "pedido(s)",
        ignoresPeriodFilter: true,
      }),
    },
  };
}

describe("financeBillingDashboard", () => {
  it("wrapper roteia nfe e sales_order", () => {
    const service = readFileSync(
      join(process.cwd(), "src", "lib", "financeBillingDashboard.ts"),
      "utf8"
    );
    const routes = readFileSync(join(process.cwd(), "src", "lib", "financeBillingRoutes.ts"), "utf8");
    assert.ok(service.includes("buildBillingDashboardTab"));
    assert.ok(service.includes("buildBillingDashboardFromNfes"));
    assert.ok(service.includes("resolveExecutiveDashboardYearContext"));
    assert.ok(routes.includes("/api/finance/billing/dashboard"));
    assert.ok(!routes.includes("buildExecutiveDashboardSummary"));
  });

  it("filtro de ano monta query correta", () => {
    assert.equal(buildFinanceBillingDashboardQuery("2026"), "year=2026&billingSource=nfe");
    assert.equal(createDefaultFinanceBillingYear(REF), "2026");
    assert.equal(hasPendingFinanceBillingYearChange("2025", "2026"), true);
    assert.equal(hasPendingFinanceBillingYearChange("2026", "2026"), false);
  });

  it("payload tab não contém NaN ou Infinity nas métricas numéricas", () => {
    assert.equal(billingTabMetricsAreFinite(minimalBillingTab()), true);
    const bad = minimalBillingTab();
    bad.summaryCards[0]!.value = Number.NaN;
    assert.equal(billingTabMetricsAreFinite(bad), false);
  });

  it("comparativo preserva ano anterior via yearCtx (motor executivo)", () => {
    const yearFile = readFileSync(
      join(process.cwd(), "src", "lib", "executiveDashboardYear.ts"),
      "utf8"
    );
    assert.ok(yearFile.includes("previousYear = selectedYear - 1"));
  });
});
