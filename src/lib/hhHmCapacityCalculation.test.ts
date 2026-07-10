import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  computeHhHmAdjustedHours,
  computeHhHmCapacityHours,
  computeHhHmTheoreticalHours,
  HH_HM_CAPACITY_HH_INPUT_HINT,
  HH_HM_CAPACITY_HM_INPUT_HINT,
  parseHhHmCapacityEfficiencyPercent,
} from "./hhHmCapacityCalculation.js";

describe("hhHmCapacityCalculation", () => {
  it("horas HH teóricas = pessoas × horas por pessoa", () => {
    assert.equal(computeHhHmTheoreticalHours(60, 180), 10_800);
  });

  it("horas HH ajustadas com eficiência 80% = 8640", () => {
    assert.equal(computeHhHmAdjustedHours(10_800, 80), 8_640);
  });

  it("horas HM teóricas = máquinas × horas por máquina", () => {
    assert.equal(computeHhHmTheoreticalHours(13, 180), 2_340);
  });

  it("horas HM ajustadas com eficiência 80% = 1872", () => {
    assert.equal(computeHhHmAdjustedHours(2_340, 80), 1_872);
  });

  it("computeHhHmCapacityHours integra strings do formulário", () => {
    const hh = computeHhHmCapacityHours({
      unitCount: "60",
      hoursPerUnit: "180",
      efficiencyPercent: "80",
    });
    assert.equal(hh.theoreticalHours, 10_800);
    assert.equal(hh.adjustedHours, 8_640);

    const hm = computeHhHmCapacityHours({
      unitCount: "13",
      hoursPerUnit: "180",
      efficiencyPercent: "80",
    });
    assert.equal(hm.theoreticalHours, 2_340);
    assert.equal(hm.adjustedHours, 1_872);
  });

  it("eficiência inválida é tratada", () => {
    assert.equal(parseHhHmCapacityEfficiencyPercent("").value, null);
    assert.match(parseHhHmCapacityEfficiencyPercent("0").error ?? "", /maior que 0/);
    assert.match(parseHhHmCapacityEfficiencyPercent("110").error ?? "", /100%/);
    assert.equal(computeHhHmAdjustedHours(10_800, null), null);
    assert.equal(computeHhHmAdjustedHours(10_800, 0), null);
  });

  it("divisão por zero / capacidade incompleta retorna null", () => {
    assert.equal(computeHhHmTheoreticalHours(0, 180), null);
    assert.equal(computeHhHmTheoreticalHours(60, null), null);
    assert.equal(computeHhHmAdjustedHours(null, 80), null);
  });

  it("mensagens de hint HH/HM estão documentadas", () => {
    assert.match(HH_HM_CAPACITY_HH_INPUT_HINT, /pessoas\/horas\/eficiência/);
    assert.match(HH_HM_CAPACITY_HM_INPUT_HINT, /máquinas\/horas\/eficiência/);
  });
});
