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
  it("1. endpoint retorna 12 meses", () => {
    const payload = buildCashFlowAnnualComparison([], [], 2026, BASE);
    assert.equal(payload.months.length, 12);
    assert.equal(payload.months[0]?.monthLabel, "jan");
    assert.equal(payload.months[11]?.monthLabel, "dez");
  });

  it("2. endpoint continua independente dos filtros da tela", () => {
    const base = createAnnualComparisonBaseFilters();
    assert.equal(base.month, undefined);
    assert.equal(base.year, undefined);
    assert.equal(base.customerName, undefined);
    assert.equal(base.supplierName, undefined);

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
    assert.equal(annual.months[2]?.receivableOpenAmount, 1000);
    assert.equal(annual.filterIndependent, true);

    const routes = read("src/lib/financeCashFlowRoutes.ts");
    assert.ok(routes.includes("/api/finance/cash-flow/annual-comparison"));
    assert.doesNotMatch(routes, /annual-comparison[\s\S]*parseFiltersOrRespond/);
  });

  it("3. janeiro com AR recebido aparece em receivedAmount", () => {
    const arRows = [
      arRow({
        externalId: 1,
        dueDate: new Date(2026, 0, 10),
        amountReceived: 800,
        balanceReceivable: 0,
      }),
    ];
    const payload = buildCashFlowAnnualComparison(arRows, [], 2026, BASE);
    assert.equal(payload.months[0]?.receivedAmount, 800);
    assert.equal(payload.months[0]?.receivableOpenAmount, 0);
  });

  it("4. janeiro com AR aberto aparece em receivableOpenAmount", () => {
    const arRows = [
      arRow({
        externalId: 1,
        dueDate: new Date(2026, 0, 12),
        balanceReceivable: 200,
        amountReceived: 0,
      }),
    ];
    const payload = buildCashFlowAnnualComparison(arRows, [], 2026, BASE);
    assert.equal(payload.months[0]?.receivableOpenAmount, 200);
    assert.equal(payload.months[0]?.receivedAmount, 0);
  });

  it("5. janeiro com AP pago aparece em paidAmount", () => {
    const apRows = [
      apRow({
        externalId: 1,
        dueDate: new Date(2026, 0, 8),
        amountPaid: 450,
        balancePayable: 0,
      }),
    ];
    const payload = buildCashFlowAnnualComparison([], apRows, 2026, BASE);
    assert.equal(payload.months[0]?.paidAmount, 450);
    assert.equal(payload.months[0]?.payableOpenAmount, 0);
  });

  it("6. janeiro com AP aberto aparece em payableOpenAmount", () => {
    const apRows = [
      apRow({
        externalId: 1,
        dueDate: new Date(2026, 0, 20),
        balancePayable: 300,
      }),
    ];
    const payload = buildCashFlowAnnualComparison([], apRows, 2026, BASE);
    assert.equal(payload.months[0]?.payableOpenAmount, 300);
    assert.equal(payload.months[0]?.paidAmount, 0);
  });

  it("7. AR liquidado alocado pelo vencimento (motor executivo)", () => {
    const arRows = [
      arRow({
        externalId: 1,
        dueDate: new Date(2026, 2, 10),
        settlementDate: new Date(2026, 0, 5),
        amountReceived: 500,
        balanceReceivable: 0,
      }),
    ];
    const payload = buildCashFlowAnnualComparison(arRows, [], 2026, BASE);
    assert.equal(payload.months[0]?.receivedAmount, 0);
    assert.equal(payload.months[2]?.receivedAmount, 500);
  });

  it("8. AP pago alocado pelo vencimento (motor executivo)", () => {
    const apRows = [
      apRow({
        externalId: 1,
        dueDate: new Date(2026, 2, 10),
        paymentDate: new Date(2026, 0, 5),
        amountPaid: 400,
        balancePayable: 0,
      }),
    ];
    const payload = buildCashFlowAnnualComparison([], apRows, 2026, BASE);
    assert.equal(payload.months[0]?.paidAmount, 0);
    assert.equal(payload.months[2]?.paidAmount, 400);
  });

  it("9. AR aberto usa data de vencimento", () => {
    const arRows = [
      arRow({
        externalId: 1,
        dueDate: new Date(2026, 4, 25),
        balanceReceivable: 150,
      }),
    ];
    const payload = buildCashFlowAnnualComparison(arRows, [], 2026, BASE);
    assert.equal(payload.months[0]?.receivableOpenAmount, 0);
    assert.equal(payload.months[4]?.receivableOpenAmount, 150);
  });

  it("10. AP aberto usa data de vencimento operacional", () => {
    const apRows = [
      apRow({
        externalId: 1,
        dueDate: new Date(2026, 7, 15),
        balancePayable: 600,
      }),
    ];
    const payload = buildCashFlowAnnualComparison([], apRows, 2026, BASE);
    assert.equal(payload.months[6]?.payableOpenAmount, 0);
    assert.equal(payload.months[7]?.payableOpenAmount, 600);
  });

  it("11. título vencido e aberto aparece no mês do vencimento", () => {
    const arRows = [
      arRow({
        externalId: 1,
        dueDate: new Date(2026, 0, 5),
        balanceReceivable: 90,
        amountReceived: 0,
      }),
    ];
    const payload = buildCashFlowAnnualComparison(arRows, [], 2026, BASE);
    assert.equal(payload.months[0]?.receivableOpenAmount, 90);
  });

  it("12. mês futuro com AR aberto aparece em A Receber", () => {
    const arRows = [
      arRow({
        externalId: 1,
        dueDate: new Date(2026, 10, 20),
        balanceReceivable: 1200,
      }),
    ];
    const payload = buildCashFlowAnnualComparison(arRows, [], 2026, BASE);
    assert.equal(payload.months[10]?.receivableOpenAmount, 1200);
    assert.equal(payload.months[10]?.receivedAmount, 0);
  });

  it("13. mês futuro com AP aberto aparece em A Pagar", () => {
    const apRows = [
      apRow({
        externalId: 1,
        dueDate: new Date(2026, 11, 5),
        balancePayable: 750,
      }),
    ];
    const payload = buildCashFlowAnnualComparison([], apRows, 2026, BASE);
    assert.equal(payload.months[11]?.payableOpenAmount, 750);
    assert.equal(payload.months[11]?.paidAmount, 0);
  });

  it("meta aparece quando há base do ano anterior", () => {
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

  it("meta oculta quando ano anterior zerado", () => {
    const payload = buildCashFlowAnnualComparison([], [], 2026, BASE);
    assert.equal(payload.hasReceivableGoal, false);
    assert.equal(payload.totals.receivableGoal, null);
  });

  it("não quebra com meses zerados", () => {
    const payload = buildCashFlowAnnualComparison([], [], 2026, BASE);
    assert.equal(annualComparisonHasChartData(payload), false);
    const rows = mapAnnualComparisonChartRows(payload);
    assert.equal(rows.length, 12);
    assert.ok(rows.every((r) => r.receivableGoal === null));
  });

  it("aceita year informado", () => {
    assert.equal(parseAnnualComparisonYear("2024", BASE), 2024);
    const payload = buildCashFlowAnnualComparison([], [], 2024, BASE);
    assert.equal(payload.year, 2024);
  });
});

