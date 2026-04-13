import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  addDirectMaterialRow,
  cloneExplosionMap,
  directMaterialLineFromBom,
  finalizeRowsForOpenBook,
  mergeExplosionMaps,
  naturePercentages,
  simulateIndustrialCost,
  sumExplosionTotalCost,
  type ExplosionRowCore,
} from "./openBookMaterialExplosion";

/** TEST 1 — componente fabricado isolado (MP, HH, HM coerentes na decomposição) */
describe("TEST 1: componente fabricado isolado", () => {
  it("MP + HH + HM como base industrial; fórmula de linha MP alinhada ao motor", () => {
    const mp = 100;
    const hh = 40;
    const hm = 25;
    const n = naturePercentages(mp, hh, hm);
    assert.ok(Math.abs(n.pctMp + n.pctHh + n.pctHm - 100) < 1e-9);
    const line = directMaterialLineFromBom(10, 0, 2, 0);
    assert.equal(line.lineTotal, 20);
  });
});

/** TEST 2 — pai com filhos fabricados (escala HH/HM separada da MP na explosão) */
describe("TEST 2: item pai com filhos fabricados", () => {
  it("merge escala filho: MP consolidada separada de HH/HM (simulado por totais)", () => {
    const childMap = new Map<string, ExplosionRowCore>();
    childMap.set("m1", {
      materialId: "m1",
      code: "X",
      description: "sub",
      unit: "kg",
      quantity: 1,
      totalCost: 50,
    });
    const parentMap = new Map<string, ExplosionRowCore>();
    mergeExplosionMaps(parentMap, childMap, 3);
    assert.equal(parentMap.get("m1")?.quantity, 3);
    assert.equal(parentMap.get("m1")?.totalCost, 150);
    const mpTotal = sumExplosionTotalCost(parentMap);
    const hh = 30;
    const hm = 20;
    const n = naturePercentages(mpTotal, hh, hm);
    assert.ok(Math.abs(n.pctMp + n.pctHh + n.pctHm - 100) < 1e-9);
  });
});

/** TEST 3 — materiais diretos (materialId) na explosão */
describe("TEST 3: materiais diretos", () => {
  it("linhas diretas somam na mesma chave materialId", () => {
    const into = new Map<string, ExplosionRowCore>();
    const r1: ExplosionRowCore = {
      materialId: "a",
      code: "A",
      description: "A",
      unit: "kg",
      quantity: 1,
      totalCost: 10,
    };
    addDirectMaterialRow(into, r1);
    addDirectMaterialRow(into, { ...r1, quantity: 2, totalCost: 20 });
    assert.equal(into.get("a")?.quantity, 3);
    assert.equal(into.get("a")?.totalCost, 30);
  });
});

/** TEST 4 — consolidação recursiva (mesma MP em caminhos diferentes) */
describe("TEST 4: consolidação recursiva", () => {
  it("mesma matéria-prima em dois ramos consolidada sem duplicar custo indevido", () => {
    const branchA = new Map<string, ExplosionRowCore>();
    branchA.set("steel", {
      materialId: "steel",
      code: "ST",
      description: "Aço",
      unit: "kg",
      quantity: 1,
      totalCost: 100,
    });
    const branchB = new Map<string, ExplosionRowCore>();
    branchB.set("steel", {
      materialId: "steel",
      code: "ST",
      description: "Aço",
      unit: "kg",
      quantity: 0.5,
      totalCost: 50,
    });
    const root = new Map<string, ExplosionRowCore>();
    mergeExplosionMaps(root, branchA, 1);
    mergeExplosionMaps(root, branchB, 1);
    assert.equal(root.get("steel")?.quantity, 1.5);
    assert.equal(root.get("steel")?.totalCost, 150);
  });

  it("cloneExplosionMap não compartilha referência mutável entre ramos", () => {
    const a = new Map<string, ExplosionRowCore>();
    a.set("x", {
      materialId: "x",
      code: "X",
      description: "",
      unit: "u",
      quantity: 1,
      totalCost: 1,
    });
    const b = cloneExplosionMap(a);
    b.get("x")!.totalCost += 5;
    assert.equal(a.get("x")!.totalCost, 1);
  });
});

/** TEST 5 — percentuais MP + HH + HM = 100% */
describe("TEST 5: percentuais", () => {
  it("soma dos percentuais de natureza = 100% (tolerância numérica)", () => {
    const n = naturePercentages(60, 25, 15);
    const sum = n.pctMp + n.pctHh + n.pctHm;
    assert.ok(Math.abs(sum - 100) < 1e-9);
  });

  it("simulação mantém interpretação de aumento % sobre cada natureza", () => {
    const s = simulateIndustrialCost(100, 50, 25, 10, 0, 0);
    assert.ok(Math.abs(s.newMp - 110) < 1e-9);
    assert.equal(s.newHh, 50);
    assert.equal(s.newHm, 25);
    assert.ok(s.deltaPct > 0);
  });
});

describe("finalizeRowsForOpenBook", () => {
  it("calcula % sobre industrial e sobre MP", () => {
    const m = new Map<string, ExplosionRowCore>();
    m.set("a", {
      materialId: "a",
      code: "A",
      description: "A",
      unit: "kg",
      quantity: 2,
      totalCost: 40,
    });
    const rows = finalizeRowsForOpenBook(m, 200, 80);
    assert.equal(rows[0].pctOfIndustrial, 20);
    assert.equal(rows[0].pctOfMp, 50);
    assert.equal(rows[0].unitCostEffective, 20);
  });
});
