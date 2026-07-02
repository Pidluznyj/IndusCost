import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

function read(rel: string): string {
  return readFileSync(join(process.cwd(), rel), "utf8");
}

describe("transformationCostSimulator UI isolation", () => {
  it("módulo não chama APIs nem persiste custo oficial", () => {
    const mod = read("src/components/TransformationCostSimulatorModule.tsx");
    assert.doesNotMatch(mod, /fetchJsonOk|\/api\//);
    assert.doesNotMatch(mod, /prisma/i);
    assert.match(mod, /localStorage/);
    assert.match(mod, /não alteram custos oficiais/i);
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
});
