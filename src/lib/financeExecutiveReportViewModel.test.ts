import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { FinanceExecutiveReport } from "./financeExecutiveReportTypes.js";
import {
  getFinanceExecutiveReportApiPath,
  hasExecutiveReportDataQualityAlerts,
  resolveExecutiveReportCriticalMonths,
  resolveExecutiveSummaryBillingByYear,
} from "./financeExecutiveReportViewModel.js";
import {
  EXECUTIVE_REPORT_EMPTY_MESSAGE,
  executiveChartRowsPreserveMonthOrder,
  formatExecutiveReportAxisCurrency,
  formatExecutiveReportPresentationCurrency,
  formatExecutiveReportPresentationPercent,
  mapBillingMultiYearToBarComparison,
  mapCashFlowTimelineToChart,
  buildExecutiveCashFlowAnnualChart,
  EXECUTIVE_REPORT_MONTH_LABELS_PT,
  mapRealizedProjectedChart,
  mapSalesOrdersMonthlyToChart,
} from "./financeExecutiveReportPresentation.js";

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
          {
            month: 3,
            monthLabel: "mar",
            values: { 2024: 1_500_000, 2025: 2_000_000, 2026: 2_500_000 },
            targetValue: 0,
          },
        ],
        multiYearSummary: [],
        cumulativeBilling: [],
      },
    },
    billingProjection: {
      source: {} as never,
      tab: {
        projection: {} as never,
        realizedVsProjected: {
          realized: 1_200_000,
          projected: 1_500_000,
          target: null,
          formatted: {
            realized: "R$ 1,2 Mi",
            projected: "R$ 1,5 Mi",
            target: "—",
          },
        },
        accumulatedEvolution: [],
        forecast: {} as never,
      },
    },
    accountsReceivable: { source: {} as never, payload: {} as never },
    accountsPayable: { source: {} as never, payload: {} as never },
    cashFlow: { source: {} as never, payload: {} as never },
    calendarAgenda: {
      source: {} as never,
      calendar: {} as never,
      executiveSummary: {
        plannedMonthlyTimeline: [],
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
          {
            year: 2026,
            month: 5,
            monthLabel: "Mai",
            received: 50_000,
            receivableOpenDue: 10_000,
            estimatedInflow: 60_000,
            paid: 20_000,
            payableOpenDue: 15_000,
            estimatedOutflow: 35_000,
            netFlow: 25_000,
            accumulatedNet: 25_000,
          },
        ],
        period: {} as never,
        net: {} as never,
      },
      annualChart: {
        year: 2026,
        highlightMonth: 5,
        hasData: true,
        points: EXECUTIVE_REPORT_MONTH_LABELS_PT.map((monthLabel, index) => ({
          month: index + 1,
          monthLabel,
          isCurrentMonth: index + 1 === 5,
          inflow: index + 1 === 6 ? 0 : 60_000,
          outflow: index + 1 === 6 ? 100 : 35_000,
          netFlow: index + 1 === 6 ? -100 : 25_000,
          accumulated: index + 1 === 6 ? -100 : 25_000,
          isNegative: index + 1 === 6,
        })),
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

describe("financeExecutiveReportPresentation", () => {
  it("valores grandes viram R$ X Mi", () => {
    assert.match(formatExecutiveReportPresentationCurrency(5_830_000), /Mi/);
    assert.match(formatExecutiveReportAxisCurrency(5_830_000), /Mi/);
  });

  it("valores menores viram R$ X mil", () => {
    assert.match(formatExecutiveReportPresentationCurrency(827_500), /mil/);
    assert.match(formatExecutiveReportAxisCurrency(827_500), /mil/);
  });

  it("percentuais formatam com duas casas", () => {
    assert.equal(formatExecutiveReportPresentationPercent(96.154, 2), "96,15%");
  });

  it("mês atual é destacado no comparativo de barras", () => {
    const report = minimalReport();
    const chart = mapBillingMultiYearToBarComparison(
      report.billingComparison.tab.multiYearMonthly,
      2026,
      5
    );
    const current = chart.rows.find((r) => r.month === 5);
    const other = chart.rows.find((r) => r.month === 3);
    assert.equal(current?.isCurrentMonth, true);
    assert.equal(other?.isCurrentMonth, false);
  });

  it("estado vazio não quebra mapeamento", () => {
    const chart = mapBillingMultiYearToBarComparison([], 2026, 5);
    assert.equal(chart.hasData, false);
    assert.equal(chart.rows.length, 0);
    assert.equal(EXECUTIVE_REPORT_EMPTY_MESSAGE.length > 0, true);

    const realized = mapRealizedProjectedChart(
      { realized: null, projected: null, target: null, formatted: { realized: "—", projected: "—", target: "—" } },
      5
    );
    assert.equal(realized.hasData, false);
    assert.equal(realized.hasTarget, false);
  });

  it("séries de gráfico preservam ordem dos meses", () => {
    const report = minimalReport();
    const chart = mapBillingMultiYearToBarComparison(
      report.billingComparison.tab.multiYearMonthly,
      2026,
      5
    );
    const ordered = executiveChartRowsPreserveMonthOrder(chart.rows);
    assert.deepEqual(
      ordered.map((r) => r.month),
      [3, 5]
    );
  });

  it("dados negativos do fluxo são tratados corretamente", () => {
    const report = minimalReport();
    const cash = buildExecutiveCashFlowAnnualChart(
      report.calendarAgenda.executiveSummary!.monthlyTimeline,
      report.year,
      5
    );
    const negative = cash.rows.find((r) => r.netFlow < 0);
    const positive = cash.rows.find((r) => r.netFlow > 0);
    assert.equal(negative?.isNegative, true);
    assert.equal(positive?.isNegative, false);
    assert.equal(cash.hasData, true);
    assert.equal(cash.rows.length, 12);
  });

  it("gráfico de fluxo ignora filtro de mês e mantém 12 meses do ano", () => {
    const sparseTimeline = [
      {
        year: 2026,
        month: 6,
        monthLabel: "Jun",
        received: 0,
        receivableOpenDue: 1000,
        estimatedInflow: 1000,
        paid: 0,
        payableOpenDue: 0,
        estimatedOutflow: 0,
        netFlow: 1000,
        accumulatedNet: 1000,
      },
    ];
    const chart = buildExecutiveCashFlowAnnualChart(sparseTimeline, 2026, 6);
    assert.equal(chart.rows.length, 12);
    assert.deepEqual(
      chart.rows.map((r) => r.monthLabel),
      [...EXECUTIVE_REPORT_MONTH_LABELS_PT]
    );
    assert.equal(mapCashFlowTimelineToChart(sparseTimeline, 6).rows.length, 12);
  });

  it("mapRealizedProjectedChart sinaliza meta ausente", () => {
    const report = minimalReport();
    const model = mapRealizedProjectedChart(
      report.billingProjection.tab.realizedVsProjected,
      5
    );
    assert.equal(model.hasTarget, false);
    assert.equal(model.hasData, true);
    assert.equal(model.currentMonthLabel, "Mai");
  });

  it("mapSalesOrdersMonthlyToChart preserva ordem mensal", () => {
    const rows = mapSalesOrdersMonthlyToChart(
      [
        {
          month: 8,
          monthLabel: "Ago",
          periodLabel: "ago/2026",
          previousYearValue: 10,
          currentYearValue: 20,
          targetValue: 30,
          projectedValue: 25,
          achievementPercent: 66.6,
          differenceToTarget: -10,
        },
        {
          month: 2,
          monthLabel: "Fev",
          periodLabel: "fev/2026",
          previousYearValue: 5,
          currentYearValue: 8,
          targetValue: 12,
          projectedValue: 9,
          achievementPercent: 66.6,
          differenceToTarget: -4,
        },
      ],
      2
    );
    assert.deepEqual(rows.rows.map((r) => r.month), [2, 8]);
    assert.equal(rows.rows[0]?.isCurrentMonth, true);
  });
});
