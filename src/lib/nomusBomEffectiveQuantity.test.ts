import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  computeEffectiveLineQuantity,
  NOMUS_QUANTITY_DECIMAL_PLACES,
  QUANTITY_TOLERANCE,
} from "./nomusBomComparison";
import { stageRowToNomusLine } from "./nomusBomComparisonLoad";

describe("nomusBom — quantidade efetiva (qtdeNecessaria + qtdePerdaNormal)", () => {
  it("311.90AA / 110.02--: 0.00650 + 0.000616 = 0.007116 (sem ruído de float)", () => {
    const eff = computeEffectiveLineQuantity(0.0065, 0.000616);
    assert.equal(eff, 0.007116);
  });

  it("sem perda (loss = null) retorna a própria quantidade teórica", () => {
    assert.equal(computeEffectiveLineQuantity(0.0065, null), 0.0065);
    assert.equal(computeEffectiveLineQuantity(2, null), 2);
  });

  it("sem perda (loss = 0) retorna a própria quantidade teórica", () => {
    assert.equal(computeEffectiveLineQuantity(0.0065, 0), 0.0065);
  });

  it("requiredQuantity null retorna null (não vira NaN)", () => {
    assert.equal(computeEffectiveLineQuantity(null, 0.000616), null);
    assert.equal(computeEffectiveLineQuantity(undefined, 0.000616), null);
  });

  it("loss undefined é tratado como zero", () => {
    assert.equal(computeEffectiveLineQuantity(0.0065, undefined), 0.0065);
  });

  it("respeita a precisão de 6 casas decimais do stage Nomus", () => {
    assert.equal(NOMUS_QUANTITY_DECIMAL_PLACES, 6);
    // 0.1 + 0.2 = 0.30000000000000004 em float
    assert.equal(computeEffectiveLineQuantity(0.1, 0.2), 0.3);
  });

  it("requiredQuantity NaN/Infinity retorna null", () => {
    assert.equal(computeEffectiveLineQuantity(NaN, 0), null);
    assert.equal(computeEffectiveLineQuantity(Infinity, 0), null);
  });

  it("loss NaN/Infinity é ignorado (vira 0)", () => {
    assert.equal(computeEffectiveLineQuantity(0.0065, NaN), 0.0065);
    assert.equal(computeEffectiveLineQuantity(0.0065, Infinity), 0.0065);
  });

  it("perda pequena distinta de zero é embutida (acima da tolerância de comparação)", () => {
    // 0.001 + 0.00001 = 0.00101 — bem acima da QUANTITY_TOLERANCE.
    const eff = computeEffectiveLineQuantity(0.001, 0.00001);
    assert.equal(eff, 0.00101);
    assert.ok(Math.abs(eff! - 0.001) > QUANTITY_TOLERANCE);
  });
});

describe("stageRowToNomusLine — embute a perda em quantity", () => {
  function makeRow(qtdeNecessaria: unknown, qtdePerdaNormal: unknown) {
    return {
      externalLineId: 1,
      parentCode: "311.90AA",
      componentCode: "110.02--",
      componentDescription: "*ABS* NATURAL GP35",
      qtdeNecessaria,
      qtdePerdaNormal,
      listaMateriaisId: 1,
      listaMateriaisNome: "PRINCIPAL",
      listaMateriaisPadrao: true,
      listaMateriaisPadraoBlocoK: false,
      listaMateriaisAtivo: true,
      opcional: false,
      alternativo: false,
      preferencial: false,
      itemDeEmbarque: false,
      posicao: 1,
    };
  }

  it("311.90AA / 110.02--: line.quantity = 0.007116 (consumo final)", () => {
    const line = stageRowToNomusLine(makeRow(0.0065, 0.000616));
    assert.equal(line.quantity, 0.007116);
    assert.equal(line.requiredQuantity, 0.0065);
    assert.equal(line.lossQuantity, 0.000616);
  });

  it("aceita Decimal-like (objeto com .toNumber()) vindo do Prisma", () => {
    const dec = (n: number) => ({ toNumber: () => n });
    const line = stageRowToNomusLine(makeRow(dec(0.0065), dec(0.000616)));
    assert.equal(line.quantity, 0.007116);
    assert.equal(line.requiredQuantity, 0.0065);
    assert.equal(line.lossQuantity, 0.000616);
  });

  it("sem perda → quantity = qtdeNecessaria", () => {
    const line = stageRowToNomusLine(makeRow(0.5, null));
    assert.equal(line.quantity, 0.5);
    assert.equal(line.requiredQuantity, 0.5);
    assert.equal(line.lossQuantity, null);
  });

  it("loss=0 explícito → quantity = qtdeNecessaria", () => {
    const line = stageRowToNomusLine(makeRow(0.5, 0));
    assert.equal(line.quantity, 0.5);
    assert.equal(line.lossQuantity, 0);
  });

  it("qtdeNecessaria null → quantity null", () => {
    const line = stageRowToNomusLine(makeRow(null, 0.000616));
    assert.equal(line.quantity, null);
    assert.equal(line.requiredQuantity, null);
  });
});
