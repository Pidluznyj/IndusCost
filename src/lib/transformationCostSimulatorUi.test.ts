import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

function read(rel: string): string {
  return readFileSync(join(process.cwd(), rel), "utf8");
}

describe("transformationCostSimulator UI isolation", () => {
  it("módulo carrega referência oficial sem persistir custo oficial", () => {
    const mod = read("src/components/TransformationCostSimulatorModule.tsx");
    assert.match(mod, /fetchJsonOk[\s\S]*\/api\/transformation-simulator\/official-reference-costs/);
    assert.doesNotMatch(mod, /prisma/i);
    assert.match(mod, /localStorage/);
    assert.match(mod, /não alteram custos oficiais/i);
    assert.match(mod, /Referência oficial do sistema/);
    assert.match(mod, /HH default/);
    assert.match(mod, /HM default/);
    assert.match(mod, /Custo hora de injeção default/);
    assert.match(mod, /Custo hora de injeção/);
    assert.match(mod, /Custo de Injeção Estimado por Peça/);
  });

  it("rota e menu em Engenharia", () => {
    const app = read("src/App.tsx");
    assert.match(app, /path="transformation-simulator"/);
    assert.match(app, /TransformationCostSimulatorModule/);

    const groups = read("src/lib/navigationGroups.ts");
    assert.match(groups, /"transformation-simulator"/);
    assert.match(groups, /engenharia[\s\S]*transformation-simulator/);
  });

  it("endpoint read-only de referência oficial no server", () => {
    const server = read("server.ts");
    assert.match(server, /\/api\/transformation-simulator\/official-reference-costs/);
    assert.match(server, /buildOfficialDefaultIndustrialCostsReference/);
    assert.match(server, /initAnalysisCache/);
  });

  it("simulação HH/HM por centro de custo integrada sem persistir custo oficial", () => {
    const mod = read("src/components/TransformationCostSimulatorModule.tsx");
    assert.match(mod, /CostCenterHhHmSimulationPanel/);
    const panel = read("src/components/CostCenterHhHmSimulationPanel.tsx");
    const multiselect = read("src/components/CostCenterHhHmSimulationMultiselect.tsx");
    assert.match(panel, /média mensal/i);
    assert.match(panel, /Usar taxa manual/i);
    assert.match(panel, /Pessoas produtivas/i);
    assert.match(panel, /Máquinas produtivas/i);
    assert.match(panel, /Horas por pessoa\/mês/);
    assert.match(panel, /Horas por máquina\/mês/);
    assert.match(panel, /Eficiência mão de obra \(%\)/);
    assert.match(panel, /Eficiência máquinas \(%\)/);
    assert.match(panel, /min-h-\[2\.75rem\]/);
    assert.match(panel, /Configuração avançada/i);
    assert.match(panel, /Salvar simulação/);
    assert.match(panel, /save-cc-hh-hm-simulation/);
    assert.match(mod, /TransformationHhHmSavedSimulationsSection/);
    assert.match(panel, /não altera custos oficiais/i);
    assert.match(panel, /Taxa final HH \+ HM/i);
    assert.match(panel, /computeCostCenterHhHmDualRateSimulation/);
    assert.doesNotMatch(panel, /Impacto no custo do item/);
    assert.match(panel, /Aplicar taxa em uma peça\/item/i);
    assert.match(panel, /buildCostCenterHhHmSimulationCostCentersApiPath/);
    assert.match(panel, /CostCenterHhHmSimulationMultiselect/);
    assert.match(multiselect, /cost-center-hh-hm-multiselect/);
    assert.match(multiselect, /role="listbox"/);
    assert.match(panel, /parseCostCenterHhHmSimulationCostCentersResponse/);
    assert.match(panel, /normalizeCostCenterHhHmSimulationStoredForm/);
    assert.doesNotMatch(panel, /prisma/i);
    const routes = read("src/lib/financeCostCentersRoutes.ts");
    assert.match(routes, /\/api\/finance\/cost-centers\/hh-hm-simulation\/monthly-data/);
    assert.match(routes, /\/api\/finance\/cost-centers\/hh-hm-simulation\/cost-centers/);
    assert.match(routes, /hhHmSimulationGuard/);
    assert.doesNotMatch(routes, /prisma\.(simulation|product)/i);
  });
});
