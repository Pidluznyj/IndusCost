/**
 * Regressão — agregação semanal do valor de estoque de MP.
 * Trava a regra central: o ÚLTIMO snapshot de cada semana ISO representa a
 * semana (valor de fechamento), e semanas sem dado não são inventadas.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  aggregateMaterialStockValueByWeek,
  formatWeekAxisLabel,
  resolveIsoWeekEnd,
  resolveIsoWeekStart,
  summarizeMaterialStockValueSeries,
  type MaterialStockValueSnapshotPoint,
} from "./materialStockValueSeries.js";

function snap(
  civilDate: string,
  totalValue: number,
  overrides: Partial<MaterialStockValueSnapshotPoint> = {}
): MaterialStockValueSnapshotPoint {
  return {
    civilDate,
    totalValue,
    materialsWithStock: 10,
    materialsConsidered: 50,
    capturedAt: `${civilDate}T12:00:00.000Z`,
    ...overrides,
  };
}

describe("resolveIsoWeekStart — semana ISO (segunda a domingo)", () => {
  it("segunda-feira devolve ela mesma", () => {
    // 2026-08-03 é uma segunda-feira.
    assert.equal(resolveIsoWeekStart("2026-08-03"), "2026-08-03");
  });

  it("domingo pertence à semana que começou na segunda anterior", () => {
    // 2026-08-09 é domingo → semana começa em 03/08.
    assert.equal(resolveIsoWeekStart("2026-08-09"), "2026-08-03");
  });

  it("quarta-feira mapeia para a segunda da mesma semana", () => {
    assert.equal(resolveIsoWeekStart("2026-08-05"), "2026-08-03");
  });

  it("atravessa virada de mês corretamente", () => {
    // 2026-09-01 é terça → segunda foi 31/08.
    assert.equal(resolveIsoWeekStart("2026-09-01"), "2026-08-31");
  });

  it("weekEnd é o domingo da mesma semana", () => {
    assert.equal(resolveIsoWeekEnd("2026-08-03"), "2026-08-09");
  });
});

describe("aggregateMaterialStockValueByWeek", () => {
  it("último snapshot da semana representa a semana (valor de fechamento)", () => {
    const weeks = aggregateMaterialStockValueByWeek([
      snap("2026-08-03", 100_000), // segunda
      snap("2026-08-05", 120_000), // quarta
      snap("2026-08-07", 135_000), // sexta ← deve vencer
    ]);
    assert.equal(weeks.length, 1);
    assert.equal(weeks[0]!.weekStart, "2026-08-03");
    assert.equal(weeks[0]!.totalValue, 135_000);
    assert.equal(weeks[0]!.snapshotCount, 3, "conta todas as fotos da semana");
    assert.equal(weeks[0]!.representativeCivilDate, "2026-08-07");
  });

  it("desempata dois snapshots no MESMO dia pelo instante (capturedAt)", () => {
    const weeks = aggregateMaterialStockValueByWeek([
      snap("2026-08-05", 100_000, { capturedAt: "2026-08-05T09:00:00.000Z" }),
      snap("2026-08-05", 175_000, { capturedAt: "2026-08-05T17:30:00.000Z" }),
    ]);
    assert.equal(weeks[0]!.totalValue, 175_000, "o mais tarde do dia vence");
    assert.equal(weeks[0]!.snapshotCount, 2);
  });

  it("separa semanas distintas e calcula a variação entre elas", () => {
    const weeks = aggregateMaterialStockValueByWeek([
      snap("2026-08-07", 100_000), // semana de 03/08
      snap("2026-08-14", 150_000), // semana de 10/08
    ]);
    assert.equal(weeks.length, 2);
    assert.equal(weeks[0]!.deltaFromPreviousWeek, null, "1ª semana não tem anterior");
    assert.equal(weeks[0]!.deltaPercentFromPreviousWeek, null);
    assert.equal(weeks[1]!.deltaFromPreviousWeek, 50_000);
    assert.equal(weeks[1]!.deltaPercentFromPreviousWeek, 50);
  });

  it("queda entre semanas gera delta negativo", () => {
    const weeks = aggregateMaterialStockValueByWeek([
      snap("2026-08-07", 200_000),
      snap("2026-08-14", 150_000),
    ]);
    assert.equal(weeks[1]!.deltaFromPreviousWeek, -50_000);
    assert.equal(weeks[1]!.deltaPercentFromPreviousWeek, -25);
  });

  it("semana SEM snapshot não é inventada (série não cria ponto falso)", () => {
    const weeks = aggregateMaterialStockValueByWeek([
      snap("2026-08-07", 100_000), // semana de 03/08
      // semana de 10/08 sem conferência nenhuma
      snap("2026-08-21", 130_000), // semana de 17/08
    ]);
    assert.equal(weeks.length, 2, "só semanas com dado real");
    assert.deepEqual(
      weeks.map((w) => w.weekStart),
      ["2026-08-03", "2026-08-17"]
    );
    // A comparação é com a semana anterior COM dado, não com a vazia.
    assert.equal(weeks[1]!.deltaFromPreviousWeek, 30_000);
  });

  it("entrada vazia devolve série vazia (sem quebrar)", () => {
    assert.deepEqual(aggregateMaterialStockValueByWeek([]), []);
  });

  it("valor zero legítimo é preservado (não vira ausência)", () => {
    const weeks = aggregateMaterialStockValueByWeek([snap("2026-08-05", 0)]);
    assert.equal(weeks.length, 1);
    assert.equal(weeks[0]!.totalValue, 0);
  });

  it("anterior zero não gera percentual infinito", () => {
    const weeks = aggregateMaterialStockValueByWeek([
      snap("2026-08-07", 0),
      snap("2026-08-14", 50_000),
    ]);
    assert.equal(weeks[1]!.deltaFromPreviousWeek, 50_000);
    assert.equal(
      weeks[1]!.deltaPercentFromPreviousWeek,
      null,
      "divisão por zero vira null, não Infinity"
    );
  });

  it("ordem de entrada não importa — saída sempre cronológica", () => {
    const weeks = aggregateMaterialStockValueByWeek([
      snap("2026-08-21", 130_000),
      snap("2026-08-07", 100_000),
      snap("2026-08-14", 110_000),
    ]);
    assert.deepEqual(
      weeks.map((w) => w.weekStart),
      ["2026-08-03", "2026-08-10", "2026-08-17"]
    );
  });
});

describe("summarizeMaterialStockValueSeries", () => {
  it("resume último valor, máximo, mínimo e contagens", () => {
    const weeks = aggregateMaterialStockValueByWeek([
      snap("2026-08-07", 100_000),
      snap("2026-08-14", 180_000),
      snap("2026-08-21", 140_000),
    ]);
    const s = summarizeMaterialStockValueSeries(weeks);
    assert.equal(s.latestValue, 140_000);
    assert.equal(s.latestWeekStart, "2026-08-17");
    assert.equal(s.latestDelta, -40_000);
    assert.equal(s.maxValue, 180_000);
    assert.equal(s.maxWeekStart, "2026-08-10");
    assert.equal(s.minValue, 100_000);
    assert.equal(s.minWeekStart, "2026-08-03");
    assert.equal(s.weeksWithData, 3);
    assert.equal(s.totalSnapshots, 3);
  });

  it("série vazia devolve tudo null sem quebrar", () => {
    const s = summarizeMaterialStockValueSeries([]);
    assert.equal(s.latestValue, null);
    assert.equal(s.maxValue, null);
    assert.equal(s.weeksWithData, 0);
  });
});

describe("formatWeekAxisLabel", () => {
  it("formata como DD/MM", () => {
    assert.equal(formatWeekAxisLabel("2026-08-03"), "03/08");
  });
});
