import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  aggregateParentDecomposition,
  scaleChildContribution,
  structuralBomLineTotal,
  type ChildUnitAnalysis,
} from "./costRollup";

/** TEST 1 — componente fabricado isolado (custo final = MP+HH+HM) */
describe("TEST 1: componente fabricado isolado", () => {
  const child: ChildUnitAnalysis = {
    totalMaterialCost: 40,
    totalHH_Unit: 15,
    totalHM_Unit: 10,
    totalCIF_Unit: 5,
    totalIndustrialCost: 65,
  };
  it("MP + HH + HM = custo consolidado (CIF fora)", () => {
    assert.equal(
      child.totalMaterialCost + child.totalHH_Unit + child.totalHM_Unit,
      child.totalIndustrialCost
    );
  });
  it("conversão > 0; CIF informativo separado", () => {
    assert.ok(child.totalHH_Unit + child.totalHM_Unit > 0);
    assert.ok(child.totalCIF_Unit > 0);
  });
});

/** TEST 2 — pai com filho fabricado */
describe("TEST 2: pai com childProductId", () => {
  it("consolidado (MP+HH+HM) = estrutura sem CIF + processo próprio HH/HM", () => {
    const directMat = 0;
    const child: ChildUnitAnalysis = {
      totalMaterialCost: 100,
      totalHH_Unit: 30,
      totalHM_Unit: 20,
      totalCIF_Unit: 10,
      totalIndustrialCost: 150,
    };
    const qty = 2;
    const scaled = scaleChildContribution(child, qty);
    const structural = structuralBomLineTotal(directMat, [scaled]);
    const own = { hh: 5, hm: 3, cif: 2 };
    const dec = aggregateParentDecomposition(directMat, [scaled], own);
    const consolidated = dec.totalMaterialCost + dec.totalHH_Unit + dec.totalHM_Unit;
    const flat = structural + own.hh + own.hm;
    assert.ok(Math.abs(consolidated - flat) < 1e-4);
    assert.ok(dec.totalHH_Unit > own.hh);
    assert.ok(dec.totalCIF_Unit > own.cif);
  });
});

/** TEST 3 — apenas material direto */
describe("TEST 3: materialId direto (sem filho)", () => {
  it("sem processo próprio: conversão e CIF zero", () => {
    const dec = aggregateParentDecomposition(50, [], { hh: 0, hm: 0, cif: 0 });
    assert.equal(dec.totalMaterialCost, 50);
    assert.equal(dec.totalHH_Unit + dec.totalHM_Unit, 0);
    assert.equal(dec.totalCIF_Unit, 0);
  });
});

/** TEST 4 — pai misto */
describe("TEST 4: material direto + filho fabricado", () => {
  it("consolidado sem CIF; linha estrutural = MP+HH+HM do filho", () => {
    const directMat = 25;
    const child: ChildUnitAnalysis = {
      totalMaterialCost: 10,
      totalHH_Unit: 4,
      totalHM_Unit: 3,
      totalCIF_Unit: 2,
      totalIndustrialCost: 17,
    };
    const scaled = scaleChildContribution(child, 1);
    const dec = aggregateParentDecomposition(directMat, [scaled], { hh: 0, hm: 0, cif: 0 });
    assert.equal(dec.totalMaterialCost, 35);
    assert.equal(dec.totalHH_Unit, 4);
    assert.equal(dec.totalHM_Unit, 3);
    assert.equal(dec.totalCIF_Unit, 2);
    const consolidated = dec.totalMaterialCost + dec.totalHH_Unit + dec.totalHM_Unit;
    assert.ok(Math.abs(consolidated - (directMat + scaled.structuralLine)) < 1e-5);
  });
});

/** TEST 5 — regressão */
describe("TEST 5: regressão — invariante MP+HH+HM", () => {
  it("rollup consolidado = estrutural + HH/HM próprios (sem CIF no total)", () => {
    const directMat = 12.5;
    const child: ChildUnitAnalysis = {
      totalMaterialCost: 8,
      totalHH_Unit: 2,
      totalHM_Unit: 1.5,
      totalCIF_Unit: 0.5,
      totalIndustrialCost: 11.5,
    };
    const scaled = scaleChildContribution(child, 3);
    const structural = structuralBomLineTotal(directMat, [scaled]);
    const own = { hh: 1.2, hm: 0.8, cif: 0.4 };
    const dec = aggregateParentDecomposition(directMat, [scaled], own);
    const consolidated = dec.totalMaterialCost + dec.totalHH_Unit + dec.totalHM_Unit;
    const flat = structural + own.hh + own.hm;
    assert.ok(Math.abs(consolidated - flat) < 1e-4);
  });
});
