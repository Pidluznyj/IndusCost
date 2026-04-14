import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  addDirectMaterialRow,
  mergeExplosionMaps,
  naturePercentages,
  sumExplosionTotalCost,
  type ExplosionRowCore,
} from "./openBookMaterialExplosion";
import {
  priceDivisorFromPremissas,
  projectSuggestedPrice,
  simulatePricingOpenBookSensitivity,
  type PricingOpenBookExecutive,
} from "./pricingOpenBook";

/** TESTE 1 — item com composição simples: MP/HH/HM + percentuais */
describe("pricing open book — TESTE 1", () => {
  it("calcula percentuais de natureza sobre MP+HH+HM", () => {
    const n = naturePercentages(70, 20, 10);
    assert.ok(Math.abs(n.pctMp - 70) < 1e-9);
    assert.ok(Math.abs(n.pctHh - 20) < 1e-9);
    assert.ok(Math.abs(n.pctHm - 10) < 1e-9);
  });
});

/** TESTE 2 — item com componentes fabricados: consolidação na formação de preço */
describe("pricing open book — TESTE 2", () => {
  it("consolida MP vinda de dois ramos filhos no mesmo material", () => {
    const childA = new Map<string, ExplosionRowCore>();
    childA.set("mat-a", {
      materialId: "mat-a",
      code: "MAT-A",
      description: "Resina A",
      unit: "kg",
      quantity: 1,
      totalCost: 30,
    });
    const childB = new Map<string, ExplosionRowCore>();
    childB.set("mat-a", {
      materialId: "mat-a",
      code: "MAT-A",
      description: "Resina A",
      unit: "kg",
      quantity: 0.5,
      totalCost: 15,
    });
    const root = new Map<string, ExplosionRowCore>();
    mergeExplosionMaps(root, childA, 2);
    mergeExplosionMaps(root, childB, 4);
    assert.ok(Math.abs(root.get("mat-a")!.quantity - 4) < 1e-9);
    assert.ok(Math.abs(root.get("mat-a")!.totalCost - 120) < 1e-9);
  });
});

/** TESTE 3 — item com materiais diretos */
describe("pricing open book — TESTE 3", () => {
  it("detalha materiais diretos por materialId sem perder soma", () => {
    const map = new Map<string, ExplosionRowCore>();
    addDirectMaterialRow(map, {
      materialId: "m1",
      code: "M1",
      description: "Aço",
      unit: "kg",
      quantity: 2,
      totalCost: 40,
    });
    addDirectMaterialRow(map, {
      materialId: "m2",
      code: "M2",
      description: "Pigmento",
      unit: "kg",
      quantity: 0.2,
      totalCost: 6,
    });
    assert.ok(Math.abs(sumExplosionTotalCost(map) - 46) < 1e-9);
  });
});

/** TESTE 4 — % MP + % HH + % HM = 100% */
describe("pricing open book — TESTE 4", () => {
  it("soma de percentuais de natureza fecha em 100%", () => {
    const n = naturePercentages(91.25, 13.75, 5);
    const sum = n.pctMp + n.pctHh + n.pctHm;
    assert.ok(Math.abs(sum - 100) < 1e-9);
  });
});

/** TESTE 5 — regressão: formação de preço e aba existente continuam consistentes */
describe("pricing open book — TESTE 5", () => {
  it("projeção de preço mantém contrato de premissas (divisor e frete)", () => {
    const divisor = priceDivisorFromPremissas({
      taxRate: 12,
      commRate: 5,
      marginRate: 15,
      freight: 8,
    });
    assert.ok(Math.abs(divisor - 0.68) < 1e-9);
    const p = projectSuggestedPrice(100, {
      taxRate: 12,
      commRate: 5,
      marginRate: 15,
      freight: 8,
    });
    assert.ok(Math.abs(p - (108 / 0.68)) < 1e-9);
  });

  it("sensibilidade não altera base quando aumentos são zero", () => {
    const exec: PricingOpenBookExecutive = {
      totalIndustrialCost: 120,
      totalMaterialCost: 80,
      totalHH: 25,
      totalHM: 15,
      pctMp: 66.6667,
      pctHh: 20.8333,
      pctHm: 12.5,
    };
    const sim = simulatePricingOpenBookSensitivity(
      exec,
      { taxRate: 10, commRate: 5, marginRate: 15, freight: 4 },
      0,
      0,
      0
    );
    assert.ok(Math.abs(sim.newTotal - exec.totalIndustrialCost) < 1e-9);
    assert.ok(Math.abs(sim.suggestedDeltaAbs) < 1e-9);
  });
});
