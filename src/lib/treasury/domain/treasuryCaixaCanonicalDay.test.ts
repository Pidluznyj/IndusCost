/**
 * Regressão — motor único-de-dia canônico da Caixa.
 *
 * Trava as invariantes que a inconsistência anterior violava:
 *   Σ títulos da dimensão == total da dimensão do dia
 *   Σ dias == totais mensais/período
 *   dimensões disjuntas (título aberto vs baixado no mesmo dia)
 *   dado ausente ≠ zero silencioso
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { FinanceAccountsPayableGridRow } from "@/src/lib/financeAccountsPayableRulesEngine.js";
import type { FinanceAccountsReceivableGridRow } from "@/src/lib/financeAccountsReceivableRulesEngine.js";
import {
  aggregateTreasuryCaixaCanonicalDaysByMonth,
  buildTreasuryCaixaCanonicalDays,
  findTreasuryCaixaCanonicalDay,
} from "./treasuryCaixaCanonicalDay.js";

function ar(
  overrides: Partial<FinanceAccountsReceivableGridRow>
): FinanceAccountsReceivableGridRow {
  return {
    externalId: 1,
    companyName: null,
    personName: "Cliente",
    personCnpj: null,
    dueDate: null,
    settlementDate: null,
    amountReceivable: 0,
    amountReceived: 0,
    balanceReceivable: 0,
    hasSourceInvoice: false,
    calculatedStatus: "open",
    daysOverdue: 0,
    paymentMethodName: null,
    bankAccountName: null,
    sourceInvoiceId: null,
    sourceInvoiceNumber: null,
    suspendCollection: false,
    ...overrides,
  };
}

function ap(
  overrides: Partial<FinanceAccountsPayableGridRow>
): FinanceAccountsPayableGridRow {
  return {
    externalId: 1,
    companyName: null,
    personName: "Fornecedor",
    personCnpj: null,
    dueDate: null,
    operationalDueDate: null,
    paymentDate: null,
    amountPayable: 0,
    amountPaid: 0,
    balancePayable: 0,
    calculatedStatus: "open",
    daysOverdue: 0,
    paymentMethodName: null,
    bankAccountName: null,
    documentNumber: null,
    suspendPayment: false,
    isRescheduled: false,
    ...overrides,
  };
}

describe("buildTreasuryCaixaCanonicalDays — invariantes de conciliação", () => {
  it("Σ receivableDueTitles == receivableDue por dia", () => {
    const days = buildTreasuryCaixaCanonicalDays({
      civilDatesInWindow: ["2026-08-04", "2026-08-05"],
      receivables: [
        ar({ externalId: 1, dueDate: "2026-08-04", balanceReceivable: 1000 }),
        ar({ externalId: 2, dueDate: "2026-08-04", balanceReceivable: 500 }),
        ar({ externalId: 3, dueDate: "2026-08-05", balanceReceivable: 200 }),
      ],
      payables: [],
    });
    const day04 = findTreasuryCaixaCanonicalDay(days, "2026-08-04")!;
    const sum04 = day04.receivableDueTitles.reduce(
      (s, t) => s + t.balanceReceivable,
      0
    );
    assert.equal(day04.receivableDue, 1500);
    assert.equal(sum04, 1500);
    assert.equal(day04.receivableDueTitles.length, 2);
  });

  it("Σ payablePaidTitles == payablePaid por dia (respeitando fallback paymentDate→dueDate)", () => {
    const days = buildTreasuryCaixaCanonicalDays({
      civilDatesInWindow: ["2026-08-04"],
      receivables: [],
      payables: [
        // Nomus preencheu paymentDate — conta em 04
        ap({
          externalId: 10,
          dueDate: "2026-08-01",
          paymentDate: "2026-08-04",
          amountPaid: 700,
        }),
        // Nomus NÃO preencheu paymentDate mas foi pago — fallback pelo dueDate
        ap({
          externalId: 11,
          dueDate: "2026-08-04",
          paymentDate: null,
          amountPaid: 300,
        }),
      ],
    });
    const day = findTreasuryCaixaCanonicalDay(days, "2026-08-04")!;
    assert.equal(day.payablePaid, 1000);
    const sum = day.payablePaidTitles.reduce((s, t) => s + t.amountPaid, 0);
    assert.equal(sum, 1000);
    assert.equal(day.payablePaidTitles.length, 2);
  });

  it("dimensões AR são DISJUNTAS: título só entra em Due OU em Received no dia", () => {
    // Título com dueDate=04, baixado em 04 (balance=0 → não está aberto)
    const days = buildTreasuryCaixaCanonicalDays({
      civilDatesInWindow: ["2026-08-04"],
      receivables: [
        ar({
          externalId: 20,
          dueDate: "2026-08-04",
          settlementDate: "2026-08-04",
          amountReceivable: 500,
          amountReceived: 500,
          balanceReceivable: 0,
        }),
      ],
      payables: [],
    });
    const day = findTreasuryCaixaCanonicalDay(days, "2026-08-04")!;
    assert.equal(day.receivableDue, 0, "baixado hoje → sai do 'a receber'");
    assert.equal(day.receivableDueTitles.length, 0);
    assert.equal(day.receivableReceived, 500);
    assert.equal(day.receivableReceivedTitles.length, 1);
  });

  it("título parcialmente baixado entra nas DUAS dimensões — o valor certo em cada uma", () => {
    // Parcial: recebeu 300 hoje, ainda deve 700 vencendo hoje. Aparece em
    // Received (300) e em Due (700). São o MESMO título mas em fatos distintos.
    const days = buildTreasuryCaixaCanonicalDays({
      civilDatesInWindow: ["2026-08-04"],
      receivables: [
        ar({
          externalId: 21,
          dueDate: "2026-08-04",
          settlementDate: "2026-08-04",
          amountReceivable: 1000,
          amountReceived: 300,
          balanceReceivable: 700,
        }),
      ],
      payables: [],
    });
    const day = findTreasuryCaixaCanonicalDay(days, "2026-08-04")!;
    assert.equal(day.receivableReceived, 300);
    assert.equal(day.receivableDue, 700);
    assert.equal(day.receivableReceivedTitles[0]?.amountReceived, 300);
    assert.equal(day.receivableDueTitles[0]?.balanceReceivable, 700);
  });

  it("CP suspenso não entra no fluxo (Ledger zera) — mas pago suspenso continua fato realizado", () => {
    const days = buildTreasuryCaixaCanonicalDays({
      civilDatesInWindow: ["2026-08-04"],
      receivables: [
        ar({
          externalId: 30,
          dueDate: "2026-08-04",
          balanceReceivable: 500,
          suspendCollection: true,
        }),
      ],
      payables: [
        ap({
          externalId: 31,
          dueDate: "2026-08-04",
          balancePayable: 800,
          suspendPayment: true,
        }),
        ap({
          externalId: 32,
          dueDate: "2026-08-04",
          paymentDate: "2026-08-04",
          amountPaid: 400,
        }),
      ],
    });
    const day = findTreasuryCaixaCanonicalDay(days, "2026-08-04")!;
    assert.equal(day.receivableDue, 0);
    assert.equal(day.payableDue, 0);
    assert.equal(day.payablePaid, 400);
  });

  it("dia fora da janela não aparece — mesmo com movimento", () => {
    const days = buildTreasuryCaixaCanonicalDays({
      civilDatesInWindow: ["2026-08-04"],
      receivables: [
        ar({ dueDate: "2026-08-05", balanceReceivable: 999 }),
      ],
      payables: [],
    });
    assert.equal(findTreasuryCaixaCanonicalDay(days, "2026-08-05"), null);
    const day = findTreasuryCaixaCanonicalDay(days, "2026-08-04")!;
    assert.equal(day.receivableDue, 0);
    assert.equal(day.receivableDueTitles.length, 0);
  });

  it("dia sem título retorna 0.00 com listas vazias (não vira 'sem dado')", () => {
    const days = buildTreasuryCaixaCanonicalDays({
      civilDatesInWindow: ["2026-08-04"],
      receivables: [],
      payables: [],
    });
    const day = findTreasuryCaixaCanonicalDay(days, "2026-08-04")!;
    assert.equal(day.receivableDue, 0);
    assert.equal(day.payableDue, 0);
    assert.equal(day.receivableDueTitles.length, 0);
    assert.equal(day.payableDueTitles.length, 0);
  });

  it("outros movimentos (ledger/transfer) entram na dimensão própria, nunca no CR/CP", () => {
    const otherMap = new Map([
      [
        "2026-08-04",
        [
          { origin: "LEDGER" as const, direction: "OUT" as const, amount: 150 },
          {
            origin: "TRANSFER" as const,
            direction: "IN" as const,
            amount: 90,
          },
        ],
      ],
    ]);
    const days = buildTreasuryCaixaCanonicalDays({
      civilDatesInWindow: ["2026-08-04"],
      receivables: [],
      payables: [
        ap({
          externalId: 40,
          dueDate: "2026-08-04",
          paymentDate: "2026-08-04",
          amountPaid: 500,
        }),
      ],
      otherMovementsByCivilDate: otherMap,
    });
    const day = findTreasuryCaixaCanonicalDay(days, "2026-08-04")!;
    assert.equal(day.payablePaid, 500, "CP baixado permanece em payablePaid");
    assert.equal(day.otherInflows, 90);
    assert.equal(day.otherOutflows, 150);
    assert.equal(day.otherMovements.length, 2);
  });

  it("Σ dias == totais mensais por dimensão", () => {
    const days = buildTreasuryCaixaCanonicalDays({
      civilDatesInWindow: [
        "2026-08-04",
        "2026-08-05",
        "2026-09-01",
      ],
      receivables: [
        ar({ externalId: 1, dueDate: "2026-08-04", balanceReceivable: 100 }),
        ar({ externalId: 2, dueDate: "2026-08-05", balanceReceivable: 250 }),
        ar({ externalId: 3, dueDate: "2026-09-01", balanceReceivable: 400 }),
      ],
      payables: [
        ap({ externalId: 10, dueDate: "2026-08-04", balancePayable: 60 }),
        ap({ externalId: 11, dueDate: "2026-09-01", balancePayable: 300 }),
      ],
    });
    const months = aggregateTreasuryCaixaCanonicalDaysByMonth(days);
    const ago = months.find((m) => m.monthKey === "2026-08")!;
    const set = months.find((m) => m.monthKey === "2026-09")!;
    assert.equal(ago.receivableDue, 350);
    assert.equal(ago.payableDue, 60);
    assert.equal(set.receivableDue, 400);
    assert.equal(set.payableDue, 300);
  });
});
