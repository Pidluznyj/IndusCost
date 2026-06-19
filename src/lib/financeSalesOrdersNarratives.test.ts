import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assertFinanceSalesOrdersNarrativeFinite,
  buildFinanceSalesOrdersMonthlyComparisonNarrative,
  buildFinanceSalesOrdersPortfolioNarrative,
  buildFinanceSalesOrdersProjectionNarrative,
} from "./financeSalesOrdersNarratives.js";
import type { FinanceSalesOrdersDashboardPayload } from "./financeSalesOrdersDashboardTypes.js";

function payload(partial: Partial<FinanceSalesOrdersDashboardPayload["summary"]>): FinanceSalesOrdersDashboardPayload {
  return {
    summary: {
      selectedYear: 2026,
      selectedMonth: 6,
      monthSalesAmount: 0,
      monthSalesPreviousYearAmount: 0,
      monthSalesGrowthAmount: 0,
      monthSalesGrowthPercent: null,
      ytdSalesAmount: 0,
      previousYtdSalesAmount: 0,
      ytdGrowthAmount: 0,
      ytdGrowthPercent: partial.ytdGrowthPercent ?? null,
      monthTargetAmount: 100_000,
      yearTargetAmount: 1_000_000,
      monthAchievementPercent: null,
      yearAchievementPercent: null,
      monthProjectedAmount: partial.monthProjectedAmount ?? null,
      yearProjectedAmount: null,
      projectedMonthAchievementPercent: null,
      projectedYearAchievementPercent: null,
      dailyAverageAmount: null,
      orderCount: 0,
      itemCount: 0,
      averageTicketAmount: null,
      openPortfolioAmount: partial.openPortfolioAmount ?? 0,
      openPortfolioCount: partial.openPortfolioCount ?? 0,
      invoicedOrdersAmount: 0,
      invoicedOrdersCount: 0,
      notInvoicedOrdersAmount: 0,
      notInvoicedOrdersCount: 0,
      overdueOpenOrdersCount: partial.overdueOpenOrdersCount ?? 0,
      overdueOpenOrdersAmount: 0,
      ...partial,
    },
    topCustomers: [],
  } as FinanceSalesOrdersDashboardPayload;
}

describe("financeSalesOrdersNarratives", () => {
  it("crescimento YTD positivo", () => {
    const text = buildFinanceSalesOrdersMonthlyComparisonNarrative(
      payload({ ytdGrowthPercent: 12 })
    );
    assert.match(text, /acima|crescimento/i);
    assert.ok(assertFinanceSalesOrdersNarrativeFinite(text));
  });

  it("projeção abaixo da meta", () => {
    const text = buildFinanceSalesOrdersProjectionNarrative(
      payload({ monthProjectedAmount: 50_000, monthTargetAmount: 100_000 })
    );
    assert.match(text, /abaixo da meta/i);
  });

  it("carteira com atraso", () => {
    const text = buildFinanceSalesOrdersPortfolioNarrative(
      payload({ overdueOpenOrdersCount: 5, openPortfolioCount: 10 })
    );
    assert.match(text, /atraso/i);
  });

  it("texto curto e leigo", () => {
    const text = buildFinanceSalesOrdersProjectionNarrative(payload({}));
    assert.ok(text.length < 220);
    assert.doesNotMatch(text, /prisma|sql/i);
  });
});
