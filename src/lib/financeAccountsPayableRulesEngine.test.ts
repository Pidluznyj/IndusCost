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

  it("estimatedYearTotal = paidYtd + openUntilYearEnd", () => {
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
