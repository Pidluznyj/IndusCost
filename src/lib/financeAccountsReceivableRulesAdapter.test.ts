import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildOfficialAccountsReceivableDashboard,
  buildOfficialAccountsReceivableRulesResult,
  OFFICIAL_AR_RULES_SOURCE,
  resolveOfficialArCashFlowExecutiveMetrics,
} from "./financeAccountsReceivableRulesAdapter.js";
import {
  buildFinanceAccountsReceivableDashboard,
  type FinanceArDashboardRow,
} from "./financeAccountsReceivableDashboard.js";
import { buildExecutiveReportReceivablesSection } from "./financeExecutiveReportDataSources.js";

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

describe("financeAccountsReceivableRulesAdapter integration", () => {
  it("dashboard oficial expõe metricsSource e cards idênticos ao motor", () => {
    const rows = [
      row({ externalId: 1, balanceReceivable: 100, dueDate: new Date(2026, 5, 1) }),
      row({ externalId: 2, balanceReceivable: 200, dueDate: new Date(2026, 5, 20) }),
    ];
    const payload = buildOfficialAccountsReceivableDashboard({
      rows,
      filters: { status: "all" },
      referenceDate: REF,
      syncCutoff: null,
    });
    assert.equal(payload.metricsSource, OFFICIAL_AR_RULES_SOURCE);
    assert.equal(payload.cards.totalOpenAmount, payload.metrics.openAmount);
    assert.equal(payload.cards.overdueAmount, payload.metrics.overdueAmount);
  });

  it("adapter preserva paridade com buildFinanceAccountsReceivableDashboard nos cards", () => {
    const rows = [
      row({ externalId: 1, balanceReceivable: 500, dueDate: new Date(2026, 4, 1) }),
      row({
        externalId: 2,
        balanceReceivable: 0,
        amountReceived: 300,
        settlementDate: new Date(2026, 5, 2),
        dueDate: new Date(2026, 5, 1),
      }),
    ];
    const legacy = buildFinanceAccountsReceivableDashboard(rows, { status: "all" }, REF, null);
    const official = buildOfficialAccountsReceivableDashboard({
      rows,
      filters: { status: "all" },
      referenceDate: REF,
      syncCutoff: null,
    });
    assert.equal(official.cards.totalOpenAmount, legacy.cards.totalOpenAmount);
    assert.equal(official.cards.receivedThisMonthAmount, legacy.cards.receivedThisMonthAmount);
    assert.equal(official.financialHorizon.total60.amount, legacy.financialHorizon.total60.amount);
  });

  it("relatório executivo AR usa cards do motor oficial", () => {
    const rows = [
      row({ externalId: 1, balanceReceivable: 100, dueDate: new Date(2026, 5, 1) }),
    ];
    const section = buildExecutiveReportReceivablesSection({
      rows,
      filters: { status: "all", year: 2026 },
      referenceDate: REF,
      syncCutoff: null,
      year: 2026,
      month: 6,
    });
    const engine = buildOfficialAccountsReceivableRulesResult({
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

  it("fluxo de caixa — métricas executivas AR vêm do motor", () => {
    const rows = [
      row({
        externalId: 1,
        balanceReceivable: 400,
        dueDate: new Date(2026, 8, 1),
      }),
      row({
        externalId: 2,
        balanceReceivable: 0,
        amountReceived: 150,
        settlementDate: new Date(2026, 5, 3),
        dueDate: new Date(2026, 5, 1),
      }),
    ];
    const engine = buildOfficialAccountsReceivableRulesResult({
      rows,
      filters: { status: "all", year: 2026 },
      referenceDate: REF,
      syncCutoff: null,
      year: 2026,
    });
    const cf = resolveOfficialArCashFlowExecutiveMetrics(
      rows,
      { status: "all", year: 2026 },
      REF,
      null,
      2026
    );
    assert.equal(cf.receivedYtd, engine.metrics.receivedYtd);
    assert.equal(cf.openUntilYearEnd, engine.metrics.openUntilYearEnd);
    assert.equal(cf.estimatedYearTotal, engine.metrics.estimatedYearTotal);
  });
});
