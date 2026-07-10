import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  computeHhHmAdjustedHours,
  computeHhHmCapacityHours,
  computeHhHmTheoreticalHours,
  calculateHhHmHourlyRate,
  HH_HM_CAPACITY_HH_INPUT_HINT,
  HH_HM_CAPACITY_HM_INPUT_HINT,
  parseHhHmCapacityEfficiencyPercent,
  resolveHhHmRateDenominatorHours,
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

  it("horas HM ajustadas com eficiência 100% = 2340", () => {
    assert.equal(computeHhHmAdjustedHours(2_340, 100), 2_340);
  });

  it("taxa HM com eficiência 100% usa 2340 horas (R$ 26,67)", () => {
    assert.equal(calculateHhHmHourlyRate(62_396.89, 2_340), 26.67);
  });

  it("taxa HM com eficiência 80% usa 1872 horas (R$ 33,33)", () => {
    assert.equal(calculateHhHmHourlyRate(62_396.89, 1_872), 33.33);
  });

  it("denominador ignora horas manuais quando avançado está desmarcado", () => {
    assert.equal(
      resolveHhHmRateDenominatorHours({
        useManualBaseHours: false,
        manualBaseHours: 1_872,
        adjustedHours: 2_340,
      }),
      2_340
    );
    assert.equal(
      resolveHhHmRateDenominatorHours({
        useManualBaseHours: true,
        manualBaseHours: 1_872,
        adjustedHours: 2_340,
      }),
      1_872
    );
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
