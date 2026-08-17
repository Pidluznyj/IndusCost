import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { toCivilDateKey } from "@/src/lib/financeCivilDate.js";
import type { TreasuryCaixaCanonicalDay } from "./treasuryCaixaCanonicalDay.js";
import type {
  TreasuryCaixaDayFlow,
  TreasuryCaixaRealizedDay,
  TreasuryCaixaTimelineRow,
} from "./treasuryCaixaRules.js";
import {
  appendTreasuryCaixaDailyDueEstimates,
  appendTreasuryCaixaMonthlyDueEstimates,
  applyTreasuryCaixaCanonicalTodayFlow,
  applyTreasuryCaixaRunningBalance,
  buildTreasuryCaixaDayFlow,
  buildTreasuryCaixaMonthlyBalanceChart,
  buildTreasuryCaixaMonthlyTimeline,
  buildTreasuryCaixaOverdue,
  buildTreasuryCaixaRealizedDays,
  buildTreasuryCaixaUnifiedTimeline,
  computeTreasuryCaixaTotals,
  detectTreasuryCaixaOutliers,
  resolveTreasuryCaixaCanonicalWindow,
  resolveTreasuryCaixaChainedOpeningForToday,
  resolveTreasuryCaixaDueDateRange,
  selectTreasuryCaixaCanonicalPopulation,
  TreasuryCaixaFilterError,
} from "./treasuryCaixaRules.js";

function key(d: Date): string | null {
  return toCivilDateKey(d);
}

/** Referência de "hoje" compartilhada pelos testes de linha do tempo. */
const TODAY = "2026-08-03";

/** O agrupador recebe linhas prontas — monta direto, sem passar por builder. */
function tl(rows: TreasuryCaixaTimelineRow[]): TreasuryCaixaTimelineRow[] {
  return rows;
}

/** Linha da linha do tempo; a zona sai da data contra {@link TODAY}. */
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
    closingCalculated: closing,
    closingInformed: null,
    divergence: null,
    negative: closing != null && closing < 0,
    ...over,
  };
}

