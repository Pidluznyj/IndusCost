import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

function read(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("operations performance navigation", () => {
  it("App.tsx registra rota /operations-performance", () => {
    assert.match(read("src/App.tsx"), /path="operations-performance"/);
    assert.match(read("src/App.tsx"), /Performance de Componentes/);
  });

  it("navigationGroups inclui operations-performance em Operações", () => {
    assert.match(read("src/lib/navigationGroups.ts"), /operations-performance/);
  });

  it("OperationsPerformanceModule usa APIs de performance", () => {
    const moduleSrc = read("src/components/operations/OperationsPerformanceModule.tsx");
    assert.match(moduleSrc, /fetchComponentPerformanceList/);
    assert.match(moduleSrc, /patchComponentPerformanceProduct/);
    assert.match(moduleSrc, /fetchComponentPerformanceHistory/);
  });
});
