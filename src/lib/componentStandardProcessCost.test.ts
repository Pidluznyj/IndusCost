import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildOfficialDefaultIndustrialCostsReference,
  compareSimulatedInjectionHourlyToOfficial,
  computeStandardProcessUnitCosts,
  resolveDefaultProcessHourCostsFromAnalysisCache,
  resolveSimulatedComponentHhHm,
} from "./componentStandardProcessCost.js";

const SAMPLE_CACHE = {
  globalHhCost: 25,
  energyCost: 50000,
  workingHours: 220,
  hhSource: "MANUAL" as const,
};

const SAMPLE_INPUT = {
  cycleTimeSeconds: 64,
  cavities: 24,
  efficiencyExpectedPercent: 100,
  setupTimeMin: 0,
  lotSize: 1,
  globalHhCostPerHour: 25,
  machineHourCostPerHour: 50000 / 220,
};

describe("componentStandardProcessCost", () => {
  it("resolveDefaultProcessHourCostsFromAnalysisCache — mesma fonte do motor oficial", () => {
    const resolved = resolveDefaultProcessHourCostsFromAnalysisCache(SAMPLE_CACHE);
    assert.equal(resolved.available, true);
    assert.equal(resolved.globalHhCostPerHour, 25);
    assert.ok(Math.abs(resolved.machineHourCostPerHour - 50000 / 220) < 0.0001);
    assert.equal(resolved.hhSource, "MANUAL");
  });

  it("resolveDefaultProcessHourCostsFromAnalysisCache — indisponível sem horas úteis", () => {
    const resolved = resolveDefaultProcessHourCostsFromAnalysisCache({
      ...SAMPLE_CACHE,
      workingHours: 0,
    });
    assert.equal(resolved.available, false);
  });

  it("computeStandardProcessUnitCosts — ciclo e cavidades alteram HH/HM", () => {
    const base = computeStandardProcessUnitCosts(SAMPLE_INPUT);
    assert.equal(base.ok, true);
    if (!base.ok) return;

    const slower = computeStandardProcessUnitCosts({ ...SAMPLE_INPUT, cycleTimeSeconds: 128 });
    assert.equal(slower.ok, true);
    if (!slower.ok) return;
    assert.ok(slower.totalHH_Unit > base.totalHH_Unit);
    assert.ok(slower.totalHM_Unit > base.totalHM_Unit);

    const fewerCavities = computeStandardProcessUnitCosts({ ...SAMPLE_INPUT, cavities: 12 });
    assert.equal(fewerCavities.ok, true);
    if (!fewerCavities.ok) return;
    assert.ok(fewerCavities.totalHH_Unit > base.totalHH_Unit);
    assert.ok(fewerCavities.totalHM_Unit > base.totalHM_Unit);
  });

  it("computeStandardProcessUnitCosts — ciclo zero não gera NaN", () => {
    const result = computeStandardProcessUnitCosts({ ...SAMPLE_INPUT, cycleTimeSeconds: 0 });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.errorCode, "INVALID_CYCLE");
  });

  it("computeStandardProcessUnitCosts — cavidades zero não gera NaN", () => {
    const result = computeStandardProcessUnitCosts({ ...SAMPLE_INPUT, cavities: 0 });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.errorCode, "INVALID_CAVITIES");
  });

  it("resolveSimulatedComponentHhHm — modo default usa helper oficial", () => {
    const defaults = resolveDefaultProcessHourCostsFromAnalysisCache(SAMPLE_CACHE);
    const resolved = resolveSimulatedComponentHhHm({
      useDefaultHourCosts: true,
      manualHh: 0,
      manualHm: 0,
      process: {
        cycleTimeSeconds: 64,
        cavities: 24,
        efficiencyExpectedPercent: 100,
        setupTimeMin: 0,
        lotSize: 1,
      },
      defaultHourCosts: defaults,
    });
    assert.equal(resolved.error, null);
    assert.equal(resolved.source, "DEFAULT");
    assert.ok(resolved.hh > 0);
    assert.ok(resolved.hm > 0);

    const expected = computeStandardProcessUnitCosts({
      cycleTimeSeconds: 64,
      cavities: 24,
      efficiencyExpectedPercent: 100,
      setupTimeMin: 0,
      lotSize: 1,
      globalHhCostPerHour: defaults.globalHhCostPerHour,
      machineHourCostPerHour: defaults.machineHourCostPerHour,
    });
    assert.equal(expected.ok, true);
    if (!expected.ok) return;
    assert.ok(Math.abs(resolved.hh - expected.totalHH_Unit) < 0.000001);
    assert.ok(Math.abs(resolved.hm - expected.totalHM_Unit) < 0.000001);
  });

  it("resolveSimulatedComponentHhHm — aviso quando defaults indisponíveis", () => {
    const resolved = resolveSimulatedComponentHhHm({
      useDefaultHourCosts: true,
      manualHh: 0,
      manualHm: 0,
      process: {
        cycleTimeSeconds: 64,
        cavities: 24,
        efficiencyExpectedPercent: 100,
        setupTimeMin: 0,
        lotSize: 1,
      },
      defaultHourCosts: { globalHhCostPerHour: 0, machineHourCostPerHour: 0, hhSource: "AUTO", available: false },
    });
    assert.ok(resolved.error?.includes("Configurações Gerais"));
  });

  it("resolveSimulatedComponentHhHm — modo manual preservado", () => {
    const resolved = resolveSimulatedComponentHhHm({
      useDefaultHourCosts: false,
      manualHh: 1.5,
      manualHm: 2.25,
      defaultHourCosts: resolveDefaultProcessHourCostsFromAnalysisCache(SAMPLE_CACHE),
    });
    assert.equal(resolved.error, null);
    assert.equal(resolved.source, "MANUAL");
    assert.equal(resolved.hh, 1.5);
    assert.equal(resolved.hm, 2.25);
  });

  it("buildOfficialDefaultIndustrialCostsReference — HH + HM default", () => {
    const reference = buildOfficialDefaultIndustrialCostsReference(SAMPLE_CACHE);
    assert.equal(reference.available, true);
    assert.equal(reference.source, "GENERAL_SETTINGS");
    assert.equal(reference.hhDefault, 25);
    assert.ok(Math.abs(reference.hmDefault - 50000 / 220) < 0.0001);
    assert.ok(Math.abs(reference.injectionHourlyCostDefault - (25 + 50000 / 220)) < 0.0001);
  });

  it("buildOfficialDefaultIndustrialCostsReference — exemplo 18.52 + 13.35", () => {
    const reference = buildOfficialDefaultIndustrialCostsReference({
      globalHhCost: 18.52,
      energyCost: 25000,
      workingHours: 1872,
      hhSource: "AUTO",
    });
    assert.equal(reference.available, true);
    assert.ok(Math.abs(reference.hhDefault - 18.52) < 0.001);
    assert.ok(Math.abs(reference.hmDefault - 13.35) < 0.02);
    assert.ok(Math.abs(reference.injectionHourlyCostDefault - 31.87) < 0.02);
  });

  it("buildOfficialDefaultIndustrialCostsReference — indisponível sem horas úteis", () => {
    const reference = buildOfficialDefaultIndustrialCostsReference({
      ...SAMPLE_CACHE,
      workingHours: 0,
    });
    assert.equal(reference.available, false);
    assert.equal(reference.injectionHourlyCostDefault, 0);
  });

  it("compareSimulatedInjectionHourlyToOfficial — diferença percentual", () => {
    const comparison = compareSimulatedInjectionHourlyToOfficial({
      simulatedInjectionHourlyCost: 35,
      officialReference: {
        available: true,
        injectionHourlyCostDefault: 31.87,
      },
    });
    assert.notEqual(comparison, null);
    assert.ok(Math.abs((comparison as { difference: number }).difference - 3.13) < 0.01);
  });

  it("compareSimulatedInjectionHourlyToOfficial — retorna null sem simulação", () => {
    assert.equal(
      compareSimulatedInjectionHourlyToOfficial({
        simulatedInjectionHourlyCost: null,
        officialReference: { available: true, injectionHourlyCostDefault: 31.87 },
      }),
      null
    );
  });
});
