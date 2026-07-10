import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  buildCostCenterHhHmSimulationPayload,
  buildManualHhHmSimulationPayload,
  normalizeTransformationHhHmSimulationListPayload,
  parseTransformationHhHmSimulationCreateBody,
  parseTransformationHhHmSimulationType,
  TRANSFORMATION_HH_HM_SIMULATION_HISTORY_API,
} from "./transformationHhHmSimulationHistory.js";

function read(rel: string): string {
  return readFileSync(join(process.cwd(), rel), "utf8");
}

describe("transformationHhHmSimulationHistory", () => {
  it("aceita CUSTO_MANUAL e CUSTO_CC", () => {
    assert.equal(parseTransformationHhHmSimulationType("CUSTO_MANUAL"), "CUSTO_MANUAL");
    assert.equal(parseTransformationHhHmSimulationType("CUSTO_CC"), "CUSTO_CC");
    assert.equal(parseTransformationHhHmSimulationType("FOO"), null);
  });

  it("cria payload manual com HH/HM e final", () => {
    const payload = buildManualHhHmSimulationPayload({
      observation: "teste",
      form: {
        monthlyPayroll: "335767",
        productivePeople: "60",
        hoursPerPerson: "180",
        laborEfficiencyPercent: "80",
        monthlyEnergy: "25000",
        machines: "13",
        hoursPerMachine: "180",
        machineEfficiencyPercent: "80",
      },
      labor: {
        theoreticalLaborHours: 10800,
        adjustedLaborHours: 8640,
        adjustedHH: 38.86,
      },
      energy: {
        theoreticalMachineHours: 2340,
        adjustedMachineHours: 1872,
        adjustedHM: 13.35,
      },
    });
    assert.equal("error" in payload, false);
    if ("error" in payload) return;
    assert.equal(payload.type, "CUSTO_MANUAL");
    assert.equal(payload.hhEffectiveRate, 38.86);
    assert.equal(payload.hmEffectiveRate, 13.35);
    assert.equal(payload.finalHhHmRate, 52.21);
    assert.equal(payload.inputSnapshot.productivePeople, "60");
    assert.equal(payload.resultSnapshot.adjustedLaborHours, 8640);
  });

  it("cria payload CC com centros e snapshot", () => {
    const payload = buildCostCenterHhHmSimulationPayload({
      observation: "cc",
      periodLabelHh: "01/2026 — 06/2026",
      periodLabelHm: "01/2026 — 06/2026",
      hh: {
        averagePeriod: "LAST_6_MONTHS",
        selectedCostCenterIds: ["cc-a"],
        selectedCostCenterLabels: "100 — Folha",
        productiveCount: "60",
        hoursPerUnit: "180",
        efficiencyPercent: "80",
        useManualRate: false,
        manualRatePerHour: "",
        monthlyAverageAmount: 337536.26,
        theoreticalHours: 10800,
        adjustedHours: 8640,
        calculatedRatePerHour: 39.07,
        effectiveRatePerHour: 39.07,
      },
      hm: {
        averagePeriod: "LAST_6_MONTHS",
        selectedCostCenterIds: ["cc-b"],
        selectedCostCenterLabels: "200 — Energia",
        productiveCount: "13",
        hoursPerUnit: "180",
        efficiencyPercent: "80",
        useManualRate: false,
        manualRatePerHour: "",
        monthlyAverageAmount: 23310.3,
        theoreticalHours: 2340,
        adjustedHours: 1872,
        calculatedRatePerHour: 12.45,
        effectiveRatePerHour: 12.45,
      },
    });
    assert.equal("error" in payload, false);
    if ("error" in payload) return;
    assert.equal(payload.type, "CUSTO_CC");
    assert.equal(payload.dateAxis, "DUE_DATE");
    assert.equal(payload.finalHhHmRate, 51.52);
    assert.deepEqual(
      (payload.inputSnapshot.hh as { selectedCostCenterIds: string[] }).selectedCostCenterIds,
      ["cc-a"]
    );
    assert.deepEqual(
      (payload.inputSnapshot.hm as { selectedCostCenterIds: string[] }).selectedCostCenterIds,
      ["cc-b"]
    );
  });

  it("rejeita type inválido e eficiência inválida", () => {
    const invalidType = parseTransformationHhHmSimulationCreateBody({
      type: "XYZ",
      inputSnapshot: {},
      resultSnapshot: {},
      hhEffectiveRate: 10,
    });
    assert.equal(invalidType.ok, false);

    const invalidEff = parseTransformationHhHmSimulationCreateBody({
      type: "CUSTO_MANUAL",
      inputSnapshot: { laborEfficiencyPercent: 120 },
      resultSnapshot: {},
      hhEffectiveRate: 10,
    });
    assert.equal(invalidEff.ok, false);
    if (invalidEff.ok) return;
    assert.match(invalidEff.message, /0 e 100/);

    const nestedEff = parseTransformationHhHmSimulationCreateBody({
      type: "CUSTO_CC",
      inputSnapshot: { hh: { efficiencyPercent: -1 } },
      resultSnapshot: {},
      hhEffectiveRate: 10,
    });
    assert.equal(nestedEff.ok, false);

    const negativeHours = parseTransformationHhHmSimulationCreateBody({
      type: "CUSTO_MANUAL",
      inputSnapshot: { hoursPerPerson: "-1" },
      resultSnapshot: {},
      hhEffectiveRate: 10,
    });
    assert.equal(negativeHours.ok, false);
  });

  it("não altera Proposal, BOM nem custo oficial no histórico", () => {
    const history = read("src/lib/transformationHhHmSimulationHistory.ts");
    const server = read("src/lib/transformationHhHmSimulationHistory.server.ts");
    const routes = read("src/lib/transformationHhHmSimulationHistoryRoutes.ts");
    for (const src of [history, server, routes]) {
      assert.doesNotMatch(src, /Proposal/);
      assert.doesNotMatch(src, /ProductBOM/);
      assert.doesNotMatch(src, /officialProductCost/i);
      assert.doesNotMatch(src, /updateMany|deleteMany/);
    }
  });

  it("normaliza listagem para items array", () => {
    const empty = normalizeTransformationHhHmSimulationListPayload(null);
    assert.deepEqual(empty.items, []);
    const ok = normalizeTransformationHhHmSimulationListPayload({
      items: [
        {
          id: "11111111-1111-1111-1111-111111111111",
          type: "CUSTO_MANUAL",
          hhEffectiveRate: "10",
          hmEffectiveRate: "5",
          finalHhHmRate: "15",
          inputSnapshot: {},
          resultSnapshot: {},
          createdAt: "2026-07-10T10:00:00.000Z",
          updatedAt: "2026-07-10T10:00:00.000Z",
        },
      ],
      total: 1,
    });
    assert.equal(ok.items.length, 1);
    assert.equal(ok.items[0]?.finalHhHmRate, 15);
  });

  it("UI e rotas de histórico estão integradas", () => {
    const mod = read("src/components/TransformationCostSimulatorModule.tsx");
    const panel = read("src/components/CostCenterHhHmSimulationPanel.tsx");
    const section = read("src/components/TransformationHhHmSavedSimulationsSection.tsx");
    const routes = read("src/lib/transformationHhHmSimulationHistoryRoutes.ts");
    const server = read("server.ts");
    assert.match(mod, /Salvar simulação/);
    assert.match(mod, /TransformationHhHmSavedSimulationsSection/);
    assert.match(panel, /save-cc-hh-hm-simulation/);
    assert.match(section, /Nenhuma simulação salva ainda/);
    assert.match(section, /Simulação histórica, não altera custo oficial/);
    assert.match(routes, new RegExp(TRANSFORMATION_HH_HM_SIMULATION_HISTORY_API.replace(/\//g, "\\/")));
    assert.match(server, /registerTransformationHhHmSimulationHistoryRoutes/);
    assert.doesNotMatch(mod, /prisma/i);
    assert.doesNotMatch(panel, /prisma/i);
  });
});
