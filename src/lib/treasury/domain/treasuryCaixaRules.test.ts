import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { toCivilDateKey } from "@/src/lib/financeCivilDate.js";
import type { TreasuryCaixaTimelineRow } from "./treasuryCaixaRules.js";
import {
  buildTreasuryCaixaDayFlow,
  buildTreasuryCaixaMonthlyTimeline,
  buildTreasuryCaixaOverdue,
  buildTreasuryCaixaRealizedDays,
  buildTreasuryCaixaUnifiedTimeline,
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

describe("treasuryCaixaRules — buildTreasuryCaixaMonthlyTimeline", () => {
  const TODAY = "2026-08-03";

  /** O agrupador recebe linhas prontas — monta direto, sem passar por builder. */
  function tl(rows: TreasuryCaixaTimelineRow[]): TreasuryCaixaTimelineRow[] {
    return rows;
  }

  function d(
    civilDate: string,
    over: Partial<TreasuryCaixaTimelineRow> = {}
  ): TreasuryCaixaTimelineRow {
    const closing = over.closing !== undefined ? over.closing : 0;
    return {
      civilDate,
      kind:
        civilDate < TODAY ? "REALIZED" : civilDate > TODAY ? "FORECAST" : "TODAY",
      opening: 0,
      inflows: 0,
      outflows: 0,
      closing,
      negative: closing != null && closing < 0,
      ...over,
    };
  }

  it("a soma dos dias bate com o mês (é como o usuário valida)", () => {
    const months = buildTreasuryCaixaMonthlyTimeline(
      tl([
        d("2026-07-01", {
          opening: 1000,
          inflows: 300,
          outflows: 100,
          closing: 1200,
        }),
        d("2026-07-02", {
          opening: 1200,
          inflows: 200,
          outflows: 400,
          closing: 1000,
        }),
      ])
    );
    assert.equal(months.length, 1);
    const jul = months[0]!;
    assert.equal(jul.monthKey, "2026-07");
    // Abertura = primeiro dia; fechamento = último dia.
    assert.equal(jul.opening, 1000);
    assert.equal(jul.closing, 1000);
    // Entradas/saídas = soma dos dias.
    assert.equal(jul.inflows, 500);
    assert.equal(jul.outflows, 500);
    assert.equal(jul.days.length, 2);
  });

  it("separa os meses e ordena cronologicamente", () => {
    const months = buildTreasuryCaixaMonthlyTimeline(
      tl([d("2026-09-01"), d("2026-07-01"), d("2026-08-01")])
    );
    assert.deepEqual(
      months.map((m) => m.monthKey),
      ["2026-07", "2026-08", "2026-09"]
    );
  });

  it("mês inteiro no passado é REALIZED; inteiro no futuro é FORECAST", () => {
    const [jul] = buildTreasuryCaixaMonthlyTimeline(tl([d("2026-07-10")]));
    assert.equal(jul!.kind, "REALIZED");
    const [set] = buildTreasuryCaixaMonthlyTimeline(tl([d("2026-09-10")]));
    assert.equal(set!.kind, "FORECAST");
  });

  it("mês que contém hoje é CURRENT", () => {
    const [ago] = buildTreasuryCaixaMonthlyTimeline(
      tl([d("2026-08-01"), d(TODAY), d("2026-08-20")])
    );
    assert.equal(ago!.kind, "CURRENT");
  });

  it("mês que mistura passado e futuro sem conter hoje também é CURRENT", () => {
    const [ago] = buildTreasuryCaixaMonthlyTimeline(
      tl([d("2026-08-02"), d("2026-08-04")])
    );
    assert.equal(ago!.kind, "CURRENT");
  });

  it("propaga o primeiro dia negativo do mês", () => {
    const [ago] = buildTreasuryCaixaMonthlyTimeline(
      tl([
        d("2026-08-10", { closing: 500 }),
        d("2026-08-11", { closing: -200 }),
        d("2026-08-12", { closing: -900 }),
      ])
    );
    assert.equal(ago!.negative, true);
    assert.equal(ago!.firstNegativeDate, "2026-08-11");
  });

  it("mês sem dia negativo não é marcado", () => {
    const [ago] = buildTreasuryCaixaMonthlyTimeline(
      tl([d("2026-08-10", { closing: 5 })])
    );
    assert.equal(ago!.negative, false);
    assert.equal(ago!.firstNegativeDate, null);
  });

  it("sem dias → nenhum mês", () => {
    assert.deepEqual(buildTreasuryCaixaMonthlyTimeline([]), []);
  });
});

describe("treasuryCaixaRules — buildTreasuryCaixaRealizedDays", () => {
  it("agrupa por data de liquidação, não por vencimento", () => {
    const days = buildTreasuryCaixaRealizedDays({
      receivables: [
        { settlementDate: "2026-07-15", amountReceived: 1000 },
        { settlementDate: "2026-07-15", amountReceived: 500 },
        { settlementDate: "2026-07-16", amountReceived: 200 },
      ],
      payables: [{ dueDate: "2026-07-15", amountPaid: 300 }],
    });
    assert.equal(days.length, 2);
    assert.equal(days[0]!.civilDate, "2026-07-15");
    assert.equal(days[0]!.inflows, 1500);
    assert.equal(days[0]!.outflows, 300);
    assert.equal(days[0]!.receivableCount, 2);
    assert.equal(days[0]!.payableCount, 1);
    assert.equal(days[1]!.inflows, 200);
  });

  it("ignora título sem data de liquidação (não foi pago)", () => {
    const days = buildTreasuryCaixaRealizedDays({
      receivables: [{ settlementDate: null, amountReceived: 900 }],
      payables: [{ dueDate: null, amountPaid: 400 }],
    });
    assert.deepEqual(days, []);
  });

  it("ignora valor zero ou negativo", () => {
    const days = buildTreasuryCaixaRealizedDays({
      receivables: [
        { settlementDate: "2026-07-15", amountReceived: 0 },
        { settlementDate: "2026-07-15", amountReceived: -50 },
      ],
      payables: [],
    });
    assert.deepEqual(days, []);
  });

  it("aceita timestamp e recorta para o dia civil", () => {
    const days = buildTreasuryCaixaRealizedDays({
      receivables: [
        { settlementDate: "2026-07-15T13:45:00.000Z", amountReceived: 100 },
      ],
      payables: [],
    });
    assert.equal(days[0]!.civilDate, "2026-07-15");
  });

  it("ordena cronologicamente", () => {
    const days = buildTreasuryCaixaRealizedDays({
      receivables: [
        { settlementDate: "2026-07-20", amountReceived: 1 },
        { settlementDate: "2026-07-10", amountReceived: 1 },
      ],
      payables: [{ dueDate: "2026-07-15", amountPaid: 1 }],
    });
    assert.deepEqual(
      days.map((d) => d.civilDate),
      ["2026-07-10", "2026-07-15", "2026-07-20"]
    );
  });
});

describe("treasuryCaixaRules — buildTreasuryCaixaUnifiedTimeline", () => {
  const TODAY = "2026-08-03";

  it("junta passado (fato), hoje (fato) e futuro (previsão) numa linha só", () => {
    const tl = buildTreasuryCaixaUnifiedTimeline({
      todayCivilDate: TODAY,
      realizedDays: [
        {
          civilDate: "2026-08-01",
          inflows: 500,
          outflows: 200,
          receivableCount: 1,
          payableCount: 1,
        },
      ],
      todayFlow: {
        civilDate: TODAY,
        opening: 1000,
        inflows: 300,
        outflows: 100,
        closingCalculated: 1200,
        closingInformed: 1200,
        divergence: 0,
        accountCount: 1,
        pendingClosingCount: 0,
      },
      forecastDays: [
        {
          civilDate: "2026-08-05",
          openingBalance: 1200,
          inflows: 700,
          outflows: 900,
          closingBalance: 1000,
        },
      ],
    });
    assert.deepEqual(
      tl.rows.map((r) => r.kind),
      ["REALIZED", "TODAY", "FORECAST"]
    );
    assert.equal(tl.realizedCount, 1);
    assert.equal(tl.forecastCount, 1);
    // Passado: entrou/saiu são fato; saldo não foi informado → null.
    assert.equal(tl.rows[0]!.inflows, 500);
    assert.equal(tl.rows[0]!.opening, null);
    assert.equal(tl.rows[0]!.closing, null);
    // Futuro usa a previsão, não o realizado.
    assert.equal(tl.rows[2]!.inflows, 700);
  });

  it("dia realizado que caia hoje ou no futuro é descartado (evita duplicar)", () => {
    const tl = buildTreasuryCaixaUnifiedTimeline({
      todayCivilDate: TODAY,
      realizedDays: [
        {
          civilDate: TODAY,
          inflows: 999,
          outflows: 0,
          receivableCount: 1,
          payableCount: 0,
        },
        {
          civilDate: "2026-08-09",
          inflows: 888,
          outflows: 0,
          receivableCount: 1,
          payableCount: 0,
        },
      ],
      todayFlow: null,
      forecastDays: [],
    });
    assert.deepEqual(tl.rows, []);
  });

  it("dia de previsão que caia hoje ou no passado é descartado", () => {
    const tl = buildTreasuryCaixaUnifiedTimeline({
      todayCivilDate: TODAY,
      realizedDays: [],
      todayFlow: null,
      forecastDays: [
        {
          civilDate: "2026-08-01",
          openingBalance: 1,
          inflows: 1,
          outflows: 1,
          closingBalance: 1,
        },
      ],
    });
    assert.deepEqual(tl.rows, []);
  });

  it("hoje usa o fechamento informado quando existe", () => {
    const tl = buildTreasuryCaixaUnifiedTimeline({
      todayCivilDate: TODAY,
      realizedDays: [],
      todayFlow: {
        civilDate: TODAY,
        opening: 100,
        inflows: 0,
        outflows: 0,
        closingCalculated: 100,
        closingInformed: 95,
        divergence: -5,
        accountCount: 1,
        pendingClosingCount: 0,
      },
      forecastDays: [],
    });
    assert.equal(tl.rows[0]!.closing, 95);
  });

  it("marca o primeiro dia negativo do futuro", () => {
    const tl = buildTreasuryCaixaUnifiedTimeline({
      todayCivilDate: TODAY,
      realizedDays: [],
      todayFlow: null,
      forecastDays: [
        {
          civilDate: "2026-08-04",
          openingBalance: 100,
          inflows: 0,
          outflows: 0,
          closingBalance: 50,
        },
        {
          civilDate: "2026-08-05",
          openingBalance: 50,
          inflows: 0,
          outflows: 0,
          closingBalance: -20,
        },
      ],
    });
    assert.equal(tl.firstNegativeDate, "2026-08-05");
  });

  it("tudo vazio → linha do tempo vazia, sem erro", () => {
    const tl = buildTreasuryCaixaUnifiedTimeline({
      todayCivilDate: TODAY,
      realizedDays: [],
      todayFlow: null,
      forecastDays: [],
    });
    assert.deepEqual(tl.rows, []);
    assert.equal(tl.firstNegativeDate, null);
  });
});

describe("treasuryCaixaRules — buildTreasuryCaixaOverdue", () => {
  it("distribui os títulos nas faixas de atraso e soma os lados", () => {
    const o = buildTreasuryCaixaOverdue({
      receivables: [
        { daysOverdue: 3, balanceReceivable: 1000 },
        { daysOverdue: 40, balanceReceivable: 2000 },
        { daysOverdue: 200, balanceReceivable: 500 },
      ],
      payables: [{ daysOverdue: 10, balancePayable: 300 }],
    });
    assert.equal(o.receivable.total, 3500);
    assert.equal(o.receivable.count, 3);
    assert.equal(o.payable.total, 300);
    assert.deepEqual(
      o.receivable.buckets.map((b) => b.key),
      ["overdue1to7", "overdue31to60", "overdue90plus"]
    );
    assert.equal(o.payable.buckets[0]!.key, "overdue8to15");
  });

  it("agrupa vários títulos na mesma faixa", () => {
    const o = buildTreasuryCaixaOverdue({
      receivables: [
        { daysOverdue: 2, balanceReceivable: 100 },
        { daysOverdue: 5, balanceReceivable: 250 },
      ],
      payables: [],
    });
    assert.equal(o.receivable.buckets.length, 1);
    assert.equal(o.receivable.buckets[0]!.amount, 350);
    assert.equal(o.receivable.buckets[0]!.count, 2);
  });

  it("não conta título a vencer nem vencendo hoje", () => {
    const o = buildTreasuryCaixaOverdue({
      receivables: [
        { daysOverdue: 0, balanceReceivable: 900 },
        { daysOverdue: -5, balanceReceivable: 900 },
      ],
      payables: [],
    });
    assert.equal(o.receivable.total, 0);
    assert.deepEqual(o.receivable.buckets, []);
  });

  it("não conta título já liquidado (saldo zero)", () => {
    const o = buildTreasuryCaixaOverdue({
      receivables: [{ daysOverdue: 30, balanceReceivable: 0 }],
      payables: [{ daysOverdue: 30, balancePayable: 0 }],
    });
    assert.equal(o.receivable.count, 0);
    assert.equal(o.payable.count, 0);
  });

  it("faixa sem título não aparece", () => {
    const o = buildTreasuryCaixaOverdue({
      receivables: [{ daysOverdue: 95, balanceReceivable: 10 }],
      payables: [],
    });
    assert.equal(o.receivable.buckets.length, 1);
    assert.equal(o.receivable.buckets[0]!.key, "overdue90plus");
  });

  it("respeita os limites das faixas (7/8 e 90/91)", () => {
    const o = buildTreasuryCaixaOverdue({
      receivables: [
        { daysOverdue: 7, balanceReceivable: 1 },
        { daysOverdue: 8, balanceReceivable: 1 },
        { daysOverdue: 90, balanceReceivable: 1 },
        { daysOverdue: 91, balanceReceivable: 1 },
      ],
      payables: [],
    });
    assert.deepEqual(
      o.receivable.buckets.map((b) => b.key),
      ["overdue1to7", "overdue8to15", "overdue61to90", "overdue90plus"]
    );
  });

  it("sem atrasados → zeros, sem NaN", () => {
    const o = buildTreasuryCaixaOverdue({ receivables: [], payables: [] });
    assert.equal(o.receivable.total, 0);
    assert.equal(o.payable.total, 0);
    assert.deepEqual(o.receivable.buckets, []);
  });
});

describe("treasuryCaixaRules — assimetria CR/CP na data de caixa", () => {
  it("CP entra pelo vencimento mesmo tendo sido pago depois (regra canônica)", () => {
    const days = buildTreasuryCaixaRealizedDays({
      receivables: [],
      // Vencido em 10/07; a baixa real pode ter sido outro dia — o motor
      // oficial aloca CP sempre no vencimento.
      payables: [{ dueDate: "2026-07-10", amountPaid: 5000 }],
    });
    assert.equal(days.length, 1);
    assert.equal(days[0]!.civilDate, "2026-07-10");
    assert.equal(days[0]!.outflows, 5000);
  });

  it("CP sem pagamento não entra (amountPaid zero)", () => {
    const days = buildTreasuryCaixaRealizedDays({
      receivables: [],
      payables: [{ dueDate: "2026-07-10", amountPaid: 0 }],
    });
    assert.deepEqual(days, []);
  });

  it("CR e CP no mesmo dia somam nos lados certos", () => {
    const days = buildTreasuryCaixaRealizedDays({
      receivables: [{ settlementDate: "2026-07-10", amountReceived: 900 }],
      payables: [{ dueDate: "2026-07-10", amountPaid: 400 }],
    });
    assert.equal(days[0]!.inflows, 900);
    assert.equal(days[0]!.outflows, 400);
  });
});
