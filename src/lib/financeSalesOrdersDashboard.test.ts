import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  computeAchievementPercent,
  computeGrowthTarget,
  computeMonthProjection,
  computeTicketAverage,
  computeYtdDailyAverageByWorkday,
  TARGET_GROWTH_FACTOR,
} from "./salesOrderDashboardRules.js";
import { getSalesOrderNetValue } from "./crmCommercialOrderRules.js";
import {
  financeSalesOrdersMetricsAreFinite,
  parseFinanceSalesOrdersFilters,
  resolveFinanceSalesOrdersYearContext,
  resolveSalesOrderNetAmount,
} from "./financeSalesOrdersDashboard.js";
import { buildFinanceSalesOrdersExportCsv } from "./financeSalesOrdersExport.js";
import { FINANCE_SALES_ORDERS_MONTH_LABELS } from "./financeSalesOrdersDashboardTypes.js";

describe("financeSalesOrdersDashboard", () => {
  it("usa SalesOrder como fonte — prisma no service", () => {
    const src = readFileSync(join(process.cwd(), "src/lib/financeSalesOrdersDashboard.ts"), "utf8");
    assert.match(src, /prisma\.salesOrder/);
    assert.match(src, /buildSalesOrdersDashboardTab/);
    assert.doesNotMatch(src, /prisma\.proposal/i);
    assert.doesNotMatch(src, /Proposal/);
  });

  it("resolveSalesOrderNetAmount usa totalNetValue", () => {
    assert.equal(resolveSalesOrderNetAmount({ totalNetValue: 1500 }), 1500);
    assert.equal(getSalesOrderNetValue({ totalNetValue: null }), 0);
  });

  it("parseFinanceSalesOrdersFilters filtra ano e mês", () => {
    const f = parseFinanceSalesOrdersFilters({ year: "2026", month: "6" }, new Date(2026, 5, 15));
    assert.equal(f.year, 2026);
    assert.equal(f.month, 6);
    const all = parseFinanceSalesOrdersFilters({ year: "2026", month: "" });
    assert.equal(all.month, null);
  });

  it("mês Todos não define month no filtro", () => {
    const f = parseFinanceSalesOrdersFilters({ year: "2026" });
    assert.equal(f.month, null);
  });

  it("meta mês = anterior × 1.30", () => {
    assert.equal(computeGrowthTarget(100_000), 100_000 * TARGET_GROWTH_FACTOR);
  });

  it("atingimento e projeção sem NaN", () => {
    assert.equal(computeAchievementPercent(80_000, 100_000), 80);
    const daily = computeYtdDailyAverageByWorkday(100_000, 10);
    const projected = computeMonthProjection(daily, 20);
    assert.ok(Number.isFinite(projected));
    assert.ok(Number.isFinite(computeTicketAverage(100_000, 10)!));
  });

  it("resolveFinanceSalesOrdersYearContext ajusta mês", () => {
    const ctx = resolveFinanceSalesOrdersYearContext(
      { year: 2026, month: 3, company: null, customerId: null, customerSearch: null, sellerName: null, status: null, invoiceStatus: "all" },
      new Date(2026, 5, 15)
    );
    assert.equal(ctx.ytdMonthLimit, 3);
    assert.equal(ctx.referenceDate.getMonth(), 2);
  });

  it("monta série mensal Jan–Dez", () => {
    assert.equal(FINANCE_SALES_ORDERS_MONTH_LABELS.length, 12);
    assert.equal(FINANCE_SALES_ORDERS_MONTH_LABELS[0], "Jan");
    assert.equal(FINANCE_SALES_ORDERS_MONTH_LABELS[11], "Dez");
  });

  it("financeSalesOrdersMetricsAreFinite valida payload mock", () => {
    const payload = {
      summary: {
        selectedYear: 2026,
        selectedMonth: 6,
        monthSalesAmount: 1000,
        monthSalesPreviousYearAmount: 800,
        monthSalesGrowthAmount: 200,
        monthSalesGrowthPercent: 25,
        ytdSalesAmount: 5000,
        previousYtdSalesAmount: 4000,
        ytdGrowthAmount: 1000,
        ytdGrowthPercent: 25,
        monthTargetAmount: 1040,
        yearTargetAmount: 5200,
        monthAchievementPercent: 96,
        yearAchievementPercent: 96,
        monthProjectedAmount: 1100,
        yearProjectedAmount: 6000,
        projectedMonthAchievementPercent: 105,
        projectedYearAchievementPercent: 115,
        dailyAverageAmount: 100,
        orderCount: 10,
        itemCount: 50,
        averageTicketAmount: 100,
        openPortfolioAmount: 2000,
        openPortfolioCount: 3,
        invoicedOrdersAmount: 3000,
        invoicedOrdersCount: 7,
        notInvoicedOrdersAmount: 2000,
        notInvoicedOrdersCount: 3,
        overdueOpenOrdersAmount: 500,
        overdueOpenOrdersCount: 1,
      },
      monthlyComparison: [
        {
          month: 1,
          monthLabel: "Jan",
          currentYearAmount: 100,
          previousYearAmount: 80,
          differenceAmount: 20,
          growthPercent: 25,
        },
      ],
      topCustomers: [{ customerId: "1", customerName: "A", amount: 100, orderCount: 1, averageTicketAmount: 100, sharePercent: 100 }],
    } as never;
    assert.equal(financeSalesOrdersMetricsAreFinite(payload), true);
  });

  it("export CSV inclui cabeçalhos", () => {
    const csv = buildFinanceSalesOrdersExportCsv({
      monthlyComparison: [
        {
          month: 1,
          monthLabel: "Jan",
          currentYearAmount: 100,
          previousYearAmount: 80,
          differenceAmount: 20,
          growthPercent: 25,
        },
      ],
      realizedProjected: [{ month: 1, monthLabel: "Jan", realizedAmount: 100, projectedAmount: 110, targetAmount: 104, previousYearAmount: 80 }],
      summary: { monthSalesAmount: 100, ytdSalesAmount: 100, monthTargetAmount: 104, yearTargetAmount: 500, openPortfolioAmount: 50, orderCount: 1, itemCount: 2 } as never,
    } as never);
    assert.match(csv, /Mês/);
    assert.match(csv, /Jan/);
  });
});
