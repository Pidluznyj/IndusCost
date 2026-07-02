import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  computeTransformationCostPerHourFromRates,
  computeTransformationCostSimulator,
  DEFAULT_TRANSFORMATION_COST_SIMULATOR_VALUES,
  EMPTY_TRANSFORMATION_COST_SIMULATOR_VALUES,
} from "./transformationCostSimulator.js";

function approx(actual: number | null, expected: number, tolerance = 0.02): void {
  assert.notEqual(actual, null);
  assert.ok(Math.abs((actual as number) - expected) <= tolerance, `${actual} ≈ ${expected}`);
}

describe("transformationCostSimulator", () => {
  it("valores padrão — HH/HM e custo por peça esperados", () => {
    const result = computeTransformationCostSimulator(DEFAULT_TRANSFORMATION_COST_SIMULATOR_VALUES);

    approx(result.labor.theoreticalLaborHours, 10800, 0.01);
    approx(result.labor.adjustedLaborHours, 8640, 0.01);
    approx(result.labor.theoreticalHH, 14.81, 0.01);
    approx(result.labor.adjustedHH, 18.52, 0.01);

    approx(result.energy.theoreticalMachineHours, 2340, 0.01);
    approx(result.energy.adjustedMachineHours, 1872, 0.01);
    approx(result.energy.theoreticalHM, 10.68, 0.01);
    approx(result.energy.adjustedHM, 13.35, 0.01);

    approx(result.product.transformationCostPerHour, 31.87, 0.02);
    approx(result.product.cyclesPerHour, 56.25, 0.01);
    approx(result.product.theoreticalPiecesPerHour, 1350, 0.01);
    approx(result.product.goodPiecesPerHour, 1350, 0.01);
    approx(result.product.estimatedTransformationCostPerPiece, 0.0236, 0.0001);
  });

  it("eficiência 100% mantém horas teóricas = ajustadas", () => {
    const result = computeTransformationCostSimulator({
      ...DEFAULT_TRANSFORMATION_COST_SIMULATOR_VALUES,
      laborEfficiencyPercent: "100",
      machineEfficiencyPercent: "100",
    });
    approx(result.labor.adjustedLaborHours, 10800, 0.01);
    approx(result.energy.adjustedMachineHours, 2340, 0.01);
    approx(result.labor.adjustedHH, 14.81, 0.02);
    approx(result.energy.adjustedHM, 10.68, 0.02);
  });

  it("rejeita eficiência inválida", () => {
    const zero = computeTransformationCostSimulator({
      ...DEFAULT_TRANSFORMATION_COST_SIMULATOR_VALUES,
      laborEfficiencyPercent: "0",
    });
    assert.match(zero.fieldErrors.laborEfficiencyPercent ?? "", /maior que 0/);
    assert.equal(zero.labor.adjustedHH, null);

    const over = computeTransformationCostSimulator({
      ...DEFAULT_TRANSFORMATION_COST_SIMULATOR_VALUES,
      machineEfficiencyPercent: "110",
    });
    assert.match(over.fieldErrors.machineEfficiencyPercent ?? "", /100%/);
    assert.equal(over.energy.adjustedHM, null);
  });

  it("ciclo zerado e cavidades zeradas não calculam produto", () => {
    const zeroCycle = computeTransformationCostSimulator({
      ...DEFAULT_TRANSFORMATION_COST_SIMULATOR_VALUES,
      cycleSeconds: "0",
    });
    assert.match(zeroCycle.fieldErrors.cycleSeconds ?? "", /maior que zero/);
    assert.equal(zeroCycle.product.cyclesPerHour, null);

    const zeroCavities = computeTransformationCostSimulator({
      ...DEFAULT_TRANSFORMATION_COST_SIMULATOR_VALUES,
      cavities: "0",
    });
    assert.match(zeroCavities.fieldErrors.cavities ?? "", /maiores que zero/);
    assert.equal(zeroCavities.product.goodPiecesPerHour, null);
  });

  it("operadores fracionados alteram custo hora transformação", () => {
    const base = computeTransformationCostSimulator(DEFAULT_TRANSFORMATION_COST_SIMULATOR_VALUES);
    const hh = base.labor.adjustedHH as number;
    const hm = base.energy.adjustedHM as number;

    approx(
      computeTransformationCostPerHourFromRates({ adjustedHH: hh, adjustedHM: hm, operators: 0.5 }),
      22.61,
      0.02
    );
    approx(
      computeTransformationCostPerHourFromRates({ adjustedHH: hh, adjustedHM: hm, operators: 0.25 }),
      17.98,
      0.02
    );
    approx(
      computeTransformationCostPerHourFromRates({ adjustedHH: hh, adjustedHM: hm, operators: 2 }),
      50.39,
      0.02
    );
  });

  it("refugo 5% reduz peças boas por hora", () => {
    const result = computeTransformationCostSimulator({
      ...DEFAULT_TRANSFORMATION_COST_SIMULATOR_VALUES,
      scrapPercent: "5",
    });
    approx(result.product.goodPiecesPerHour, 1282.5, 0.01);
    assert.ok((result.product.estimatedTransformationCostPerPiece ?? 0) > 0.0236);
  });

  it("campos vazios não geram NaN ou Infinity", () => {
    const result = computeTransformationCostSimulator(EMPTY_TRANSFORMATION_COST_SIMULATOR_VALUES);
    const values = [
      result.labor.theoreticalHH,
      result.labor.adjustedHH,
      result.energy.theoreticalHM,
      result.energy.adjustedHM,
      result.product.transformationCostPerHour,
      result.product.estimatedTransformationCostPerPiece,
    ];
    for (const value of values) {
      if (value != null) {
        assert.ok(Number.isFinite(value));
      }
    }
    assert.equal(result.product.estimatedTransformationCostPerPiece, null);
  });
});
