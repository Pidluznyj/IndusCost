import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { computeComponentInjectionCalculationBreakdown } from "./componentInjectionCalculationBreakdown.js";

const SAMPLE_HOUR_COSTS = {
  globalHhCostPerHour: 28.935185,
  machineHourCostPerHour: 13.354701,
  available: true as const,
};

describe("componentInjectionCalculationBreakdown", () => {
  it("ciclo 40 e cavidades 16 — capacidade produtiva", () => {
    const result = computeComponentInjectionCalculationBreakdown({
      cycleTimeSeconds: 40,
      cavities: 16,
      efficiencyExpectedPercent: 100,
      hourCosts: SAMPLE_HOUR_COSTS,
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.ok(Math.abs(result.cyclesPerHour - 90) < 0.0001);
    assert.ok(Math.abs(result.theoreticalPiecesPerHour - 1440) < 0.0001);
    assert.ok(Math.abs(result.goodPiecesPerHour - 1440) < 0.0001);
  });

  it("custo hora de injeção e custo por peça — exemplo R$ 42,29/h", () => {
    const result = computeComponentInjectionCalculationBreakdown({
      cycleTimeSeconds: 40,
      cavities: 16,
      efficiencyExpectedPercent: 100,
      hourCosts: SAMPLE_HOUR_COSTS,
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.ok(Math.abs(result.injectionHourlyCost - 42.289886) < 0.000001);
    assert.ok(Math.abs(result.injectionCostPerPiece - 42.289886 / 1440) < 0.000001);
    assert.ok(Math.abs(result.injectionCostPerPiece - 0.029368) < 0.0001);
  });

  it("eficiência 80% reduz peças boas por hora", () => {
    const result = computeComponentInjectionCalculationBreakdown({
      cycleTimeSeconds: 40,
      cavities: 16,
      efficiencyExpectedPercent: 80,
      hourCosts: SAMPLE_HOUR_COSTS,
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.ok(Math.abs(result.goodPiecesPerHour - 1152) < 0.0001);
  });

  it("ciclo zero não gera NaN", () => {
    const result = computeComponentInjectionCalculationBreakdown({
      cycleTimeSeconds: 0,
      cavities: 16,
      efficiencyExpectedPercent: 100,
      hourCosts: SAMPLE_HOUR_COSTS,
    });
    assert.equal(result.ok, false);
  });

  it("cavidades zero não gera NaN", () => {
    const result = computeComponentInjectionCalculationBreakdown({
      cycleTimeSeconds: 40,
      cavities: 0,
      efficiencyExpectedPercent: 100,
      hourCosts: SAMPLE_HOUR_COSTS,
    });
    assert.equal(result.ok, false);
  });

  it("HH/HM ausentes — fallback amigável", () => {
    const result = computeComponentInjectionCalculationBreakdown({
      cycleTimeSeconds: 40,
      cavities: 16,
      efficiencyExpectedPercent: 100,
      hourCosts: { globalHhCostPerHour: 0, machineHourCostPerHour: 0, available: false },
    });
    assert.equal(result.ok, false);
    assert.match(result.message, /Configurações Gerais/);
  });
});
