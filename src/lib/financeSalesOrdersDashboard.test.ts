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
  resolveFinanceSalesOrdersPeriodBounds,
  resolveFinanceSalesOrdersYearContext,
  resolveSalesOrderNetAmount,
} from "./financeSalesOrdersDashboard.js";
import type { FinanceSalesOrdersDashboardPayload } from "./financeSalesOrdersDashboardTypes.js";
import { buildFinanceSalesOrdersExportCsv } from "./financeSalesOrdersExport.js";
import { FINANCE_SALES_ORDERS_MONTH_LABELS } from "./financeSalesOrdersDashboardTypes.js";

describe("financeSalesOrdersDashboard", () => {
  it("usa motor oficial de regras — prisma apenas para carga", () => {
    const src = readFileSync(join(process.cwd(), "src/lib/financeSalesOrdersDashboard.ts"), "utf8");
    assert.match(src, /buildOfficialSalesOrderRulesResult/);
    assert.match(src, /OFFICIAL_SO_RULES_SOURCE/);
    assert.match(src, /buildSalesOrdersDashboardTab/);
    assert.doesNotMatch(src, /prisma\.salesOrder\.aggregate/);
    assert.doesNotMatch(src, /prisma\.proposal/i);
    assert.doesNotMatch(src, /Proposal/);
  });

  it("auditoria não filtra issueDate/customerId null via Prisma (campos obrigatórios no schema)", () => {
    const schema = readFileSync(join(process.cwd(), "prisma/schema.prisma"), "utf8");
    const salesOrderBlock = schema.match(/model SalesOrder \{[\s\S]*?\n\}/)?.[0] ?? "";
    assert.match(salesOrderBlock, /issueDate\s+DateTime\s+@default/);
    assert.match(salesOrderBlock, /customerId\s+String\s+@db\.Uuid/);
    assert.doesNotMatch(salesOrderBlock, /issueDate\s+DateTime\?/);
    assert.doesNotMatch(salesOrderBlock, /customerId\s+String\?/);

    const src = readFileSync(join(process.cwd(), "src/lib/financeSalesOrdersDashboard.ts"), "utf8");
    assert.doesNotMatch(src, /issueDate:\s*null/);
    assert.doesNotMatch(src, /customerId:\s*null/);
    assert.match(src, /missingIssueDate:\s*0/);
    assert.match(src, /missingCustomer:\s*0/);
    assert.match(src, /queryExcludedCounts[\s\S]*catch/);
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

  it("parseFinanceSalesOrdersFilters — todos os filtros do dashboard", () => {
    const f = parseFinanceSalesOrdersFilters({
      year: "2026",
      month: "3",
      company: "SM",
      customerId: "cust-1",
      customerSearch: "esmal",
      sellerName: "Rodrigo",
      status: "SENT_TO_NOMUS",
      invoiceStatus: "with_invoice",
    });
    assert.equal(f.year, 2026);
    assert.equal(f.month, 3);
    assert.equal(f.company, "SM");
    assert.equal(f.customerId, "cust-1");
    assert.equal(f.customerSearch, "esmal");
    assert.equal(f.sellerName, "Rodrigo");
    assert.equal(f.status, "SENT_TO_NOMUS");
    assert.equal(f.invoiceStatus, "with_invoice");

    const semNf = parseFinanceSalesOrdersFilters({ year: "2026", invoiceStatus: "without_invoice" });
    assert.equal(semNf.invoiceStatus, "without_invoice");
  });

  it("carteira NF/aberta usa motor oficial via mapOfficialFinancePortfolioFromManagementRows", () => {
    const src = readFileSync(join(process.cwd(), "src/lib/financeSalesOrdersDashboard.ts"), "utf8");
    assert.match(src, /mapOfficialFinancePortfolioFromManagementRows/);
    assert.doesNotMatch(src, /orderIsInvoicedSql/);
    assert.doesNotMatch(src, /orderNotInvoicedSql/);
  });

  it("parseFinanceSalesOrdersFilters — status logístico BI", () => {
    const f = parseFinanceSalesOrdersFilters({
      year: "2026",
      logisticStatus: "overduePending",
    });
    assert.equal(f.logisticStatus, "overduePending");
    const invalid = parseFinanceSalesOrdersFilters({ logisticStatus: "invalid" });
    assert.equal(invalid.logisticStatus, null);
  });

  it("resolveFinanceSalesOrdersPeriodBounds respeita mês", () => {
    const monthBounds = resolveFinanceSalesOrdersPeriodBounds({
      year: 2026,
      month: 3,
      company: null,
      customerId: null,
      customerSearch: null,
      sellerName: null,
      status: null,
      invoiceStatus: "all",
      logisticStatus: null,
    });
    assert.equal(monthBounds.from.getMonth(), 2);
    assert.equal(monthBounds.to.getMonth(), 2);

    const yearBounds = resolveFinanceSalesOrdersPeriodBounds({
      year: 2026,
      month: null,
      company: null,
      customerId: null,
      customerSearch: null,
      sellerName: null,
      status: null,
      invoiceStatus: "all",
      logisticStatus: null,
    });
    assert.equal(yearBounds.from.getMonth(), 0);
    assert.equal(yearBounds.to.getMonth(), 11);
  });

  it("usa extended metrics no service", () => {
    const src = readFileSync(join(process.cwd(), "src/lib/financeSalesOrdersDashboard.ts"), "utf8");
    assert.match(src, /buildExtendedMetricsFromOrders/);
    assert.match(src, /manufacturingStatusBreakdown/);
    assert.match(src, /logisticStatusBreakdown/);
  });

  it("financeSalesOrdersDashboardPayload tem contrato mínimo válido", () => {
    const payload: FinanceSalesOrdersDashboardPayload = {
      generatedAt: new Date().toISOString(),
      filters: {
        year: 2026,
        month: null,
        company: null,
        customerId: null,
        customerSearch: null,
        sellerName: null,
        status: null,
        invoiceStatus: "all",
        logisticStatus: null,
      },
      summary: {
        selectedYear: 2026,
        selectedMonth: null,
        totalOrdersAmount: 0,
        monthSalesAmount: 0,
        monthSalesPreviousYearAmount: 0,
        monthSalesGrowthAmount: 0,
        monthSalesGrowthPercent: 0,
        ytdSalesAmount: 0,
        previousYtdSalesAmount: 0,
        ytdGrowthAmount: 0,
        ytdGrowthPercent: 0,
        monthTargetAmount: null,
        yearTargetAmount: null,
        monthTargetConfigured: false,
        monthAchievementPercent: null,
        yearAchievementPercent: null,
        monthProjectedAmount: 0,
        yearProjectedAmount: 0,
        projectedMonthAchievementPercent: null,
        projectedYearAchievementPercent: null,
        dailyAverageAmount: 0,
        orderCount: 0,
        itemCount: 0,
        averageTicketAmount: 0,
        openPortfolioAmount: 0,
        openPortfolioCount: 0,
        invoicedOrdersAmount: 0,
        invoicedOrdersCount: 0,
        notInvoicedOrdersAmount: 0,
        notInvoicedOrdersCount: 0,
        overdueOpenOrdersAmount: 0,
        overdueOpenOrdersCount: 0,
      },
      monthlyComparison: FINANCE_SALES_ORDERS_MONTH_LABELS.map((monthLabel, i) => ({
        month: i + 1,
        monthLabel,
        currentYearAmount: 0,
        previousYearAmount: 0,
        differenceAmount: 0,
        growthPercent: 0,
      })),
      realizedProjected: [],
      topCustomers: [],
      topSellers: [],
      statusBreakdown: [],
      manufacturingStatusBreakdown: [],
      logisticStatusBreakdown: [],
      criticalOrders: [],
      openPortfolioEvolution: [],
      portfolioBreakdown: {
        notInvoicedAmount: 0,
        notInvoicedCount: 0,
        invoicedAmount: 0,
        invoicedCount: 0,
        overdueAmount: 0,
        overdueCount: 0,
        onTimeOpenAmount: 0,
        onTimeOpenCount: 0,
      },
      chartSeries: {} as never,
      tab: { available: true } as never,
      dataQuality: {
        warnings: [],
        source: "SalesOrder/SalesOrderItem",
        excludedCancelledOrdersCount: 0,
        excludedErrorOrdersCount: 0,
        missingIssueDateCount: 0,
        missingCustomerCount: 0,
        targetConfigured: false,
        targetDerived: false,
        targetRule: "test",
        lastNomusSyncAt: null,
        calculationRules: [],
        openPortfolioEvolutionNote: "test",
      },
    };
    assert.equal(payload.monthlyComparison.length, 12);
    assert.equal(financeSalesOrdersMetricsAreFinite(payload), true);
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
      { year: 2026, month: 3, company: null, customerId: null, customerSearch: null, sellerName: null, status: null, invoiceStatus: "all", logisticStatus: null },
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
        totalOrdersAmount: 1000,
        monthSalesAmount: 1000,
        monthSalesPreviousYearAmount: 800,
        monthSalesGrowthAmount: 200,
        monthSalesGrowthPercent: 25,
        ytdSalesAmount: 5000,
        previousYtdSalesAmount: 4000,
        ytdGrowthAmount: 1000,
        ytdGrowthPercent: 25,
        monthTargetAmount: null,
        yearTargetAmount: null,
        monthTargetConfigured: false,
        monthAchievementPercent: null,
        yearAchievementPercent: null,
        monthProjectedAmount: 1100,
        yearProjectedAmount: 6000,
        projectedMonthAchievementPercent: null,
        projectedYearAchievementPercent: null,
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
      topSellers: [{ sellerName: "Ana", amount: 100, orderCount: 1, averageTicketAmount: 100, sharePercent: 100 }],
      manufacturingStatusBreakdown: [{ code: "2", label: "Liberado", amount: 100, orderCount: 1 }],
      logisticStatusBreakdown: [],
      criticalOrders: [],
      openPortfolioEvolution: [],
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
