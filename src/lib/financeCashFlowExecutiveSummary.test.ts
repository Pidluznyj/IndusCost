import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  buildFinanceAccountsPayableDashboard,
  type FinanceApDashboardRow,
} from "./financeAccountsPayableDashboard.js";
import {
  buildExecutiveMonthlyTimeline,
  buildFinanceCashFlowExecutiveSummary,
  executiveSummaryMetricsAreFinite,
  isApPaidInPeriod,
  isArOpenDueInPeriod,
  resolveForwardYearRange,
  sumApOpenDueInPeriod,
  sumApPaidInPeriod,
  sumArOpenDueInPeriod,
} from "./financeCashFlowExecutiveSummary.js";
import {
  buildFinanceCashFlowDashboard,
  financeCashFlowMetricsAreFinite,
  type FinanceCashFlowApRow,
  type FinanceCashFlowArRow,
} from "./financeCashFlowDashboard.js";
import { buildFinanceCashFlowExportCsv } from "./financeCashFlowExport.js";
import { buildExecutiveMonthlyPlannedChartRows } from "./financeCashFlowExecutiveChart.js";
import { isArReceivedInPeriod, sumArReceivedInPeriod } from "./financeCashFlowExecutiveYtd.js";

const REF = new Date(2026, 5, 9);

function arRow(overrides: Partial<FinanceCashFlowArRow> = {}): FinanceCashFlowArRow {
  return {
    externalId: 1,
    companyName: "Empresa A",
    personName: "Cliente X",
    personCnpj: null,
    description: null,
    dueDate: new Date(2026, 5, 15),
    settlementDate: null,
    competenceDate: null,
    amountReceivable: 1000,
    amountReceived: 0,
    balanceReceivable: 1000,
    paymentMethodName: null,
    bankAccountName: null,
    sourceInvoiceId: null,
    sourceInvoiceNumber: null,
    suspendCollection: false,
    nomusStatus: true,
    syncedAt: new Date(),
    ...overrides,
  };
}

function apRow(overrides: Partial<FinanceCashFlowApRow> = {}): FinanceCashFlowApRow {
  return {
    externalId: 2,
    companyName: "Empresa A",
    personName: "Fornecedor Y",
    personCnpj: null,
    description: null,
    dueDate: new Date(2026, 5, 20),
    scheduleDate: null,
    type: null,
    settlementDate: null,
    paymentDate: null,
    competenceDate: null,
    amountPayable: 500,
    amountPaid: 0,
    balancePayable: 500,
    paymentMethodName: null,
    bankAccountName: null,
    sourceInvoiceId: null,
    documentNumber: null,
    suspendPayment: false,
    nomusStatus: true,
    syncedAt: new Date(),
    ...overrides,
  };
}

const filters = {
  viewMode: "projected" as const,
  dateBase: "due" as const,
  status: "all" as const,
  year: 2026,
};

