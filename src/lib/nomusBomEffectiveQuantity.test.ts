import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  computeEffectiveLineQuantity,
  NOMUS_QUANTITY_DECIMAL_PLACES,
  QUANTITY_TOLERANCE,
} from "./nomusBomComparison";
import { stageRowToNomusLine } from "./nomusBomComparisonLoad";

describe("nomusBom — quantidade efetiva (= qtdeNecessaria, sem qtdePerdaNormal)", () => {
  it("309.02AA / 115.01--: 0.010878 + 0.001771 → effective = 0.010878 (não 0.012649)", () => {
    const eff = computeEffectiveLineQuantity(0.010878, 0.001771);
    assert.equal(eff, 0.010878);
    assert.notEqual(eff, 0.012649);
  });

  it("309.02AA / 121.04--: 0.000222 + 0.000036 → effective = 0.000222 (não 0.000258)", () => {
    const eff = computeEffectiveLineQuantity(0.000222, 0.000036);
    assert.equal(eff, 0.000222);
    assert.notEqual(eff, 0.000258);
  });

  it("311.90AA / 110.02--: usa só qtdeNecessaria 0.0065 (ignora perda 0.000616)", () => {
    const eff = computeEffectiveLineQuantity(0.0065, 0.000616);
    assert.equal(eff, 0.0065);
    assert.notEqual(eff, 0.007116);
  });

  it("sem perda (loss = null) retorna a própria quantidade teórica", () => {
    assert.equal(computeEffectiveLineQuantity(0.0065, null), 0.0065);
    assert.equal(computeEffectiveLineQuantity(2, null), 2);
  });

  it("loss = 0 retorna a própria quantidade teórica", () => {
    assert.equal(computeEffectiveLineQuantity(0.0065, 0), 0.0065);
  });

  it("requiredQuantity null retorna null (não vira NaN)", () => {
    assert.equal(computeEffectiveLineQuantity(null, 0.000616), null);
    assert.equal(computeEffectiveLineQuantity(undefined, 0.000616), null);
  });

  it("loss undefined é ignorado", () => {
    assert.equal(computeEffectiveLineQuantity(0.0065, undefined), 0.0065);
  });

  it("respeita a precisão de 6 casas decimais do stage Nomus", () => {
    assert.equal(NOMUS_QUANTITY_DECIMAL_PLACES, 6);
    assert.equal(computeEffectiveLineQuantity(0.123456789, 0.5), 0.123457);
  });

  it("requiredQuantity NaN/Infinity retorna null", () => {
    assert.equal(computeEffectiveLineQuantity(NaN, 0), null);
    assert.equal(computeEffectiveLineQuantity(Infinity, 0), null);
  });

  it("loss NaN/Infinity é ignorado", () => {
    assert.equal(computeEffectiveLineQuantity(0.0065, NaN), 0.0065);
    assert.equal(computeEffectiveLineQuantity(0.0065, Infinity), 0.0065);
  });

  it("perda pequena não altera effectiveQuantity", () => {
    const eff = computeEffectiveLineQuantity(0.001, 0.00001);
    assert.equal(eff, 0.001);
    assert.ok(Math.abs(eff! - 0.001) <= QUANTITY_TOLERANCE);
  });
});

describe("stageRowToNomusLine — quantity = qtdeNecessaria", () => {
  function makeRow(qtdeNecessaria: unknown, qtdePerdaNormal: unknown) {
    return {
      externalLineId: 1,
      parentCode: "309.02AA",
      componentCode: "115.01--",
      componentDescription: "MP teste",
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

  it("309.02AA / 115.01--: line.quantity = 0.010878, loss preservada em lossQuantity", () => {
    const line = stageRowToNomusLine(makeRow(0.010878, 0.001771));
    assert.equal(line.quantity, 0.010878);
    assert.equal(line.requiredQuantity, 0.010878);
    assert.equal(line.lossQuantity, 0.001771);
  });

  it("aceita Decimal-like (objeto com .toNumber()) vindo do Prisma", () => {
    const dec = (n: number) => ({ toNumber: () => n });
    const line = stageRowToNomusLine(makeRow(dec(0.010878), dec(0.001771)));
    assert.equal(line.quantity, 0.010878);
    assert.equal(line.requiredQuantity, 0.010878);
    assert.equal(line.lossQuantity, 0.001771);
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
