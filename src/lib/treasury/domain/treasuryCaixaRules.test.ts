import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { toCivilDateKey } from "@/src/lib/financeCivilDate.js";
import {
  buildTreasuryCaixaCashBalance,
  computeTreasuryCaixaTotals,
  resolveTreasuryCaixaDueDateRange,
  TREASURY_CAIXA_BASELINE_CIVIL_DATE,
  TreasuryCaixaFilterError,
} from "./treasuryCaixaRules.js";

function key(d: Date): string | null {
  return toCivilDateKey(d);
}

describe("treasuryCaixaRules — resolveTreasuryCaixaDueDateRange", () => {
  it("só ano → 1º de janeiro a 31 de dezembro", () => {
    const range = resolveTreasuryCaixaDueDateRange({ year: 2026 });
    assert.equal(key(range.dueDateFrom), "2026-01-01");
    assert.equal(key(range.dueDateTo), "2026-12-31");
  });

  it("ano + mês → primeiro ao último dia do mês", () => {
    const range = resolveTreasuryCaixaDueDateRange({ year: 2026, month: 2 });
    assert.equal(key(range.dueDateFrom), "2026-02-01");
    assert.equal(key(range.dueDateTo), "2026-02-28");
  });

  it("respeita fevereiro bissexto", () => {
    const range = resolveTreasuryCaixaDueDateRange({ year: 2028, month: 2 });
    assert.equal(key(range.dueDateTo), "2028-02-29");
  });

  it("ano + mês + dia → mesmo dia nas duas pontas", () => {
    const range = resolveTreasuryCaixaDueDateRange({
      year: 2026,
      month: 3,
      day: 15,
    });
    assert.equal(key(range.dueDateFrom), "2026-03-15");
    assert.equal(key(range.dueDateTo), "2026-03-15");
  });

  it("rejeita dia sem mês", () => {
    assert.throws(
      () => resolveTreasuryCaixaDueDateRange({ year: 2026, day: 10 }),
      TreasuryCaixaFilterError
    );
  });

  it("rejeita mês fora de 1-12", () => {
    assert.throws(
      () => resolveTreasuryCaixaDueDateRange({ year: 2026, month: 13 }),
      TreasuryCaixaFilterError
    );
  });

  it("rejeita dia inválido para o mês (31 de abril)", () => {
    assert.throws(
      () => resolveTreasuryCaixaDueDateRange({ year: 2026, month: 4, day: 31 }),
      TreasuryCaixaFilterError
    );
  });

  it("rejeita ano fora do range plausível", () => {
    assert.throws(
      () => resolveTreasuryCaixaDueDateRange({ year: 1800 }),
      TreasuryCaixaFilterError
    );
  });
});

describe("treasuryCaixaRules — computeTreasuryCaixaTotals", () => {
  it("soma CR/CP e calcula saldo líquido e contagens", () => {
    const totals = computeTreasuryCaixaTotals({
      receivables: [{ balanceReceivable: 100 }, { balanceReceivable: 50.5 }],
      payables: [{ balancePayable: 30 }],
    });
    assert.equal(totals.totalReceivable, 150.5);
    assert.equal(totals.totalPayable, 30);
    assert.equal(totals.netBalance, 120.5);
    assert.equal(totals.receivableCount, 2);
    assert.equal(totals.payableCount, 1);
  });

  it("listas vazias → zeros", () => {
    const totals = computeTreasuryCaixaTotals({ receivables: [], payables: [] });
    assert.equal(totals.totalReceivable, 0);
    assert.equal(totals.totalPayable, 0);
    assert.equal(totals.netBalance, 0);
    assert.equal(totals.receivableCount, 0);
    assert.equal(totals.payableCount, 0);
  });

  it("ignora valores não finitos ao somar", () => {
    const totals = computeTreasuryCaixaTotals({
      receivables: [{ balanceReceivable: Number.NaN }, { balanceReceivable: 10 }],
      payables: [],
    });
    assert.equal(totals.totalReceivable, 10);
  });

  it("soma também o que já foi recebido/pago, além do saldo em aberto", () => {
    const totals = computeTreasuryCaixaTotals({
      receivables: [
        { balanceReceivable: 0, amountReceived: 200 },
        { balanceReceivable: 50.5, amountReceived: 0 },
      ],
      payables: [
        { balancePayable: 0, amountPaid: 80 },
        { balancePayable: 30, amountPaid: 0 },
      ],
    });
    assert.equal(totals.totalReceived, 200);
    assert.equal(totals.totalPaid, 80);
    assert.equal(totals.netRealized, 120);
    assert.equal(totals.totalReceivable, 50.5);
    assert.equal(totals.totalPayable, 30);
  });

  it("amountReceived/amountPaid ausentes → tratados como zero", () => {
    const totals = computeTreasuryCaixaTotals({
      receivables: [{ balanceReceivable: 10 }],
      payables: [{ balancePayable: 5 }],
    });
    assert.equal(totals.totalReceived, 0);
    assert.equal(totals.totalPaid, 0);
    assert.equal(totals.netRealized, 0);
  });
});

describe("treasuryCaixaRules — buildTreasuryCaixaCashBalance", () => {
  it("marco zero é 01/01/2026", () => {
    assert.equal(TREASURY_CAIXA_BASELINE_CIVIL_DATE, "2026-01-01");
  });

  it("saldo = entradas − saídas, preservando as datas da janela", () => {
    const cash = buildTreasuryCaixaCashBalance({
      baselineDate: TREASURY_CAIXA_BASELINE_CIVIL_DATE,
      asOfDate: "2026-03-31",
      received: 1500.75,
      paid: 400.25,
    });
    assert.equal(cash.baselineDate, "2026-01-01");
    assert.equal(cash.asOfDate, "2026-03-31");
    assert.equal(cash.received, 1500.75);
    assert.equal(cash.paid, 400.25);
    assert.equal(cash.balance, 1100.5);
  });

  it("caixa negativo quando saídas superam entradas", () => {
    const cash = buildTreasuryCaixaCashBalance({
      baselineDate: TREASURY_CAIXA_BASELINE_CIVIL_DATE,
      asOfDate: "2026-02-28",
      received: 100,
      paid: 250,
    });
    assert.equal(cash.balance, -150);
  });

  it("sem movimento → saldo zero (o marco zero em si)", () => {
    const cash = buildTreasuryCaixaCashBalance({
      baselineDate: TREASURY_CAIXA_BASELINE_CIVIL_DATE,
      asOfDate: "2026-01-01",
      received: 0,
      paid: 0,
    });
    assert.equal(cash.balance, 0);
  });

  it("valores não finitos viram zero em vez de NaN", () => {
    const cash = buildTreasuryCaixaCashBalance({
      baselineDate: TREASURY_CAIXA_BASELINE_CIVIL_DATE,
      asOfDate: "2026-06-30",
      received: Number.NaN,
      paid: 80,
    });
    assert.equal(cash.received, 0);
    assert.equal(cash.balance, -80);
  });
});
