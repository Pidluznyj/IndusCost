import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildFinanceAccountsReceivableDashboard,
  type FinanceArDashboardRow,
} from "./financeAccountsReceivableDashboard.js";
import {
  auditAccountsReceivableRules,
  buildAccountsReceivableMetrics,
  buildAccountsReceivableRulesContext,
  buildFinanceAccountsReceivableRulesResult,
  classifyAccountsReceivableTitle,
  explainAccountsReceivableMetric,
  getAccountsReceivableValue,
  isAccountsReceivableTitleAllowedInManagement,
  isOfficialArOverdueTitle,
  listAccountsReceivableMetricDefinitions,
  normalizeAccountsReceivableTitle,
  sumOfficialArOpenDueInPeriod,
  sumOfficialArOverdueAmount,
} from "./financeAccountsReceivableRulesEngine.js";
import { toCivilDateKey } from "./financeCivilDate.js";

function row(partial: Partial<FinanceArDashboardRow> & Pick<FinanceArDashboardRow, "externalId">): FinanceArDashboardRow {
  return {
    companyName: "Empresa A",
    personName: "Cliente X",
    personCnpj: "12.345.678/0001-90",
    dueDate: null,
    settlementDate: null,
    amountReceivable: 1000,
    amountReceived: 0,
    balanceReceivable: 1000,
    paymentMethodName: "Boleto",
    bankAccountName: "Bradesco",
    sourceInvoiceId: 100,
    sourceInvoiceNumber: "NF-100",
    suspendCollection: false,
    description: null,
    nomusStatus: null,
    syncedAt: new Date("2026-06-06T12:00:00.000Z"),
    ...partial,
  };
}

const REF = new Date(2026, 5, 6, 12, 0, 0, 0);