describe("financeCashFlowExecutiveSummary", () => {
  it("Recebido YTD soma amountReceived por dueDate no ano", () => {
    const rows = [
      arRow({
        amountReceived: 300,
        dueDate: new Date(2026, 1, 10),
        settlementDate: new Date(2026, 2, 10),
        balanceReceivable: 0,
      }),
      arRow({
        externalId: 2,
        amountReceived: 200,
        dueDate: new Date(2026, 3, 5),
        settlementDate: new Date(2026, 4, 5),
        balanceReceivable: 0,
      }),
      arRow({
        externalId: 3,
        amountReceived: 100,
        dueDate: new Date(2025, 11, 20),
        settlementDate: new Date(2026, 0, 20),
        balanceReceivable: 0,
      }),
    ];
    const ytdStart = new Date(2026, 0, 1);
    const ytdEnd = REF;
    assert.equal(sumArReceivedInPeriod(rows, ytdStart, ytdEnd), 500);
    assert.equal(isArReceivedInPeriod(rows[2]!, ytdStart, ytdEnd), false);
  });

  it("A receber até fim do ano soma balanceReceivable por dueDate de hoje até 31/12", () => {
    const forward = resolveForwardYearRange(2026, REF);
    assert.equal(forward.isActive, true);
    const rows = [
      arRow({ balanceReceivable: 400, dueDate: new Date(2026, 6, 1) }),
      arRow({
        externalId: 2,
        balanceReceivable: 600,
        dueDate: new Date(2026, 11, 30),
      }),
      arRow({
        externalId: 3,
        balanceReceivable: 100,
        dueDate: new Date(2026, 4, 1),
      }),
      arRow({
        externalId: 4,
        balanceReceivable: 999,
        dueDate: new Date(2027, 0, 5),
      }),
    ];
    const open = sumArOpenDueInPeriod(rows, forward.fromDate, forward.toDate);
    assert.equal(open, 1000);
    assert.equal(isArOpenDueInPeriod(rows[2]!, forward.fromDate, forward.toDate), false);
  });

  it("Estimativa AR ano = recebido YTD + a receber até fim do ano", () => {
    const payload = buildFinanceCashFlowDashboard(
      [
        arRow({
          amountReceived: 1000,
          settlementDate: new Date(2026, 2, 1),
          balanceReceivable: 0,
          dueDate: new Date(2026, 2, 1),
        }),
        arRow({
          externalId: 2,
          balanceReceivable: 2500,
          dueDate: new Date(2026, 8, 10),
        }),
      ],
      [],
      filters,
      REF
    );
    const { receivable } = payload.executiveSummary;
    assert.equal(
      receivable.estimatedYearTotal,
      receivable.receivedYtd + receivable.openFromTodayToYearEnd
    );
  });

  it("Pago YTD soma realizedAmount por dueDate no ano", () => {
    const rows = [
      apRow({
        amountPaid: 150,
        dueDate: new Date(2026, 0, 10),
        paymentDate: new Date(2026, 0, 15),
        balancePayable: 0,
      }),
      apRow({
        externalId: 3,
        amountPaid: 50,
        dueDate: new Date(2026, 1, 1),
        settlementDate: new Date(2026, 1, 1),
        paymentDate: null,
        balancePayable: 0,
      }),
    ];
    assert.equal(isApPaidInPeriod(rows[0]!, new Date(2026, 0, 1), REF), true);
    assert.equal(sumApPaidInPeriod(rows, new Date(2026, 0, 1), REF), 200);
  });

  it("Pago YTD ignora paymentDate quando vencimento é anterior", () => {
    const rows = [
      apRow({
        amountPaid: 1000,
        dueDate: new Date(2025, 11, 10),
        paymentDate: new Date(2026, 5, 15),
        balancePayable: 0,
      }),
    ];
    assert.equal(isApPaidInPeriod(rows[0]!, new Date(2026, 5, 1), REF), false);
    assert.equal(isApPaidInPeriod(rows[0]!, new Date(2025, 11, 1), new Date(2025, 11, 31)), true);
  });

  it("A pagar até fim do ano soma balancePayable por dueDate de hoje até 31/12", () => {
    const forward = resolveForwardYearRange(2026, REF);
    const rows = [
      apRow({ balancePayable: 800, dueDate: new Date(2026, 7, 1) }),
      apRow({ externalId: 3, balancePayable: 200, dueDate: new Date(2026, 3, 1) }),
    ];
    assert.equal(sumApOpenDueInPeriod(rows, forward.fromDate, forward.toDate), 800);
  });

  it("Estimativa AP ano = pago YTD + a pagar até fim do ano", () => {
    const payload = buildFinanceCashFlowDashboard(
      [],
      [
        apRow({
          amountPaid: 400,
          dueDate: new Date(2026, 1, 1),
          paymentDate: new Date(2026, 1, 1),
          balancePayable: 0,
        }),
        apRow({
          externalId: 3,
          balancePayable: 600,
          dueDate: new Date(2026, 9, 1),
        }),
      ],
      filters,
      REF
    );
    const { payable } = payload.executiveSummary;
    assert.equal(
      payable.estimatedYearTotal,
      payable.paidYtd + payable.openFromTodayToYearEnd
    );
  });

  it("Saldo realizado YTD = recebido YTD - pago YTD", () => {
    const payload = buildFinanceCashFlowDashboard(
      [
        arRow({
          amountReceived: 1000,
          settlementDate: new Date(2026, 1, 1),
          balanceReceivable: 0,
        }),
      ],
      [
        apRow({
          amountPaid: 300,
          dueDate: new Date(2026, 2, 1),
          paymentDate: new Date(2026, 2, 1),
          balancePayable: 0,
        }),
      ],
      filters,
      REF
    );
    const { net, receivable, payable } = payload.executiveSummary;
    assert.equal(net.realizedYtd, receivable.receivedYtd - payable.paidYtd);
  });

  it("Saldo projetado restante = AR restante - AP restante", () => {
    const payload = buildFinanceCashFlowDashboard(
      [arRow({ balanceReceivable: 5000, dueDate: new Date(2026, 10, 1) })],
      [apRow({ balancePayable: 1200, dueDate: new Date(2026, 11, 1) })],
      filters,
      REF
    );
    const { net, receivable, payable } = payload.executiveSummary;
    assert.equal(
      net.projectedRemaining,
      receivable.openFromTodayToYearEnd - payable.openFromTodayToYearEnd
    );
  });

  it("Estimativa líquida anual = estimativa AR - estimativa AP", () => {
    const payload = buildFinanceCashFlowDashboard(
      [
        arRow({
          amountReceived: 2000,
          settlementDate: new Date(2026, 0, 10),
          balanceReceivable: 0,
        }),
        arRow({
          externalId: 2,
          balanceReceivable: 3000,
          dueDate: new Date(2026, 11, 1),
        }),
      ],
      [
        apRow({
          amountPaid: 500,
          dueDate: new Date(2026, 0, 20),
          paymentDate: new Date(2026, 0, 20),
          balancePayable: 0,
        }),
        apRow({
          externalId: 3,
          balancePayable: 1000,
          dueDate: new Date(2026, 8, 1),
        }),
      ],
      filters,
      REF
    );
    const { net, receivable, payable } = payload.executiveSummary;
    assert.equal(
      net.estimatedYearNet,
      receivable.estimatedYearTotal - payable.estimatedYearTotal
    );
    assert.equal(net.estimatedYearNetStatus, net.estimatedYearNet >= 0 ? "surplus" : "deficit");
  });

  it("filtro de origem NF afeta apenas AR", () => {
    const withNf = buildFinanceCashFlowDashboard(
      [
        arRow({
          balanceReceivable: 1000,
          sourceInvoiceId: 99,
          dueDate: new Date(2026, 10, 1),
        }),
        arRow({
          externalId: 2,
          balanceReceivable: 2000,
          dueDate: new Date(2026, 10, 2),
        }),
      ],
      [apRow({ balancePayable: 500, dueDate: new Date(2026, 10, 3) })],
      { ...filters, invoiceIssued: "yes" },
      REF
    );
    const all = buildFinanceCashFlowDashboard(
      [
        arRow({
          balanceReceivable: 1000,
          sourceInvoiceId: 99,
          dueDate: new Date(2026, 10, 1),
        }),
        arRow({
          externalId: 2,
          balanceReceivable: 2000,
          dueDate: new Date(2026, 10, 2),
        }),
      ],
      [apRow({ balancePayable: 500, dueDate: new Date(2026, 10, 3) })],
      filters,
      REF
    );
    assert.equal(withNf.executiveSummary.receivable.openFromTodayToYearEnd, 1000);
    assert.equal(all.executiveSummary.receivable.openFromTodayToYearEnd, 3000);
    assert.equal(
      withNf.executiveSummary.payable.openFromTodayToYearEnd,
      all.executiveSummary.payable.openFromTodayToYearEnd
    );
  });

  it("filtro de mês não quebra visão anual/YTD", () => {
    const withMonth = buildFinanceCashFlowDashboard(
      [arRow({ balanceReceivable: 5000, dueDate: new Date(2026, 10, 1) })],
      [apRow({ balancePayable: 1000, dueDate: new Date(2026, 10, 2) })],
      { ...filters, month: 3 },
      REF
    );
    const withoutMonth = buildFinanceCashFlowDashboard(
      [arRow({ balanceReceivable: 5000, dueDate: new Date(2026, 10, 1) })],
      [apRow({ balancePayable: 1000, dueDate: new Date(2026, 10, 2) })],
      filters,
      REF
    );
    assert.deepEqual(
      withMonth.executiveSummary.receivable,
      withoutMonth.executiveSummary.receivable
    );
    assert.deepEqual(withMonth.executiveSummary.payable, withoutMonth.executiveSummary.payable);
    assert.deepEqual(withMonth.executiveSummary.net, withoutMonth.executiveSummary.net);
    assert.notEqual(
      withMonth.executiveSummary.period.inflowAmount,
      withoutMonth.executiveSummary.period.inflowAmount
    );
    assert.equal(withMonth.executiveSummary.period.monthFiltered, true);
  });

  it("cards do período continuam batendo com cards do dashboard", () => {
    const payload = buildFinanceCashFlowDashboard([arRow()], [apRow()], filters, REF);
    assert.equal(payload.executiveSummary.period.inflowAmount, payload.cards.inflowAmount);
    assert.equal(payload.executiveSummary.period.outflowAmount, payload.cards.outflowAmount);
    assert.equal(payload.executiveSummary.period.netFlowAmount, payload.cards.netFlowAmount);
  });

  it("valores não retornam NaN/Infinity", () => {
    const payload = buildFinanceCashFlowDashboard([arRow()], [apRow()], filters, REF);
    assert.ok(executiveSummaryMetricsAreFinite(payload.executiveSummary));
    assert.ok(financeCashFlowMetricsAreFinite(payload));
  });

  it("exportação inclui resumo executivo", () => {
    const payload = buildFinanceCashFlowDashboard([arRow()], [apRow()], filters, REF);
    const csv = buildFinanceCashFlowExportCsv(payload);
    assert.ok(csv.includes("resumo_recebido_ytd"));
    assert.ok(csv.includes("resumo_estimativa_liquida_anual"));
  });

  it("linha do tempo mensal soma AP aberto por dueDate do mês inteiro, inclusive vencidos em aberto", () => {
    const rows = [
      apRow({
        externalId: 1,
        balancePayable: 400,
        dueDate: new Date(2026, 5, 3),
      }),
      apRow({
        externalId: 2,
        balancePayable: 300,
        dueDate: new Date(2026, 5, 25),
      }),
      apRow({
        externalId: 3,
        balancePayable: 200,
        dueDate: new Date(2026, 5, 30),
      }),
    ];
    const timeline = buildExecutiveMonthlyTimeline([], rows, 2026, REF);
    const jun = timeline.find((r) => r.month === 6);
    assert.equal(jun?.payableOpenDue, 900);
    assert.equal(jun?.estimatedOutflow, 900);
  });

  it("linha do tempo mensal não limita AP aberto a partir de hoje no mês corrente", () => {
    const rows = [
      apRow({
        externalId: 1,
        balancePayable: 150,
        dueDate: new Date(2026, 5, 5),
      }),
      apRow({
        externalId: 2,
        balancePayable: 250,
        dueDate: new Date(2026, 5, 20),
      }),
    ];
    const timeline = buildExecutiveMonthlyTimeline([], rows, 2026, REF);
    const jun = timeline.find((r) => r.month === 6);
    assert.equal(jun?.payableOpenDue, 400);
  });

  it("junho/2026 fixture bate pago, aberto e saídas estimadas por dueDate", () => {
    const paid = 428_664.3;
    const open = 821_235.13;
    const rows = [
      apRow({
        externalId: 1,
        amountPayable: paid,
        amountPaid: paid,
        balancePayable: 0,
        dueDate: new Date(2026, 5, 10),
        paymentDate: new Date(2026, 5, 8),
      }),
      apRow({
        externalId: 2,
        amountPayable: open,
        amountPaid: 0,
        balancePayable: open,
        dueDate: new Date(2026, 5, 28),
      }),
    ];
    const timeline = buildExecutiveMonthlyTimeline([], rows, 2026, REF);
    const jun = timeline.find((r) => r.month === 6);
    assert.equal(jun?.paid, paid);
    assert.equal(jun?.payableOpenDue, open);
    assert.equal(jun?.estimatedOutflow, 1_249_899.43);
  });

  it("timeline mensal bate com base Contas a Pagar no mesmo filtro de mês", () => {
    const rows: FinanceApDashboardRow[] = [
      apRow({
        externalId: 1,
        companyName: "KOPPETEL",
        amountPayable: 600,
        amountPaid: 200,
        balancePayable: 400,
        dueDate: new Date(2026, 5, 8),
        paymentDate: new Date(2026, 5, 7),
      }),
      apRow({
        externalId: 2,
        companyName: "KOPPETEL",
        amountPayable: 350,
        amountPaid: 0,
        balancePayable: 350,
        dueDate: new Date(2026, 5, 22),
      }),
    ];
    const apFilters = {
      status: "all" as const,
      year: 2026,
      month: 6,
      companyName: "KOPPETEL",
    };
    const cashFilters = {
      viewMode: "projected" as const,
      dateBase: "due" as const,
      status: "all" as const,
      year: 2026,
      month: 6,
      companyName: "KOPPETEL",
    };
    const apDashboard = buildFinanceAccountsPayableDashboard(rows, apFilters, REF);
    const cashFlow = buildFinanceCashFlowDashboard([], rows, cashFilters, REF);
    const jun = cashFlow.executiveSummary.monthlyTimeline.find((r) => r.month === 6);

    assert.equal(apDashboard.cards.totalPayableAmount, 950);
    assert.equal(apDashboard.cards.totalOpenAmount, 750);
    assert.equal(jun?.paid, 200);
    assert.equal(jun?.payableOpenDue, 750);
    assert.equal(jun?.estimatedOutflow, 950);
  });

  it("timeline mensal exclui intercompany e pedido de compra como Contas a Pagar", () => {
    const rows: FinanceApDashboardRow[] = [
      apRow({
        externalId: 1,
        companyName: "LAZARIOS",
        personName: "Fornecedor Nacional Ltda",
        personCnpj: "33.333.333/0001-33",
        balancePayable: 500,
        amountPayable: 500,
        dueDate: new Date(2026, 5, 12),
      }),
      apRow({
        externalId: 2,
        companyName: "LAZARIOS",
        personName: "Koppetel Comercio de Plasticos LTDA",
        personCnpj: "14.055.501/0001-80",
        balancePayable: 800,
        amountPayable: 800,
        dueDate: new Date(2026, 5, 15),
      }),
      apRow({
        externalId: 3,
        companyName: "LAZARIOS",
        personName: "Fornecedor PC",
        description: "Pedido de compra PC 7788",
        balancePayable: 300,
        amountPayable: 300,
        dueDate: new Date(2026, 5, 18),
      }),
    ];
    const filters = {
      viewMode: "projected" as const,
      dateBase: "due" as const,
      status: "all" as const,
      year: 2026,
      companyName: "LAZARIOS",
    };
    const timeline = buildFinanceCashFlowDashboard([], rows, filters, REF).executiveSummary
      .monthlyTimeline;
    const jun = timeline.find((r) => r.month === 6);
    const chart = buildExecutiveMonthlyPlannedChartRows(timeline).find((r) => r.name === "Jun");

    assert.equal(jun?.payableOpenDue, 500);
    assert.equal(jun?.estimatedOutflow, 500);
    assert.equal(chart?.payableOpen, 500);
    assert.equal(chart?.estimatedOutflow, 500);
  });

  it("linha do tempo mensal agrega meses do ano", () => {
    const timeline = buildExecutiveMonthlyTimeline(
      [
        arRow({
          amountReceived: 100,
          dueDate: new Date(2026, 0, 15),
          settlementDate: new Date(2026, 5, 15),
          balanceReceivable: 0,
        }),
      ],
      [
        apRow({
          amountPaid: 40,
          dueDate: new Date(2026, 0, 20),
          paymentDate: new Date(2026, 0, 20),
          balancePayable: 0,
        }),
      ],
      2026,
      REF
    );
    assert.equal(timeline.length, 12);
    assert.deepEqual(
      timeline.map((r) => r.month),
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]
    );
    const jan = timeline.find((r) => r.month === 1);
    assert.equal(jan?.received, 100);
    assert.equal(jan?.paid, 40);
  });

  it("ano passado zera projeção futura", () => {
    const forward = resolveForwardYearRange(2025, REF);
    assert.equal(forward.isActive, false);
    const payload = buildFinanceCashFlowDashboard(
      [arRow({ dueDate: new Date(2025, 10, 1), balanceReceivable: 500 })],
      [],
      { ...filters, year: 2025 },
      REF
    );
    assert.equal(payload.executiveSummary.receivable.openFromTodayToYearEnd, 0);
  });
});

describe("FinanceCashFlowExecutiveSummary UI", () => {
  it("página exibe painel executivo e linha do tempo", () => {
    const page = readFileSync(
      join(process.cwd(), "src", "components", "finance", "FinanceCashFlowPage.tsx"),
      "utf8"
    );
    assert.match(page, /FinanceCashFlowExecutiveSummaryPanel/);
    assert.match(page, /FinanceCashFlowMonthlyPlannedChart/);
    assert.match(page, /FinanceCashFlowMonthlyTimelineTable/);
    assert.match(page, /executiveSummary/);
  });

  it("painel executivo expõe KPIs principais", () => {
    const panel = readFileSync(
      join(
        process.cwd(),
        "src",
        "components",
        "finance",
        "cash-flow",
        "FinanceCashFlowExecutiveSummaryPanel.tsx"
      ),
      "utf8"
    );
    assert.match(panel, /Recebido YTD/);
    assert.match(panel, /Estimativa líquida anual/);
    assert.match(panel, /Período filtrado/);
    assert.match(panel, /Faturamento não é caixa/);
  });
});
