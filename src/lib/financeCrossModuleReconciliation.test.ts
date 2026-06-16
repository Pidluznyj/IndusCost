import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { FinanceApDashboardRow } from "./financeAccountsPayableDashboard.js";
import type { FinanceArDashboardRow } from "./financeAccountsReceivableDashboard.js";
import { reconcileFinanceModulesFromCashFlowFilters } from "./financeCrossModuleReconciliation.js";

const REF = new Date(2026, 5, 9);

function arRow(overrides: Partial<FinanceArDashboardRow> = {}): FinanceArDashboardRow {
  return {
    externalId: 1,
    companyName: "Empresa A",
    personName: "Cliente X",
    personCnpj: "11111111000111",
    description: null,
    dueDate: new Date(2026, 5, 15),
    settlementDate: null,
    amountReceivable: 1000,
    amountReceived: 0,
    balanceReceivable: 1000,
    paymentMethodName: "Boleto",
    bankAccountName: "Conta 1",
    sourceInvoiceId: null,
    sourceInvoiceNumber: null,
    suspendCollection: false,
    nomusStatus: true,
    syncedAt: new Date(2026, 5, 8),
    ...overrides,
  };
}

function apRow(overrides: Partial<FinanceApDashboardRow> = {}): FinanceApDashboardRow {
  return {
    externalId: 2,
    companyName: "Empresa A",
    personName: "Fornecedor Y",
    personCnpj: "22222222000122",
    description: null,
    dueDate: new Date(2026, 5, 20),
    scheduleDate: null,
    type: null,
    settlementDate: null,
    paymentDate: null,
    amountPayable: 500,
    amountPaid: 0,
    balancePayable: 500,
    paymentMethodName: "PIX",
    bankAccountName: "Conta 2",
    sourceInvoiceId: null,
    documentNumber: "DOC-1",
    suspendPayment: false,
    nomusStatus: true,
    syncedAt: new Date(2026, 5, 8),
    ...overrides,
  };
}

describe("financeCrossModuleReconciliation", () => {
  it("previsto: AR em aberto = entradas do fluxo", () => {
    const rec = reconcileFinanceModulesFromCashFlowFilters(
      [arRow({ balanceReceivable: 100_000, dueDate: new Date(2026, 0, 10) })],
      [apRow({ balancePayable: 80_000, dueDate: new Date(2026, 0, 12) })],
      { viewMode: "projected", dateBase: "due", status: "all", year: 2026 },
      REF
    );
    assert.equal(rec.status, "OK");
    assert.equal(rec.ar.totalOpenAmount, 100_000);
    assert.equal(rec.ap.totalOpenAmount, 80_000);
    assert.equal(rec.cashFlow.inflowAmount, 100_000);
    assert.equal(rec.cashFlow.outflowAmount, 80_000);
    assert.equal(rec.cashFlow.netFlowAmount, 20_000);
    assert.equal(rec.matches.projectedInflowVsArOpen, true);
    assert.equal(rec.matches.projectedOutflowVsApOpen, true);
  });

  it("realizado: recebido/pago por liquidação bate com fluxo", () => {
    const rec = reconcileFinanceModulesFromCashFlowFilters(
      [
        arRow({
          balanceReceivable: 0,
          amountReceived: 40_000,
          settlementDate: new Date(2026, 1, 8),
        }),
      ],
      [
        apRow({
          balancePayable: 0,
          amountPaid: 25_000,
          dueDate: new Date(2026, 1, 10),
          paymentDate: new Date(2026, 1, 10),
        }),
      ],
      { viewMode: "realized", dateBase: "settlement", status: "all", year: 2026, month: 2 },
      REF
    );
    assert.equal(rec.status, "OK");
    assert.equal(rec.ar.realizedInPeriod, 40_000);
    assert.equal(rec.ap.realizedInPeriod, 25_000);
    assert.equal(rec.cashFlow.inflowAmount, 40_000);
    assert.equal(rec.cashFlow.outflowAmount, 25_000);
    assert.equal(rec.matches.realizedInflowVsAr, true);
    assert.equal(rec.matches.realizedOutflowVsAp, true);
  });

  it("origem Com NF afeta somente AR/entradas", () => {
    const rec = reconcileFinanceModulesFromCashFlowFilters(
      [
        arRow({
          externalId: 10,
          sourceInvoiceId: 1,
          balanceReceivable: 300,
          dueDate: new Date(2026, 3, 1),
        }),
        arRow({
          externalId: 11,
          balanceReceivable: 700,
          dueDate: new Date(2026, 3, 2),
        }),
      ],
      [apRow()],
      {
        viewMode: "projected",
        dateBase: "due",
        status: "all",
        year: 2026,
        month: 4,
        invoiceIssued: "yes",
      },
      REF
    );
    assert.equal(rec.ar.totalOpenAmount, 300);
    assert.equal(rec.cashFlow.inflowAmount, 300);
    assert.equal(rec.status, "OK");
  });

  it("deduplicação: Tudo não soma sem NF substituído por Com NF", () => {
    const rec = reconcileFinanceModulesFromCashFlowFilters(
      [
        arRow({
          externalId: 20,
          balanceReceivable: 2000,
          dueDate: new Date(2026, 4, 5),
        }),
        arRow({
          externalId: 21,
          sourceInvoiceId: 50,
          balanceReceivable: 2000,
          dueDate: new Date(2026, 4, 5),
        }),
      ],
      [],
      { viewMode: "projected", dateBase: "due", status: "all", year: 2026, month: 5 },
      REF
    );
    assert.equal(rec.ar.totalOpenAmount, 2000);
    assert.equal(rec.cashFlow.inflowAmount, 2000);
    assert.equal(rec.status, "OK");
  });
});
