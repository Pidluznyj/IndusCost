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
import { FINANCE_SETTLEMENT_RECONCILIATION_DEFAULTS } from "@/src/lib/finance/financeSettlementReconciliation.js";
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
    settlementDate: null,
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

  it("realizedInflows/Outflows = baixados + outros; projectedInflows/Outflows = vencendo em aberto", () => {
    const days = buildTreasuryCaixaCanonicalDays({
      civilDatesInWindow: ["2026-08-04"],
      receivables: [
        ar({ externalId: 1, dueDate: "2026-08-04", balanceReceivable: 500 }),
        ar({
          externalId: 2,
          settlementDate: "2026-08-04",
          amountReceived: 200,
        }),
      ],
      payables: [
        ap({ externalId: 3, dueDate: "2026-08-04", balancePayable: 300 }),
        ap({
          externalId: 4,
          dueDate: "2026-08-01",
          paymentDate: "2026-08-04",
          amountPaid: 150,
        }),
      ],
      otherMovementsByCivilDate: new Map([
        [
          "2026-08-04",
          [
            { origin: "LEDGER", direction: "IN", amount: 40 },
            { origin: "TRANSFER", direction: "OUT", amount: 25 },
          ],
        ],
      ]),
    });
    const d = findTreasuryCaixaCanonicalDay(days, "2026-08-04")!;
    // realized = baixados + outros
    assert.equal(d.realizedInflows, 240, "200 recebido + 40 outros");
    assert.equal(d.realizedOutflows, 175, "150 pago + 25 outros");
    // projected = títulos em aberto vencendo hoje
    assert.equal(d.projectedInflows, 500);
    assert.equal(d.projectedOutflows, 300);
  });

  it("openingBalance encadeia dia a dia; closingRealized é o próximo opening", () => {
    const days = buildTreasuryCaixaCanonicalDays({
      civilDatesInWindow: ["2026-08-04", "2026-08-05", "2026-08-06"],
      receivables: [
        // Recebido em 04: 500; recebido em 05: 200
        ar({ settlementDate: "2026-08-04", amountReceived: 500 }),
        ar({ settlementDate: "2026-08-05", amountReceived: 200 }),
      ],
      payables: [
        // Pago em 05: 100
        ap({ dueDate: "2026-08-05", paymentDate: "2026-08-05", amountPaid: 100 }),
      ],
      openingBalanceOfFirstDay: 1000,
    });
    const [d04, d05, d06] = days;
    assert.equal(d04!.openingBalance, 1000);
    assert.equal(d04!.closingRealizedBalance, 1500, "1000 + 500");
    assert.equal(d05!.openingBalance, 1500, "opening = realized do dia anterior");
    assert.equal(d05!.closingRealizedBalance, 1600, "1500 + 200 − 100");
    assert.equal(d06!.openingBalance, 1600);
    // Sem movimento, realized fecha no que abriu.
    assert.equal(d06!.closingRealizedBalance, 1600);
  });

  it("closingProjectedBalance inclui vencendo em aberto SEM propagar na cadeia", () => {
    const days = buildTreasuryCaixaCanonicalDays({
      civilDatesInWindow: ["2026-08-04", "2026-08-05"],
      receivables: [
        // Em aberto vencendo em 04, valor 700 — NÃO baixado
        ar({ dueDate: "2026-08-04", balanceReceivable: 700 }),
      ],
      payables: [
        // Em aberto vencendo em 05, valor 200
        ap({ dueDate: "2026-08-05", balancePayable: 200 }),
      ],
      openingBalanceOfFirstDay: 100,
    });
    const [d04, d05] = days;
    // Realizado NÃO muda pelo projetado.
    assert.equal(d04!.closingRealizedBalance, 100);
    // Projetado = opening + realized + projected(in) − realized − projected(out)
    assert.equal(d04!.closingProjectedBalance, 800, "100 + 700");
    // Encadeia pelo realizado — opening de 05 = 100, não 800.
    assert.equal(d05!.openingBalance, 100);
    assert.equal(d05!.closingProjectedBalance, -100, "100 − 200 projetado");
  });

  it("sem openingBalanceOfFirstDay: opening/closings ficam null e emite warning NO_OPENING_BALANCE", () => {
    const days = buildTreasuryCaixaCanonicalDays({
      civilDatesInWindow: ["2026-08-04"],
      receivables: [
        ar({ settlementDate: "2026-08-04", amountReceived: 999 }),
      ],
      payables: [],
    });
    const d = findTreasuryCaixaCanonicalDay(days, "2026-08-04")!;
    assert.equal(d.openingBalance, null);
    assert.equal(d.closingRealizedBalance, null);
    assert.equal(d.closingProjectedBalance, null);
    // O fato elementar continua fato — só o SALDO fica indisponível.
    assert.equal(d.realizedInflows, 999);
    const codes = d.warnings.map((w) => w.code);
    assert.ok(codes.includes("NO_OPENING_BALANCE"));
  });

  it("otherMovementsLoadStatus='not_loaded' emite warning em cada dia sem inventar zero", () => {
    const days = buildTreasuryCaixaCanonicalDays({
      civilDatesInWindow: ["2026-08-04", "2026-08-05"],
      receivables: [],
      payables: [],
      otherMovementsLoadStatus: "not_loaded",
    });
    for (const d of days) {
      // Ausência de outros movimentos NÃO vira zero no fato: outros* continua
      // 0 (nenhum foi entregue), mas o warning avisa que a fonte não rodou.
      assert.equal(d.otherInflows, 0);
      assert.equal(d.otherOutflows, 0);
      const codes = d.warnings.map((w) => w.code);
      assert.ok(codes.includes("OTHER_MOVEMENTS_NOT_LOADED"));
    }
  });

  it("âncora oficial de saldo re-ancora a cadeia no dia da âncora e propaga para frente", () => {
    // opening 0 na gênese, cadeia acumularia -700 até 05/08 (só saída).
    // Mas a âncora em 05/08 informa R$ 416.945 — a cadeia se re-ancora.
    const days = buildTreasuryCaixaCanonicalDays({
      civilDatesInWindow: ["2026-08-04", "2026-08-05", "2026-08-06"],
      receivables: [],
      payables: [
        ap({
          externalId: 1,
          dueDate: "2026-08-04",
          paymentDate: "2026-08-04",
          amountPaid: 700,
        }),
        ap({ externalId: 2, dueDate: "2026-08-06", balancePayable: 200 }),
      ],
      openingBalanceOfFirstDay: 0,
      officialTodayBalance: {
        civilDate: "2026-08-05",
        amount: 416945,
        sourceLabel: "Rotina 'Saldos do Dia' de 05/08/2026",
        strength: "STRONG",
      },
    });
    const [d04, d05, d06] = days;
    // 04: cadeia normal — opening 0, saiu 700 → -700
    assert.equal(d04!.closingRealizedBalance, -700);
    // 05: RE-ANCORA — closing realizado = valor da âncora
    assert.equal(d05!.closingRealizedBalance, 416945);
    // 06: opening = closing de 05 (416945), sem movimento realizado → 416945
    assert.equal(d06!.openingBalance, 416945);
    assert.equal(d06!.closingRealizedBalance, 416945);
    // Projetado de 06 subtrai o AP em aberto (200)
    assert.equal(d06!.closingProjectedBalance, 416745);
  });

  it("âncora WEAK emite warning OPENING_BALANCE_FROM_WEAK_SOURCE", () => {
    const days = buildTreasuryCaixaCanonicalDays({
      civilDatesInWindow: ["2026-08-05"],
      receivables: [],
      payables: [],
      openingBalanceOfFirstDay: null,
      officialTodayBalance: {
        civilDate: "2026-08-05",
        amount: 416945,
        sourceLabel: "Saldo mais recente das contas (Nomus)",
        strength: "WEAK",
      },
    });
    const d = days[0]!;
    assert.equal(d.closingRealizedBalance, 416945);
    const codes = d.warnings.map((w) => w.code);
    assert.ok(codes.includes("OPENING_BALANCE_FROM_WEAK_SOURCE"));
  });

  it("âncora com cobertura parcial de contas emite OFFICIAL_BALANCE_PARTIAL_ACCOUNTS", () => {
    const days = buildTreasuryCaixaCanonicalDays({
      civilDatesInWindow: ["2026-08-05"],
      receivables: [],
      payables: [],
      officialTodayBalance: {
        civilDate: "2026-08-05",
        amount: 214345,
        sourceLabel: "Rotina 'Saldos do Dia' (1/2 contas)",
        strength: "STRONG",
        accountsPartial: true,
      },
    });
    const d = days[0]!;
    const codes = d.warnings.map((w) => w.code);
    assert.ok(codes.includes("OFFICIAL_BALANCE_PARTIAL_ACCOUNTS"));
  });

  it("sem opening E sem âncora no primeiro dia → warning NO_OPENING_BALANCE (regressão)", () => {
    const days = buildTreasuryCaixaCanonicalDays({
      civilDatesInWindow: ["2026-08-04"],
      receivables: [
        ar({ settlementDate: "2026-08-04", amountReceived: 100 }),
      ],
      payables: [],
      openingBalanceOfFirstDay: null,
    });
    const d = days[0]!;
    assert.equal(d.openingBalance, null);
    assert.equal(d.closingRealizedBalance, null);
    const codes = d.warnings.map((w) => w.code);
    assert.ok(codes.includes("NO_OPENING_BALANCE"));
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

describe("buildTreasuryCaixaCanonicalDays — CASE-01/CASE-02: título fora da janela por vencimento, dentro por liquidação", () => {
  const POLICY = FINANCE_SETTLEMENT_RECONCILIATION_DEFAULTS;

  it("CASE-01 — CP vencido MUITO antes da janela, pago DENTRO dela além da tolerância → conta na data da baixa (settlementDate)", () => {
    // dueDate=10/07, settlementDate=07/08 (>D+3) — mesmo sem `paymentDate`
    // preenchido pelo Nomus, a baixa real fica visível via `settlementDate`.
    const days = buildTreasuryCaixaCanonicalDays({
      civilDatesInWindow: ["2026-08-07"],
      receivables: [],
      payables: [
        ap({
          externalId: 100,
          dueDate: "2026-07-10",
          paymentDate: null,
          settlementDate: "2026-08-07",
          amountPayable: 100,
          amountPaid: 100,
          balancePayable: 0,
        }),
      ],
      reconciliationPolicy: POLICY,
    });
    const day = findTreasuryCaixaCanonicalDay(days, "2026-08-07")!;
    assert.equal(day.payablePaid, 100);
    assert.equal(day.payablePaidTitles.length, 1);
    assert.equal(day.payablePaidTitles[0]!.externalId, 100);
  });

  it("CASE-02 — CP vencendo bem DEPOIS da janela, pago DENTRO dela antecipadamente → conta na data da baixa (settlementDate)", () => {
    // dueDate=10/09, settlementDate=07/08 (antecipado) — mesma proteção.
    const days = buildTreasuryCaixaCanonicalDays({
      civilDatesInWindow: ["2026-08-07"],
      receivables: [],
      payables: [
        ap({
          externalId: 200,
          dueDate: "2026-09-10",
          paymentDate: null,
          settlementDate: "2026-08-07",
          amountPayable: 100,
          amountPaid: 100,
          balancePayable: 0,
        }),
      ],
      reconciliationPolicy: POLICY,
    });
    const day = findTreasuryCaixaCanonicalDay(days, "2026-08-07")!;
    assert.equal(day.payablePaid, 100);
    assert.equal(day.payablePaidTitles.length, 1);
    assert.equal(day.payablePaidTitles[0]!.externalId, 200);
  });

  it("POP-07 — equivalente para AR: CR vencido muito antes, recebido dentro da janela além da tolerância → conta na baixa", () => {
    const days = buildTreasuryCaixaCanonicalDays({
      civilDatesInWindow: ["2026-08-07"],
      receivables: [
        ar({
          externalId: 300,
          dueDate: "2026-07-10",
          settlementDate: "2026-08-07",
          amountReceivable: 100,
          amountReceived: 100,
          balanceReceivable: 0,
        }),
      ],
      payables: [],
      reconciliationPolicy: POLICY,
    });
    const day = findTreasuryCaixaCanonicalDay(days, "2026-08-07")!;
    assert.equal(day.receivableReceived, 100);
    assert.equal(day.receivableReceivedTitles.length, 1);
  });

  it("dentro da tolerância (D+2), mesmo sem paymentDate: settlementDate ainda assim atribui a D, não à data da baixa", () => {
    // dueDate=05/08, settlementDate=07/08 (D+2, dentro da tolerância) →
    // effectiveDate = dueDate (05/08), não 07/08 — prova que o fallback para
    // settlementDate não quebra a regra dos 3 dias, só preenche a lacuna
    // quando paymentDate está ausente.
    const days = buildTreasuryCaixaCanonicalDays({
      civilDatesInWindow: ["2026-08-05", "2026-08-07"],
      receivables: [],
      payables: [
        ap({
          externalId: 400,
          dueDate: "2026-08-05",
          paymentDate: null,
          settlementDate: "2026-08-07",
          amountPayable: 100,
          amountPaid: 100,
          balancePayable: 0,
        }),
      ],
      reconciliationPolicy: POLICY,
    });
    const day05 = findTreasuryCaixaCanonicalDay(days, "2026-08-05")!;
    const day07 = findTreasuryCaixaCanonicalDay(days, "2026-08-07")!;
    assert.equal(day05.payablePaid, 100);
    assert.equal(day07.payablePaid, 0);
  });
});
