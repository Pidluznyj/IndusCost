/**
 * Regressão — matemática de deltas sobre a série canônica.
 *
 * O motor de antecipação/postergação por título foi removido (conceito
 * substituído pelos cenários de volume de vendas). Aqui fica a garantia do
 * que restou: utilitários de data civil e a aplicação do delta acumulado
 * sobre os fechamentos SEM recalcular o Realista (identidade no centavo).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  addCivilDays,
  applyScenarioDeltasToClosings,
  diffCivilDays,
  type TreasuryScenarioDeltaSet,
} from "./treasuryCaixaScenarioDeltas.js";

const EMPTY: TreasuryScenarioDeltaSet = {
  byDay: [],
  outOfHorizonInflow: 0,
  outOfHorizonOutflow: 0,
  changedTitleCount: 0,
};

describe("utilitários de data civil", () => {
  it("addCivilDays atravessa mês/fuso sem deslocar dia (timezone-safe)", () => {
    assert.equal(addCivilDays("2026-08-31", 1), "2026-09-01");
    assert.equal(addCivilDays("2026-08-14", 15), "2026-08-29");
    assert.equal(addCivilDays("2026-12-31", 1), "2027-01-01");
    assert.equal(diffCivilDays("2026-08-14", "2026-08-29"), 15);
  });
});

describe("aplicação sobre a série canônica (Realista intocado)", () => {
  const CANONICAL = new Map<string, number | null>([
    // Exemplo oficial — série da Linha do tempo.
    ["2026-08-19", 413612.53],
    ["2026-08-20", 213877.26],
    ["2026-08-21", 227277.92],
  ]);
  const DAYS = ["2026-08-19", "2026-08-20", "2026-08-21"];

  it("delta vazio devolve a série canônica IDÊNTICA no centavo", () => {
    const out = applyScenarioDeltasToClosings({
      orderedCivilDates: DAYS,
      realisticClosingByDay: CANONICAL,
      deltas: EMPTY,
    });
    assert.equal(out.get("2026-08-19"), 413612.53);
    assert.equal(out.get("2026-08-20"), 213877.26);
    assert.equal(out.get("2026-08-21"), 227277.92);
  });

  it("o deslocamento do fechamento é o delta líquido acumulado", () => {
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
    assert.equal(out.get("2026-08-19"), 413612.53, "dia sem delta intocado");
    assert.equal(out.get("2026-08-20"), 213877.26 + 800);
    assert.equal(out.get("2026-08-21"), 227277.92 + 800 - 300);
  });

  it("deltas negativos (Pessimista por volume) reduzem o fechamento sem tocar a base", () => {
    const deltas: TreasuryScenarioDeltaSet = {
      byDay: [
        // Entradas reduzidas e saídas variáveis reduzidas (economia).
        { civilDate: "2026-08-20", inflowDelta: -5000, outflowDelta: -1500 },
      ],
      outOfHorizonInflow: -2000,
      outOfHorizonOutflow: 0,
      changedTitleCount: 1,
    };
    const out = applyScenarioDeltasToClosings({
      orderedCivilDates: DAYS,
      realisticClosingByDay: CANONICAL,
      deltas,
    });
    assert.equal(out.get("2026-08-20"), 213877.26 - 5000 + 1500);
    assert.equal(out.get("2026-08-21"), 227277.92 - 5000 + 1500);
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
