import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  APPLY_HH_HM_SIMULATION_API,
  buildOfficialRatesSnapshot,
  parseApplyHhHmSimulationBody,
  planApplyHhHmSimulationToOfficialParams,
} from "./settingsApplyHhHmSimulation.js";
import { SETTINGS_GLOBAL_PARAMS_EDIT_PERMISSIONS } from "./settingsGlobalsRoutes.js";

function read(rel: string): string {
  return readFileSync(join(process.cwd(), rel), "utf8");
}

describe("settingsApplyHhHmSimulation", () => {
  it("HH alimenta override e HM recalcula ENERGY_COST sem campo novo", () => {
    const planned = planApplyHhHmSimulationToOfficialParams({
      hhEffectiveRate: 38.86,
      hmEffectiveRate: 13.354701,
      currentHhOverride: 25,
      currentEnergyCost: 25000,
      currentWorkingHours: 1872,
    });
    assert.equal(planned.ok, true);
    if (!planned.ok) return;
    assert.equal(planned.plan.updateHhOverride, true);
    assert.equal(planned.plan.hhOverrideValue, 38.86);
    assert.equal(planned.plan.updateEnergyCost, true);
    assert.equal(planned.plan.keepWorkingHours, true);
    assert.equal(planned.plan.workingHoursValue, 1872);
    assert.ok(
      Math.abs((planned.plan.energyCostValue ?? 0) - 13.354701 * 1872) < 0.01
    );
    assert.ok(
      Math.abs((planned.plan.after.hmDefault ?? 0) - 13.354701) < 0.0001
    );
    assert.equal(planned.plan.after.hhDefault, 38.86);
  });

  it("exige WORKING_HOURS para aplicar HM", () => {
    const planned = planApplyHhHmSimulationToOfficialParams({
      hhEffectiveRate: null,
      hmEffectiveRate: 12,
      currentHhOverride: null,
      currentEnergyCost: null,
      currentWorkingHours: null,
    });
    assert.equal(planned.ok, false);
    if (planned.ok) return;
    assert.equal(planned.code, "WORKING_HOURS_REQUIRED");
  });

  it("rejeita simulação sem taxas", () => {
    const planned = planApplyHhHmSimulationToOfficialParams({
      hhEffectiveRate: null,
      hmEffectiveRate: null,
      currentHhOverride: 10,
      currentEnergyCost: 1000,
      currentWorkingHours: 100,
    });
    assert.equal(planned.ok, false);
  });

  it("parse exige confirm true e simulationId", () => {
    assert.equal(parseApplyHhHmSimulationBody({}).ok, false);
    assert.equal(
      parseApplyHhHmSimulationBody({ simulationId: "x", confirm: false }).ok,
      false
    );
    const ok = parseApplyHhHmSimulationBody({
      simulationId: "11111111-1111-1111-1111-111111111111",
      confirm: true,
    });
    assert.equal(ok.ok, true);
  });

  it("snapshot oficial soma HH+HM", () => {
    const snap = buildOfficialRatesSnapshot({
      hhOverride: 10,
      energyCost: 2000,
      workingHours: 100,
    });
    assert.equal(snap.hhDefault, 10);
    assert.equal(snap.hmDefault, 20);
    assert.equal(snap.injectionHourlyCostDefault, 30);
  });

  it("rota e UI integradas sem migration/campo novo", () => {
    const routes = read("src/lib/settingsGlobalsRoutes.ts");
    const serverApply = read("src/lib/settingsApplyHhHmSimulation.server.ts");
    const settings = read("src/components/SettingsModule.tsx");
    const section = read("src/components/settings/SettingsApplyHhHmSimulationSection.tsx");
    const server = read("server.ts");

    assert.match(routes, /APPLY_HH_HM_SIMULATION_API/);
    assert.match(routes, /apply-hh-hm-simulation|applyHhHmSimulationToOfficialParams/);
    assert.match(routes, /SETTINGS_GLOBAL_PARAMS_EDIT_PERMISSIONS/);
    assert.ok(SETTINGS_GLOBAL_PARAMS_EDIT_PERMISSIONS.includes("settings.global_params.edit"));
    assert.match(server, /registerSettingsGlobalsRoutes/);
    assert.match(server, /isUuid/);
    assert.match(settings, /SettingsApplyHhHmSimulationSection/);
    assert.match(section, /Aplicar aos parâmetros oficiais/);
    assert.match(section, /Aplicar simulação HH\/HM salva/);
    assert.match(section, /APPLY_HH_HM_SIMULATION_API/);
    assert.equal(APPLY_HH_HM_SIMULATION_API, "/api/settings/global-parameters/apply-hh-hm-simulation");
    assert.match(serverApply, /HH_VALUE_OVERRIDE/);
    assert.match(serverApply, /ENERGY_COST/);
    assert.doesNotMatch(serverApply, /HM_VALUE_OVERRIDE/);
    assert.doesNotMatch(serverApply, /getProductCostAnalysis/);
    assert.doesNotMatch(serverApply, /ProductBOM|Proposal/);
    assert.doesNotMatch(serverApply, /prisma\.\$executeRaw|CREATE TABLE/i);
  });
});
