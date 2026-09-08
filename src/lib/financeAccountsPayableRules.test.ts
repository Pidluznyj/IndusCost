import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildFinanceAccountsPayableDashboard,
} from "./financeAccountsPayableDashboard.js";
import {
  buildFinanceCashFlowDashboard,
  type FinanceCashFlowApRow,
} from "./financeCashFlowDashboard.js";
import {
  computeCashFlowLedgerPeriodTotals,
} from "./financeCashFlowLedger.js";
import {
  isFinanceApCancelledTitle,
  normalizeAccountsPayableTitle,
  resolveFinanceApEffectivePaymentDate,
  resolveFinanceApCashRealizedAmount,
  resolveFinanceApOpenAmount,
  resolveFinanceApSettledWithoutCashAmount,
  resolveFinanceApRealizedAmount,
  type FinanceApRulesInput,
} from "./financeAccountsPayableRules.js";

const REF = new Date(2026, 5, 9);

function apInput(overrides: Partial<FinanceApRulesInput> = {}): FinanceApRulesInput {
  return {
    externalId: 1,
    dueDate: new Date(2026, 2, 10),
    paymentDate: null,
    settlementDate: null,
    amountPayable: 1000,
    amountPaid: 0,
    balancePayable: 1000,
    paymentMethodName: "PIX",
    description: null,
    comments: null,
    classification: null,
    suspendPayment: false,
    ...overrides,
  };
}

