import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  defaultUntilFor,
  firstDayOf,
  lastDayOfMonth,
  periodsEqual,
} from "./CashSupportWorkspacePage.js";

describe("CashSupportWorkspacePage — derivação de período", () => {
  it("firstDayOf: mês específico vira dia 1 daquele mês", () => {
    assert.equal(firstDayOf({ year: 2026, month: 8, until: "x" }), "2026-08-01");
  });

  it("firstDayOf: 'todos os meses' vira 1º de janeiro", () => {
    assert.equal(firstDayOf({ year: 2026, month: "", until: "x" }), "2026-01-01");
  });

  it("lastDayOfMonth: fevereiro de ano bissexto", () => {
    assert.equal(lastDayOfMonth(2028, 2), "2028-02-29");
  });

  it("lastDayOfMonth: fevereiro de ano não bissexto", () => {
    assert.equal(lastDayOfMonth(2026, 2), "2026-02-28");
  });

  it("defaultUntilFor: ano passado + 'todos os meses' fecha em 31/12 daquele ano", () => {
    assert.equal(defaultUntilFor(2025, "", "2026-08-07"), "2025-12-31");
  });

  it("defaultUntilFor: ano corrente + 'todos os meses' fecha em hoje", () => {
    assert.equal(defaultUntilFor(2026, "", "2026-08-07"), "2026-08-07");
  });

  it("defaultUntilFor: mês passado fecha no último dia daquele mês", () => {
    assert.equal(defaultUntilFor(2026, 7, "2026-08-07"), "2026-07-31");
  });

  it("defaultUntilFor: mês corrente fecha em hoje (nunca no futuro)", () => {
    assert.equal(defaultUntilFor(2026, 8, "2026-08-07"), "2026-08-07");
  });

  it("defaultUntilFor: mês futuro do ano corrente fecha no fim do próprio mês", () => {
    assert.equal(defaultUntilFor(2026, 12, "2026-08-07"), "2026-12-31");
  });

  it("defaultUntilFor: ano futuro + 'todos os meses' fecha em 31/12 (nunca antes do 1º de janeiro)", () => {
    const until = defaultUntilFor(2027, "", "2026-08-07");
    assert.equal(until, "2027-12-31");
    assert.ok(until >= "2027-01-01", "até não pode ficar antes do início do próprio ano");
  });

  it("defaultUntilFor: ano futuro + mes especifico fecha no fim do mes", () => {
    assert.equal(defaultUntilFor(2027, 3, "2026-08-07"), "2027-03-31");
  });

  it("BUG CORRIGIDO: trocar só o Ano nunca deixa civilDateTo referenciando o ano errado", () => {
    // Antes da correção: until ficava parado no valor antigo (ex.: hoje do
    // ano corrente) mesmo depois de escolher um ano passado — o filtro de
    // Ano nao tinha efeito real sobre o limite superior do periodo.
    const until = defaultUntilFor(2024, 8, "2026-08-07");
    assert.equal(until.slice(0, 4), "2024");
  });

  it("invariante: civilDateTo nunca fica antes de civilDateFrom, para qualquer Ano/Mês", () => {
    const today = "2026-08-07";
    for (let year = 2023; year <= 2028; year += 1) {
      for (const month of [1, 6, 8, 12, ""] as const) {
        const from = firstDayOf({ year, month, until: "x" });
        const to = defaultUntilFor(year, month, today);
        assert.ok(
          to >= from,
          `year=${year} month=${month}: civilDateTo (${to}) < civilDateFrom (${from})`
        );
      }
    }
  });
});

describe("periodsEqual — filtros só aplicam no botão Aplicar", () => {
  it("períodos iguais não habilitam o Aplicar", () => {
    assert.equal(
      periodsEqual(
        { year: 2026, month: 2, until: "2026-02-28" },
        { year: 2026, month: 2, until: "2026-02-28" }
      ),
      true
    );
  });

  it("qualquer campo editado marca filtro pendente (ano, mês ou até)", () => {
    const base = { year: 2026, month: 2 as const, until: "2026-02-28" };
    assert.equal(periodsEqual(base, { ...base, year: 2025 }), false);
    assert.equal(periodsEqual(base, { ...base, month: 3 }), false);
    assert.equal(periodsEqual(base, { ...base, month: "" }), false);
    assert.equal(periodsEqual(base, { ...base, until: "2026-02-27" }), false);
  });
});
