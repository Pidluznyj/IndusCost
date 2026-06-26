import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildOfficialAccountsPayableDashboard,
  buildOfficialAccountsPayableRulesResult,
  OFFICIAL_AP_RULES_SOURCE,
  resolveOfficialApCashFlowExecutiveMetrics,
} from "./financeAccountsPayableRulesAdapter.js";
import {
  buildFinanceAccountsPayableDashboard,
  type FinanceApDashboardRow,
} from "./financeAccountsPayableDashboard.js";
import { buildExecutiveReportPayablesSection } from "./financeExecutiveReportDataSources.js";

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

describe("financeAccountsPayableRulesAdapter integration", () => {
  it("dashboard oficial expõe metricsSource e cards idênticos ao motor", () => {
    const rows = [
      row({ externalId: 1, balancePayable: 100, dueDate: new Date(2026, 5, 1) }),
      row({ externalId: 2, balancePayable: 200, dueDate: new Date(2026, 5, 20) }),
    ];
    const payload = buildOfficialAccountsPayableDashboard({
      rows,
      filters: { status: "all" },
      referenceDate: REF,
      syncCutoff: null,
    });
    assert.equal(payload.metricsSource, OFFICIAL_AP_RULES_SOURCE);
    assert.equal(payload.cards.totalOpenAmount, payload.metrics.openAmount);
    assert.equal(payload.cards.overdueAmount, payload.metrics.overdueAmount);
  });

  it("adapter preserva paridade com buildFinanceAccountsPayableDashboard nos cards", () => {
    const rows = [
      row({ externalId: 1, balancePayable: 500, dueDate: new Date(2026, 4, 1) }),
      row({
        externalId: 2,
        balancePayable: 0,
        amountPaid: 300,
        paymentDate: new Date(2026, 5, 2),
        dueDate: new Date(2026, 5, 1),
      }),
    ];
    const legacy = buildFinanceAccountsPayableDashboard(rows, { status: "all" }, REF, null);
    const official = buildOfficialAccountsPayableDashboard({
      rows,
      filters: { status: "all" },
      referenceDate: REF,
      syncCutoff: null,
    });
    assert.equal(official.cards.totalOpenAmount, legacy.cards.totalOpenAmount);
    assert.equal(official.cards.paidThisMonthAmount, legacy.cards.paidThisMonthAmount);
    assert.equal(official.financialHorizon.total.amount, legacy.financialHorizon.total.amount);
  });

  it("relatório executivo AP usa cards do motor oficial", () => {
    const rows = [row({ externalId: 1, balancePayable: 100, dueDate: new Date(2026, 5, 1) })];
    const engine = buildOfficialAccountsPayableRulesResult({
      rows,
      filters: { status: "all", year: 2026 },
      referenceDate: REF,
      syncCutoff: null,
      year: 2026,
      month: 6,
    });
    const section = buildExecutiveReportPayablesSection({
      rows,
      filters: { status: "all", year: 2026 },
      referenceDate: REF,
      syncCutoff: null,
      year: 2026,
      month: 6,
    });
    assert.equal(section.kpis.openAmount, engine.cards.totalOpenAmount);
    assert.equal(section.kpis.overdueAmount, engine.cards.overdueAmount);
  });

  it("fluxo de caixa — métricas executivas AP vêm do motor", () => {
    const rows = [
      row({ externalId: 1, balancePayable: 400, dueDate: new Date(2026, 8, 1) }),
      row({
        externalId: 2,
        balancePayable: 0,
        amountPaid: 150,
        paymentDate: new Date(2026, 5, 3),
        dueDate: new Date(2026, 5, 1),
      }),
    ];
    const engine = buildOfficialAccountsPayableRulesResult({
      rows,
      filters: { status: "all", year: 2026 },
      referenceDate: REF,
      syncCutoff: null,
      year: 2026,
    });
    const cf = resolveOfficialApCashFlowExecutiveMetrics(
      rows,
      { status: "all", year: 2026 },
      REF,
      null,
      2026
    );
    assert.equal(cf.paidYtd, engine.metrics.paidYtd);
    assert.equal(cf.openUntilYearEnd, engine.metrics.openUntilYearEnd);
    assert.equal(cf.estimatedYearTotal, engine.metrics.estimatedYearTotal);
  });
});
