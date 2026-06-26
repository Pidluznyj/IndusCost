import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  annualComparisonHasChartData,
  buildAnnualComparisonSeriesLabels,
  buildCashFlowAnnualComparison,
  createAnnualComparisonBaseFilters,
  mapAnnualComparisonChartRows,
  parseAnnualComparisonYear,
} from "./financeCashFlowAnnualComparison.js";
import {
  buildFinanceCashFlowDashboard,
  type FinanceCashFlowApRow,
  type FinanceCashFlowArRow,
} from "./financeCashFlowDashboard.js";

const BASE = new Date(2026, 5, 15);

function read(rel: string): string {
  return readFileSync(join(process.cwd(), rel), "utf8");
}

function arRow(overrides: Partial<FinanceCashFlowArRow> = {}): FinanceCashFlowArRow {
  return {
    externalId: 1,
    companyName: "Empresa A",
    personName: "Cliente X",
    personCnpj: "11111111000111",
    description: "Recebível teste",
    dueDate: new Date(2026, 0, 15),
    settlementDate: null,
    competenceDate: new Date(2026, 0, 1),
    amountReceivable: 1000,
    amountReceived: 0,
    balanceReceivable: 1000,
    paymentMethodName: "Boleto",
    bankAccountName: "Conta 1",
    sourceInvoiceId: 100,
    sourceInvoiceNumber: "NF-100",
    suspendCollection: false,
    nomusStatus: true,
    syncedAt: new Date(2026, 0, 10),
    ...overrides,
  };
}

function apRow(overrides: Partial<FinanceCashFlowApRow> = {}): FinanceCashFlowApRow {
  return {
    externalId: 2,
    companyName: "Empresa A",
    personName: "Fornecedor Y",
    personCnpj: "22222222000122",
    description: "Pagável teste",
    dueDate: new Date(2026, 0, 20),
    scheduleDate: null,
    type: null,
    settlementDate: null,
    paymentDate: null,
    competenceDate: new Date(2026, 0, 2),
    amountPayable: 500,
    amountPaid: 0,
    balancePayable: 500,
    paymentMethodName: "PIX",
    bankAccountName: "Conta 2",
    sourceInvoiceId: null,
    documentNumber: "DOC-1",
    suspendPayment: false,
    nomusStatus: true,
    syncedAt: new Date(2026, 0, 10),
    ...overrides,
  };
}

describe("financeCashFlowAnnualComparison", () => {
  it("1. retorna 12 meses", () => {
    const payload = buildCashFlowAnnualComparison([], [], 2026, BASE);
    assert.equal(payload.months.length, 12);
    assert.equal(payload.months[0]?.monthLabel, "jan");
    assert.equal(payload.months[11]?.monthLabel, "dez");
  });

  it("2. usa ano corrente quando year não é informado", () => {
    assert.equal(parseAnnualComparisonYear(undefined, BASE), 2026);
    assert.equal(parseAnnualComparisonYear("", BASE), 2026);
  });

  it("3. aceita year informado", () => {
    assert.equal(parseAnnualComparisonYear("2024", BASE), 2024);
    const payload = buildCashFlowAnnualComparison([], [], 2024, BASE);
    assert.equal(payload.year, 2024);
    assert.equal(payload.previousYear, 2023);
  });

  it("4. filtros base não incluem recortes da página", () => {
    const base = createAnnualComparisonBaseFilters();
    assert.equal(base.month, undefined);
    assert.equal(base.year, undefined);
    assert.equal(base.customerName, undefined);
    assert.equal(base.supplierName, undefined);
    assert.equal(base.companyName, undefined);
    assert.equal(base.status, "all");
  });

  it("5. valores AR usam timeline executiva (estimatedInflow)", () => {
    const arRows = [
      arRow({
        externalId: 1,
        dueDate: new Date(2026, 0, 10),
        amountReceived: 800,
        balanceReceivable: 0,
      }),
      arRow({
        externalId: 2,
        dueDate: new Date(2026, 0, 12),
        balanceReceivable: 200,
        amountReceived: 0,
      }),
    ];
    const payload = buildCashFlowAnnualComparison(arRows, [], 2026, BASE);
    assert.equal(payload.months[0]?.receivableCurrentYear, 1000);
  });

  it("6. valores AP usam timeline executiva (estimatedOutflow)", () => {
    const apRows = [
      apRow({
        externalId: 1,
        dueDate: new Date(2026, 1, 5),
        balancePayable: 300,
      }),
    ];
    const payload = buildCashFlowAnnualComparison([], apRows, 2026, BASE);
    assert.equal(payload.months[1]?.payableCurrentYear, 300);
  });

  it("7. meta aparece quando há base do ano anterior", () => {
    const arRows = [
      arRow({
        externalId: 1,
        dueDate: new Date(2025, 0, 10),
        amountReceived: 1000,
        balanceReceivable: 0,
      }),
    ];
    const payload = buildCashFlowAnnualComparison(arRows, [], 2026, BASE);
    assert.equal(payload.hasReceivableGoal, true);
    assert.equal(payload.months[0]?.receivableGoal, 1300);
  });

  it("8. meta oculta quando ano anterior zerado", () => {
    const payload = buildCashFlowAnnualComparison([], [], 2026, BASE);
    assert.equal(payload.hasReceivableGoal, false);
    assert.equal(payload.totals.receivableGoal, null);
  });

  it("9. não quebra com meses zerados", () => {
    const payload = buildCashFlowAnnualComparison([], [], 2026, BASE);
    assert.equal(annualComparisonHasChartData(payload), false);
    const rows = mapAnnualComparisonChartRows(payload);
    assert.equal(rows.length, 12);
    assert.ok(rows.every((r) => r.receivableGoal === null));
  });

  it("10. endpoint registrado e independente de filtros do dashboard", () => {
    const routes = read("src/lib/financeCashFlowRoutes.ts");
    assert.ok(routes.includes("/api/finance/cash-flow/annual-comparison"));
    assert.ok(routes.includes("buildCashFlowAnnualComparison"));
    assert.ok(routes.includes("loadDailyRadarPortfolioRows"));
    assert.doesNotMatch(routes, /annual-comparison[\s\S]*parseFiltersOrRespond/);
  });

  it("11. dashboard filtrado não altera comparativo anual", () => {
    const arRows = [
      arRow({ externalId: 1, dueDate: new Date(2026, 2, 1), balanceReceivable: 100 }),
      arRow({ externalId: 2, dueDate: new Date(2026, 2, 1), balanceReceivable: 900, personName: "Outro" }),
    ];
    const filteredDashboard = buildFinanceCashFlowDashboard(
      arRows,
      [],
      {
        viewMode: "projected",
        dateBase: "due",
        status: "all",
        year: 2026,
        month: 3,
        customerName: "Cliente X",
      },
      BASE
    );
    assert.notEqual(filteredDashboard.executiveSummary.period.monthFiltered, false);

    const annual = buildCashFlowAnnualComparison(arRows, [], 2026, BASE);
    assert.equal(annual.months[2]?.receivableCurrentYear, 1000);
    assert.equal(annual.filterIndependent, true);
  });
});

