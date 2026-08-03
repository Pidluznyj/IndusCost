import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { toCivilDateKey } from "@/src/lib/financeCivilDate.js";
import {
  buildTreasuryCaixaDayFlow,
  buildTreasuryCaixaTimeline,
  classifyTreasuryCaixaTimelineDay,
  computeTreasuryCaixaTotals,
  resolveTreasuryCaixaDueDateRange,
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

describe("treasuryCaixaRules — buildTreasuryCaixaDayFlow", () => {
  it("consolida as contas: começou, entrou, saiu, terminou", () => {
    const flow = buildTreasuryCaixaDayFlow({
      civilDate: "2026-08-03",
      accounts: [
        {
          openingBalance: 150000,
          realizedInflows: 10000,
          realizedOutflows: 30000,
          realizedClosingBalance: 130000,
          informedClosingBalance: 130000,
        },
        {
          openingBalance: 50000,
          realizedInflows: 5000,
          realizedOutflows: 15000,
          realizedClosingBalance: 40000,
          informedClosingBalance: 40000,
        },
      ],
    });
    assert.equal(flow.opening, 200000);
    assert.equal(flow.inflows, 15000);
    assert.equal(flow.outflows, 45000);
    assert.equal(flow.closingCalculated, 170000);
    assert.equal(flow.closingInformed, 170000);
    assert.equal(flow.divergence, 0);
    assert.equal(flow.accountCount, 2);
    assert.equal(flow.pendingClosingCount, 0);
  });

  it("saldo não informado é null, nunca zero", () => {
    const flow = buildTreasuryCaixaDayFlow({
      civilDate: "2026-08-03",
      accounts: [
        {
          openingBalance: null,
          realizedInflows: 0,
          realizedOutflows: 0,
          realizedClosingBalance: null,
          informedClosingBalance: null,
        },
      ],
    });
    assert.equal(flow.opening, null);
    assert.equal(flow.closingCalculated, null);
    assert.equal(flow.closingInformed, null);
    assert.equal(flow.divergence, null);
    assert.equal(flow.pendingClosingCount, 1);
  });

  it("divergência = informado − calculado (dinheiro sem lastro)", () => {
    const flow = buildTreasuryCaixaDayFlow({
      civilDate: "2026-08-03",
      accounts: [
        {
          openingBalance: 100000,
          realizedInflows: 0,
          realizedOutflows: 30000,
          realizedClosingBalance: 70000,
          informedClosingBalance: 60000,
        },
      ],
    });
    // Banco tem 10k a menos do que os títulos explicam → saiu sem CP.
    assert.equal(flow.divergence, -10000);
  });

  it("conta sem fechamento informado entra na contagem de pendentes", () => {
    const flow = buildTreasuryCaixaDayFlow({
      civilDate: "2026-08-03",
      accounts: [
        {
          openingBalance: 10,
          realizedInflows: 0,
          realizedOutflows: 0,
          realizedClosingBalance: 10,
          informedClosingBalance: 10,
        },
        {
          openingBalance: 20,
          realizedInflows: 0,
          realizedOutflows: 0,
          realizedClosingBalance: 20,
          informedClosingBalance: null,
        },
      ],
    });
    assert.equal(flow.pendingClosingCount, 1);
    // Só a conta informada entra no total informado — sem inventar zero.
    assert.equal(flow.closingInformed, 10);
  });

  it("sem contas → tudo null/zero, sem NaN", () => {
    const flow = buildTreasuryCaixaDayFlow({
      civilDate: "2026-08-03",
      accounts: [],
    });
    assert.equal(flow.opening, null);
    assert.equal(flow.inflows, 0);
    assert.equal(flow.outflows, 0);
    assert.equal(flow.divergence, null);
    assert.equal(flow.accountCount, 0);
  });
});

describe("treasuryCaixaRules — buildTreasuryCaixaTimeline", () => {
  const TODAY = "2026-08-03";

  function day(
    civilDate: string,
    over: Partial<
      Parameters<typeof buildTreasuryCaixaTimeline>[0]["days"][number]
    > = {}
  ) {
    return {
      civilDate,
      openingBalance: 1000,
      plannedInflows: 500,
      plannedOutflows: 200,
      realizedInflows: 80,
      realizedOutflows: 30,
      closingBalance: 1050,
      ...over,
    };
  }

  it("passado usa o realizado; futuro usa a previsão", () => {
    const tl = buildTreasuryCaixaTimeline({
      todayCivilDate: TODAY,
      days: [day("2026-08-01"), day("2026-08-05")],
    });
    const [past, future] = tl.rows;
    assert.equal(past!.kind, "REALIZED");
    assert.equal(past!.inflows, 80);
    assert.equal(past!.outflows, 30);
    assert.equal(future!.kind, "FORECAST");
    assert.equal(future!.inflows, 500);
    assert.equal(future!.outflows, 200);
  });

  it("hoje usa realizado, para bater com o Movimento de hoje", () => {
    const tl = buildTreasuryCaixaTimeline({
      todayCivilDate: TODAY,
      days: [day(TODAY)],
    });
    assert.equal(tl.rows[0]!.kind, "TODAY");
    assert.equal(tl.rows[0]!.inflows, 80);
    assert.equal(tl.rows[0]!.outflows, 30);
  });

  it("ordena por data mesmo recebendo fora de ordem", () => {
    const tl = buildTreasuryCaixaTimeline({
      todayCivilDate: TODAY,
      days: [day("2026-08-05"), day("2026-08-01"), day(TODAY)],
    });
    assert.deepEqual(
      tl.rows.map((r) => r.civilDate),
      ["2026-08-01", TODAY, "2026-08-05"]
    );
    assert.equal(tl.realizedCount, 1);
    assert.equal(tl.forecastCount, 1);
  });

  it("marca o primeiro dia negativo", () => {
    const tl = buildTreasuryCaixaTimeline({
      todayCivilDate: TODAY,
      days: [
        day("2026-08-04", { closingBalance: 500 }),
        day("2026-08-05", { closingBalance: -120 }),
        day("2026-08-06", { closingBalance: -900 }),
      ],
    });
    assert.equal(tl.firstNegativeDate, "2026-08-05");
    assert.equal(tl.rows[0]!.negative, false);
    assert.equal(tl.rows[1]!.negative, true);
  });

  it("fechamento nulo não vira zero nem conta como negativo", () => {
    const tl = buildTreasuryCaixaTimeline({
      todayCivilDate: TODAY,
      days: [day("2026-08-05", { closingBalance: null })],
    });
    assert.equal(tl.rows[0]!.closing, null);
    assert.equal(tl.rows[0]!.negative, false);
    assert.equal(tl.firstNegativeDate, null);
  });

  it("classifica as três zonas em relação a hoje", () => {
    assert.equal(classifyTreasuryCaixaTimelineDay("2026-08-02", TODAY), "REALIZED");
    assert.equal(classifyTreasuryCaixaTimelineDay(TODAY, TODAY), "TODAY");
    assert.equal(classifyTreasuryCaixaTimelineDay("2026-08-04", TODAY), "FORECAST");
  });
});
