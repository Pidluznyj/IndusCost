import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { naturePercentages } from "./openBookMaterialExplosion";
import { simulateScenarioFromBreakdown } from "./simulationFormula";

const premissas = {
  taxRatePct: 0,
  commRatePct: 0,
  otherRatePct: 0,
  marginRatePct: 40,
  freight: 0,
};

/** TESTE 1 — reajuste de 100% em MP impacta só MP */
describe("simulationFormula TESTE 1", () => {
  it("reajuste de MP não altera HH/HM", () => {
    const r = simulateScenarioFromBreakdown(
      { mp: 2, hh: 1, hm: 1 },
      { materialAdjPct: 100, laborAdjPct: 0, hmAdjPct: 0, efficiencyAdjPct: 0, marginAdjPct: 0 },
      premissas
    );
    assert.equal(r.simulated.mp, 4);
    assert.equal(r.simulated.hh, 1);
    assert.equal(r.simulated.hm, 1);
  });
});

/** TESTE 2 — reajuste só em HH */
describe("simulationFormula TESTE 2", () => {
  it("reajuste de HH não altera MP/HM", () => {
    const r = simulateScenarioFromBreakdown(
      { mp: 2, hh: 1, hm: 1 },
      { materialAdjPct: 0, laborAdjPct: 50, hmAdjPct: 0, efficiencyAdjPct: 0, marginAdjPct: 0 },
      premissas
    );
    assert.equal(r.simulated.mp, 2);
    assert.equal(r.simulated.hh, 1.5);
    assert.equal(r.simulated.hm, 1);
  });
});

/** TESTE 3 — reajuste só em HM */
describe("simulationFormula TESTE 3", () => {
  it("reajuste de HM não altera MP/HH", () => {
    const r = simulateScenarioFromBreakdown(
      { mp: 2, hh: 1, hm: 1 },
      { materialAdjPct: 0, laborAdjPct: 0, hmAdjPct: 30, efficiencyAdjPct: 0, marginAdjPct: 0 },
      premissas
    );
    assert.equal(r.simulated.mp, 2);
    assert.equal(r.simulated.hh, 1);
    assert.equal(r.simulated.hm, 1.3);
  });
});

/** TESTE 4 — fórmula de preço com margem 40% */
describe("simulationFormula TESTE 4", () => {
  it("aplica margem como markup divisor (custo / (1 - margem))", () => {
    const r = simulateScenarioFromBreakdown(
      { mp: 3, hh: 1, hm: 1 },
      { materialAdjPct: 0, laborAdjPct: 0, hmAdjPct: 0, efficiencyAdjPct: 0, marginAdjPct: 0 },
      premissas
    );
    // custo 5, margem 40% => 5 / 0.6 = 8.3333...
    assert.ok(Math.abs(r.pricing.baseSuggestedPrice - 8.3333333333) < 1e-6);
  });
});

/** TESTE 5 — caso real aproximado (MP 10,20 -> 21,00; margem 40%) */
describe("simulationFormula TESTE 5", () => {
  it("resultado simulado bate com memória matemática esperada", () => {
    const base = { mp: 3.06, hh: 0.95, hm: 0.01 }; // custo ~4,02 => preço ~6,70 com margem 40%
    const r = simulateScenarioFromBreakdown(
      base,
      { materialAdjPct: 100, laborAdjPct: 0, hmAdjPct: 0, efficiencyAdjPct: 0, marginAdjPct: 0 },
      premissas
    );
    const expectedBaseCost = 4.02;
    const expectedSimCost = 7.08; // só MP dobra (+3.06)
    const expectedBasePrice = expectedBaseCost / 0.6;
    const expectedSimPrice = expectedSimCost / 0.6;
    assert.ok(Math.abs(r.base.costBase - expectedBaseCost) < 1e-9);
    assert.ok(Math.abs(r.simulated.costBase - expectedSimCost) < 1e-9);
    assert.ok(Math.abs(r.pricing.baseSuggestedPrice - expectedBasePrice) < 1e-9);
    assert.ok(Math.abs(r.pricing.simSuggestedPrice - expectedSimPrice) < 1e-9);
  });
});

/** TESTE 6 — regressão: composição continua fechando 100% */
describe("simulationFormula TESTE 6", () => {
  it("% MP + % HH + % HM continua 100%", () => {
    const n = naturePercentages(3.06, 0.95, 0.01);
    const sum = n.pctMp + n.pctHh + n.pctHm;
    assert.ok(Math.abs(sum - 100) < 1e-9);
  });
});
