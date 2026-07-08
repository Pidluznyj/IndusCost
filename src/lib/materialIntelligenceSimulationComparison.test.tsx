import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const ROOT = process.cwd();

function read(relPath: string): string {
  return readFileSync(join(ROOT, relPath), "utf8");
}

describe("MaterialIntelligenceSimulationComparison", () => {
  it("component defines empty placeholder before simulate", () => {
    const component = read("src/components/materials/MaterialIntelligenceSimulationComparison.tsx");
    assert.match(component, /material-intelligence-simulation-comparison-empty/);
    assert.match(component, /Execute uma simulação para comparar cenários/);
  });

  it("component renders Atual, Simulado and Diferença KPI rows", () => {
    const component = read("src/components/materials/MaterialIntelligenceSimulationComparison.tsx");
    assert.match(component, /SummaryKpiGrid/);
    assert.match(component, /SummaryKpiCard/);
    assert.match(component, /label="Atual"/);
    assert.match(component, /label="Simulado"/);
    assert.match(component, /label="Diferença"/);
    assert.match(component, /material-intelligence-simulation-comparison-material/);
    assert.match(component, /material-intelligence-simulation-comparison-margin/);
    assert.match(component, /material-intelligence-simulation-comparison-risk/);
  });

  it("simulation panel wires comparison and clears result on Limpar", () => {
    const panel = read("src/components/materials/MaterialIntelligenceSimulationPanel.tsx");
    assert.match(panel, /MaterialIntelligenceSimulationComparison/);
    assert.match(panel, /comparison=\{result\?\.comparison/);
    assert.match(panel, /setResult\(null\)/);
    assert.match(panel, /material-intelligence-simulation-clear/);
  });
});
