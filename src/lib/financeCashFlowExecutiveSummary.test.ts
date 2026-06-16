import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
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
    assert.ok(timeline.length >= 6);
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
