import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  goalSeriesMonthCivilDate,
  limitGoalSeriesToMonth,
  listGoalSeriesMonths,
} from "./goalSeries.js";

describe("listGoalSeriesMonths", () => {
  it("cobre o ano inteiro inclusive nas duas pontas", () => {
    const months = listGoalSeriesMonths("2026-01-01", "2026-12-31");
    assert.equal(months.length, 12);
    assert.equal(months[0], "2026-01");
    assert.equal(months[11], "2026-12");
  });

  it("janela dentro do mesmo mês devolve um mês só", () => {
    assert.deepEqual(listGoalSeriesMonths("2026-03-05", "2026-03-20"), ["2026-03"]);
  });

  it("atravessa a virada de ano", () => {
    assert.deepEqual(listGoalSeriesMonths("2025-11-15", "2026-02-10"), [
      "2025-11",
      "2025-12",
      "2026-01",
      "2026-02",
    ]);
  });

  it("janela invertida ou vazia não gera pontos", () => {
    assert.deepEqual(listGoalSeriesMonths("2026-05-01", "2026-04-01"), []);
    assert.deepEqual(listGoalSeriesMonths("", ""), []);
  });
});

describe("goalSeriesMonthCivilDate", () => {
  it("usa o último dia do mês, respeitando ano bissexto", () => {
    assert.equal(goalSeriesMonthCivilDate("2026-01", "2026-12-31"), "2026-01-31");
    assert.equal(goalSeriesMonthCivilDate("2026-04", "2026-12-31"), "2026-04-30");
    assert.equal(goalSeriesMonthCivilDate("2024-02", "2024-12-31"), "2024-02-29");
    assert.equal(goalSeriesMonthCivilDate("2026-02", "2026-12-31"), "2026-02-28");
  });

  it("último mês parcial é cortado no fim da janela", () => {
    assert.equal(goalSeriesMonthCivilDate("2026-08", "2026-08-17"), "2026-08-17");
  });
});

describe("limitGoalSeriesToMonth", () => {
  it("corta o realizado no mês corrente — mês futuro não vira zero no gráfico", () => {
    const points = [
      { month: "2026-06" },
      { month: "2026-07" },
      { month: "2026-08" },
      { month: "2026-09" },
    ];
    assert.deepEqual(
      limitGoalSeriesToMonth(points, "2026-08").map((p) => p.month),
      ["2026-06", "2026-07", "2026-08"]
    );
  });
});