describe("financeCashFlowAnnualComparison UI", () => {
  it("8. gráfico renderiza 12 meses", () => {
    const chart = read("src/components/finance/cash-flow/FinanceCashFlowAnnualComparisonChartView.tsx");
    assert.ok(chart.includes("ComposedChart"));
    assert.ok(chart.includes("receivableCurrentYear"));
    assert.ok(chart.includes("payableCurrentYear"));
  });

  it("9. barras receber/pagar e linha meta", () => {
    const chart = read("src/components/finance/cash-flow/FinanceCashFlowAnnualComparisonChartView.tsx");
    assert.ok(chart.includes('dataKey="receivablePreviousYear"'));
    assert.ok(chart.includes('dataKey="payableCurrentYear"'));
    assert.ok(chart.includes('dataKey="receivableCurrentYear"'));
    assert.ok(chart.includes('dataKey="receivableGoal"'));
    assert.ok(chart.includes("strokeDasharray"));
  });

  it("10. meta condicional no gráfico", () => {
    const wrapper = read("src/components/finance/cash-flow/FinanceCashFlowAnnualComparisonChart.tsx");
    assert.ok(wrapper.includes("hasReceivableGoal"));
    assert.ok(wrapper.includes("showGoal"));
  });

  it("11. container com altura explícita", () => {
    const view = read("src/components/finance/cash-flow/FinanceCashFlowAnnualComparisonChartView.tsx");
    assert.ok(view.includes("FINANCE_CASH_FLOW_ANNUAL_COMPARISON_CHART_HEIGHT = 420"));
    assert.ok(view.includes("minHeight: height"));
    assert.ok(view.includes("ResponsiveContainer"));
  });

  it("12. componente não recebe filtros da página", () => {
    const page = read("src/components/finance/FinanceCashFlowPage.tsx");
    assert.match(page, /<FinanceCashFlowAnnualComparisonChart\s*\/>/);
    const wrapper = read("src/components/finance/cash-flow/FinanceCashFlowAnnualComparisonChart.tsx");
    assert.ok(wrapper.includes("/api/finance/cash-flow/annual-comparison"));
    assert.doesNotMatch(wrapper, /appliedQuery|appliedFilters|buildFinanceCashFlowDashboardQuery/);
  });

  it("13. inserido entre auditoria e fluxo planejado", () => {
    const page = read("src/components/finance/FinanceCashFlowPage.tsx");
    const overview = page.slice(page.indexOf('activeTab === "overview"'));
    const auditIdx = overview.indexOf("FinanceCashFlowNumbersAuditSection");
    const annualIdx = overview.indexOf("FinanceCashFlowAnnualComparisonChart");
    const plannedIdx = overview.indexOf("<FinanceCashFlowMonthlyPlannedChart");
    assert.ok(auditIdx >= 0 && annualIdx > auditIdx && plannedIdx > annualIdx);
  });

  it("14. labels dinâmicos por ano", () => {
    const labels = buildAnnualComparisonSeriesLabels(2026, 2025);
    assert.ok(labels.receivablePreviousYear.includes("2025"));
    assert.ok(labels.payableCurrentYear.includes("2026"));
    assert.ok(labels.receivableCurrentYear.includes("2026"));
  });
});
