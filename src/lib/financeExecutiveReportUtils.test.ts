import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  FINANCE_EXECUTIVE_REPORT_KNOWN_GAPS,
  FINANCE_EXECUTIVE_REPORT_OFFICIAL_SOURCES,
} from "./financeExecutiveReportTypes.js";
import {
  buildExecutiveReportCoverTitle,
  calculateDailyAverage,
  calculateMonthProjection,
  calculatePercentageChange,
  calculateTargetAchievement,
  formatExecutiveReportCurrency,
  normalizeExecutiveMonthKey,
  parseExecutiveMonthKey,
} from "./financeExecutiveReportUtils.js";

describe("financeExecutiveReportUtils", () => {
  it("calculatePercentageChange trata base zero e variação positiva", () => {
    assert.equal(calculatePercentageChange(130, 100), 30);
    assert.equal(calculatePercentageChange(50, 0), 100);
    assert.equal(calculatePercentageChange(0, 0), 0);
    assert.equal(calculatePercentageChange(null, 100), null);
  });

  it("calculateTargetAchievement delega à regra oficial de meta", () => {
    assert.equal(calculateTargetAchievement(80, 100), 80);
    assert.equal(calculateTargetAchievement(130, 100), 130);
    assert.equal(calculateTargetAchievement(10, 0), 100);
    assert.equal(calculateTargetAchievement(0, 0), 0);
  });

  it("calculateDailyAverage e calculateMonthProjection não geram NaN", () => {
    assert.equal(calculateDailyAverage(1000, 10), 100);
    assert.equal(calculateDailyAverage(1000, 0), null);
    assert.equal(calculateMonthProjection(100, 20), 2000);
    assert.equal(calculateMonthProjection(null, 20), null);
  });

  it("normalizeExecutiveMonthKey e parseExecutiveMonthKey são inversos", () => {
    assert.equal(normalizeExecutiveMonthKey(2026, 6), "2026-06");
    assert.deepEqual(parseExecutiveMonthKey("2026-06"), { year: 2026, month: 6 });
    assert.throws(() => normalizeExecutiveMonthKey(2026, 13), RangeError);
  });

  it("formatExecutiveReportCurrency formata BRL", () => {
    const formatted = formatExecutiveReportCurrency(1234.5);
    assert.match(formatted, /R\$/);
    assert.match(formatted, /1/);
  });

  it("buildExecutiveReportCoverTitle segue padrão REPORT DD/MM/AAAA", () => {
    const title = buildExecutiveReportCoverTitle(new Date(2026, 5, 17));
    assert.equal(title, "REPORT 17/06/2026");
  });
});

describe("financeExecutiveReportTypes", () => {
  it("mapeia fontes oficiais AR/AP/Fluxo/Faturamento/Pedidos", () => {
    assert.ok(FINANCE_EXECUTIVE_REPORT_OFFICIAL_SOURCES.accountsReceivable.builder.includes("buildFinanceAccountsReceivableDashboard"));
    assert.ok(FINANCE_EXECUTIVE_REPORT_OFFICIAL_SOURCES.accountsPayable.builder.includes("buildFinanceAccountsPayableDashboard"));
    assert.ok(FINANCE_EXECUTIVE_REPORT_OFFICIAL_SOURCES.cashFlow.builder.includes("buildFinanceCashFlowDashboard"));
    assert.ok(FINANCE_EXECUTIVE_REPORT_OFFICIAL_SOURCES.billing.builder.includes("buildFinanceBillingDashboard"));
    assert.ok(FINANCE_EXECUTIVE_REPORT_OFFICIAL_SOURCES.salesOrders.builder.includes("buildSalesOrdersDashboardTab"));
    assert.ok(FINANCE_EXECUTIVE_REPORT_OFFICIAL_SOURCES.salesOrders.description.includes("SalesOrder"));
    assert.ok(FINANCE_EXECUTIVE_REPORT_OFFICIAL_SOURCES.salesOrders.description.includes("não usa Proposta"));
  });

  it("documenta lacunas conhecidas sem hardcode de valores", () => {
    const gapsJson = JSON.stringify(FINANCE_EXECUTIVE_REPORT_KNOWN_GAPS);
    assert.ok(gapsJson.includes("snapshot"));
    assert.ok(gapsJson.includes("multi-year"));
    assert.ok(!/R\$\s*[\d.]/.test(gapsJson), "lacunas não devem conter valores monetários hardcoded");
  });

  it("contrato tipado existe e referencia payloads oficiais", () => {
    const types = readFileSync(
      join(process.cwd(), "src/lib/financeExecutiveReportTypes.ts"),
      "utf8"
    );
    assert.ok(types.includes("export type FinanceExecutiveReport"));
    assert.ok(types.includes("FinanceExecutiveReportFilters"));
    assert.ok(types.includes("FinanceArDashboardPayload"));
    assert.ok(types.includes("FinanceCashFlowDashboardPayload"));
    assert.ok(types.includes("BillingDashboardTab"));
    assert.ok(types.includes("SalesOrdersDashboardTab"));
  });
});
