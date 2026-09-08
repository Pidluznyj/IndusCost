import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  auditAccountsPayableRules,
  buildAccountsPayableMetrics,
  buildAccountsPayableRulesContext,
  buildFinanceAccountsPayableRulesResult,
  listAccountsPayableMetricDefinitions,
  sumOfficialApOpenDueInPeriod,
} from "./financeAccountsPayableRulesEngine.js";
import {
  buildFinanceAccountsPayableDashboard,
  type FinanceApDashboardRow,
} from "./financeAccountsPayableDashboard.js";

function row(partial: Partial<FinanceApDashboardRow> & Pick<FinanceApDashboardRow, "externalId">): FinanceApDashboardRow {
  return {
    companyName: "Empresa A",
    personName: "Fornecedor X",
    personCnpj: "12.345.678/0001-90",
    dueDate: new Date(2026, 5, 1),
    scheduleDate: null,
    type: null,
    settlementDate: null,
    paymentDate: null,
    competenceDate: new Date(2026, 4, 1),
    amountPayable: 1000,
    amountPaid: 0,
    balancePayable: 1000,
    paymentMethodName: "PIX",
    bankAccountName: "Bradesco",
    sourceInvoiceId: null,
    documentNumber: "DOC-1",
    suspendPayment: false,
    description: null,
    comments: null,
    classification: null,
    nomusStatus: true,
    syncedAt: new Date("2026-06-06T12:00:00.000Z"),
    ...partial,
  };
}

const REF = new Date(2026, 5, 6, 12, 0, 0, 0);

describe("financeAccountsPayableRulesEngine", () => {
  it("totalPayable — soma amountPayable no universo filtrado", () => {
    const rows = [
      row({ externalId: 1, balancePayable: 100, amountPayable: 100 }),
      row({ externalId: 2, balancePayable: 200, amountPayable: 200 }),
      row({ externalId: 3, balancePayable: 0, amountPayable: 500, amountPaid: 500 }),
    ];
    const result = buildFinanceAccountsPayableRulesResult(rows, { referenceDate: REF });
    assert.equal(result.metrics.totalPayable, 800);
    assert.equal(result.metrics.totalPayable, result.cards.totalPayableAmount);
  });

  it("paidThisMonth — pagamento efetivo no mês corrente", () => {
    const rows = [
      row({
        externalId: 1,
        balancePayable: 0,
        amountPayable: 1000,
        amountPaid: 1000,
        paymentDate: new Date(2026, 5, 3),
        dueDate: new Date(2026, 5, 1),
      }),
    ];
    const result = buildFinanceAccountsPayableRulesResult(rows, { referenceDate: REF });
    assert.equal(result.metrics.paidThisMonth, 1000);
    assert.equal(result.metrics.paidThisMonth, result.cards.paidThisMonthAmount);
  });

  it("openAmount e overdueAmount batem com dashboard", () => {
    const rows = [
      row({ externalId: 1, balancePayable: 300, dueDate: new Date(2026, 4, 1) }),
      row({ externalId: 2, balancePayable: 200, dueDate: new Date(2026, 5, 20) }),
    ];
    const result = buildFinanceAccountsPayableRulesResult(rows, { referenceDate: REF });
    const dash = buildFinanceAccountsPayableDashboard(rows, { status: "all" }, REF);
    assert.equal(result.metrics.openAmount, dash.cards.totalOpenAmount);
    assert.equal(result.metrics.overdueAmount, dash.cards.overdueAmount);
    assert.equal(result.metrics.dueTodayAmount, dash.cards.dueTodayAmount);
    assert.equal(result.metrics.dueNext7DaysAmount, dash.cards.dueNext7DaysAmount);
    assert.equal(result.metrics.dueNext30DaysAmount, dash.cards.dueNext30DaysAmount);
  });

  it("estimatedYearTotal = paidYtd + openRemainingObligation (sem vencidos = paidYtd + openUntilYearEnd)", () => {
    const rows = [
      row({
        externalId: 1,
        balancePayable: 0,
        amountPaid: 500,
        paymentDate: new Date(2026, 5, 2),
        dueDate: new Date(2026, 5, 1),
      }),
      row({ externalId: 2, balancePayable: 400, dueDate: new Date(2026, 8, 1) }),
    ];
    const result = buildFinanceAccountsPayableRulesResult(rows, { referenceDate: REF, year: 2026 });
    assert.equal(result.metrics.overdueOpenBeforeBase, 0);
    assert.equal(result.metrics.openRemainingObligation, result.metrics.openUntilYearEnd);
    assert.equal(
      result.metrics.estimatedYearTotal,
      result.metrics.paidYtd + result.metrics.openUntilYearEnd
    );
  });

  it("métricas explicáveis e auditoria finita", () => {
    const rows = [row({ externalId: 1 })];
    const result = buildFinanceAccountsPayableRulesResult(rows, { referenceDate: REF });
    assert.ok(listAccountsPayableMetricDefinitions().length > 0);
    const audit = auditAccountsPayableRules(result);
    assert.equal(audit.isFinite, true);
    assert.equal(audit.warnings.length, 0);
  });

  it("buildAccountsPayableMetrics bate com cards via helper dedicado", () => {
    const rows = [row({ externalId: 1, balancePayable: 100 })];
    const ctx = buildAccountsPayableRulesContext({ referenceDate: REF });
    const metrics = buildAccountsPayableMetrics(rows, ctx);
    const dash = buildFinanceAccountsPayableDashboard(rows, { status: "all" }, REF);
    assert.equal(metrics.openAmount, dash.cards.totalOpenAmount);
    assert.equal(metrics.overdueAmount, dash.cards.overdueAmount);
  });

  it("sumOfficialApOpenDueInPeriod — timeline por vencimento operacional", () => {
    const rows = [
      row({ externalId: 1, balancePayable: 100, dueDate: new Date(2026, 5, 10) }),
      row({ externalId: 2, balancePayable: 200, dueDate: new Date(2026, 6, 5) }),
    ];
    const juneStart = new Date(2026, 5, 1);
    const juneEnd = new Date(2026, 5, 30);
    assert.equal(sumOfficialApOpenDueInPeriod(rows, juneStart, juneEnd), 100);
  });
});

