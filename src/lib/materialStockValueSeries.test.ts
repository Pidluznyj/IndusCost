/**
 * Regressão — série do valor de estoque de MP por conferência física.
 * Trava a regra central: CADA snapshot vira ponto (mesmo na mesma semana),
 * e dias/semanas sem conferência não são inventados.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  buildMaterialStockValueCountSeries,
  formatCivilDateAxisLabel,
  resolveIsoWeekEnd,
  resolveIsoWeekStart,
  resolveMaterialStockValueWindowStart,
  summarizeMaterialStockValueSeries,
  type MaterialStockValueSnapshotPoint,
} from "./materialStockValueSeries.js";

const root = process.cwd();

function read(rel: string): string {
  return readFileSync(join(root, rel), "utf8");
}

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
    assert.equal(resolveIsoWeekStart("2026-08-03"), "2026-08-03");
  });

  it("domingo pertence à semana que começou na segunda anterior", () => {
    assert.equal(resolveIsoWeekStart("2026-08-09"), "2026-08-03");
  });

  it("quarta-feira mapeia para a segunda da mesma semana", () => {
    assert.equal(resolveIsoWeekStart("2026-08-05"), "2026-08-03");
  });

  it("atravessa virada de mês corretamente", () => {
    assert.equal(resolveIsoWeekStart("2026-09-01"), "2026-08-31");
  });

  it("weekEnd é o domingo da mesma semana", () => {
    assert.equal(resolveIsoWeekEnd("2026-08-03"), "2026-08-09");
  });
});

describe("resolveMaterialStockValueWindowStart", () => {
  it("13 semanas a partir de uma quarta incluem a segunda da semana corrente", () => {
    // 2026-10-21 é quarta → semana começa em 19/10; 13 semanas atrás = 27/07.
    assert.equal(
      resolveMaterialStockValueWindowStart("2026-10-21", 13),
      "2026-07-27"
    );
  });

  it("1 semana devolve só a segunda da semana corrente", () => {
    assert.equal(
      resolveMaterialStockValueWindowStart("2026-10-21", 1),
      "2026-10-19"
    );
  });
});

describe("buildMaterialStockValueCountSeries", () => {
  it("cada snapshot da mesma semana vira ponto (não fecha a semana)", () => {
    const points = buildMaterialStockValueCountSeries([
      snap("2026-08-03", 100_000),
      snap("2026-08-05", 120_000),
      snap("2026-08-07", 135_000),
    ]);
    assert.equal(points.length, 3, "três conferências, três pontos");
    assert.deepEqual(
      points.map((p) => p.totalValue),
      [100_000, 120_000, 135_000]
    );
    assert.deepEqual(
      points.map((p) => p.civilDate),
      ["2026-08-03", "2026-08-05", "2026-08-07"]
    );
    assert.equal(points[0]!.deltaFromPrevious, null);
    assert.equal(points[1]!.deltaFromPrevious, 20_000);
    assert.equal(points[2]!.deltaFromPrevious, 15_000);
  });

  it("duas conferências no MESMO dia aparecem as duas, na ordem do instante", () => {
    const points = buildMaterialStockValueCountSeries([
      snap("2026-08-05", 100_000, { capturedAt: "2026-08-05T09:00:00.000Z" }),
      snap("2026-08-05", 175_000, { capturedAt: "2026-08-05T17:30:00.000Z" }),
    ]);
    assert.equal(points.length, 2);
    assert.equal(points[0]!.totalValue, 100_000);
    assert.equal(points[1]!.totalValue, 175_000);
    assert.equal(points[1]!.deltaFromPrevious, 75_000);
  });

  it("separa conferências de semanas distintas e calcula a variação entre elas", () => {
    const points = buildMaterialStockValueCountSeries([
      snap("2026-08-07", 100_000),
      snap("2026-08-14", 150_000),
    ]);
    assert.equal(points.length, 2);
    assert.equal(points[0]!.deltaFromPrevious, null);
    assert.equal(points[0]!.deltaPercentFromPrevious, null);
    assert.equal(points[1]!.deltaFromPrevious, 50_000);
    assert.equal(points[1]!.deltaPercentFromPrevious, 50);
  });

  it("queda entre conferências gera delta negativo", () => {
    const points = buildMaterialStockValueCountSeries([
      snap("2026-08-07", 200_000),
      snap("2026-08-14", 150_000),
    ]);
    assert.equal(points[1]!.deltaFromPrevious, -50_000);
    assert.equal(points[1]!.deltaPercentFromPrevious, -25);
  });

  it("semana SEM snapshot não é inventada (série não cria ponto falso)", () => {
    const points = buildMaterialStockValueCountSeries([
      snap("2026-08-07", 100_000),
      snap("2026-08-21", 130_000),
    ]);
    assert.equal(points.length, 2, "só conferências reais");
    assert.deepEqual(
      points.map((p) => p.civilDate),
      ["2026-08-07", "2026-08-21"]
    );
    assert.equal(points[1]!.deltaFromPrevious, 30_000);
  });

  it("entrada vazia devolve série vazia (sem quebrar)", () => {
    assert.deepEqual(buildMaterialStockValueCountSeries([]), []);
  });

  it("valor zero legítimo é preservado (não vira ausência)", () => {
    const points = buildMaterialStockValueCountSeries([snap("2026-08-05", 0)]);
    assert.equal(points.length, 1);
    assert.equal(points[0]!.totalValue, 0);
  });

  it("anterior zero não gera percentual infinito", () => {
    const points = buildMaterialStockValueCountSeries([
      snap("2026-08-07", 0),
      snap("2026-08-14", 50_000),
    ]);
    assert.equal(points[1]!.deltaFromPrevious, 50_000);
    assert.equal(
      points[1]!.deltaPercentFromPrevious,
      null,
      "divisão por zero vira null, não Infinity"
    );
  });

  it("ordem de entrada não importa — saída sempre cronológica", () => {
    const points = buildMaterialStockValueCountSeries([
      snap("2026-08-21", 130_000),
      snap("2026-08-07", 100_000),
      snap("2026-08-14", 110_000),
    ]);
    assert.deepEqual(
      points.map((p) => p.civilDate),
      ["2026-08-07", "2026-08-14", "2026-08-21"]
    );
  });
});

describe("summarizeMaterialStockValueSeries", () => {
  it("resume último valor, máximo, mínimo e contagens por conferência", () => {
    const points = buildMaterialStockValueCountSeries([
      snap("2026-08-07", 100_000),
      snap("2026-08-14", 180_000),
      snap("2026-08-21", 140_000),
    ]);
    const s = summarizeMaterialStockValueSeries(points);
    assert.equal(s.latestValue, 140_000);
    assert.equal(s.latestCivilDate, "2026-08-21");
    assert.equal(s.latestDelta, -40_000);
    assert.equal(s.maxValue, 180_000);
    assert.equal(s.maxCapturedAt, "2026-08-14T12:00:00.000Z");
    assert.equal(s.minValue, 100_000);
    assert.equal(s.minCapturedAt, "2026-08-07T12:00:00.000Z");
    assert.equal(s.totalSnapshots, 3);
  });

  it("série vazia devolve tudo null sem quebrar", () => {
    const s = summarizeMaterialStockValueSeries([]);
    assert.equal(s.latestValue, null);
    assert.equal(s.maxValue, null);
    assert.equal(s.totalSnapshots, 0);
  });
});

describe("formatCivilDateAxisLabel", () => {
  it("formata como DD/MM", () => {
    assert.equal(formatCivilDateAxisLabel("2026-08-03"), "03/08");
  });
});

describe("contrato UI / captura — cada conferência física vira ponto", () => {
  it("gráfico não fecha a semana: usa points e conferência física", () => {
    const chart = read("src/components/materials/MaterialStockValueTrendChart.tsx");
    assert.match(chart, /data\.points/);
    assert.match(chart, /por conferência física/);
    assert.doesNotMatch(chart, /flutuação semanal/);
    assert.doesNotMatch(chart, /semana fechou/);
    assert.match(chart, /onRefreshValue/);
  });

  it("API devolve um ponto por snapshot, sem agregar por semana", () => {
    const server = read("src/lib/materialStockValueSnapshot.server.ts");
    assert.match(server, /buildMaterialStockValueCountSeries/);
    assert.doesNotMatch(server, /aggregateMaterialStockValueByWeek/);
    assert.match(server, /captureMaterialStockValueSnapshotBestEffort/);
  });

  it("ajuste da conferência física continua fotografando o valor de MP", () => {
    const service = read("src/lib/inventory/inventoryCountService.server.ts");
    assert.match(service, /captureMaterialStockValueSnapshotBestEffort/);
    assert.match(service, /source:\s*"CONFERENCE"/);
  });
});
