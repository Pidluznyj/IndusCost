import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { FinanceExecutiveReport } from "./financeExecutiveReportTypes.js";
import {
  getFinanceExecutiveReportApiPath,
  hasExecutiveReportDataQualityAlerts,
  resolveExecutiveReportCriticalMonths,
  resolveExecutiveSummaryBillingByYear,
} from "./financeExecutiveReportViewModel.js";

function minimalReport(overrides: Partial<FinanceExecutiveReport> = {}): FinanceExecutiveReport {
  return {
    generatedAt: "2026-05-14T12:00:00.000Z",
    asOfDate: "2026-05-14",
    year: 2026,
    month: 5,
    company: null,
    filters: {
      year: 2026,
      month: 5,
      asOfDate: "2026-05-14",
      mode: "live",
    },
    mode: "live",
    dataSources: {} as FinanceExecutiveReport["dataSources"],
    dataQuality: {
      sanitization: null,
      warnings: [],
      unavailableSections: [],
      targetsDerived: false,
      sync: {
        accountsReceivableLastSyncAt: null,
        accountsPayableLastSyncAt: null,
        nfeLastSyncAt: null,
        salesOrdersLastSyncAt: null,
      },
      freshness: { arStaleExcluded: false, apStaleExcluded: false },
    },
    knownGaps: [],
    cover: {
      title: "REPORT 14/05/2026",
      reportDateLabel: "14/05/2026",
      periodLabel: "05/2026",
    },
    executiveSummary: { headlineMetrics: [], highlights: [] },
    billingComparison: {
      source: {} as never,
      payload: {
        selectedYear: 2026,
        previousYear: 2025,
        currentMonth: 5,
        billingSource: "nfe",
        periodLabel: "mai/2026",
      },
      tab: {
        summaryCards: [],
        target: {
          actual: 100,
          previousPeriod: 80,
          target: 104,
          gap: -4,
          achievementPercent: 96.15,
          formatted: {
            actual: "R$ 100",
            previousPeriod: "R$ 80",
            target: "R$ 104",
            gap: "R$ -4",
            achievementPercent: "96,2%",
          },
        },
        yearComparison: {} as never,
        monthlySeries: [],
        chartSeries: {} as never,
        multiYearMonthly: [
          {
            month: 5,
            monthLabel: "mai",
            values: { 2024: 50, 2025: 70, 2026: 100 },
            targetValue: 91,
          },
        ],
        multiYearSummary: [],
        cumulativeBilling: [],
      },
    },
    billingProjection: { source: {} as never, tab: {} as never },
    accountsReceivable: { source: {} as never, payload: {} as never },
    accountsPayable: { source: {} as never, payload: {} as never },
    cashFlow: { source: {} as never, payload: {} as never },
    calendarAgenda: {
      source: {} as never,
      calendar: {} as never,
      executiveSummary: {
        monthlyTimeline: [
          {
            year: 2026,
            month: 6,
            monthLabel: "Jun",
            received: 0,
            receivableOpenDue: 0,
            estimatedInflow: 0,
            paid: 0,
            payableOpenDue: 100,
            estimatedOutflow: 100,
            netFlow: -100,
            accumulatedNet: -100,
          },
        ],
        period: {} as never,
        net: {} as never,
      },
    },
    salesOrders: { source: {} as never, tab: {} as never },
    executiveNarrative: null,
    ...overrides,
  };
}

describe("financeExecutiveReportViewModel", () => {
  it("getFinanceExecutiveReportApiPath monta URL do endpoint consolidado", () => {
    assert.equal(
      getFinanceExecutiveReportApiPath("year=2026&month=5&asOfDate=2026-05-14"),
      "/api/finance/executive-report?year=2026&month=5&asOfDate=2026-05-14"
    );
  });

  it("resolveExecutiveSummaryBillingByYear extrai faturamento do mês por ano", () => {
    const report = minimalReport();
    const rows = resolveExecutiveSummaryBillingByYear(
      report.billingComparison.tab.multiYearMonthly,
      5,
      2026
    );
    assert.equal(rows.length, 3);
    assert.equal(rows.find((r) => r.year === 2026)?.value, 100);
    assert.equal(rows.find((r) => r.year === 2025)?.value, 70);
  });

  it("resolveExecutiveReportCriticalMonths identifica meses com saldo negativo", () => {
    const report = minimalReport();
    const critical = resolveExecutiveReportCriticalMonths(report);
    assert.deepEqual(critical, ["Jun"]);
  });

  it("hasExecutiveReportDataQualityAlerts detecta warnings e metas derivadas", () => {
    assert.equal(hasExecutiveReportDataQualityAlerts(null), false);
    assert.equal(hasExecutiveReportDataQualityAlerts(minimalReport()), false);
    assert.equal(
      hasExecutiveReportDataQualityAlerts(
        minimalReport({
          dataQuality: {
            ...minimalReport().dataQuality,
            targetsDerived: true,
            warnings: ["Sync indisponível"],
          },
        })
      ),
      true
    );
  });
});