describe("financeCashFlowAnnualComparison UI", () => {
  it("14. gráfico renderiza quatro barras por mês", () => {
    const chart = read("src/components/finance/cash-flow/FinanceCashFlowAnnualComparisonChartView.tsx");
    assert.ok(chart.includes('dataKey="receivedAmount"'));
    assert.ok(chart.includes('dataKey="receivableOpenAmount"'));
    assert.ok(chart.includes('dataKey="paidAmount"'));
    assert.ok(chart.includes('dataKey="payableOpenAmount"'));
    assert.ok(chart.includes("ComposedChart"));
  });

  it("15. tooltip mostra as quatro séries e subtotais", () => {
    const chart = read("src/components/finance/cash-flow/FinanceCashFlowAnnualComparisonChartView.tsx");
    assert.ok(chart.includes("Total entradas"));
    assert.ok(chart.includes("Total saídas"));
    assert.ok(chart.includes("Saldo potencial"));
    assert.ok(chart.includes("receivedAmount"));
    assert.ok(chart.includes("receivableOpenAmount"));
    assert.ok(chart.includes("paidAmount"));
    assert.ok(chart.includes("payableOpenAmount"));
  });

  it("16. labels aparecem nas barras", () => {
    const chart = read("src/components/finance/cash-flow/FinanceCashFlowAnnualComparisonChartView.tsx");
    assert.ok(chart.includes("LabelList"));
    assert.ok(chart.includes("ChartBarValueLabel"));
  });

  it("17. linha de meta não quebra quando meta for null", () => {
    const wrapper = read("src/components/finance/cash-flow/FinanceCashFlowAnnualComparisonChart.tsx");
    assert.ok(wrapper.includes("hasReceivableGoal"));
    assert.ok(wrapper.includes("showGoal"));
    const chart = read("src/components/finance/cash-flow/FinanceCashFlowAnnualComparisonChartView.tsx");
    assert.ok(chart.includes("showGoal ?"));
    assert.ok(chart.includes("connectNulls={false}"));
  });

  it("container com altura explícita", () => {
    const view = read("src/components/finance/cash-flow/FinanceCashFlowAnnualComparisonChartView.tsx");
    assert.ok(view.includes("FINANCE_CASH_FLOW_ANNUAL_COMPARISON_CHART_HEIGHT = 420"));
    assert.ok(view.includes("minHeight: height"));
    assert.ok(view.includes("ResponsiveContainer"));
    assert.ok(view.includes("ANNUAL_CHART_MIN_WIDTH = 960"));
  });

  it("componente não recebe filtros da página", () => {
    const page = read("src/components/finance/FinanceCashFlowPage.tsx");
    assert.match(page, /<FinanceCashFlowAnnualComparisonChart\s*\/>/);
    const wrapper = read("src/components/finance/cash-flow/FinanceCashFlowAnnualComparisonChart.tsx");
    assert.ok(wrapper.includes("/api/finance/cash-flow/annual-comparison"));
    assert.doesNotMatch(wrapper, /appliedQuery|appliedFilters|buildFinanceCashFlowDashboardQuery/);
  });

  it("inserido entre auditoria e fluxo planejado", () => {
    const page = read("src/components/finance/FinanceCashFlowPage.tsx");
    const overview = page.slice(page.indexOf('activeTab === "overview"'));
    const auditIdx = overview.indexOf("FinanceCashFlowNumbersAuditSection");
    const annualIdx = overview.indexOf("FinanceCashFlowAnnualComparisonChart");
    const plannedIdx = overview.indexOf("<FinanceCashFlowMonthlyPlannedChart");
    assert.ok(auditIdx >= 0 && annualIdx > auditIdx && plannedIdx > annualIdx);
  });

  it("labels claros por série", () => {
    const labels = buildAnnualComparisonSeriesLabels(2026);
    assert.equal(labels.receivedAmount, "Recebido 2026");
    assert.equal(labels.receivableOpenAmount, "A receber 2026");
    assert.equal(labels.paidAmount, "Pago 2026");
    assert.equal(labels.payableOpenAmount, "A pagar 2026");
  });

  it("título atualizado no componente", () => {
    const wrapper = read("src/components/finance/cash-flow/FinanceCashFlowAnnualComparisonChart.tsx");
    assert.ok(wrapper.includes("Fluxo anual — Recebido, A Receber, Pago e A Pagar"));
  });
});