describe("financeAccountsReceivableRulesEngine", () => {
  it("1. totalReceivable — soma amountReceivable no universo filtrado", () => {
    const rows = [
      row({ externalId: 1, balanceReceivable: 100, amountReceivable: 100, dueDate: new Date(2026, 5, 1) }),
      row({ externalId: 2, balanceReceivable: 200, amountReceivable: 200, dueDate: new Date(2026, 5, 20) }),
      row({
        externalId: 3,
        balanceReceivable: 0,
        amountReceivable: 500,
        amountReceived: 500,
        dueDate: new Date(2026, 4, 1),
      }),
    ];
    const result = buildFinanceAccountsReceivableRulesResult(rows, { referenceDate: REF });
    assert.equal(result.metrics.totalReceivable, 800);
    assert.equal(result.metrics.totalReceivable, result.cards.totalAmountReceivable);
  });

  it("2. receivedThisMonth — settlementDate no mês corrente", () => {
    const rows = [
      row({
        externalId: 1,
        balanceReceivable: 0,
        amountReceivable: 1000,
        amountReceived: 1000,
        settlementDate: new Date(2026, 5, 3),
        dueDate: new Date(2026, 5, 1),
      }),
      row({
        externalId: 2,
        balanceReceivable: 0,
        amountReceivable: 500,
        amountReceived: 500,
        settlementDate: new Date(2026, 4, 28),
        dueDate: new Date(2026, 4, 1),
      }),
    ];
    const result = buildFinanceAccountsReceivableRulesResult(rows, { referenceDate: REF });
    assert.equal(result.metrics.receivedThisMonth, 1000);
    assert.equal(result.metrics.receivedThisMonth, result.cards.receivedThisMonthAmount);
  });

  it("3. receivedYtd — settlementDate no acumulado do ano", () => {
    const rows = [
      row({
        externalId: 1,
        balanceReceivable: 0,
        amountReceivable: 800,
        amountReceived: 800,
        settlementDate: new Date(2026, 2, 15),
        dueDate: new Date(2026, 2, 10),
      }),
      row({
        externalId: 2,
        balanceReceivable: 0,
        amountReceivable: 300,
        amountReceived: 300,
        settlementDate: new Date(2026, 5, 1),
        dueDate: new Date(2026, 5, 1),
      }),
    ];
    const result = buildFinanceAccountsReceivableRulesResult(rows, {
      referenceDate: REF,
      year: 2026,
    });
    assert.equal(result.metrics.receivedYtd, 1100);
  });

  it("4. openAmount — saldo em aberto", () => {
    const rows = [
      row({ externalId: 1, balanceReceivable: 100, dueDate: new Date(2026, 5, 1) }),
      row({ externalId: 2, balanceReceivable: 250, dueDate: new Date(2026, 5, 20) }),
      row({ externalId: 3, balanceReceivable: 0, amountReceived: 1000, dueDate: new Date(2026, 4, 1) }),
    ];
    const result = buildFinanceAccountsReceivableRulesResult(rows, { referenceDate: REF });
    assert.equal(result.metrics.openAmount, 350);
    assert.equal(result.metrics.openAmount, result.cards.totalOpenAmount);
  });

  it("5. overdueAmount — vencido gerencial", () => {
    const rows = [
      row({ externalId: 1, balanceReceivable: 100, dueDate: new Date(2026, 5, 1) }),
      row({ externalId: 2, balanceReceivable: 200, dueDate: new Date(2026, 5, 20) }),
    ];
    const result = buildFinanceAccountsReceivableRulesResult(rows, { referenceDate: REF });
    assert.equal(result.metrics.overdueAmount, 100);
    assert.equal(result.metrics.overdueAmount, result.cards.overdueAmount);
  });

  it("6. dueTodayAmount — vence hoje", () => {
    const rows = [
      row({ externalId: 1, balanceReceivable: 150, dueDate: new Date(2026, 5, 6) }),
      row({ externalId: 2, balanceReceivable: 50, dueDate: new Date(2026, 5, 1) }),
    ];
    const result = buildFinanceAccountsReceivableRulesResult(rows, { referenceDate: REF });
    assert.equal(result.metrics.dueTodayAmount, 150);
  });

  it("7–10. próximos 7/30/60/90 dias — janelas cumulativas", () => {
    const rows = [
      row({ externalId: 1, balanceReceivable: 10, dueDate: new Date(2026, 5, 10) }),
      row({ externalId: 2, balanceReceivable: 20, dueDate: new Date(2026, 5, 25) }),
      row({ externalId: 3, balanceReceivable: 30, dueDate: new Date(2026, 6, 15) }),
      row({ externalId: 4, balanceReceivable: 40, dueDate: new Date(2026, 7, 20) }),
      row({ externalId: 5, balanceReceivable: 50, dueDate: new Date(2026, 5, 1) }),
    ];
    const result = buildFinanceAccountsReceivableRulesResult(rows, { referenceDate: REF });
    assert.equal(result.metrics.dueNext7DaysAmount, 10);
    assert.equal(result.metrics.dueNext30DaysAmount, 30);
    assert.ok(result.metrics.dueNext60DaysAmount >= 30);
    assert.ok(result.metrics.dueNext90DaysAmount >= result.metrics.dueNext60DaysAmount);
  });

  it("11–12. com NF / sem NF", () => {
    const rows = [
      row({
        externalId: 1,
        balanceReceivable: 100,
        dueDate: new Date(2026, 5, 1),
        sourceInvoiceId: 10,
        sourceInvoiceNumber: "NF-10",
      }),
      row({
        externalId: 2,
        balanceReceivable: 200,
        dueDate: new Date(2026, 5, 20),
        sourceInvoiceId: null,
        sourceInvoiceNumber: null,
      }),
    ];
    const result = buildFinanceAccountsReceivableRulesResult(rows, { referenceDate: REF });
    assert.equal(result.metrics.openWithInvoiceAmount, 100);
    assert.equal(result.metrics.openWithoutInvoiceAmount, 200);
  });

  it("13. título recebido não entra como aberto", () => {
    const settled = row({
      externalId: 1,
      balanceReceivable: 0,
      amountReceivable: 1000,
      amountReceived: 1000,
      settlementDate: new Date(2026, 5, 1),
      dueDate: new Date(2026, 5, 1),
    });
    const normalized = normalizeAccountsReceivableTitle(settled, REF);
    assert.equal(normalized.isOpen, false);
    assert.equal(normalized.isSettled, true);
    assert.equal(normalized.openAmount, 0);
  });

  it("14. título aberto vencido entra como atrasado", () => {
    const overdue = row({ externalId: 1, balanceReceivable: 500, dueDate: new Date(2026, 5, 1) });
    const ctx = buildAccountsReceivableRulesContext({ referenceDate: REF });
    assert.equal(classifyAccountsReceivableTitle(overdue, ctx), "overdue");
    assert.equal(getAccountsReceivableValue(overdue, "overdueAmount", ctx), 500);
  });

  it("15. título aberto futuro entra na janela correta", () => {
    const future = row({ externalId: 1, balanceReceivable: 75, dueDate: new Date(2026, 5, 12) });
    const ctx = buildAccountsReceivableRulesContext({ referenceDate: REF });
    assert.equal(classifyAccountsReceivableTitle(future, ctx), "upcoming");
    assert.equal(getAccountsReceivableValue(future, "dueNext7DaysAmount", ctx), 75);
  });

  it("16–17. classificação NF correta", () => {
    const withNf = normalizeAccountsReceivableTitle(
      row({ externalId: 1, sourceInvoiceId: 1, sourceInvoiceNumber: "NF-1" }),
      REF
    );
    const withoutNf = normalizeAccountsReceivableTitle(
      row({ externalId: 2, sourceInvoiceId: null, sourceInvoiceNumber: null }),
      REF
    );
    assert.equal(withNf.hasSourceInvoice, true);
    assert.equal(withoutNf.hasSourceInvoice, false);
  });

  it("18. data civil não desloca vencimento 20/07", () => {
    const utcMidnight = new Date("2026-07-20T00:00:00.000Z");
    const normalized = normalizeAccountsReceivableTitle(
      row({ externalId: 1, dueDate: utcMidnight, balanceReceivable: 100 }),
      REF
    );
    assert.equal(normalized.dueDateCivilKey, "2026-07-20");
    assert.equal(toCivilDateKey(utcMidnight), "2026-07-20");
  });

  it("19. valores null/undefined não geram NaN", () => {
    const normalized = normalizeAccountsReceivableTitle(
      {
        externalId: 1,
        amountReceivable: undefined,
        amountReceived: null,
        balanceReceivable: Number.NaN,
      },
      REF
    );
    assert.ok(Number.isFinite(normalized.amountReceivable));
    assert.ok(Number.isFinite(normalized.amountReceived));
    assert.ok(Number.isFinite(normalized.openAmount));

    const result = buildFinanceAccountsReceivableRulesResult(
      [row({ externalId: 1, balanceReceivable: Number.NaN, amountReceivable: undefined })],
      { referenceDate: REF }
    );
    assert.ok(result.audit.isFinite);
  });

  it("20. métricas explicáveis retornam definição", () => {
    const defs = listAccountsReceivableMetricDefinitions();
    assert.ok(defs.length >= 16);
    const openDef = explainAccountsReceivableMetric("openAmount");
    assert.ok(openDef);
    assert.equal(openDef!.label, "Em aberto");
    assert.ok(openDef!.description.length > 0);
    assert.equal(explainAccountsReceivableMetric("unknown-metric"), null);
  });

  it("21. compatibilidade com dashboard oficial — cards principais", () => {
    const rows = [
      row({ externalId: 1, balanceReceivable: 100, dueDate: new Date(2026, 5, 1) }),
      row({ externalId: 2, balanceReceivable: 200, dueDate: new Date(2026, 5, 6) }),
      row({ externalId: 3, balanceReceivable: 300, dueDate: new Date(2026, 5, 20) }),
      row({
        externalId: 4,
        balanceReceivable: 0,
        amountReceivable: 1000,
        amountReceived: 1000,
        dueDate: new Date(2026, 4, 1),
      }),
    ];
    const dash = buildFinanceAccountsReceivableDashboard(rows, { status: "all" }, REF);
    const engine = buildFinanceAccountsReceivableRulesResult(rows, { referenceDate: REF });

    assert.equal(engine.metrics.openAmount, dash.cards.totalOpenAmount);
    assert.equal(engine.metrics.overdueAmount, dash.cards.overdueAmount);
    assert.equal(engine.metrics.dueTodayAmount, dash.cards.dueTodayAmount);
    assert.equal(engine.metrics.dueNext7DaysAmount, dash.cards.dueNext7DaysAmount);
    assert.equal(engine.metrics.dueNext30DaysAmount, dash.cards.dueNext30DaysAmount);
    assert.equal(engine.metrics.receivedThisMonth, dash.cards.receivedThisMonthAmount);
    assert.equal(engine.metrics.openWithInvoiceAmount, dash.cards.openWithInvoiceAmount);
    assert.equal(engine.metrics.openWithoutInvoiceAmount, dash.cards.openWithoutInvoiceAmount);
    assert.equal(engine.cards.totalRecords, dash.cards.totalRecords);
  });

  it("vencido sem NF excluído da visão gerencial", () => {
    const overdueNoNf = row({
      externalId: 1,
      balanceReceivable: 500,
      dueDate: new Date(2026, 5, 1),
      sourceInvoiceId: null,
      sourceInvoiceNumber: null,
    });
    assert.equal(isAccountsReceivableTitleAllowedInManagement(overdueNoNf, REF), false);

    const result = buildFinanceAccountsReceivableRulesResult([overdueNoNf], { referenceDate: REF });
    assert.equal(result.metrics.overdueAmount, 0);
    assert.equal(result.cards.totalRecords, 0);
  });

  it("futuro sem NF permanece na visão gerencial", () => {
    const futureNoNf = row({
      externalId: 1,
      balanceReceivable: 300,
      dueDate: new Date(2026, 5, 20),
      sourceInvoiceId: null,
      sourceInvoiceNumber: null,
    });
    assert.equal(isAccountsReceivableTitleAllowedInManagement(futureNoNf, REF), true);
    const result = buildFinanceAccountsReceivableRulesResult([futureNoNf], { referenceDate: REF });
    assert.equal(result.metrics.openAmount, 300);
  });

  it("estimatedYearTotal = receivedYtd + openUntilYearEnd", () => {
    const rows = [
      row({
        externalId: 1,
        balanceReceivable: 0,
        amountReceivable: 400,
        amountReceived: 400,
        settlementDate: new Date(2026, 1, 10),
        dueDate: new Date(2026, 1, 5),
      }),
      row({
        externalId: 2,
        balanceReceivable: 600,
        dueDate: new Date(2026, 8, 15),
        sourceInvoiceId: 1,
        sourceInvoiceNumber: "NF-1",
      }),
    ];
    const result = buildFinanceAccountsReceivableRulesResult(rows, {
      referenceDate: REF,
      year: 2026,
      filters: { status: "all", year: 2026 },
    });
    assert.equal(
      result.metrics.estimatedYearTotal,
      result.metrics.receivedYtd + result.metrics.openUntilYearEnd
    );
  });

  it("auditAccountsReceivableRules valida finitude", () => {
    const result = buildFinanceAccountsReceivableRulesResult(
      [row({ externalId: 1, balanceReceivable: 100, dueDate: new Date(2026, 5, 10) })],
      { referenceDate: REF }
    );
    const audit = auditAccountsReceivableRules(result);
    assert.equal(audit.isFinite, true);
    assert.equal(audit.warnings.length, 0);
    assert.ok(audit.metricsDocumented > 0);
  });

  it("buildAccountsReceivableMetrics bate com cards via helper dedicado", () => {
    const rows = [
      row({ externalId: 1, balanceReceivable: 100, dueDate: new Date(2026, 5, 1) }),
      row({ externalId: 2, balanceReceivable: 200, dueDate: new Date(2026, 5, 20) }),
    ];
    const ctx = buildAccountsReceivableRulesContext({ referenceDate: REF });
    const metrics = buildAccountsReceivableMetrics(rows, ctx);
    const dash = buildFinanceAccountsReceivableDashboard(rows, { status: "all" }, REF);
    assert.equal(metrics.openAmount, dash.cards.totalOpenAmount);
    assert.equal(metrics.overdueAmount, dash.cards.overdueAmount);
  });

  it("isOfficialArOverdueTitle e sumOfficialArOverdueAmount alinham com overdueAmount", () => {
    const rows = [
      row({ externalId: 1, balanceReceivable: 100, dueDate: new Date(2026, 5, 1) }),
      row({ externalId: 2, balanceReceivable: 200, dueDate: new Date(2026, 5, 20) }),
    ];
    assert.equal(isOfficialArOverdueTitle(rows[0]!, REF), true);
    assert.equal(isOfficialArOverdueTitle(rows[1]!, REF), false);
    assert.equal(sumOfficialArOverdueAmount(rows, { status: "all" }, REF, null), 100);
    const result = buildFinanceAccountsReceivableRulesResult(rows, { referenceDate: REF });
    assert.equal(result.metrics.overdueAmount, 100);
  });

  it("sumOfficialArOpenDueInPeriod — timeline por vencimento", () => {
    const rows = [
      row({ externalId: 1, balanceReceivable: 100, dueDate: new Date(2026, 5, 10) }),
      row({ externalId: 2, balanceReceivable: 200, dueDate: new Date(2026, 6, 5) }),
      row({
        externalId: 3,
        balanceReceivable: 0,
        amountReceived: 50,
        settlementDate: new Date(2026, 5, 2),
        dueDate: new Date(2026, 5, 15),
      }),
    ];
    const juneStart = new Date(2026, 5, 1);
    const juneEnd = new Date(2026, 5, 30);
    assert.equal(sumOfficialArOpenDueInPeriod(rows, juneStart, juneEnd), 100);
  });
});
