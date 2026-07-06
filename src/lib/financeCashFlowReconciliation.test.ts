import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildFinanceCashFlowDashboard,
  type FinanceCashFlowApRow,
  type FinanceCashFlowArRow,
} from "./financeCashFlowDashboard.js";
import {
  buildCashFlowReconciliation,
  computeCashFlowLedgerPeriodTotals,
  computeCashFlowOpenPortfolioTotals,
} from "./financeCashFlowLedger.js";

const REF = new Date(2026, 5, 9);

function arRow(overrides: Partial<FinanceCashFlowArRow> = {}): FinanceCashFlowArRow {
  return {
    externalId: 1,
    companyName: "Empresa A",
    personName: "Cliente X",
    personCnpj: "11111111000111",
    description: null,
    dueDate: new Date(2026, 5, 15),
    settlementDate: null,
    competenceDate: new Date(2026, 5, 1),
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

function apRow(overrides: Partial<FinanceCashFlowApRow> = {}): FinanceCashFlowApRow {
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
    competenceDate: new Date(2026, 5, 2),
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

describe("financeCashFlowReconciliation", () => {
  it("Receber 100.000 e Pagar 80.000 → saldo +20.000", () => {
    const ar = arRow({
      balanceReceivable: 100_000,
      amountReceivable: 100_000,
      dueDate: new Date(2026, 0, 10),
      sourceInvoiceId: 1,
      sourceInvoiceNumber: "NF-100",
    });
    const ap = apRow({
      balancePayable: 80_000,
      amountPayable: 80_000,
      dueDate: new Date(2026, 0, 12),
    });
    const filters = { viewMode: "projected" as const, dateBase: "due" as const, status: "all" as const, year: 2026 };
    const ledger = computeCashFlowLedgerPeriodTotals([ar], [ap], filters, REF);
    assert.equal(ledger.inflow, 100_000);
    assert.equal(ledger.outflow, 80_000);
    assert.equal(ledger.net, 20_000);

    const payload = buildFinanceCashFlowDashboard([ar], [ap], filters, REF);
    assert.equal(payload.cards.inflowAmount, 100_000);
    assert.equal(payload.cards.outflowAmount, 80_000);
    assert.equal(payload.cards.netFlowAmount, 20_000);
    assert.equal(payload.reconciliation.netCashFlow, 20_000);
    assert.equal(payload.reconciliation.receivable.matchesLedger, true);
    assert.equal(payload.reconciliation.payable.matchesLedger, true);
    assert.equal(payload.reconciliation.netMatchesLedger, true);
  });

  it("Receber 100.000 e Pagar 130.000 → saldo -30.000", () => {
    const ar = arRow({
      balanceReceivable: 100_000,
      dueDate: new Date(2026, 1, 5),
      sourceInvoiceId: 1,
      sourceInvoiceNumber: "NF-101",
    });
    const ap = apRow({
      balancePayable: 130_000,
      dueDate: new Date(2026, 1, 8),
    });
    const filters = { viewMode: "projected" as const, dateBase: "due" as const, status: "all" as const, year: 2026, month: 2 };
    const payload = buildFinanceCashFlowDashboard([ar], [ap], filters, REF);
    assert.equal(payload.cards.netFlowAmount, -30_000);
    assert.equal(payload.reconciliation.netCashFlow, -30_000);
  });

  it("modo realizado aloca AR pelo vencimento (dueDate)", () => {
    const payload = buildFinanceCashFlowDashboard(
      [
        arRow({
          balanceReceivable: 0,
          amountReceived: 5000,
          dueDate: new Date(2026, 2, 20),
          settlementDate: new Date(2026, 1, 10),
          sourceInvoiceId: 1,
          sourceInvoiceNumber: "NF-102",
        }),
      ],
      [],
      { viewMode: "realized", dateBase: "due", status: "all", year: 2026 },
      REF
    );
    const fev = payload.monthlySeries.find((p) => p.month === 2);
    const mar = payload.monthlySeries.find((p) => p.month === 3);
    assert.equal(fev?.inflowAmount ?? 0, 0);
    assert.equal(mar?.inflowAmount, 5000);
  });

  it("origem Com NF afeta somente entradas AR", () => {
    const withNf = arRow({
      externalId: 10,
      balanceReceivable: 400,
      dueDate: new Date(2026, 3, 1),
      sourceInvoiceId: 99,
    });
    const withoutNf = arRow({
      externalId: 11,
      balanceReceivable: 600,
      dueDate: new Date(2026, 3, 2),
      sourceInvoiceId: null,
    });
    const filters = {
      viewMode: "projected" as const,
      dateBase: "due" as const,
      status: "all" as const,
      year: 2026,
      month: 4,
      invoiceIssued: "yes" as const,
    };
    const payload = buildFinanceCashFlowDashboard([withNf, withoutNf], [apRow()], filters, REF);
    assert.equal(payload.cards.inflowAmount, 400);
    assert.equal(payload.reconciliation.receivable.cashFlowInflow, 400);
  });

  it("carteira aberta bate entre fluxo e AR/AP", () => {
    const ar = arRow({ balanceReceivable: 2500 });
    const ap = apRow({ balancePayable: 900 });
    const portfolio = computeCashFlowOpenPortfolioTotals([ar], [ap]);
    const rec = buildCashFlowReconciliation(
      { viewMode: "projected", dateBase: "due", status: "all", year: 2026 },
      {
        inflowAmount: 0,
        outflowAmount: 0,
        netFlowAmount: 0,
        totalReceivableOpen: portfolio.receivableOpen,
        totalPayableOpen: portfolio.payableOpen,
      },
      { inflow: 0, outflow: 0, net: 0, inflowCount: 0, outflowCount: 0 },
      portfolio,
      {
        arDashboardOpenPortfolio: 2500,
        arDashboardOpenPeriod: 2500,
        apDashboardOpenPortfolio: 900,
        apDashboardOpenPeriod: 900,
        arDashboardReceived: 0,
        apDashboardPaid: 0,
      }
    );
    assert.equal(rec.receivable.matchesArOpen, true);
    assert.equal(rec.payable.matchesApOpen, true);
  });

  it("modo combinado soma previsto e realizado sem duplicar título fechado", () => {
    const openAr = arRow({
      externalId: 20,
      balanceReceivable: 300,
      dueDate: new Date(2026, 4, 1),
      sourceInvoiceId: 1,
      sourceInvoiceNumber: "NF-200",
    });
    const settledAr = arRow({
      externalId: 21,
      balanceReceivable: 0,
      amountReceived: 200,
      settlementDate: new Date(2026, 4, 5),
      dueDate: new Date(2026, 4, 10),
      sourceInvoiceId: 2,
      sourceInvoiceNumber: "NF-201",
    });
    const payload = buildFinanceCashFlowDashboard(
      [openAr, settledAr],
      [],
      { viewMode: "combined", dateBase: "due", status: "all", year: 2026, month: 5 },
      REF
    );
    assert.equal(payload.cards.inflowAmount, 500);
    assert.equal(payload.reconciliation.receivable.matchesLedger, true);
  });
});
