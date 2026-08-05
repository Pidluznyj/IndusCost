/**
 * Regressão — motor de DELTAS Otimista/Pessimista sobre a série canônica.
 *
 * Cobre os testes obrigatórios da spec: Realista intocado (delta zero =
 * série idêntica), conservação de valores, dupla contagem, zonas do tempo
 * (passado/hoje/futuro), clamp D+1, fora do horizonte, parâmetro pessimista
 * (global × cliente P90), datas nulas e o exemplo oficial da Linha do tempo.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { TreasuryScenarioPolicyDto } from "../contracts/treasuryScenarioPolicyContracts.js";
import type {
  TreasuryScenarioOpenPayable,
  TreasuryScenarioOpenReceivable,
} from "./treasuryCaixaScenarios.js";
import {
  addCivilDays,
  applyScenarioDeltasToClosings,
  buildTreasuryScenarioExecutiveLines,
  computeTreasuryCaixaScenarioDeltas,
  diffCivilDays,
  type TreasuryScenarioDeltaSet,
} from "./treasuryCaixaScenarioDeltas.js";

function policy(
  overrides: Partial<TreasuryScenarioPolicyDto> = {}
): TreasuryScenarioPolicyDto {
  return {
    id: "GLOBAL",
    pessimisticEnabled: true,
    optimisticReceivableAdvanceLimitDays: 0,
    optimisticPayableDelayLimitDays: 0,
    pessimisticReceivableDelayDays: 15,
    pessimisticOverdueReceivableDelayDays: null,
    pessimisticTreatBrokenPromiseAsDelayed: true,
    useCustomerBehaviorHistory: false,
    useSupplierBehaviorHistory: false,
    settlementReconciliationEnabled: true,
    settlementReconciliationToleranceDays: 3,
    version: 1,
    updatedAt: "2026-08-05T00:00:00.000-03:00",
    createdAt: "2026-08-05T00:00:00.000-03:00",
    updatedByUserId: null,
    ...overrides,
  };
}

function ar(
  overrides: Partial<TreasuryScenarioOpenReceivable> = {}
): TreasuryScenarioOpenReceivable {
  return {
    externalId: 1,
    personName: "Cliente",
    personCnpj: null,
    dueDate: null,
    settlementDate: null,
    amountReceivable: 1000,
    amountReceived: 0,
    balanceReceivable: 1000,
    calculatedStatus: "open",
    documentNumber: null,
    ...overrides,
  };
}

function ap(
  overrides: Partial<TreasuryScenarioOpenPayable> = {}
): TreasuryScenarioOpenPayable {
  return {
    externalId: 1,
    personName: "Fornecedor",
    personCnpj: null,
    dueDate: null,
    paymentDate: null,
    amountPayable: 500,
    amountPaid: 0,
    balancePayable: 500,
    calculatedStatus: "open",
    documentNumber: null,
    ...overrides,
  };
}

const ASOF = "2026-08-05";
const HORIZON = "2026-09-30";

function run(input: {
  openReceivables?: TreasuryScenarioOpenReceivable[];
  openPayables?: TreasuryScenarioOpenPayable[];
  policy?: TreasuryScenarioPolicyDto;
  horizonEnd?: string;
  customerDelay?: ReadonlyMap<string, number>;
}) {
  return computeTreasuryCaixaScenarioDeltas({
    asOfCivilDate: ASOF,
    horizonEndCivilDate: input.horizonEnd ?? HORIZON,
    openReceivables: input.openReceivables ?? [],
    openPayables: input.openPayables ?? [],
    policy: input.policy ?? policy(),
    customerPessimisticDelayDays: input.customerDelay,
  });
}

function deltaAt(set: TreasuryScenarioDeltaSet, day: string) {
  return (
    set.byDay.find((d) => d.civilDate === day) ?? {
      civilDate: day,
      inflowDelta: 0,
      outflowDelta: 0,
    }
  );
}

function netSum(set: TreasuryScenarioDeltaSet): number {
  return set.byDay.reduce(
    (s, d) => s + d.inflowDelta - d.outflowDelta,
    0
  );
}

describe("utilitários de data civil", () => {
  it("addCivilDays atravessa mês/fuso sem deslocar dia (timezone-safe)", () => {
    assert.equal(addCivilDays("2026-08-31", 1), "2026-09-01");
    assert.equal(addCivilDays("2026-08-14", 15), "2026-08-29");
    assert.equal(diffCivilDays("2026-08-14", "2026-08-29"), 15);
  });
});

describe("Otimista — Contas a Receber", () => {
  it("teste 4 da spec: vencimento 10/08 antes da prevista 14/08 → antecipa; conservação", () => {
    const r = run({
      openReceivables: [
        ar({
          externalId: 10,
          dueDate: "2026-08-10",
          expectedDate: "2026-08-14",
          balanceReceivable: 100000,
        }),
      ],
    });
    // Realista individual = expected 14/08; Otimista = due 10/08.
    assert.equal(deltaAt(r.optimistic, "2026-08-10").inflowDelta, 100000);
    assert.equal(deltaAt(r.optimistic, "2026-08-14").inflowDelta, -100000);
    assert.equal(netSum(r.optimistic), 0, "conservação: soma dos deltas = 0");
    const mem = r.memory.find(
      (m) => m.scenario === "OPTIMISTIC" && m.sourceId === 10
    )!;
    assert.equal(mem.scenarioDate, "2026-08-10");
    assert.equal(mem.realisticIndividualDate, "2026-08-14");
    assert.equal(mem.deltaFromRealisticDays, -4);
    assert.match(mem.explanation, /antecipado.*14\/08.*10\/08.*vencimento oficial/);
  });

  it("promessa ativa 08/08 já É a data Realista → Otimista não muda (delta zero, sem ruído)", () => {
    const r = run({
      openReceivables: [
        ar({
          externalId: 11,
          dueDate: "2026-08-10",
          expectedDate: "2026-08-12",
          activePromiseDate: "2026-08-08",
          activePromiseStatus: "ACTIVE",
        }),
      ],
    });
    // Regra PROBABLE: promessa ativa define a data Realista individual;
    // como a promessa também é a primeira data defensável, Otimista == Realista.
    assert.equal(netSum(r.optimistic), 0);
    const mem = r.memory.find(
      (m) => m.scenario === "OPTIMISTIC" && m.sourceId === 11
    );
    assert.equal(mem, undefined, "UNCHANGED não gera memória");
  });

  it("promessa QUEBRADA é ignorada — Otimista antecipa da prevista 12/08 para o vencimento 10/08", () => {
    const r = run({
      openReceivables: [
        ar({
          externalId: 14,
          dueDate: "2026-08-10",
          expectedDate: "2026-08-12",
          activePromiseDate: "2026-08-08",
          activePromiseStatus: "BROKEN",
        }),
      ],
    });
    // Realista (sem promessa ativa) = prevista 12/08; Otimista = vencimento 10/08.
    assert.equal(deltaAt(r.optimistic, "2026-08-10").inflowDelta, 1000);
    assert.equal(deltaAt(r.optimistic, "2026-08-12").inflowDelta, -1000);
    assert.equal(
      deltaAt(r.optimistic, "2026-08-08").inflowDelta,
      0,
      "a data da promessa quebrada não entra como candidata"
    );
  });

  it("teste 10 da spec: vencido em aberto entra em asOf+1, nunca no passado", () => {
    const r = run({
      openReceivables: [
        ar({ externalId: 12, dueDate: "2026-08-03", balanceReceivable: 700 }),
      ],
    });
    // Realista não projeta vencido sem evidência → adição pura em D+1.
    assert.equal(deltaAt(r.optimistic, "2026-08-06").inflowDelta, 700);
    for (const d of r.optimistic.byDay) {
      assert.ok(d.civilDate > ASOF, "nenhum delta em dia <= asOf");
    }
    const mem = r.memory.find(
      (m) => m.scenario === "OPTIMISTIC" && m.sourceId === 12
    )!;
    assert.equal(mem.appliedRule, "CLAMPED_NEXT_DAY");
  });

  it("teste 11 da spec: vencendo HOJE em aberto não vira realizado hoje — projeta D+1", () => {
    const r = run({
      openReceivables: [
        ar({ externalId: 13, dueDate: ASOF, balanceReceivable: 300 }),
      ],
    });
    assert.equal(deltaAt(r.optimistic, ASOF).inflowDelta, 0, "hoje intocado");
    assert.equal(deltaAt(r.optimistic, "2026-08-06").inflowDelta, 300);
  });
});

describe("Otimista — Contas a Pagar", () => {
  it("teste 5 da spec: agendado 08/08, vencimento 10/08 → posterga para 10/08", () => {
    const r = run({
      openPayables: [
        ap({
          externalId: 20,
          dueDate: "2026-08-10",
          scheduledDate: "2026-08-08",
          balancePayable: 5000,
        }),
      ],
    });
    // Realista individual = scheduled 08/08; Otimista = due 10/08 (última defensável).
    assert.equal(deltaAt(r.optimistic, "2026-08-08").outflowDelta, -5000);
    assert.equal(deltaAt(r.optimistic, "2026-08-10").outflowDelta, 5000);
    assert.equal(netSum(r.optimistic), 0);
  });

  it("prevista negociada 20/08 após o vencimento é usada (informação existente)", () => {
    const r = run({
      openPayables: [
        ap({
          externalId: 21,
          dueDate: "2026-08-10",
          expectedDate: "2026-08-20",
        }),
      ],
    });
    const mem = r.memory.find(
      (m) => m.scenario === "OPTIMISTIC" && m.sourceId === 21
    );
    // Realista (scheduled→expected→due) = expected 20/08; Otimista também
    // 20/08 → delta zero, sem memória (UNCHANGED é omitido).
    assert.equal(mem, undefined);
    assert.equal(netSum(r.optimistic), 0);
  });
});

describe("Pessimista — Contas a Receber", () => {
  it("teste 6 da spec: Realista 14/08 + 15 dias → 29/08", () => {
    const r = run({
      openReceivables: [
        ar({
          externalId: 30,
          dueDate: "2026-08-14",
          balanceReceivable: 2000,
        }),
      ],
    });
    assert.equal(deltaAt(r.pessimistic, "2026-08-14").inflowDelta, -2000);
    assert.equal(deltaAt(r.pessimistic, "2026-08-29").inflowDelta, 2000);
    const mem = r.memory.find(
      (m) => m.scenario === "PESSIMISTIC" && m.sourceId === 30
    )!;
    assert.equal(mem.appliedRule, "PES_DELAY_GLOBAL");
    assert.equal(mem.parameterSource, "POLITICA_GLOBAL");
    assert.match(mem.explanation, /postergado.*14\/08.*29\/08.*15 dias/);
  });

  it("vencido em aberto: base D+1 (06/08) + 15 → 21/08 (exemplo da spec)", () => {
    const r = run({
      openReceivables: [
        ar({ externalId: 31, dueDate: "2026-08-01", balanceReceivable: 900 }),
      ],
    });
    assert.equal(deltaAt(r.pessimistic, "2026-08-21").inflowDelta, 900);
    for (const d of r.pessimistic.byDay) {
      assert.ok(d.civilDate > ASOF);
    }
  });

  it("teste 21 da spec: histórico do cliente (P90) tem prioridade sobre o global", () => {
    const r = run({
      openReceivables: [
        ar({
          externalId: 32,
          dueDate: "2026-08-14",
          personCnpj: "12.345.678/0001-99",
        }),
      ],
      customerDelay: new Map([["12345678000199", 7]]),
    });
    assert.equal(deltaAt(r.pessimistic, "2026-08-21").inflowDelta, 1000);
    const mem = r.memory.find(
      (m) => m.scenario === "PESSIMISTIC" && m.sourceId === 32
    )!;
    assert.equal(mem.appliedRule, "PES_DELAY_CUSTOMER_P90");
    assert.equal(mem.parameterSource, "HISTORICO_CLIENTE_P90");
  });

  it("teste 22 da spec: sem histórico usa o parâmetro global configurado (não número mágico)", () => {
    const r = run({
      openReceivables: [ar({ externalId: 33, dueDate: "2026-08-14" })],
      policy: policy({ pessimisticReceivableDelayDays: 20 }),
    });
    assert.equal(deltaAt(r.pessimistic, "2026-09-03").inflowDelta, 1000);
    assert.equal(r.pessimisticDelayDaysGlobal, 20);
  });
});

describe("Pessimista — Contas a Pagar", () => {
  it("teste 7 da spec: Realista 15/08 (agendado), vencimento 10/08 → antecipa p/ 10/08", () => {
    const r = run({
      openPayables: [
        ap({
          externalId: 40,
          dueDate: "2026-08-10",
          scheduledDate: "2026-08-15",
          balancePayable: 3000,
        }),
      ],
    });
    assert.equal(deltaAt(r.pessimistic, "2026-08-10").outflowDelta, 3000);
    assert.equal(deltaAt(r.pessimistic, "2026-08-15").outflowDelta, -3000);
    assert.equal(netSum(r.pessimistic), 0);
    const mem = r.memory.find(
      (m) => m.scenario === "PESSIMISTIC" && m.sourceId === 40
    )!;
    assert.match(mem.explanation, /antecipado.*15\/08.*10\/08/);
  });

  it("vencido em aberto não vai para o passado nem conta como pago hoje", () => {
    const r = run({
      openPayables: [
        ap({ externalId: 41, dueDate: "2026-08-01", balancePayable: 400 }),
      ],
    });
    assert.equal(deltaAt(r.pessimistic, "2026-08-06").outflowDelta, 400);
    assert.equal(deltaAt(r.pessimistic, ASOF).outflowDelta, 0);
  });
});

describe("dupla contagem e população", () => {
  it("testes 8/9/12 da spec: título liquidado (saldo 0) nunca entra em delta — mesmo com baixa futura anômala", () => {
    const r = run({
      openReceivables: [
        ar({
          externalId: 50,
          dueDate: "2026-08-10",
          settlementDate: "2026-08-20", // baixa futura anômala do Nomus
          amountReceived: 1000,
          balanceReceivable: 0, // liquidado
        }),
      ],
      openPayables: [
        ap({
          externalId: 51,
          dueDate: "2026-08-10",
          amountPaid: 500,
          balancePayable: 0,
        }),
      ],
    });
    assert.equal(r.optimistic.byDay.length, 0);
    assert.equal(r.pessimistic.byDay.length, 0);
    assert.equal(r.memory.length, 0);
  });

  it("baixa parcial usa apenas o saldo remanescente", () => {
    const r = run({
      openReceivables: [
        ar({
          externalId: 52,
          dueDate: "2026-08-14",
          amountReceivable: 1000,
          amountReceived: 400,
          balanceReceivable: 600,
        }),
      ],
    });
    assert.equal(deltaAt(r.pessimistic, "2026-08-29").inflowDelta, 600);
  });

  it("teste 25 da spec: um título aparece uma única vez por cenário", () => {
    const r = run({
      openReceivables: [
        ar({ externalId: 53, dueDate: "2026-08-14", balanceReceivable: 100 }),
      ],
    });
    const optEntries = r.memory.filter(
      (m) => m.scenario === "OPTIMISTIC" && m.sourceId === 53
    );
    const pesEntries = r.memory.filter(
      (m) => m.scenario === "PESSIMISTIC" && m.sourceId === 53
    );
    assert.ok(optEntries.length <= 1);
    assert.equal(pesEntries.length, 1);
  });

  it("teste 24 da spec: datas todas nulas não viram hoje/zero/epoch — título fica fora com memória", () => {
    const r = run({
      openReceivables: [ar({ externalId: 54, dueDate: null })],
    });
    assert.equal(r.optimistic.byDay.length, 0);
    assert.equal(r.pessimistic.byDay.length, 0);
    const mem = r.memory.find((m) => m.sourceId === 54)!;
    assert.equal(mem.appliedRule, "UNPROJECTABLE");
    assert.equal(mem.scenarioDate, null);
  });
});

describe("fora do horizonte (teste 14 da spec)", () => {
  it("deslocamento além do horizonte NÃO cai no último dia — vira outOfHorizon", () => {
    const r = run({
      openReceivables: [
        ar({ externalId: 60, dueDate: "2026-09-25", balanceReceivable: 5000 }),
      ],
      horizonEnd: "2026-09-30",
    });
    // Pessimista: 25/09 + 15 = 10/10 > horizonte 30/09.
    assert.equal(r.pessimistic.outOfHorizonInflow, 5000);
    assert.equal(
      deltaAt(r.pessimistic, "2026-09-30").inflowDelta,
      0,
      "último dia não recebe o valor artificialmente"
    );
    // O lado negativo (remoção da data Realista dentro do horizonte) fica.
    assert.equal(deltaAt(r.pessimistic, "2026-09-25").inflowDelta, -5000);
    const mem = r.memory.find(
      (m) => m.scenario === "PESSIMISTIC" && m.sourceId === 60
    )!;
    assert.equal(mem.isBeyondHorizon, true);
  });

  it("teste 13 da spec: conservação — Σ deltas em janela + fora do horizonte = 0", () => {
    const r = run({
      openReceivables: [
        ar({ externalId: 61, dueDate: "2026-09-25", balanceReceivable: 5000 }),
      ],
      horizonEnd: "2026-09-30",
    });
    const inWindow = netSum(r.pessimistic);
    assert.equal(inWindow + r.pessimistic.outOfHorizonInflow, 0);
  });
});

describe("aplicação sobre a série canônica (Realista intocado)", () => {
  const CANONICAL = new Map<string, number | null>([
    // Exemplo oficial da spec — série da Linha do tempo.
    ["2026-08-19", 413612.53],
    ["2026-08-20", 213877.26],
    ["2026-08-21", 227277.92],
  ]);
  const DAYS = ["2026-08-19", "2026-08-20", "2026-08-21"];

  it("teste 1/2 da spec: delta vazio devolve a série canônica IDÊNTICA no centavo", () => {
    const empty: TreasuryScenarioDeltaSet = {
      byDay: [],
      outOfHorizonInflow: 0,
      outOfHorizonOutflow: 0,
      changedTitleCount: 0,
    };
    const out = applyScenarioDeltasToClosings({
      orderedCivilDates: DAYS,
      realisticClosingByDay: CANONICAL,
      deltas: empty,
    });
    assert.equal(out.get("2026-08-19"), 413612.53);
    assert.equal(out.get("2026-08-20"), 213877.26);
    assert.equal(out.get("2026-08-21"), 227277.92);
  });

  it("teste 3 da spec: títulos grandes (99.999/888.888) só deslocam — nunca somam de novo sobre a Linha do tempo", () => {
    // Título de 99.999 movido de 20/08 (realista) para 19/08 (otimista):
    // 19/08 sobe 99.999; 20/08 e 21/08 voltam ao canônico (delta líquido 0).
    const r = run({
      openReceivables: [
        ar({
          externalId: 70,
          dueDate: "2026-08-19",
          expectedDate: "2026-08-20",
          balanceReceivable: 99999,
        }),
      ],
    });
    const out = applyScenarioDeltasToClosings({
      orderedCivilDates: DAYS,
      realisticClosingByDay: CANONICAL,
      deltas: r.optimistic,
    });
    assert.equal(out.get("2026-08-19"), 413612.53 + 99999);
    assert.equal(out.get("2026-08-20"), 213877.26, "canônico restaurado");
    assert.equal(out.get("2026-08-21"), 227277.92, "canônico intocado");
  });

  it("teste 19 da spec: reconciliação diária — o deslocamento do fechamento é o delta líquido acumulado", () => {
    const deltas: TreasuryScenarioDeltaSet = {
      byDay: [
        { civilDate: "2026-08-20", inflowDelta: 1000, outflowDelta: 200 },
        { civilDate: "2026-08-21", inflowDelta: 0, outflowDelta: 300 },
      ],
      outOfHorizonInflow: 0,
      outOfHorizonOutflow: 0,
      changedTitleCount: 2,
    };
    const out = applyScenarioDeltasToClosings({
      orderedCivilDates: DAYS,
      realisticClosingByDay: CANONICAL,
      deltas,
    });
    assert.equal(out.get("2026-08-19"), 413612.53);
    assert.equal(out.get("2026-08-20"), 213877.26 + 800);
    assert.equal(out.get("2026-08-21"), 227277.92 + 800 - 300);
  });

  it("testes 15/16/17 da spec: passado e hoje ficam idênticos (deltas nunca alcançam dias <= asOf)", () => {
    const r = run({
      openReceivables: [
        ar({ externalId: 80, dueDate: "2026-08-03", balanceReceivable: 999 }),
        ar({ externalId: 81, dueDate: ASOF, balanceReceivable: 111 }),
      ],
      openPayables: [
        ap({ externalId: 82, dueDate: "2026-08-01", balancePayable: 555 }),
      ],
    });
    for (const set of [r.optimistic, r.pessimistic]) {
      for (const d of set.byDay) {
        assert.ok(
          d.civilDate > ASOF,
          `delta em ${d.civilDate} violaria passado/hoje`
        );
      }
    }
  });

  it("fechamento null (indisponível) permanece null — nunca vira zero falso", () => {
    const withNull = new Map<string, number | null>([["2026-08-19", null]]);
    const out = applyScenarioDeltasToClosings({
      orderedCivilDates: ["2026-08-19"],
      realisticClosingByDay: withNull,
      deltas: {
        byDay: [{ civilDate: "2026-08-19", inflowDelta: 100, outflowDelta: 0 }],
        outOfHorizonInflow: 0,
        outOfHorizonOutflow: 0,
        changedTitleCount: 1,
      },
    });
    assert.equal(out.get("2026-08-19"), null);
  });
});

describe("resumo executivo determinístico", () => {
  it("gera frases fixas a partir dos números — sem IA", () => {
    const lines = buildTreasuryScenarioExecutiveLines({
      realistic: {
        minBalance: 213877.26,
        minBalanceDate: "2026-08-20",
        firstNegativeDate: null,
        maxCashNeed: 0,
        finalBalance: 227277.92,
      },
      pessimistic: {
        minBalance: -50000,
        minBalanceDate: "2026-08-25",
        firstNegativeDate: "2026-08-22",
        maxCashNeed: 50000,
        finalBalance: 10000,
      },
      optimistic: {
        minBalance: 300000,
        minBalanceDate: "2026-08-20",
        firstNegativeDate: null,
        maxCashNeed: 0,
        finalBalance: 400000,
      },
      optimisticTopMovers: ["NF 123 — Cliente A", "NF 456 — Cliente B"],
    });
    assert.equal(lines.length, 3);
    assert.match(lines[0]!, /Realista.*menor saldo.*20\/08\/2026/);
    assert.match(lines[1]!, /Pessimista.*negativo em 22\/08\/2026.*capital de giro/);
    assert.match(lines[2]!, /Otimista.*NF 123/);
  });
});