/** Dia realizado com os campos de saldo zerados — o teste sobrescreve o que importa. */
function realizedDay(
  civilDate: string,
  over: Partial<TreasuryCaixaRealizedDay> = {}
): TreasuryCaixaRealizedDay {
  return {
    civilDate,
    inflows: 0,
    outflows: 0,
    receivableCount: 0,
    payableCount: 0,
    opening: null,
    closing: null,
    closingCalculated: null,
    closingInformed: null,
    divergence: null,
    ...over,
  };
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

describe("treasuryCaixaRules — resolveTreasuryCaixaCanonicalWindow", () => {
  it("hoje já dentro do filtro → janela devolvida como veio, sem ampliar", () => {
    const result = resolveTreasuryCaixaCanonicalWindow({
      windowDays: ["2026-08-01", "2026-08-02", "2026-08-07", "2026-08-31"],
      todayCivilDate: "2026-08-07",
    });
    assert.equal(result.todayOutsideWindow, false);
    assert.deepEqual(result.canonicalWindowDays, [
      "2026-08-01",
      "2026-08-02",
      "2026-08-07",
      "2026-08-31",
    ]);
    assert.equal(result.widenedFromCivilDate, "2026-08-01");
    assert.equal(result.widenedToCivilDate, "2026-08-31");
  });

  it("filtro para um mês passado (hoje é 07/08, filtro é março) → hoje entra na janela", () => {
    const result = resolveTreasuryCaixaCanonicalWindow({
      windowDays: ["2026-03-01", "2026-03-15", "2026-03-31"],
      todayCivilDate: "2026-08-07",
    });
    assert.equal(result.todayOutsideWindow, true);
    assert.ok(result.canonicalWindowDays.includes("2026-08-07"));
    assert.equal(result.widenedToCivilDate, "2026-08-07");
  });

  it("filtro para um mês futuro (hoje é 07/08, filtro é dezembro) → hoje entra na janela", () => {
    const result = resolveTreasuryCaixaCanonicalWindow({
      windowDays: ["2026-12-01", "2026-12-31"],
      todayCivilDate: "2026-08-07",
    });
    assert.equal(result.todayOutsideWindow, true);
    assert.ok(result.canonicalWindowDays.includes("2026-08-07"));
    assert.equal(result.widenedFromCivilDate, "2026-08-07");
  });

  it("R09 — mesmos dados, filtros diferentes → hoje SEMPRE presente na janela canônica", () => {
    const filters = [
      ["2026-01-01", "2026-12-31"], // ano inteiro
      ["2026-03-01", "2026-03-31"], // mês passado
      ["2026-08-07", "2026-08-07"], // só hoje
      ["2026-12-01", "2026-12-31"], // mês futuro
    ];
    for (const [from, to] of filters) {
      const windowDays: string[] = [];
      const cursor = new Date(`${from}T00:00:00`);
      const end = new Date(`${to}T00:00:00`);
      while (cursor <= end) {
        windowDays.push(cursor.toISOString().slice(0, 10));
        cursor.setDate(cursor.getDate() + 1);
      }
      const result = resolveTreasuryCaixaCanonicalWindow({
        windowDays,
        todayCivilDate: "2026-08-07",
      });
      assert.ok(
        result.canonicalWindowDays.includes("2026-08-07"),
        `filtro ${from}..${to} deveria incluir hoje na janela canônica`
      );
    }
  });

  it("janela vazia + hoje → janela com só hoje", () => {
    const result = resolveTreasuryCaixaCanonicalWindow({
      windowDays: [],
      todayCivilDate: "2026-08-07",
    });
    assert.deepEqual(result.canonicalWindowDays, ["2026-08-07"]);
    assert.equal(result.todayOutsideWindow, true);
  });
});

describe("treasuryCaixaRules — selectTreasuryCaixaCanonicalPopulation (POP-01..POP-06, POP-10)", () => {
  const WINDOW = { fromCivilDate: "2026-08-01", toCivilDate: "2026-08-31" };
  type Row = { externalId: number; dueDate: string | null; settled: string | null };
  const settledOf = (r: Row) => r.settled;

  it("POP-01 — dueDate dentro, aberto (sem liquidação) → entra", () => {
    const rows: Row[] = [{ externalId: 1, dueDate: "2026-08-15", settled: null }];
    const result = selectTreasuryCaixaCanonicalPopulation(rows, WINDOW, settledOf);
    assert.equal(result.length, 1);
  });

  it("POP-02 — dueDate dentro, liquidação em D+2 → entra (o vencimento já basta)", () => {
    const rows: Row[] = [{ externalId: 2, dueDate: "2026-08-05", settled: "2026-08-07" }];
    const result = selectTreasuryCaixaCanonicalPopulation(rows, WINDOW, settledOf);
    assert.equal(result.length, 1);
  });

  it("POP-03 — dueDate ANTES da janela, liquidação DENTRO (além da tolerância) → entra pela liquidação", () => {
    const rows: Row[] = [{ externalId: 3, dueDate: "2026-07-10", settled: "2026-08-07" }];
    const result = selectTreasuryCaixaCanonicalPopulation(rows, WINDOW, settledOf);
    assert.equal(result.length, 1);
    assert.equal(result[0]!.externalId, 3);
  });

  it("POP-04 — dueDate DEPOIS da janela, liquidação DENTRO (antecipada) → entra pela liquidação", () => {
    const rows: Row[] = [{ externalId: 4, dueDate: "2026-09-10", settled: "2026-08-07" }];
    const result = selectTreasuryCaixaCanonicalPopulation(rows, WINDOW, settledOf);
    assert.equal(result.length, 1);
    assert.equal(result[0]!.externalId, 4);
  });

  it("POP-05 / POP-10 — dueDate dentro E liquidação dentro, título repetido na entrada → conta uma única vez", () => {
    const rows: Row[] = [
      { externalId: 5, dueDate: "2026-08-05", settled: "2026-08-07" },
      { externalId: 5, dueDate: "2026-08-05", settled: "2026-08-07" }, // mesma identidade, veio de duas consultas
    ];
    const result = selectTreasuryCaixaCanonicalPopulation(rows, WINDOW, settledOf);
    assert.equal(result.length, 1);
  });

  it("POP-06 — dueDate fora E liquidação fora (ou ausente) → não entra", () => {
    const rows: Row[] = [
      { externalId: 6, dueDate: "2026-06-01", settled: "2026-06-03" },
      { externalId: 7, dueDate: "2026-10-01", settled: null },
    ];
    const result = selectTreasuryCaixaCanonicalPopulation(rows, WINDOW, settledOf);
    assert.deepEqual(result, []);
  });

  it("limites inclusivos: dueDate exatamente no primeiro/último dia da janela entra", () => {
    const rows: Row[] = [
      { externalId: 8, dueDate: "2026-08-01", settled: null },
      { externalId: 9, dueDate: "2026-08-31", settled: null },
    ];
    const result = selectTreasuryCaixaCanonicalPopulation(rows, WINDOW, settledOf);
    assert.equal(result.length, 2);
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

  it("previsto do dia (CR/CP vencendo hoje) passa arredondado; ausente vira null", () => {
    const withPredicted = buildTreasuryCaixaDayFlow({
      civilDate: "2026-08-03",
      accounts: [],
      predictedInflows: 35303.404,
      predictedOutflows: 20248.585,
    });
    assert.equal(withPredicted.predictedInflows, 35303.4);
    assert.equal(withPredicted.predictedOutflows, 20248.59);

    const without = buildTreasuryCaixaDayFlow({
      civilDate: "2026-08-03",
      accounts: [],
    });
    assert.equal(without.predictedInflows, null);
    assert.equal(without.predictedOutflows, null);

    // Zero explícito é informação (nada vence hoje), não ausência.
    const zero = buildTreasuryCaixaDayFlow({
      civilDate: "2026-08-03",
      accounts: [],
      predictedInflows: 0,
      predictedOutflows: 0,
    });
    assert.equal(zero.predictedInflows, 0);
    assert.equal(zero.predictedOutflows, 0);
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

/** Flow de hoje mínimo; o teste sobrescreve o que importa. */
function todayFlow(over: Partial<TreasuryCaixaDayFlow> = {}): TreasuryCaixaDayFlow {
  return {
    civilDate: "2026-08-07",
    opening: 0,
    inflows: 0,
    outflows: 0,
    closingCalculated: 0,
    closingInformed: null,
    divergence: null,
    accountCount: 1,
    pendingClosingCount: 0,
    ...over,
  };
}

/** Dia canônico mínimo (motor único-de-dia); o teste sobrescreve o que importa. */
function canonicalDay(
  over: Partial<TreasuryCaixaCanonicalDay> = {}
): TreasuryCaixaCanonicalDay {
  return {
    civilDate: "2026-08-07",
    receivableDue: 0,
    receivableDueTitles: [],
    receivableReceived: 0,
    receivableReceivedTitles: [],
    payableDue: 0,
    payableDueTitles: [],
    payablePaid: 0,
    payablePaidTitles: [],
    otherInflows: 0,
    otherOutflows: 0,
    otherMovements: [],
    realizedInflows: 0,
    realizedOutflows: 0,
    projectedInflows: 0,
    projectedOutflows: 0,
    openingBalance: null,
    closingRealizedBalance: null,
    closingProjectedBalance: null,
    warnings: [],
    ...over,
  };
}

describe("treasuryCaixaRules — applyTreasuryCaixaCanonicalTodayFlow", () => {
  it("troca inflows/outflows do fechamento bancário bruto pelos do motor único-de-dia (CR/CP)", () => {
    // Reprodução do defeito observado em 07/08/2026: o fechamento bancário
    // bruto (`/today/closing`) soma CP por settlementDate cru — sem a regra
    // dos 3 dias — e mistura títulos de dias diferentes. O motor único-de-dia
    // (canonicalDay), a MESMA fonte que o drill-down usa, mostra "Pago hoje"
    // = R$ 0,00 porque nenhuma baixa de hoje tem data EFETIVA hoje (todas
    // caíram dentro da janela de 3 dias e foram atribuídas ao vencimento).
    const flow = todayFlow({
      opening: 500000,
      inflows: 80000,
      outflows: 199286.45,
      closingCalculated: 500000 + 80000 - 199286.45,
      closingInformed: null,
      divergence: null,
    });
    const day = canonicalDay({
      receivableDue: 15000,
      payableDue: 22418.89,
      receivableReceived: 12000,
      payablePaid: 0,
    });

    const corrected = applyTreasuryCaixaCanonicalTodayFlow(flow, day);

    assert.equal(corrected.outflows, 0);
    assert.equal(corrected.inflows, 12000);
    // Fechamento recomposto: abertura + realizado canônico + previsão do dia
    // (regra D+1): 500000 + 12000 − 0 + 15000 − 22418,89.
    assert.equal(corrected.closingCalculated, 504581.11);
  });

  it("preserva abertura e saldo informado (âncora manual, não vira fluxo)", () => {
    const flow = todayFlow({
      opening: 1000,
      inflows: 999,
      outflows: 999,
      closingInformed: 900,
    });
    const day = canonicalDay({ receivableReceived: 50, payablePaid: 20 });

    const corrected = applyTreasuryCaixaCanonicalTodayFlow(flow, day);

    assert.equal(corrected.opening, 1000);
    assert.equal(corrected.closingInformed, 900);
    // Divergência recomposta contra o calculado NOVO (1000+50-20=1030): 900-1030.
    assert.equal(corrected.closingCalculated, 1030);
    assert.equal(corrected.divergence, -130);
  });

  it("ignora ledger/transferência (otherInflows/otherOutflows) — só título CR/CP", () => {
    const flow = todayFlow({ opening: 0, inflows: 0, outflows: 0 });
    const day = canonicalDay({
      receivableReceived: 100,
      payablePaid: 40,
      // Movimento de banco/ledger avulso — não pode vazar para inflows/outflows.
      otherInflows: 500000,
      otherOutflows: 500000,
      realizedInflows: 500100,
      realizedOutflows: 500040,
    });

    const corrected = applyTreasuryCaixaCanonicalTodayFlow(flow, day);

    assert.equal(corrected.inflows, 100);
    assert.equal(corrected.outflows, 40);
  });

  it("sem canonicalDay (hoje fora do período consultado) — devolve o flow como veio", () => {
    const flow = todayFlow({ inflows: 111, outflows: 222 });
    const corrected = applyTreasuryCaixaCanonicalTodayFlow(flow, null);
    assert.deepEqual(corrected, flow);
  });

  it("idempotente — aplicar duas vezes com o mesmo canonicalDay não muda o resultado", () => {
    const flow = todayFlow({ opening: 200, inflows: 999, outflows: 999 });
    const day = canonicalDay({ receivableReceived: 30, payablePaid: 10 });
    const once = applyTreasuryCaixaCanonicalTodayFlow(flow, day);
    const twice = applyTreasuryCaixaCanonicalTodayFlow(once, day);
    assert.deepEqual(once, twice);
  });
});

/**
 * Regra D+1 (pedido do negócio, 17/08/2026): a confirmação de baixa só acontece
 * no dia seguinte, então DURANTE o dia de hoje o caixa tem que considerar a
 * PREVISÃO do próprio dia (títulos em aberto vencendo hoje). A partir de D+1 o
 * dia vira passado e passa a valer só o que foi realmente pago/recebido.
 */
describe("treasuryCaixaRules — previsão do próprio dia (regra D+1)", () => {
  it("hoje: previsão do dia entra como previsto e move o fechamento calculado", () => {
    const flow = todayFlow({
      opening: 500000,
      inflows: 80000,
      outflows: 199286.45,
      closingCalculated: 500000 + 80000 - 199286.45,
    });
    const day = canonicalDay({
      receivableDue: 15000,
      payableDue: 22418.89,
      receivableReceived: 12000,
      payablePaid: 0,
    });

    const corrected = applyTreasuryCaixaCanonicalTodayFlow(flow, day);

    // Realizado continua separado (o card "Movimento de hoje" mostra os dois).
    assert.equal(corrected.inflows, 12000);
    assert.equal(corrected.outflows, 0);
    // Previsão do dia = títulos em aberto vencendo hoje.
    assert.equal(corrected.predictedInflows, 15000);
    assert.equal(corrected.predictedOutflows, 22418.89);
    // Fechamento calculado = abertura + realizado + previsto.
    assert.equal(
      corrected.closingCalculated,
      500000 + 12000 - 0 + 15000 - 22418.89
    );
  });

  it("divergência continua medindo informado − REALIZADO (previsão não vira divergência)", () => {
    const flow = todayFlow({
      opening: 1000,
      closingInformed: 900,
    });
    const day = canonicalDay({
      receivableReceived: 50,
      payablePaid: 20,
      receivableDue: 400,
      payableDue: 700,
    });

    const corrected = applyTreasuryCaixaCanonicalTodayFlow(flow, day);

    // Projetado: 1000 + 50 − 20 + 400 − 700 = 730.
    assert.equal(corrected.closingCalculated, 730);
    // Divergência contra o REALIZADO (1000+50−20=1030): 900 − 1030 = −130.
    assert.equal(corrected.divergence, -130);
  });

  it("linha do tempo: HOJE soma realizado + previsto e ancora o futuro no projetado", () => {
    const flow = applyTreasuryCaixaCanonicalTodayFlow(
      todayFlow({ civilDate: TODAY, opening: 10000 }),
      canonicalDay({
        civilDate: TODAY,
        receivableReceived: 1000,
        payablePaid: 500,
        receivableDue: 3000,
        payableDue: 8000,
      })
    );

    const timeline = buildTreasuryCaixaUnifiedTimeline({
      todayCivilDate: TODAY,
      realizedDays: [],
      todayFlow: flow,
      forecastDays: [],
    });

    const today = timeline.rows.find((r) => r.kind === "TODAY")!;
    assert.equal(today.inflows, 4000); // 1000 recebido + 3000 a receber hoje
    assert.equal(today.outflows, 8500); // 500 pago + 8000 a pagar hoje
    // Parte prevista fica destacada para a UI separar do realizado.
    assert.equal(today.forecastInflows, 3000);
    assert.equal(today.forecastOutflows, 8000);
    assert.equal(today.closing, 10000 + 4000 - 8500);
  });

  it("linha do tempo: saldo informado manual mantém o privilégio sobre o calculado", () => {
    const flow = applyTreasuryCaixaCanonicalTodayFlow(
      todayFlow({ civilDate: TODAY, opening: 10000, closingInformed: 12345 }),
      canonicalDay({
        civilDate: TODAY,
        receivableReceived: 1000,
        payablePaid: 500,
        receivableDue: 3000,
        payableDue: 8000,
      })
    );

    const timeline = buildTreasuryCaixaUnifiedTimeline({
      todayCivilDate: TODAY,
      realizedDays: [],
      todayFlow: flow,
      forecastDays: [],
    });

    const today = timeline.rows.find((r) => r.kind === "TODAY")!;
    assert.equal(today.closing, 12345);
    assert.equal(today.closingInformed, 12345);
  });

  it("sem lançamento manual, hoje abre no fechamento do último dia e fecha com a previsão", () => {
    // Cenário real de 17/08/2026: nenhum saldo informado hoje, último dia
    // realizado (14/08) fechou em 136.244,34, e o dia tem 75.097,78 a receber
    // e 52.805,99 a pagar vencendo. A tela mostrava "—" em Começou/Terminou.
    const realizedDays: TreasuryCaixaRealizedDay[] = [
      realizedDay("2026-08-13", { closing: 134919.34 }),
      realizedDay("2026-08-14", { closing: 136244.34 }),
    ];
    const fallbackOpening = resolveTreasuryCaixaChainedOpeningForToday(
      realizedDays,
      "2026-08-17"
    );
    assert.equal(fallbackOpening, 136244.34);

    const flow = applyTreasuryCaixaCanonicalTodayFlow(
      todayFlow({ civilDate: "2026-08-17", opening: null }),
      canonicalDay({
        civilDate: "2026-08-17",
        receivableDue: 75097.78,
        payableDue: 52805.99,
      }),
      { fallbackOpening }
    );

    assert.equal(flow.opening, 136244.34);
    assert.equal(flow.closingCalculated, 158536.13);

    const timeline = buildTreasuryCaixaUnifiedTimeline({
      todayCivilDate: "2026-08-17",
      realizedDays,
      todayFlow: flow,
      forecastDays: [],
    });
    const today = timeline.rows.find((r) => r.kind === "TODAY")!;
    assert.equal(today.opening, 136244.34);
    assert.equal(today.closing, 158536.13);
  });

  it("abertura informada tem privilégio sobre a encadeada", () => {
    const flow = applyTreasuryCaixaCanonicalTodayFlow(
      todayFlow({ civilDate: "2026-08-17", opening: 99999 }),
      canonicalDay({ civilDate: "2026-08-17" }),
      { fallbackOpening: 136244.34 }
    );
    assert.equal(flow.opening, 99999);
  });

  it("sem nenhum dia fechado antes de hoje não inventa abertura", () => {
    assert.equal(
      resolveTreasuryCaixaChainedOpeningForToday(
        [realizedDay("2026-08-17", { closing: 500 })],
        "2026-08-17"
      ),
      null
    );
  });

  it("dia passado (D+1 em diante) segue só com o que foi realmente pago/recebido", () => {
    const timeline = buildTreasuryCaixaUnifiedTimeline({
      todayCivilDate: TODAY,
      realizedDays: [
        {
          civilDate: "2026-08-02",
          inflows: 700,
          outflows: 200,
          receivableCount: 1,
          payableCount: 1,
          opening: 1000,
          closing: 1500,
          closingCalculated: 1500,
          closingInformed: null,
          divergence: null,
        },
      ],
      todayFlow: null,
      forecastDays: [],
    });

    const past = timeline.rows.find((r) => r.civilDate === "2026-08-02")!;
    assert.equal(past.kind, "REALIZED");
    assert.equal(past.inflows, 700);
    assert.equal(past.outflows, 200);
    assert.equal(past.forecastInflows, undefined);
  });
});

describe("treasuryCaixaRules — buildTreasuryCaixaMonthlyTimeline", () => {

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

describe("treasuryCaixaRules — appendTreasuryCaixaMonthlyDueEstimates", () => {
  it("complementa mês ausente (agenda não cobriu) com a estimativa por vencimento", () => {
    const months = buildTreasuryCaixaMonthlyTimeline(tl([d("2026-07-10")]));
    const merged = appendTreasuryCaixaMonthlyDueEstimates(months, [
      { monthKey: "2026-09", estimatedInflow: 1000, estimatedOutflow: 400 },
    ]);
    assert.equal(merged.length, 2);
    const set = merged.find((m) => m.monthKey === "2026-09")!;
    assert.equal(set.kind, "FORECAST");
    assert.equal(set.estimateOnly, true);
    assert.equal(set.inflows, 1000);
    assert.equal(set.outflows, 400);
    // Encadeia no fechamento do último mês real (julho fechou em 0).
    assert.equal(set.opening, 0);
    assert.equal(set.closing, 600);
    assert.equal(set.divergence, null);
    assert.equal(set.days.length, 0);
  });

  it("Começou/Terminou dos meses estimados acumulam a partir do último fechamento real", () => {
    const months = buildTreasuryCaixaMonthlyTimeline(
      tl([d("2026-07-10", { closing: 500 })])
    );
    const merged = appendTreasuryCaixaMonthlyDueEstimates(months, [
      { monthKey: "2026-08", estimatedInflow: 1000, estimatedOutflow: 400 },
      { monthKey: "2026-09", estimatedInflow: 200, estimatedOutflow: 800 },
    ]);
    const ago = merged.find((m) => m.monthKey === "2026-08")!;
    const set = merged.find((m) => m.monthKey === "2026-09")!;
    assert.equal(ago.opening, 500);
    assert.equal(ago.closing, 1100);
    // Setembro abre onde agosto estimado terminou — cadeia contínua.
    assert.equal(set.opening, 1100);
    assert.equal(set.closing, 500);
  });

  it("mês estimado que fecha negativo é marcado (alerta visual)", () => {
    const months = buildTreasuryCaixaMonthlyTimeline(
      tl([d("2026-07-10", { closing: 100 })])
    );
    const merged = appendTreasuryCaixaMonthlyDueEstimates(months, [
      { monthKey: "2026-08", estimatedInflow: 0, estimatedOutflow: 500 },
    ]);
    const ago = merged.find((m) => m.monthKey === "2026-08")!;
    assert.equal(ago.closing, -400);
    assert.equal(ago.negative, true);
  });

  it("sem nenhum mês fechado antes não há âncora — saldo fica null, não inventa", () => {
    const merged = appendTreasuryCaixaMonthlyDueEstimates([], [
      { monthKey: "2026-09", estimatedInflow: 1000, estimatedOutflow: 400 },
    ]);
    const set = merged[0]!;
    assert.equal(set.opening, null);
    assert.equal(set.closing, null);
    assert.equal(set.negative, false);
  });
});

describe("treasuryCaixaRules — appendTreasuryCaixaDailyDueEstimates", () => {
  /** Linha do tempo mínima: hoje fechado num valor conhecido. */
  function baseTimeline(todayClosing: number | null) {
    return {
      todayCivilDate: TODAY,
      rows: [
        d(TODAY, {
          closing: todayClosing,
          closingCalculated: todayClosing,
        }),
      ],
      realizedCount: 0,
      forecastCount: 0,
      firstNegativeDate: null,
    };
  }

  it("encadeia dia a dia a partir do fechamento de hoje (âncora = último caixa conhecido)", () => {
    const tlOut = appendTreasuryCaixaDailyDueEstimates(baseTimeline(100), [
      { civilDate: "2026-08-05", estimatedInflow: 50, estimatedOutflow: 20 },
      { civilDate: "2026-08-07", estimatedInflow: 0, estimatedOutflow: 80 },
    ]);
    const d5 = tlOut.rows.find((r) => r.civilDate === "2026-08-05")!;
    const d7 = tlOut.rows.find((r) => r.civilDate === "2026-08-07")!;
    assert.equal(d5.opening, 100);
    assert.equal(d5.closing, 130);
    assert.equal(d5.estimated, true);
    assert.equal(d5.kind, "FORECAST");
    // O dia 06 (sem movimento) não vira linha; o saldo atravessa o vão.
    assert.equal(d7.opening, 130);
    assert.equal(d7.closing, 50);
    assert.equal(tlOut.forecastCount, 2);
  });

  it("responde 'que dia o caixa aperta': fechamento estimado negativo marca o dia", () => {
    const tlOut = appendTreasuryCaixaDailyDueEstimates(baseTimeline(100), [
      { civilDate: "2026-08-05", estimatedInflow: 0, estimatedOutflow: 60 },
      { civilDate: "2026-08-06", estimatedInflow: 0, estimatedOutflow: 70 },
    ]);
    const d6 = tlOut.rows.find((r) => r.civilDate === "2026-08-06")!;
    assert.equal(d6.closing, -30);
    assert.equal(d6.negative, true);
    assert.equal(tlOut.firstNegativeDate, "2026-08-06");
  });

  it("não duplica dia já coberto (hoje/agenda) nem cria dia sem movimento", () => {
    const tlOut = appendTreasuryCaixaDailyDueEstimates(baseTimeline(100), [
      { civilDate: TODAY, estimatedInflow: 999, estimatedOutflow: 0 },
      { civilDate: "2026-08-01", estimatedInflow: 999, estimatedOutflow: 0 },
      { civilDate: "2026-08-05", estimatedInflow: 0, estimatedOutflow: 0 },
    ]);
    assert.equal(tlOut.rows.length, 1);
  });

  it("âncora pula fechamento null no fim da linha (usa o último conhecido)", () => {
    const tl = {
      todayCivilDate: TODAY,
      rows: [
        d("2026-08-02", { closing: 200, closingCalculated: 200 }),
        d(TODAY, { closing: null, closingCalculated: null }),
      ],
      realizedCount: 1,
      forecastCount: 0,
      firstNegativeDate: null,
    };
    const tlOut = appendTreasuryCaixaDailyDueEstimates(tl, [
      { civilDate: "2026-08-05", estimatedInflow: 10, estimatedOutflow: 0 },
    ]);
    const d5 = tlOut.rows.find((r) => r.civilDate === "2026-08-05")!;
    assert.equal(d5.opening, 200);
    assert.equal(d5.closing, 210);
  });

  it("sem nenhum fechamento conhecido, mostra o fluxo estimado com saldo null", () => {
    const tlOut = appendTreasuryCaixaDailyDueEstimates(baseTimeline(null), [
      { civilDate: "2026-08-05", estimatedInflow: 10, estimatedOutflow: 5 },
    ]);
    const d5 = tlOut.rows.find((r) => r.civilDate === "2026-08-05")!;
    assert.equal(d5.inflows, 10);
    assert.equal(d5.outflows, 5);
    assert.equal(d5.opening, null);
    assert.equal(d5.closing, null);
    assert.equal(d5.negative, false);
  });

  it("mês cujos dias são todos estimados herda o selo; mês misto não", () => {
    const tlOut = appendTreasuryCaixaDailyDueEstimates(baseTimeline(100), [
      { civilDate: "2026-09-10", estimatedInflow: 10, estimatedOutflow: 0 },
      { civilDate: "2026-09-20", estimatedInflow: 0, estimatedOutflow: 5 },
    ]);
    const months = buildTreasuryCaixaMonthlyTimeline(tlOut.rows);
    const set = months.find((m) => m.monthKey === "2026-09")!;
    assert.equal(set.estimateOnly, true);
    // Mês de hoje mistura dia real com nada estimado — sem selo.
    const ago = months.find((m) => m.monthKey === "2026-08")!;
    assert.equal(ago.estimateOnly, undefined);
    // Saldo do mês estimado vem da cadeia diária.
    assert.equal(set.opening, 100);
    assert.equal(set.closing, 105);
  });

  it("NÃO sobrescreve mês que já tem dias reais (mais preciso)", () => {
    const months = buildTreasuryCaixaMonthlyTimeline(
      tl([d("2026-09-10", { inflows: 50, outflows: 10, closing: 40 })])
    );
    const merged = appendTreasuryCaixaMonthlyDueEstimates(months, [
      { monthKey: "2026-09", estimatedInflow: 999999, estimatedOutflow: 999999 },
    ]);
    assert.equal(merged.length, 1);
    const set = merged[0]!;
    assert.equal(set.inflows, 50);
    assert.equal(set.outflows, 10);
    assert.equal(set.estimateOnly, undefined);
  });

  it("mantém ordenação cronológica ao inserir meses complementados no meio", () => {
    const months = buildTreasuryCaixaMonthlyTimeline(
      tl([d("2026-07-10"), d("2026-12-10")])
    );
    const merged = appendTreasuryCaixaMonthlyDueEstimates(months, [
      { monthKey: "2026-09", estimatedInflow: 10, estimatedOutflow: 0 },
      { monthKey: "2026-08", estimatedInflow: 5, estimatedOutflow: 0 },
    ]);
    assert.deepEqual(
      merged.map((m) => m.monthKey),
      ["2026-07", "2026-08", "2026-09", "2026-12"]
    );
  });

  it("sem estimativas → devolve os meses originais inalterados", () => {
    const months = buildTreasuryCaixaMonthlyTimeline(tl([d("2026-07-10")]));
    const merged = appendTreasuryCaixaMonthlyDueEstimates(months, []);
    assert.deepEqual(merged, months);
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

describe("treasuryCaixaRules — applyTreasuryCaixaRunningBalance", () => {
  it("acumula a partir de zero na gênese (01/01/2026)", () => {
    const out = applyTreasuryCaixaRunningBalance([
      realizedDay("2026-01-02", { inflows: 500, outflows: 200 }),
      realizedDay("2026-01-05", { inflows: 100, outflows: 700 }),
    ]);
    assert.equal(out[0]!.opening, 0);
    assert.equal(out[0]!.closing, 300);
    assert.equal(out[1]!.opening, 300);
    assert.equal(out[1]!.closing, -300);
  });

  it("dia antes da gênese fica null — não há premissa de saldo ali", () => {
    const out = applyTreasuryCaixaRunningBalance([
      realizedDay("2025-12-20", { inflows: 1000 }),
      realizedDay("2026-01-01", { inflows: 50 }),
    ]);
    assert.equal(out[0]!.opening, null);
    assert.equal(out[0]!.closing, null);
    // A gênese em si já acumula (zero é o saldo DE ENTRADA do dia 01/01).
    assert.equal(out[1]!.opening, 0);
    assert.equal(out[1]!.closing, 50);
  });

  it("acumula na ordem cronológica independente da ordem de entrada", () => {
    const out = applyTreasuryCaixaRunningBalance([
      realizedDay("2026-03-01", { outflows: 100 }),
      realizedDay("2026-01-10", { inflows: 900 }),
    ]);
    const jan = out.find((d) => d.civilDate === "2026-01-10")!;
    const mar = out.find((d) => d.civilDate === "2026-03-01")!;
    assert.equal(jan.opening, 0);
    assert.equal(jan.closing, 900);
    // Março continua a cadeia de janeiro mesmo sem dias intermediários.
    assert.equal(mar.opening, 900);
    assert.equal(mar.closing, 800);
  });
});

describe("treasuryCaixaRules — saldo manual sobrepõe o automático", () => {
  it("dia com saldo informado fecha no informado, não no calculado", () => {
    const out = applyTreasuryCaixaRunningBalance(
      [realizedDay("2026-01-02", { inflows: 500, outflows: 200 })],
      { informedClosingByCivilDate: new Map([["2026-01-02", 250]]) }
    );
    // Calculado seria 0 + 500 − 200 = 300; o extrato diz 250.
    assert.equal(out[0]!.closingCalculated, 300);
    assert.equal(out[0]!.closingInformed, 250);
    assert.equal(out[0]!.closing, 250);
    // Faltam R$ 50 que saíram sem título por trás.
    assert.equal(out[0]!.divergence, -50);
  });

  it("o dia seguinte abre no saldo INFORMADO — a série re-ancora na realidade", () => {
    const out = applyTreasuryCaixaRunningBalance(
      [
        realizedDay("2026-01-02", { inflows: 500, outflows: 200 }),
        realizedDay("2026-01-03", { inflows: 100, outflows: 0 }),
      ],
      { informedClosingByCivilDate: new Map([["2026-01-02", 250]]) }
    );
    assert.equal(out[1]!.opening, 250);
    assert.equal(out[1]!.closing, 350);
    // Sem informado no dia 03, não há divergência a declarar.
    assert.equal(out[1]!.divergence, null);
    assert.equal(out[1]!.closingInformed, null);
  });

  it("divergência positiva quando entrou dinheiro sem título", () => {
    const out = applyTreasuryCaixaRunningBalance(
      [realizedDay("2026-01-02", { inflows: 100, outflows: 0 })],
      { informedClosingByCivilDate: new Map([["2026-01-02", 180]]) }
    );
    assert.equal(out[0]!.divergence, 80);
  });

  it("saldo informado em dia SEM título ainda entra na série e re-ancora", () => {
    const out = applyTreasuryCaixaRunningBalance(
      [realizedDay("2026-01-02", { inflows: 100 })],
      { informedClosingByCivilDate: new Map([["2026-01-04", 999]]) }
    );
    const day4 = out.find((d) => d.civilDate === "2026-01-04");
    assert.ok(day4, "dia sem título mas com saldo informado precisa existir");
    assert.equal(day4!.inflows, 0);
    assert.equal(day4!.closingInformed, 999);
    assert.equal(day4!.closing, 999);
    // Calculado herdaria 100 do dia 02; o extrato diz 999.
    assert.equal(day4!.closingCalculated, 100);
    assert.equal(day4!.divergence, 899);
  });

  it("informado igual ao calculado → divergência zero (não null)", () => {
    const out = applyTreasuryCaixaRunningBalance(
      [realizedDay("2026-01-02", { inflows: 300 })],
      { informedClosingByCivilDate: new Map([["2026-01-02", 300]]) }
    );
    assert.equal(out[0]!.divergence, 0);
  });

  it("o mês soma as divergências dos dias e conta quantos divergem", () => {
    const months = buildTreasuryCaixaMonthlyTimeline([
      d("2026-07-01", { closing: 100, divergence: -50 }),
      d("2026-07-02", { closing: 200, divergence: 30 }),
      d("2026-07-03", { closing: 300, divergence: 0 }),
    ]);
    assert.equal(months[0]!.divergence, -20);
    // O dia com divergência exatamente zero não conta como divergente.
    assert.equal(months[0]!.divergentDayCount, 2);
  });

  it("mês sem nenhum saldo informado tem divergência null, não zero", () => {
    const months = buildTreasuryCaixaMonthlyTimeline([
      d("2026-07-01", { closing: 100 }),
      d("2026-07-02", { closing: 200 }),
    ]);
    assert.equal(months[0]!.divergence, null);
    assert.equal(months[0]!.divergentDayCount, 0);
  });
});

describe("treasuryCaixaRules — detectTreasuryCaixaOutliers", () => {
  function row(civilDate: string, inflows: number, outflows = 0) {
    return d(civilDate, { inflows, outflows });
  }

  it("marca o dia que dispara para cima", () => {
    // Série estável em ~100 com um dia de 5000.
    const rows = [
      row("2026-07-01", 100),
      row("2026-07-02", 110),
      row("2026-07-03", 95),
      row("2026-07-04", 105),
      row("2026-07-05", 5000),
    ];
    const found = detectTreasuryCaixaOutliers(rows);
    const inflow = found.filter((f) => f.field === "inflows");
    assert.equal(inflow.length, 1);
    assert.equal(inflow[0]!.civilDate, "2026-07-05");
    assert.equal(inflow[0]!.direction, "HIGH");
    assert.equal(inflow[0]!.value, 5000);
  });

  it("marca o dia que despenca para baixo", () => {
    const rows = [
      row("2026-07-01", 1000),
      row("2026-07-02", 1100),
      row("2026-07-03", 950),
      row("2026-07-04", 1050),
      row("2026-07-05", 1),
    ];
    const found = detectTreasuryCaixaOutliers(rows).filter(
      (f) => f.field === "inflows"
    );
    assert.equal(found.length, 1);
    assert.equal(found[0]!.direction, "LOW");
  });

  it("série homogênea não marca ninguém", () => {
    const rows = [
      row("2026-07-01", 100),
      row("2026-07-02", 105),
      row("2026-07-03", 95),
      row("2026-07-04", 102),
      row("2026-07-05", 98),
    ];
    assert.deepEqual(detectTreasuryCaixaOutliers(rows), []);
  });

  it("série constante não marca ninguém (não há dispersão)", () => {
    const rows = [
      row("2026-07-01", 100),
      row("2026-07-02", 100),
      row("2026-07-03", 100),
      row("2026-07-04", 100),
    ];
    assert.deepEqual(detectTreasuryCaixaOutliers(rows), []);
  });

  it("amostra pequena demais não marca nada", () => {
    const rows = [row("2026-07-01", 10), row("2026-07-02", 99999)];
    assert.deepEqual(detectTreasuryCaixaOutliers(rows), []);
  });

  it("dias parados (zero) não entram na referência nem são marcados", () => {
    // Sem o filtro de zero, a mediana viraria 0 e todo movimento seria anômalo.
    const rows = [
      row("2026-07-01", 0),
      row("2026-07-02", 0),
      row("2026-07-03", 0),
      row("2026-07-04", 0),
      row("2026-07-05", 100),
      row("2026-07-06", 110),
      row("2026-07-07", 90),
      row("2026-07-08", 105),
    ];
    const found = detectTreasuryCaixaOutliers(rows);
    assert.deepEqual(found, []);
  });

  it("entradas e saídas são avaliadas separadamente", () => {
    const rows = [
      d("2026-07-01", { inflows: 100, outflows: 50 }),
      d("2026-07-02", { inflows: 110, outflows: 55 }),
      d("2026-07-03", { inflows: 95, outflows: 45 }),
      d("2026-07-04", { inflows: 105, outflows: 52 }),
      d("2026-07-05", { inflows: 100, outflows: 9000 }),
    ];
    const found = detectTreasuryCaixaOutliers(rows);
    assert.equal(found.length, 1);
    assert.equal(found[0]!.field, "outflows");
    assert.equal(found[0]!.direction, "HIGH");
  });

  it("preserva a zona do dia (realizado x previsto) para a tela distinguir", () => {
    const rows = [
      row("2026-08-01", 100),
      row("2026-08-02", 110),
      row("2026-08-04", 95),
      row("2026-08-05", 105),
      row("2026-08-06", 8000),
    ];
    const found = detectTreasuryCaixaOutliers(rows);
    assert.equal(found[0]!.kind, "FORECAST");
  });
});

describe("treasuryCaixaRules — buildTreasuryCaixaMonthlyBalanceChart", () => {
  it("gera um ponto por mês com fechamento, rotulado em pt-BR", () => {
    const months = buildTreasuryCaixaMonthlyTimeline([
      d("2026-01-31", { closing: 1000 }),
      d("2026-02-28", { closing: -250 }),
    ]);
    const points = buildTreasuryCaixaMonthlyBalanceChart(months);
    assert.deepEqual(
      points.map((p) => p.label),
      ["jan/26", "fev/26"]
    );
    assert.equal(points[0]!.closingBalance, 1000);
    assert.equal(points[1]!.closingBalance, -250);
  });

  it("mês sem fechamento não vira ponto (não interpola saldo)", () => {
    const months = buildTreasuryCaixaMonthlyTimeline([
      d("2026-01-31", { closing: null }),
      d("2026-02-28", { closing: 500 }),
    ]);
    const points = buildTreasuryCaixaMonthlyBalanceChart(months);
    assert.equal(points.length, 1);
    assert.equal(points[0]!.monthKey, "2026-02");
  });

  it("marca o mês de previsão para a tela poder tracejar a linha", () => {
    const months = buildTreasuryCaixaMonthlyTimeline([
      d("2026-09-01", { closing: 700 }),
    ]);
    const points = buildTreasuryCaixaMonthlyBalanceChart(months);
    assert.equal(points[0]!.isForecast, true);
  });

  it("sem meses → série vazia, sem erro", () => {
    assert.deepEqual(buildTreasuryCaixaMonthlyBalanceChart([]), []);
  });
});

describe("treasuryCaixaRules — buildTreasuryCaixaUnifiedTimeline", () => {

  it("junta passado (fato), hoje (fato) e futuro (previsão) numa linha só", () => {
    const tl = buildTreasuryCaixaUnifiedTimeline({
      todayCivilDate: TODAY,
      realizedDays: [
        // Já vem acumulado pelo chamador (applyTreasuryCaixaRunningBalance).
        realizedDay("2026-08-01", {
          inflows: 500,
          outflows: 200,
          opening: 1000,
          closing: 1300,
          closingCalculated: 1300,
        }),
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
    // Passado: entrou/saiu são fato; saldo é o acumulado desde a gênese.
    assert.equal(tl.rows[0]!.inflows, 500);
    assert.equal(tl.rows[0]!.opening, 1000);
    assert.equal(tl.rows[0]!.closing, 1300);
    // Futuro usa a previsão, não o realizado.
    assert.equal(tl.rows[2]!.inflows, 700);
  });

  it("dia realizado que caia hoje ou no futuro é descartado (evita duplicar)", () => {
    const tl = buildTreasuryCaixaUnifiedTimeline({
      todayCivilDate: TODAY,
      realizedDays: [
        realizedDay(TODAY, { inflows: 999 }),
        realizedDay("2026-08-09", { inflows: 888 }),
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

  it("hoje é a REALIDADE mesmo quando a projeção cobre o dia (saldo informado manda)", () => {
    // Cenário do bug real: informado 428k, mas a projeção achava que hoje
    // abriria com 239k (descontou no passado CPs vencidos que nunca saíram).
    const tl = buildTreasuryCaixaUnifiedTimeline({
      todayCivilDate: TODAY,
      realizedDays: [],
      todayFlow: {
        civilDate: TODAY,
        opening: 428461.9,
        inflows: 11753.59,
        outflows: 15000,
        closingCalculated: 425215.49,
        closingInformed: null,
        divergence: null,
        accountCount: 2,
        pendingClosingCount: 2,
      },
      forecastDays: [
        {
          civilDate: TODAY,
          openingBalance: 239279.25,
          inflows: 158856.39,
          outflows: 65648.9,
          closingBalance: 332486.74,
        },
      ],
    });
    const today = tl.rows.find((r) => r.kind === "TODAY")!;
    assert.equal(today.opening, 428461.9);
    assert.equal(today.inflows, 11753.59);
    assert.equal(today.outflows, 15000);
    assert.equal(today.closing, 425215.49);
  });

  it("futuro re-ancora no fechamento real de hoje — amanhã abre onde hoje terminou", () => {
    const tl = buildTreasuryCaixaUnifiedTimeline({
      todayCivilDate: TODAY,
      realizedDays: [],
      todayFlow: {
        civilDate: TODAY,
        opening: 428461.9,
        inflows: 11753.59,
        outflows: 15000,
        closingCalculated: 425215.49,
        closingInformed: null,
        divergence: null,
        accountCount: 2,
        pendingClosingCount: 2,
      },
      forecastDays: [
        {
          civilDate: TODAY,
          openingBalance: 239279.25,
          inflows: 158856.39,
          outflows: 65648.9,
          closingBalance: 332486.74,
        },
        {
          civilDate: "2026-08-04",
          openingBalance: 332486.74,
          inflows: 43436.86,
          outflows: 20248.58,
          closingBalance: 355675.02,
        },
        {
          civilDate: "2026-08-05",
          openingBalance: 355675.02,
          inflows: 11894.34,
          outflows: 35420.78,
          closingBalance: 332148.58,
        },
      ],
    });
    // shift = 425.215,49 − 332.486,74 = 92.728,75
    const d4 = tl.rows.find((r) => r.civilDate === "2026-08-04")!;
    const d5 = tl.rows.find((r) => r.civilDate === "2026-08-05")!;
    // Amanhã abre exatamente onde hoje terminou de verdade (sem degrau).
    assert.equal(d4.opening, 425215.49);
    assert.equal(d4.closing, 448403.77);
    // Movimentos diários da projeção não mudam — só os saldos se deslocam.
    assert.equal(d4.inflows, 43436.86);
    assert.equal(d4.outflows, 20248.58);
    // A cadeia continua encadeada: 05 abre onde 04 fechou.
    assert.equal(d5.opening, d4.closing);
    assert.equal(d5.closing, 424877.33);
  });

  it("fechamento INFORMADO de hoje tem prioridade sobre o calculado como âncora", () => {
    const tl = buildTreasuryCaixaUnifiedTimeline({
      todayCivilDate: TODAY,
      realizedDays: [],
      todayFlow: {
        civilDate: TODAY,
        opening: 1000,
        inflows: 0,
        outflows: 0,
        closingCalculated: 1000,
        // Extrato diz 900 — dinheiro saiu sem título; a realidade manda.
        closingInformed: 900,
        divergence: -100,
        accountCount: 1,
        pendingClosingCount: 0,
      },
      forecastDays: [
        {
          civilDate: TODAY,
          openingBalance: 1000,
          inflows: 0,
          outflows: 0,
          closingBalance: 1000,
        },
        {
          civilDate: "2026-08-04",
          openingBalance: 1000,
          inflows: 50,
          outflows: 0,
          closingBalance: 1050,
        },
      ],
    });
    const d4 = tl.rows.find((r) => r.civilDate === "2026-08-04")!;
    assert.equal(d4.opening, 900);
    assert.equal(d4.closing, 950);
  });

  it("re-ancorar pode revelar (ou desfazer) saldo negativo futuro", () => {
    const tl = buildTreasuryCaixaUnifiedTimeline({
      todayCivilDate: TODAY,
      realizedDays: [],
      todayFlow: {
        civilDate: TODAY,
        opening: 100,
        inflows: 0,
        outflows: 90,
        closingCalculated: 10,
        closingInformed: null,
        divergence: null,
        accountCount: 1,
        pendingClosingCount: 1,
      },
      forecastDays: [
        {
          civilDate: TODAY,
          openingBalance: 500,
          inflows: 0,
          outflows: 0,
          closingBalance: 500,
        },
        {
          // Na projeção fecharia positivo (+80); ancorado na realidade (10),
          // o dia fecha negativo: 80 − 490 = −410.
          civilDate: "2026-08-04",
          openingBalance: 500,
          inflows: 0,
          outflows: 420,
          closingBalance: 80,
        },
      ],
    });
    assert.equal(tl.firstNegativeDate, "2026-08-04");
    assert.equal(tl.rows.find((r) => r.civilDate === "2026-08-04")!.closing, -410);
  });

  it("projeção que NÃO cobre hoje não é re-ancorada (sem elo, não inventa)", () => {
    const tl = buildTreasuryCaixaUnifiedTimeline({
      todayCivilDate: TODAY,
      realizedDays: [],
      todayFlow: {
        civilDate: TODAY,
        opening: 1000,
        inflows: 0,
        outflows: 0,
        closingCalculated: 1000,
        closingInformed: null,
        divergence: null,
        accountCount: 1,
        pendingClosingCount: 0,
      },
      // Filtro de um mês futuro: entre hoje e 01/09 há dias não cobertos —
      // igualar a abertura de setembro ao caixa de hoje mentiria.
      forecastDays: [
        {
          civilDate: "2026-09-01",
          openingBalance: 700,
          inflows: 10,
          outflows: 0,
          closingBalance: 710,
        },
      ],
    });
    const sep = tl.rows.find((r) => r.civilDate === "2026-09-01")!;
    assert.equal(sep.opening, 700);
    assert.equal(sep.closing, 710);
  });

  it("sem fluxo de hoje, a agenda preenche hoje como fallback (sem re-ancorar)", () => {
    const tl = buildTreasuryCaixaUnifiedTimeline({
      todayCivilDate: TODAY,
      realizedDays: [],
      todayFlow: null,
      forecastDays: [
        {
          civilDate: TODAY,
          openingBalance: 200,
          inflows: 30,
          outflows: 10,
          closingBalance: 220,
        },
        {
          civilDate: "2026-08-04",
          openingBalance: 220,
          inflows: 0,
          outflows: 0,
          closingBalance: 220,
        },
      ],
    });
    const today = tl.rows.find((r) => r.kind === "TODAY")!;
    assert.equal(today.opening, 200);
    assert.equal(today.closing, 220);
    assert.equal(
      tl.rows.find((r) => r.civilDate === "2026-08-04")!.opening,
      220
    );
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
  it("CP com data de pagamento informada entra no dia em que o dinheiro ANDOU", () => {
    const days = buildTreasuryCaixaRealizedDays({
      receivables: [],
      // Vencido em 10/07, pago em 15/07 — a realidade (pagamento) manda.
      payables: [
        { dueDate: "2026-07-10", paymentDate: "2026-07-15", amountPaid: 5000 },
      ],
    });
    assert.equal(days.length, 1);
    assert.equal(days[0]!.civilDate, "2026-07-15");
    assert.equal(days[0]!.outflows, 5000);
  });

  it("CP sem data de pagamento cai no vencimento (fallback — Nomus raramente informa)", () => {
    const days = buildTreasuryCaixaRealizedDays({
      receivables: [],
      payables: [{ dueDate: "2026-07-10", paymentDate: null, amountPaid: 5000 }],
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

describe("treasuryCaixaRules — invariância temporal (R08): dueDate=05/08, settlementDate=07/08, R$100", () => {
  // A regra dos 3 dias já resolveu a data efetiva ANTES deste ponto (é o que
  // `buildTreasuryCaixaCanonicalRealizedInputs` prova em
  // treasuryCaixaServiceCanonicalRealized.test.ts — R01..R07): o título entra
  // em `buildTreasuryCaixaRealizedDays` já com `settlementDate: "2026-08-05"`
  // (dueDate), NUNCA "2026-08-07" (a data real da baixa). Nenhuma função deste
  // arquivo recebe "hoje" como parâmetro na hora de resolver a data efetiva —
  // por isso a invariância é garantida por CONSTRUÇÃO, não por um caso de
  // sorte. Este teste prova a ponta final: montar a Timeline com "hoje"
  // avançando de 05/08 até 15/08 nunca desloca o valor de 05/08 para 07/08.
  const realizedDaysAll = applyTreasuryCaixaRunningBalance(
    buildTreasuryCaixaRealizedDays({
      receivables: [{ settlementDate: "2026-08-05", amountReceived: 100 }],
      payables: [],
    }),
    { informedClosingByCivilDate: new Map() }
  );

  for (const today of [
    "2026-08-05",
    "2026-08-06",
    "2026-08-07",
    "2026-08-08",
    "2026-08-15",
  ]) {
    it(`today=${today} — 05/08 continua com R$100, 07/08 continua com R$0`, () => {
      const timeline = buildTreasuryCaixaUnifiedTimeline({
        todayCivilDate: today,
        realizedDays: realizedDaysAll,
        todayFlow: null,
        forecastDays: [],
      });
      const day0508 = timeline.rows.find((r) => r.civilDate === "2026-08-05");
      const day0708 = timeline.rows.find((r) => r.civilDate === "2026-08-07");

      // 05/08 só aparece como linha quando já é passado ou é o próprio "hoje"
      // (sem todayFlow, "hoje" não gera linha — ver fallback da agenda); para
      // today >= 05/08 a linha existe e vale R$100.
      if (today > "2026-08-05") {
        assert.ok(day0508, `esperava linha de 05/08 para today=${today}`);
        assert.equal(day0508!.inflows, 100);
      }
      // 07/08 NUNCA tem entrada própria — o título não duplicou nem migrou
      // para lá em nenhum cenário de "hoje".
      assert.equal(day0708, undefined);
    });
  }
});

describe("treasuryCaixaRules — mensal = soma dos dias, sem duplicação (R10, R11)", () => {
  it("dueDate 05/08, baixa 07/08 (dentro da tolerância) — agosto soma R$100 UMA única vez, nunca R$200", () => {
    const realizedDaysAll = applyTreasuryCaixaRunningBalance(
      buildTreasuryCaixaRealizedDays({
        // Já com a data efetiva resolvida (05/08) — não a data real da baixa.
        receivables: [{ settlementDate: "2026-08-05", amountReceived: 100 }],
        payables: [],
      }),
      { informedClosingByCivilDate: new Map() }
    );
    const timeline = buildTreasuryCaixaUnifiedTimeline({
      todayCivilDate: "2026-08-31",
      realizedDays: realizedDaysAll,
      todayFlow: null,
      forecastDays: [],
    });
    const months = buildTreasuryCaixaMonthlyTimeline(timeline.rows);
    const august = months.find((m) => m.monthKey === "2026-08");

    assert.ok(august);
    assert.equal(august!.inflows, 100);

    // Soma dos dias == mês (a mesma invariante que a UI usa para não ter uma
    // segunda verdade mensal).
    const sumOfDays = timeline.rows
      .filter((r) => r.civilDate.startsWith("2026-08"))
      .reduce((s, r) => s + r.inflows, 0);
    assert.equal(august!.inflows, sumOfDays);
  });

  it("dois títulos, o mesmo mês, nenhum duplica: mensal = soma exata dos diários canônicos", () => {
    const realizedDaysAll = applyTreasuryCaixaRunningBalance(
      buildTreasuryCaixaRealizedDays({
        receivables: [
          { settlementDate: "2026-08-05", amountReceived: 100 }, // dueDate 05/08, baixa 07/08 (já resolvida)
          { settlementDate: "2026-08-20", amountReceived: 250 }, // título independente, no vencimento
        ],
        payables: [{ dueDate: "2026-08-10", amountPaid: 60 }],
      }),
      { informedClosingByCivilDate: new Map() }
    );
    const timeline = buildTreasuryCaixaUnifiedTimeline({
      todayCivilDate: "2026-08-31",
      realizedDays: realizedDaysAll,
      todayFlow: null,
      forecastDays: [],
    });
    const months = buildTreasuryCaixaMonthlyTimeline(timeline.rows);
    const august = months.find((m) => m.monthKey === "2026-08");

    assert.equal(august!.inflows, 350);
    assert.equal(august!.outflows, 60);
  });
});

describe("treasuryCaixaRules — isolamento de fonte (SRC04, SRC05, SRC06)", () => {
  it("SRC04 — saldo manual (opening/closingInformed) continua funcionando após a correção canônica", () => {
    const flow: TreasuryCaixaDayFlow = {
      civilDate: "2026-08-07",
      opening: 1000,
      inflows: 0,
      outflows: 0,
      closingCalculated: 1000,
      closingInformed: 950,
      divergence: -50,
      accountCount: 1,
      pendingClosingCount: 0,
    };
    const day = canonicalDay({ receivableReceived: 40, payablePaid: 10 });
    const corrected = applyTreasuryCaixaCanonicalTodayFlow(flow, day);
    // Âncora manual preservada; só o cálculo derivado muda.
    assert.equal(corrected.opening, 1000);
    assert.equal(corrected.closingInformed, 950);
  });

  it("SRC05 — AP altera apenas saídas (outflows), nunca inflows", () => {
    const days = buildTreasuryCaixaRealizedDays({
      receivables: [],
      payables: [{ dueDate: "2026-08-05", amountPaid: 500 }],
    });
    assert.equal(days[0]!.outflows, 500);
    assert.equal(days[0]!.inflows, 0);
  });

  it("SRC06 — AR altera apenas entradas (inflows), nunca outflows", () => {
    const days = buildTreasuryCaixaRealizedDays({
      receivables: [{ settlementDate: "2026-08-05", amountReceived: 700 }],
      payables: [],
    });
    assert.equal(days[0]!.inflows, 700);
    assert.equal(days[0]!.outflows, 0);
  });
});