describe("AP_OPEN_REMAINING_OBLIGATION — vencido em aberto continua obrigação do ano", () => {
  // Data-base 06/06/2026. Eixo AP = dueDate: vencido fica alocado na dueDate original.
  const paid = (externalId: number, amount: number, due: Date) =>
    row({
      externalId,
      amountPayable: amount,
      amountPaid: amount,
      balancePayable: 0,
      dueDate: due,
      paymentDate: due,
      settlementDate: due,
    });
  const open = (
    externalId: number,
    amount: number,
    due: Date,
    extra: Partial<FinanceApDashboardRow> = {}
  ) => row({ externalId, amountPayable: amount, amountPaid: 0, balancePayable: amount, dueDate: due, ...extra });

  const metricsOf = (rows: FinanceApDashboardRow[], ref = REF) =>
    buildFinanceAccountsPayableRulesResult(rows, { referenceDate: ref, year: 2026 }).metrics;

  const REAL_CASE_REF = new Date(2026, 8, 8, 12);
  const realCaseRows = () => [
    paid(1, 12_626_339.02, new Date(2026, 4, 10)),
    open(2, 624_983.3, new Date(2026, 2, 20)),
    open(3, 794_362.55, new Date(2026, 8, 15)),
    open(4, 998_312.07, new Date(2026, 9, 15)),
    open(5, 942_568.04, new Date(2026, 10, 15)),
    open(6, 1_168_907.77, new Date(2026, 11, 15)),
  ];

  it("TESTE A: pago 100 + vencido aberto 20 + futuro 30 → openRemaining 50, estimativa 150 (não 130)", () => {
    const m = metricsOf([
      paid(1, 100, new Date(2026, 1, 10)),
      open(2, 20, new Date(2026, 3, 15)),
      open(3, 30, new Date(2026, 8, 1)),
    ]);
    assert.equal(m.paidYtd, 100);
    assert.equal(m.overdueOpenBeforeBase, 20);
    assert.equal(m.dueTodayOpenInYear, 0);
    assert.equal(m.openUntilYearEnd, 30);
    assert.equal(m.openRemainingObligation, 50);
    assert.equal(m.estimatedYearTotal, 150);
    assert.notEqual(m.estimatedYearTotal, 130);
  });

  it("TESTE B: sem vencidos → openRemaining = futuro, estimativa 130", () => {
    const m = metricsOf([paid(1, 100, new Date(2026, 1, 10)), open(2, 30, new Date(2026, 8, 1))]);
    assert.equal(m.overdueOpenBeforeBase, 0);
    assert.equal(m.openRemainingObligation, 30);
    assert.equal(m.estimatedYearTotal, 130);
  });

  it("TESTE C: só vencido em aberto → openRemaining 20, estimativa 120; o vencido não some", () => {
    const m = metricsOf([paid(1, 100, new Date(2026, 1, 10)), open(2, 20, new Date(2026, 3, 15))]);
    assert.equal(m.openUntilYearEnd, 0);
    assert.equal(m.overdueOpenBeforeBase, 20);
    assert.equal(m.openRemainingObligation, 20);
    assert.equal(m.estimatedYearTotal, 120);
  });

  it("TESTE D: título que vence na data-base fica em A VENCER (data-base inclusive), nunca em vencido, e não desaparece", () => {
    const m = metricsOf([
      open(1, 40, new Date(2026, 5, 6)),
      open(2, 20, new Date(2026, 3, 15)),
      open(3, 30, new Date(2026, 8, 1)),
    ]);
    assert.equal(m.dueTodayOpenInYear, 40);
    assert.equal(m.openUntilYearEnd, 70);
    assert.equal(m.overdueOpenBeforeBase, 20);
    assert.equal(m.openRemainingObligation, 90);
    assert.equal(
      m.openRemainingObligation,
      m.overdueOpenBeforeBase + m.dueTodayOpenInYear + (m.openUntilYearEnd - m.dueTodayOpenInYear)
    );
  });

  it("TESTE E: título cancelado não entra em nenhuma métrica de obrigação", () => {
    const m = metricsOf([
      open(1, 20, new Date(2026, 3, 15), { description: "TITULO CANCELADO" }),
      open(2, 30, new Date(2026, 8, 1), { description: "Cancelada por duplicidade" }),
      open(3, 10, new Date(2026, 8, 1)),
    ]);
    assert.equal(m.overdueOpenBeforeBase, 0);
    assert.equal(m.openUntilYearEnd, 10);
    assert.equal(m.openRemainingObligation, 10);
  });

  it("TESTE F: título pago entra em Pago YTD e não em openRemaining", () => {
    const m = metricsOf([paid(1, 100, new Date(2026, 3, 15))]);
    assert.equal(m.paidYtd, 100);
    assert.equal(m.overdueOpenBeforeBase, 0);
    assert.equal(m.openRemainingObligation, 0);
    assert.equal(m.estimatedYearTotal, 100);
  });

  it("TESTE G: título parcialmente pago contribui só com o saldo canônico em aberto", () => {
    const m = metricsOf([
      row({ externalId: 1, amountPayable: 100, amountPaid: 60, balancePayable: 40, dueDate: new Date(2026, 3, 15) }),
    ]);
    assert.equal(m.overdueOpenBeforeBase, 40);
    assert.equal(m.openRemainingObligation, 40);
  });

  it("TESTE H: vencido baixado sem numerário (WITHOUT_CASH) segue o motor oficial — não é obrigação de caixa", () => {
    const m = metricsOf([
      row({
        externalId: 1,
        amountPayable: 100,
        amountPaid: 0,
        balancePayable: 100,
        dueDate: new Date(2026, 3, 15),
        settlementDate: new Date(2026, 3, 20),
        description: "BAIXA SEM NUMERARIO",
      }),
      open(2, 30, new Date(2026, 8, 1)),
    ]);
    assert.equal(m.overdueOpenBeforeBase, 0);
    assert.equal(m.openRemainingObligation, 30);
  });

  it("TESTE I: regressão equivalente ao caso real — estimativa = pago + carteira aberta, não pago + futuro", () => {
    const m = metricsOf(realCaseRows(), REAL_CASE_REF);
    assert.equal(m.paidYtd, 12_626_339.02);
    assert.equal(m.openUntilYearEnd, 3_904_150.43);
    assert.equal(m.overdueOpenBeforeBase, 624_983.3);
    assert.equal(m.openRemainingObligation, 4_529_133.73);
    assert.equal(m.estimatedYearTotal, 17_155_472.75);
    assert.notEqual(m.estimatedYearTotal, 16_530_489.45);
  });

  it("paridade com a tela Contas a Pagar (mesmo ano, mesma data-base, sem mês): Em aberto e Vencido gerencial", () => {
    const m = metricsOf(realCaseRows(), REAL_CASE_REF);
    const dash = buildFinanceAccountsPayableDashboard(realCaseRows(), { status: "all", year: 2026 }, REAL_CASE_REF);
    assert.equal(dash.cards.totalOpenAmount, m.openRemainingObligation);
    assert.equal(dash.cards.overdueAmount, m.overdueOpenBeforeBase);
  });

  it("invariantes: a vencer ≤ obrigação; obrigação ≥ vencido; auditoria sem avisos; ano futuro sem vencido", () => {
    const rows = [
      paid(1, 100, new Date(2026, 1, 10)),
      open(2, 20, new Date(2026, 3, 15)),
      open(3, 30, new Date(2026, 8, 1)),
    ];
    const result = buildFinanceAccountsPayableRulesResult(rows, { referenceDate: REF, year: 2026 });
    const m = result.metrics;
    assert.ok(m.openUntilYearEnd <= m.openRemainingObligation);
    assert.ok(m.openRemainingObligation >= m.overdueOpenBeforeBase);
    assert.equal(auditAccountsPayableRules(result).warnings.length, 0);
    const future = buildFinanceAccountsPayableRulesResult([open(9, 50, new Date(2027, 2, 1))], {
      referenceDate: REF,
      year: 2027,
    }).metrics;
    assert.equal(future.overdueOpenBeforeBase, 0);
    assert.equal(future.openRemainingObligation, 50);
    assert.equal(future.openUntilYearEnd, 50);
  });

  it("vencido em aberto não é deslocado para o mês da data-base (eixo dueDate preservado)", () => {
    const rows = [open(2, 20, new Date(2026, 3, 15)), open(3, 30, new Date(2026, 8, 1))];
    const ctx = buildAccountsPayableRulesContext({ referenceDate: REF, year: 2026 });
    assert.equal(sumOfficialApOpenDueInPeriod(rows, new Date(2026, 5, 1), new Date(2026, 5, 30)), 0);
    assert.equal(sumOfficialApOpenDueInPeriod(rows, new Date(2026, 3, 1), new Date(2026, 3, 30)), 20);
    assert.equal(ctx.forwardFromDate.getTime(), new Date(2026, 5, 6).getTime());
  });
});
