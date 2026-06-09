import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import type { FinanceApDashboardRow } from "./financeAccountsPayableDashboard.js";
import {
  auditFinanceApDashboardCalculations,
  computeFinanceApIndependentMetrics,
} from "./financeAccountsPayableCalculationAudit.js";
import { FINANCE_AP_PAID_THIS_MONTH_SCOPE } from "./financeFilterScope.js";

function row(
  partial: Partial<FinanceApDashboardRow> & Pick<FinanceApDashboardRow, "externalId">
): FinanceApDashboardRow {
  return {
    companyName: "Empresa A",
    personName: "Fornecedor X",
    personCnpj: "12.345.678/0001-90",
    dueDate: new Date(2026, 5, 10),
    settlementDate: null,
    paymentDate: null,
    amountPayable: 1000,
    amountPaid: 0,
    balancePayable: 1000,
    paymentMethodName: "PIX",
    bankAccountName: "Bradesco",
    sourceInvoiceId: 100,
    documentNumber: "NF-100",
    suspendPayment: false,
    description: null,
    nomusStatus: null,
    syncedAt: new Date("2026-06-06T12:00:00.000Z"),
    ...partial,
  };
}

const REF = new Date(2026, 5, 6, 12, 0, 0, 0);

describe("financeAccountsPayableCalculationAudit", () => {
  const fixture = [
    row({ externalId: 1, personName: "Alpha", balancePayable: 100, dueDate: new Date(2026, 5, 1) }),
    row({ externalId: 2, personName: "Beta", balancePayable: 200, dueDate: new Date(2026, 6, 15) }),
    row({
      externalId: 3,
      balancePayable: 0,
      amountPaid: 450,
      paymentDate: new Date(2026, 5, 4),
      dueDate: new Date(2026, 4, 1),
    }),
  ];

  it("auditFinanceApDashboardCalculations bate com recálculo independente", () => {
    const result = auditFinanceApDashboardCalculations(fixture, { status: "all", year: 2026 }, REF);
    assert.equal(result.ok, true, result.mismatches.join("; "));
  });

  it("paidThisMonth usa calendário atual — exceção rotulada", () => {
    const ind = computeFinanceApIndependentMetrics(fixture, { status: "all", year: 2026 }, REF);
    assert.equal(ind.paidThisMonthAmount, 450);
    const page = readFileSync(
      join(process.cwd(), "src", "components", "finance", "FinanceAccountsPayablePage.tsx"),
      "utf8"
    );
    assert.ok(page.includes("FINANCE_AP_PAID_THIS_MONTH_SCOPE"));
    assert.ok(FINANCE_AP_PAID_THIS_MONTH_SCOPE.includes("calendário atual"));
  });

  it("UI AP possui resumo executivo e filtros principais visíveis", () => {
    const page = readFileSync(
      join(process.cwd(), "src", "components", "finance", "FinanceAccountsPayablePage.tsx"),
      "utf8"
    );
    assert.ok(page.includes("Resumo executivo"));
    assert.ok(page.includes("alwaysVisible"));
    assert.ok(page.includes("Vence Hoje"));
    assert.ok(page.includes("FINANCE_AP_DEFAULT_YEAR_SCOPE"));
  });
});
