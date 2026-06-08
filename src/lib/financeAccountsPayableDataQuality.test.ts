import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { FinanceApDashboardRow } from "./financeAccountsPayableDashboard.js";
import {
  buildFinanceApDataQualitySummary,
  createFinanceApDataQualityAccumulator,
  financeApDataQualitySeverityLabel,
  rowMatchesFinanceApQualityAlert,
  trackFinanceApDataQualityRow,
} from "./financeAccountsPayableDataQuality.js";

function row(partial: Partial<FinanceApDashboardRow> & Pick<FinanceApDashboardRow, "externalId">): FinanceApDashboardRow {
  return {
    companyName: "Empresa",
    personName: "Fornecedor",
    personCnpj: "11.111.111/0001-11",
    dueDate: new Date(2026, 5, 20),
    settlementDate: null,
    paymentDate: null,
    amountPayable: 100,
    amountPaid: 0,
    balancePayable: 100,
    paymentMethodName: "Boleto",
    bankAccountName: "Bradesco",
    sourceInvoiceId: 1,
    documentNumber: "NF-1",
    suspendPayment: false,
    description: null,
    nomusStatus: false,
    syncedAt: new Date("2026-06-06T12:00:00.000Z"),
    ...partial,
  };
}

const REF = new Date(2026, 5, 6, 12, 0, 0, 0);

describe("financeAccountsPayableDataQuality", () => {
  it("classifica severidade de alertas", () => {
    assert.equal(financeApDataQualitySeverityLabel("info"), "Info");
    assert.equal(financeApDataQualitySeverityLabel("warning"), "Atenção");
    assert.equal(financeApDataQualitySeverityLabel("critical"), "Crítico");
  });

  it("conta vencidos acima de 30/60/90 dias", () => {
    const acc = createFinanceApDataQualityAccumulator();
    trackFinanceApDataQualityRow(
      acc,
      row({ externalId: 1, balancePayable: 500, dueDate: new Date(2026, 2, 1) }),
      REF
    );
    const summary = buildFinanceApDataQualitySummary(acc);
    const over30 = summary.find((s) => s.key === "overdueOver30Days");
    const over60 = summary.find((s) => s.key === "overdueOver60Days");
    const over90 = summary.find((s) => s.key === "overdueOver90Days");
    assert.ok(over30 && over30.count === 1);
    assert.ok(over60 && over60.count === 1);
    assert.ok(over90 && over90.count === 1);
    assert.equal(over90?.severity, "critical");
  });

  it("rowMatchesFinanceApQualityAlert filtra por tipo", () => {
    const missingCnpj = row({ externalId: 2, personCnpj: null });
    assert.equal(
      rowMatchesFinanceApQualityAlert(missingCnpj, "missingPersonCnpj", REF),
      true
    );
    assert.equal(
      rowMatchesFinanceApQualityAlert(missingCnpj, "negativeBalance", REF),
      false
    );
  });
});