function cashFlowApRow(overrides: Partial<FinanceCashFlowApRow> = {}): FinanceCashFlowApRow {
  return {
    externalId: 2,
    companyName: "Empresa A",
    personName: "Fornecedor Y",
    personCnpj: "22222222000122",
    description: null,
    dueDate: new Date(2026, 2, 10),
    scheduleDate: null,
    type: null,
    settlementDate: null,
    paymentDate: null,
    competenceDate: new Date(2026, 2, 1),
    amountPayable: 1000,
    amountPaid: 0,
    balancePayable: 1000,
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

describe("financeAccountsPayableRules", () => {
  it("baixa sem numerário usa dueDate como effectivePaymentDate e amountPayable como realizedAmount", () => {
    const normalized = normalizeAccountsPayableTitle(
      apInput({
        balancePayable: 1000,
        amountPaid: 0,
        dueDate: new Date(2026, 2, 10),
        paymentDate: new Date(2026, 5, 15),
        settlementDate: new Date(2026, 5, 15),
        paymentMethodName: "Baixa sem numerário",
      })
    );
    assert.equal(normalized.isOpen, false);
    assert.equal(normalized.openAmount, 0);
    assert.equal(normalized.realizedAmount, 1000);
    assert.equal(normalized.effectivePaymentDate?.toISOString().slice(0, 10), "2026-03-10");
    assert.equal(normalized.settlementKind, "WITHOUT_CASH");
    assert.equal(normalized.isSpecialWriteOff, true);
  });

  it("baixa forçada usa dueDate como effectivePaymentDate", () => {
    const normalized = normalizeAccountsPayableTitle(
      apInput({
        balancePayable: 1000,
        amountPaid: 0,
        dueDate: new Date(2026, 2, 10),
        paymentDate: new Date(2026, 5, 15),
        description: "Baixa forçada",
      })
    );
    assert.equal(normalized.isOpen, false);
    assert.equal(normalized.openAmount, 0);
    assert.equal(normalized.realizedAmount, 1000);
    assert.equal(normalized.effectivePaymentDate?.toISOString().slice(0, 10), "2026-03-10");
    assert.equal(normalized.settlementKind, "FORCED");
  });

  it("título normal pago usa dueDate no dashboard e amountPaid como realizedAmount", () => {
    const normalized = normalizeAccountsPayableTitle(
      apInput({
        amountPayable: 1000,
        amountPaid: 1000,
        balancePayable: 0,
        dueDate: new Date(2026, 2, 10),
        paymentDate: new Date(2026, 3, 5),
        settlementDate: new Date(2026, 3, 5),
      })
    );
    assert.equal(normalized.isOpen, false);
    assert.equal(normalized.openAmount, 0);
    assert.equal(normalized.realizedAmount, 1000);
    assert.equal(normalized.effectiveDashboardDate?.toISOString().slice(0, 10), "2026-03-10");
    assert.equal(normalized.effectivePaymentDate?.toISOString().slice(0, 10), "2026-03-10");
    assert.equal(normalized.originalPaymentDate?.toISOString().slice(0, 10), "2026-04-05");
    assert.equal(normalized.settlementKind, "NORMAL");
  });

  it("título pago com vencimento anterior não infla mês da baixa (cenário A)", () => {
    const normalized = normalizeAccountsPayableTitle(
      apInput({
        amountPayable: 1000,
        amountPaid: 1000,
        balancePayable: 0,
        dueDate: new Date(2025, 11, 10),
        paymentDate: new Date(2026, 5, 15),
        settlementDate: new Date(2026, 5, 15),
      })
    );
    assert.equal(normalized.effectiveDashboardDate?.toISOString().slice(0, 10), "2025-12-10");
    assert.equal(normalized.effectivePaymentDate?.toISOString().slice(0, 10), "2025-12-10");
    assert.equal(normalized.realizedAmount, 1000);
    assert.equal(normalized.isOpen, false);
  });

  it("título pago com baixa em junho aloca no vencimento de março (cenário B)", () => {
    const normalized = normalizeAccountsPayableTitle(
      apInput({
        amountPayable: 2000,
        amountPaid: 2000,
        balancePayable: 0,
        dueDate: new Date(2026, 2, 10),
        paymentDate: new Date(2026, 5, 15),
      })
    );
    assert.equal(normalized.effectivePaymentDate?.toISOString().slice(0, 10), "2026-03-10");
    assert.equal(normalized.realizedAmount, 2000);
  });

  it("título pago com amountPaid zerado usa amountPayable como realizedAmount", () => {
    const normalized = normalizeAccountsPayableTitle(
      apInput({
        amountPayable: 800,
        amountPaid: 0,
        balancePayable: 0,
        dueDate: new Date(2026, 1, 5),
        paymentDate: new Date(2026, 5, 1),
      })
    );
    assert.equal(normalized.isSettled, true);
    assert.equal(normalized.realizedAmount, 800);
    assert.equal(normalized.effectivePaymentDate?.toISOString().slice(0, 10), "2026-02-05");
  });

  it("título em aberto usa dueDate na previsão e mantém openAmount", () => {
    const normalized = normalizeAccountsPayableTitle(
      apInput({
        amountPayable: 1000,
        amountPaid: 0,
        balancePayable: 1000,
        dueDate: new Date(2026, 4, 20),
      })
    );
    assert.equal(normalized.isOpen, true);
    assert.equal(normalized.openAmount, 1000);
    assert.equal(normalized.realizedAmount, 0);
    assert.equal(normalized.effectivePaymentDate, null);
  });

  it("cancelados são excluídos das métricas principais", () => {
    const normalized = normalizeAccountsPayableTitle(
      apInput({
        balancePayable: 1000,
        classification: "CANCELLED",
      })
    );
    assert.equal(normalized.isCancelled, true);
    assert.equal(normalized.isOpen, false);
    assert.equal(normalized.realizedAmount, 0);
    assert.equal(normalized.openAmount, 0);
    assert.equal(isFinanceApCancelledTitle(apInput({ classification: "CANCELADO" })), true);
  });

  it("não retorna NaN/Infinity nos valores saneados", () => {
    const normalized = normalizeAccountsPayableTitle(
      apInput({
        amountPayable: Number.NaN,
        amountPaid: Number.POSITIVE_INFINITY,
        balancePayable: Number.NaN,
      })
    );
    assert.ok(Number.isFinite(normalized.amountPayable));
    assert.ok(Number.isFinite(normalized.amountPaid));
    assert.ok(Number.isFinite(normalized.realizedAmount));
    assert.ok(Number.isFinite(normalized.openAmount));
  });

  it("fluxo financeiro lança título pago normal no vencimento, não na baixa", () => {
    const ap = cashFlowApRow({
      amountPayable: 1000,
      amountPaid: 1000,
      balancePayable: 0,
      dueDate: new Date(2026, 2, 10),
      paymentDate: new Date(2026, 5, 15),
      settlementDate: new Date(2026, 5, 15),
    });
    const payload = buildFinanceCashFlowDashboard(
      [],
      [ap],
      { viewMode: "realized", dateBase: "settlement", status: "all", year: 2026 },
      REF
    );
    const mar = payload.monthlySeries.find((p) => p.month === 3);
    const jun = payload.monthlySeries.find((p) => p.month === 6);
    assert.ok(mar);
    assert.equal(mar!.outflowAmount, 1000);
    assert.equal(jun!.outflowAmount ?? 0, 0);
  });

  it("fluxo financeiro e dashboard AP batem para o mesmo filtro", () => {
    const rows = [
      cashFlowApRow({
        externalId: 10,
        amountPayable: 1000,
        amountPaid: 0,
        balancePayable: 1000,
        dueDate: new Date(2026, 2, 10),
        paymentDate: new Date(2026, 5, 15),
        paymentMethodName: "Baixa sem numerário",
      }),
      cashFlowApRow({
        externalId: 11,
        amountPayable: 500,
        amountPaid: 0,
        balancePayable: 500,
        dueDate: new Date(2026, 5, 20),
      }),
    ];
    const filters = { viewMode: "combined" as const, dateBase: "due" as const, status: "all" as const, year: 2026 };
    const cf = buildFinanceCashFlowDashboard([], rows, filters, REF);
    const apDash = buildFinanceAccountsPayableDashboard(rows, { status: "all" }, REF);
    const realizedLedger = computeCashFlowLedgerPeriodTotals(
      [],
      rows,
      { ...filters, viewMode: "realized" },
      REF
    );

    assert.equal(cf.cards.totalPayableOpen, apDash.cards.totalOpenAmount);
    // AP_SETTLED: a baixa sem numerário encerra o título (realizado gerencial 1000, aberto 0)…
    assert.equal(resolveFinanceApRealizedAmount(rows[0]), 1000);
    assert.equal(resolveFinanceApOpenAmount(rows[0]), 0);
    // …mas AP_CASH_REALIZED é 0: o Fluxo de Caixa não a apresenta como saída de caixa.
    assert.equal(resolveFinanceApCashRealizedAmount(rows[0]), 0);
    assert.equal(realizedLedger.outflow, resolveFinanceApCashRealizedAmount(rows[0]));
    assert.equal(realizedLedger.outflow, 0);
    assert.equal(resolveFinanceApOpenAmount(rows[1]), 500);
  });

  it("YTD AP usa realizedAmount e openAmount saneados", () => {
    const row = cashFlowApRow({
      amountPayable: 1000,
      amountPaid: 0,
      balancePayable: 1000,
      dueDate: new Date(2026, 2, 10),
      paymentDate: new Date(2026, 5, 15),
      paymentMethodName: "Baixada sem numerário",
    });
    assert.equal(resolveFinanceApRealizedAmount(row), 1000);
    assert.equal(resolveFinanceApOpenAmount(row), 0);
    assert.equal(
      resolveFinanceApEffectivePaymentDate(row)?.toISOString().slice(0, 10),
      "2026-03-10"
    );
  });

  it("AP externo entra no dashboard com empresa pagadora do grupo", () => {
    const rows = [
      cashFlowApRow({
        companyName: "KOPPETEL",
        personName: "Fornecedor Externo SA",
        personCnpj: "11.111.111/0001-11",
        balancePayable: 1200,
        dueDate: new Date(2026, 5, 10),
      }),
    ];
    const dash = buildFinanceAccountsPayableDashboard(rows, { status: "all", year: 2026 }, REF);
    assert.equal(dash.cards.totalOpenAmount, 1200);
  });

  it("AP intercompany entre empresas do grupo sai do dashboard", () => {
    const rows = [
      cashFlowApRow({
        companyName: "KOPPETEL",
        personName: "Lazarios Comercio de Plasticos LTDA",
        personCnpj: "72.569.510/0001-95",
        balancePayable: 900,
        dueDate: new Date(2026, 5, 10),
      }),
      cashFlowApRow({
        companyName: "KOPPETEL",
        personName: "Fornecedor Externo",
        personCnpj: "22.222.222/0001-22",
        balancePayable: 100,
        dueDate: new Date(2026, 5, 12),
      }),
    ];
    const dash = buildFinanceAccountsPayableDashboard(rows, { status: "all", year: 2026 }, REF);
    assert.equal(dash.cards.totalOpenAmount, 100);
    assert.equal(dash.dataSanitization.ignoredInternalGroupPayables, 1);
  });

  it("pedido de compra continua excluído da visão gerencial", () => {
    const rows = [
      cashFlowApRow({
        companyName: "KOPPETEL",
        description: "PEDIDO DE COMPRA 999",
        balancePayable: 500,
        dueDate: new Date(2026, 5, 10),
      }),
    ];
    const dash = buildFinanceAccountsPayableDashboard(rows, { status: "all", year: 2026 }, REF);
    assert.equal(dash.cards.openTitlesCount, 0);
    assert.equal(dash.dataSanitization.ignoredPurchaseOrderAgendaPayables, 1);
  });
});

describe("AP_SETTLED × AP_CASH_REALIZED — caixa só com evidência (amountPaid informado)", () => {
  const settledZero = (extra: Record<string, unknown> = {}) =>
    apInput({ amountPayable: 100, amountPaid: 0, balancePayable: 0, dueDate: new Date(2026, 2, 10), settlementDate: new Date(2026, 2, 12), ...extra });

  it("TESTE 12 — WITHOUT_CASH: settled 100, cashRealized 0, open 0 (não reaparece em aberto)", () => {
    const n = normalizeAccountsPayableTitle(settledZero({ balancePayable: 100, paymentMethodName: "Baixa sem numerário" }));
    assert.equal(n.settlementKind, "WITHOUT_CASH");
    assert.equal(n.isSettled, true);
    assert.equal(n.realizedAmount, 100);
    assert.equal(n.cashRealizedAmount, 0);
    assert.equal(n.openAmount, 0);
    assert.equal(resolveFinanceApSettledWithoutCashAmount(settledZero({ balancePayable: 100, paymentMethodName: "Baixa sem numerário" })), 100);
  });

  it("TESTE 13 — baixa normal com amountPaid = 100 → cashRealized 100", () => {
    const row = apInput({ amountPayable: 100, amountPaid: 100, balancePayable: 0, dueDate: new Date(2026, 2, 10), paymentDate: new Date(2026, 2, 10) });
    assert.equal(resolveFinanceApRealizedAmount(row), 100);
    assert.equal(resolveFinanceApCashRealizedAmount(row), 100);
    assert.equal(resolveFinanceApSettledWithoutCashAmount(row), 0);
  });

  it("TESTE 14 — parcial: amountPaid 40, saldo 60 → cashRealized 40, open 60; os 60 não viram realizado", () => {
    const row = apInput({ amountPayable: 100, amountPaid: 40, balancePayable: 60, dueDate: new Date(2026, 2, 10) });
    assert.equal(resolveFinanceApCashRealizedAmount(row), 40);
    assert.equal(resolveFinanceApRealizedAmount(row), 40);
    assert.equal(resolveFinanceApOpenAmount(row), 60);
  });

  it("TESTE 15 — invariante de segurança: settled com amountPaid = 0 NÃO vira caixa de 100", () => {
    const row = settledZero();
    const n = normalizeAccountsPayableTitle(row);
    assert.equal(n.isSettled, true);
    assert.equal(n.realizedAmount, 100, "AP_SETTLED mantém a inferência gerencial documentada");
    assert.equal(n.cashRealizedAmount, 0, "AP_CASH_REALIZED nunca infere amountPayable");
    assert.equal(resolveFinanceApSettledWithoutCashAmount(row), 100);
  });

  it("TESTE 16 — FORCED: caixa só até o amountPaid comprovado (0 → 0; 30 → 30), nunca amountPayable", () => {
    const zero = settledZero({ balancePayable: 100, description: "Baixa forçada" });
    assert.equal(normalizeAccountsPayableTitle(zero).settlementKind, "FORCED");
    assert.equal(resolveFinanceApRealizedAmount(zero), 100);
    assert.equal(resolveFinanceApCashRealizedAmount(zero), 0);
    const partial = settledZero({ amountPaid: 30, balancePayable: 70, description: "Baixa forçada" });
    assert.equal(resolveFinanceApCashRealizedAmount(partial), 30);
    assert.ok(resolveFinanceApCashRealizedAmount(partial) <= 30);
  });

  it("cancelado: settled 0, cashRealized 0, open 0", () => {
    const row = settledZero({ amountPaid: 100, description: "Titulo cancelado" });
    assert.equal(resolveFinanceApRealizedAmount(row), 0);
    assert.equal(resolveFinanceApCashRealizedAmount(row), 0);
    assert.equal(resolveFinanceApOpenAmount(row), 0);
  });

  it("invariante: cashRealized ≤ amountPaid e cashRealized ≤ realized para qualquer título", () => {
    const samples = [
      settledZero(),
      settledZero({ amountPaid: 100 }),
      settledZero({ amountPaid: 25, balancePayable: 75 }),
      settledZero({ balancePayable: 100, paymentMethodName: "Baixa sem numerário" }),
      settledZero({ balancePayable: 100, description: "Baixa forçada", amountPaid: 10 }),
    ];
    for (const row of samples) {
      const n = normalizeAccountsPayableTitle(row);
      assert.ok(n.cashRealizedAmount <= n.amountPaid + 0.005);
      assert.ok(n.cashRealizedAmount <= n.realizedAmount + 0.005);
    }
  });
});
