import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { computeMaterialEffectiveCost, requiredQuantityWithBomLoss } from "./materialEffectiveCost.js";
import { effectiveUnitCostFromMaterialPayload } from "./newProductSandbox.js";

const near = (actual: number, expected: number) =>
  assert.ok(Math.abs(actual - expected) <= 1e-9, `${actual} ≉ ${expected}`);

describe("materialEffectiveCost — regra do motor oficial", () => {
  it("custo efetivo = (custo + frete) / (1 − perda padrão)", () => {
    const r = computeMaterialEffectiveCost({ currentCost: 100, freight: 10, standardLossPct: 10 });
    near(r.landedCost, 110);
    near(r.effectiveCost, 110 / 0.9);
    assert.equal(r.lossApplied, true);
    near(computeMaterialEffectiveCost({ currentCost: 5.42 }).effectiveCost, 5.42);
  });

  it("perda ≥ 100% ou inválida não divide (sem Infinity nem negativo)", () => {
    for (const standardLossPct of [100, 150, Number.NaN]) {
      const r = computeMaterialEffectiveCost({ currentCost: 10, freight: 2, standardLossPct });
      assert.ok(Number.isFinite(r.effectiveCost));
      assert.ok(r.effectiveCost >= 0);
    }
    assert.equal(computeMaterialEffectiveCost({ currentCost: 10, standardLossPct: 100 }).lossApplied, false);
    assert.equal(computeMaterialEffectiveCost({ currentCost: -5, freight: "x" }).effectiveCost, 0);
  });

  it("quantidade requerida = q / (1 − perda de BOM), como no motor", () => {
    near(requiredQuantityWithBomLoss(2, 5).requiredQuantity, 2 / 0.95);
    near(requiredQuantityWithBomLoss(2, 0).requiredQuantity, 2);
    assert.equal(requiredQuantityWithBomLoss(2, 100).lossApplied, false);
  });

  it("perda do material e perda de BOM são distintas e não se duplicam", () => {
    const unit = computeMaterialEffectiveCost({ currentCost: 9, freight: 1, standardLossPct: 10 }).effectiveCost;
    const qty = requiredQuantityWithBomLoss(1, 5).requiredQuantity;
    near(unit * qty, (10 / 0.9) * (1 / 0.95));
  });

  it("divergência conhecida em Projetos: q × (1 + perda) ≠ q / (1 − perda)", () => {
    // Caracterização: Projetos (projectsCalculations) usa q × u × (1 + perda/100). Não alterado
    // nesta entrega porque mudaria custos já persistidos; registrado para decisão.
    const projectsRule = 2 * (1 + 5 / 100);
    const engineRule = requiredQuantityWithBomLoss(2, 5).requiredQuantity;
    assert.ok(engineRule > projectsRule);
    near(engineRule - projectsRule, 2 / 0.95 - 2.1);
  });

  it("equivale ao helper do sandbox quando a API não manda effectiveCost", () => {
    for (const m of [
      { currentCost: 100, freight: 10, standardLoss: 10 },
      { currentCost: 5.42, freight: 0, standardLoss: 0 },
      { currentCost: 12, freight: 1.3, standardLoss: 100 },
    ]) {
      near(
        effectiveUnitCostFromMaterialPayload(m),
        computeMaterialEffectiveCost({ currentCost: m.currentCost, freight: m.freight, standardLossPct: m.standardLoss })
          .effectiveCost
      );
    }
  });
});
