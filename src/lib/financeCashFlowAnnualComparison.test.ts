import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  annualComparisonHasChartData,
  buildAnnualComparisonSeriesLabels,
  buildCashFlowAnnualComparison,
  createAnnualComparisonBaseFilters,
  filterApRowsForAnnualComparison,
  filterArRowsForAnnualComparison,
  isApPaidByPaymentInPeriod,
  isArReceivedByRealizationInPeriod,
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
    assert.ok(routes.includes("loadAnnualComparisonPortfolioRows"));
    assert.ok(routes.includes("createAnnualComparisonBaseFilters"));
    assert.doesNotMatch(routes, /annual-comparison[\s\S]*parseFiltersOrRespond/);
    assert.match(routes, /annual-comparison[\s\S]*?loadAnnualComparisonPortfolioRows/);
  });

  it("2b. AR liquidado com amountReceived zerado usa amountReceivable", () => {
    const arRows = [
      arRow({
        externalId: 1,
        dueDate: new Date(2026, 0, 10),
        settlementDate: new Date(2026, 0, 10),
        amountReceivable: 950,
        amountReceived: 0,
        balanceReceivable: 0,
      }),
    ];
    const filtered = filterArRowsForAnnualComparison(arRows, BASE);
    assert.equal(filtered.length, 1);
    const payload = buildCashFlowAnnualComparison(filtered, [], 2026, BASE);
    assert.equal(payload.months[0]?.receivedAmount, 950);
  });

  it("2c. AP pago no ano aloca pelo pagamento mesmo com vencimento fora do ano", () => {
    const apRows = [
      apRow({
        externalId: 1,
        dueDate: new Date(2025, 11, 20),
        paymentDate: new Date(2026, 0, 8),
        amountPaid: 600,
        balancePayable: 0,
      }),
    ];
    const filtered = filterApRowsForAnnualComparison(apRows, BASE);
    const payload = buildCashFlowAnnualComparison([], filtered, 2026, BASE);
    assert.equal(payload.months[0]?.paidAmount, 600);
    assert.equal(payload.months[11]?.paidAmount, 0);
  });

  it("3. AR recebido entra em receivedAmount pela data de baixa", () => {
    const arRows = [
      arRow({
        externalId: 1,
        dueDate: new Date(2026, 2, 10),
        settlementDate: new Date(2026, 0, 8),
        amountReceived: 800,
        balanceReceivable: 0,
      }),
    ];
    const payload = buildCashFlowAnnualComparison(arRows, [], 2026, BASE);
    assert.equal(payload.months[0]?.receivedAmount, 800);
    assert.equal(payload.months[2]?.receivedAmount, 0);
    assert.equal(payload.months[0]?.receivableOpenAmount, 0);
  });

  it("4. AR aberto entra em receivableOpenAmount pela data de vencimento", () => {
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

  it("5. AP pago entra em paidAmount pela data de pagamento", () => {
    const apRows = [
      apRow({
        externalId: 1,
        dueDate: new Date(2026, 2, 10),
        paymentDate: new Date(2026, 0, 5),
        amountPaid: 450,
        balancePayable: 0,
      }),
    ];
    const payload = buildCashFlowAnnualComparison([], apRows, 2026, BASE);
    assert.equal(payload.months[0]?.paidAmount, 450);
    assert.equal(payload.months[2]?.paidAmount, 0);
    assert.equal(payload.months[0]?.payableOpenAmount, 0);
  });

  it("6. AP aberto entra em payableOpenAmount pela data de vencimento", () => {
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

  it("7. cashInTotalAmount = receivedAmount + receivableOpenAmount", () => {
    const arRows = [
      arRow({
        externalId: 1,
        settlementDate: new Date(2026, 0, 5),
        amountReceived: 500,
        balanceReceivable: 0,
      }),
      arRow({
        externalId: 2,
        dueDate: new Date(2026, 0, 20),
        balanceReceivable: 150,
      }),
    ];
    const payload = buildCashFlowAnnualComparison(arRows, [], 2026, BASE);
    const jan = payload.months[0]!;
    assert.equal(jan.cashInTotalAmount, jan.receivedAmount + jan.receivableOpenAmount);
    assert.equal(jan.cashInTotalAmount, 650);
  });

  it("8. cashOutTotalAmount = paidAmount + payableOpenAmount", () => {
    const apRows = [
      apRow({
        externalId: 1,
        paymentDate: new Date(2026, 0, 3),
        amountPaid: 200,
        balancePayable: 0,
      }),
      apRow({
        externalId: 2,
        dueDate: new Date(2026, 0, 25),
        balancePayable: 100,
      }),
    ];
    const payload = buildCashFlowAnnualComparison([], apRows, 2026, BASE);
    const jan = payload.months[0]!;
    assert.equal(jan.cashOutTotalAmount, jan.paidAmount + jan.payableOpenAmount);
    assert.equal(jan.cashOutTotalAmount, 300);
  });

  it("9. netCashAmount = cashInTotalAmount - cashOutTotalAmount", () => {
    const arRows = [
      arRow({
        externalId: 1,
        settlementDate: new Date(2026, 0, 5),
        amountReceived: 1000,
        balanceReceivable: 0,
      }),
    ];
    const apRows = [
      apRow({
        externalId: 2,
        paymentDate: new Date(2026, 0, 6),
        amountPaid: 400,
        balancePayable: 0,
      }),
    ];
    const payload = buildCashFlowAnnualComparison(arRows, apRows, 2026, BASE);
    const jan = payload.months[0]!;
    assert.equal(jan.netCashAmount, jan.cashInTotalAmount - jan.cashOutTotalAmount);
    assert.equal(jan.netCashAmount, 600);
  });

  it("10. título liquidado não entra também como aberto", () => {
    const arRows = [
      arRow({
        externalId: 1,
        dueDate: new Date(2026, 0, 10),
        settlementDate: new Date(2026, 0, 10),
        amountReceived: 800,
        balanceReceivable: 0,
      }),
    ];
    const payload = buildCashFlowAnnualComparison(arRows, [], 2026, BASE);
    assert.equal(payload.months[0]?.receivedAmount, 800);
    assert.equal(payload.months[0]?.receivableOpenAmount, 0);
  });

  it("11. título aberto vencido aparece no mês do vencimento", () => {
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

  it("realização AR usa settlementDate, não vencimento", () => {
    const row = arRow({
      dueDate: new Date(2026, 4, 1),
      settlementDate: new Date(2026, 0, 15),
      amountReceived: 500,
      balanceReceivable: 0,
    });
    const monthStart = new Date(2026, 0, 1);
    const monthEnd = new Date(2026, 0, 31);
    assert.equal(isArReceivedByRealizationInPeriod(row, monthStart, monthEnd), true);
    const marchStart = new Date(2026, 4, 1);
    const marchEnd = new Date(2026, 4, 30);
    assert.equal(isArReceivedByRealizationInPeriod(row, marchStart, marchEnd), false);
  });

  it("pagamento AP usa paymentDate, não vencimento", () => {
    const row = apRow({
      dueDate: new Date(2026, 4, 1),
      paymentDate: new Date(2026, 0, 12),
      amountPaid: 400,
      balancePayable: 0,
    });
    const monthStart = new Date(2026, 0, 1);
    const monthEnd = new Date(2026, 0, 31);
    assert.equal(isApPaidByPaymentInPeriod(row, monthStart, monthEnd), true);
    const mayStart = new Date(2026, 4, 1);
    const mayEnd = new Date(2026, 4, 31);
    assert.equal(isApPaidByPaymentInPeriod(row, mayStart, mayEnd), false);
  });

  it("meta aparece quando há base do ano anterior", () => {
    const arRows = [
      arRow({
        externalId: 1,
        dueDate: new Date(2025, 0, 10),
        settlementDate: new Date(2025, 0, 10),
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
  it("14. gráfico renderiza barras empilhadas de Entradas", () => {
    const chart = read("src/components/finance/cash-flow/FinanceCashFlowAnnualComparisonChartView.tsx");
    assert.ok(chart.includes('stackId="entradas"'));
    assert.ok(chart.includes('dataKey="receivedAmount"'));
    assert.ok(chart.includes('dataKey="receivableOpenAmount"'));
  });

  it("15. gráfico renderiza barras empilhadas de Saídas", () => {
    const chart = read("src/components/finance/cash-flow/FinanceCashFlowAnnualComparisonChartView.tsx");
    assert.ok(chart.includes('stackId="saidas"'));
    assert.ok(chart.includes('dataKey="paidAmount"'));
    assert.ok(chart.includes('dataKey="payableOpenAmount"'));
  });

  it("16. gráfico renderiza linha de saldo", () => {
    const chart = read("src/components/finance/cash-flow/FinanceCashFlowAnnualComparisonChartView.tsx");
    assert.ok(chart.includes('dataKey="netCashAmount"'));
    assert.ok(chart.includes("<Line"));
  });

  it("17. tooltip mostra recebido, a receber, pago, a pagar e saldo", () => {
    const chart = read("src/components/finance/cash-flow/FinanceCashFlowAnnualComparisonChartView.tsx");
    assert.ok(chart.includes("Total de entradas"));
    assert.ok(chart.includes("Total de saídas"));
    assert.ok(chart.includes("netCashAmount"));
    assert.ok(chart.includes("receivedAmount"));
    assert.ok(chart.includes("receivableOpenAmount"));
    assert.ok(chart.includes("paidAmount"));
    assert.ok(chart.includes("payableOpenAmount"));
  });

  it("18. labels mostram total de entradas e total de saídas", () => {
    const chart = read("src/components/finance/cash-flow/FinanceCashFlowAnnualComparisonChartView.tsx");
    assert.ok(chart.includes("StackedBarTotalLabel"));
    assert.ok(chart.includes('totalKey="cashInTotalAmount"'));
    assert.ok(chart.includes('totalKey="cashOutTotalAmount"'));
  });

  it("19. meta null não quebra o gráfico", () => {
    const wrapper = read("src/components/finance/cash-flow/FinanceCashFlowAnnualComparisonChart.tsx");
    assert.ok(wrapper.includes("showGoal={false}"));
    const chart = read("src/components/finance/cash-flow/FinanceCashFlowAnnualComparisonChartView.tsx");
    assert.ok(chart.includes("showGoal ?"));
    assert.ok(chart.includes("receivableGoal != null"));
  });

  it("container com altura explícita", () => {
    const view = read("src/components/finance/cash-flow/FinanceCashFlowAnnualComparisonChartView.tsx");
    assert.ok(view.includes("FINANCE_CASH_FLOW_ANNUAL_COMPARISON_CHART_HEIGHT = 440"));
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
    assert.equal(labels.receivedAmount, "Recebido");
    assert.equal(labels.receivableOpenAmount, "A Receber");
    assert.equal(labels.paidAmount, "Pago");
    assert.equal(labels.payableOpenAmount, "A Pagar");
    assert.equal(labels.netCashAmount, "Saldo mensal");
  });

  it("título atualizado no componente", () => {
    const wrapper = read("src/components/finance/cash-flow/FinanceCashFlowAnnualComparisonChart.tsx");
    assert.ok(wrapper.includes("Fluxo anual — Entradas, Saídas e Saldo"));
  });

  it("resumo anual com MetricCardGrid", () => {
    const wrapper = read("src/components/finance/cash-flow/FinanceCashFlowAnnualComparisonChart.tsx");
    assert.ok(wrapper.includes("MetricCardGrid"));
    assert.ok(wrapper.includes("cashInTotalAmount"));
    assert.ok(wrapper.includes("netCashAmount"));
  });
});
