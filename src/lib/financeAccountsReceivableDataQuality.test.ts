import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { FinanceArDashboardRow } from "./financeAccountsReceivableDashboard.js";
import {
  buildFinanceArDataQualitySummary,
  createFinanceArDataQualityAccumulator,
  financeArDataQualitySeverityLabel,
  rowMatchesFinanceArQualityAlert,
  trackFinanceArDataQualityRow,
} from "./financeAccountsReceivableDataQuality.js";

function row(partial: Partial<FinanceArDashboardRow> & Pick<FinanceArDashboardRow, "externalId">): FinanceArDashboardRow {
  return {
    companyName: "Empresa",
    personName: "Cliente",
    personCnpj: "11.111.111/0001-11",
    dueDate: new Date(2026, 5, 20),
    settlementDate: null,
    amountReceivable: 100,
    amountReceived: 0,
    balanceReceivable: 100,
    paymentMethodName: "Boleto",
    bankAccountName: "Bradesco",
    sourceInvoiceId: 1,
    sourceInvoiceNumber: "NF-1",
    suspendCollection: false,
    description: null,
    nomusStatus: false,
    syncedAt: new Date("2026-06-06T12:00:00.000Z"),
    ...partial,
  };
}

const REF = new Date(2026, 5, 6, 12, 0, 0, 0);

describe("financeAccountsReceivableDataQuality", () => {
  it("classifica severidade de alertas", () => {
    assert.equal(financeArDataQualitySeverityLabel("info"), "Info");
    assert.equal(financeArDataQualitySeverityLabel("warning"), "Atenção");
    assert.equal(financeArDataQualitySeverityLabel("critical"), "Crítico");
  });

  it("conta vencidos acima de 30/60/90 dias", () => {
    const acc = createFinanceArDataQualityAccumulator();
    trackFinanceArDataQualityRow(
      acc,
      row({ externalId: 1, balanceReceivable: 500, dueDate: new Date(2026, 2, 1) }),
      REF
    );
    const summary = buildFinanceArDataQualitySummary(acc);
    const over30 = summary.find((s) => s.key === "overdueOver30Days");
    const over60 = summary.find((s) => s.key === "overdueOver60Days");
    const over90 = summary.find((s) => s.key === "overdueOver90Days");
    assert.ok(over30 && over30.count === 1);
    assert.ok(over60 && over60.count === 1);
    assert.ok(over90 && over90.count === 1);
    assert.equal(over90?.severity, "critical");
  });

  it("rowMatchesFinanceArQualityAlert filtra por tipo", () => {
    const missingCnpj = row({ externalId: 2, personCnpj: null });
    assert.equal(
      rowMatchesFinanceArQualityAlert(missingCnpj, "missingPersonCnpj", REF),
      true
    );
    assert.equal(
      rowMatchesFinanceArQualityAlert(missingCnpj, "negativeBalance", REF),
      false
    );
  });
});
