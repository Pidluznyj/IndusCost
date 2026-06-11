import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  BLOCKED_OFFICIAL_WRITE_PATTERNS,
  isOfficialProductWriteFetch,
  PROJECT_SIMULATION_BANNER_TITLE,
  PROJECT_SIMULATION_MODE,
} from "./projectSimulationMode.js";

function collectProjectFiles(acc: string[] = []): string[] {
  const roots = [
    join(process.cwd(), "src", "components", "projects"),
    join(process.cwd(), "src", "components", "ProjectsModule.tsx"),
  ];
  for (const root of roots) {
    try {
      const st = statSync(root);
      if (st.isDirectory()) {
        for (const entry of readdirSync(root)) {
          const full = join(root, entry);
          if (statSync(full).isDirectory()) collectDir(full, acc);
          else if (/\.(tsx?|jsx?)$/.test(entry) && !/\.test\./.test(entry)) acc.push(full);
        }
      } else if (/\.(tsx?|jsx?)$/.test(root)) acc.push(root);
    } catch {
      // ignore
    }
  }
  const lib = join(process.cwd(), "src", "lib");
  for (const entry of readdirSync(lib)) {
    if (/projects/i.test(entry) && /\.(tsx?|js)$/.test(entry) && !/\.test\./.test(entry)) {
      acc.push(join(lib, entry));
    }
  }
  if (statSync(join(process.cwd(), "src", "lib", "projectSimulationMode.ts"))) {
    acc.push(join(process.cwd(), "src", "lib", "projectSimulationMode.ts"));
  }
  return [...new Set(acc)];
}

function collectDir(dir: string, acc: string[]) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) collectDir(full, acc);
    else if (/\.(tsx?|jsx?)$/.test(entry) && !/\.test\./.test(entry)) acc.push(full);
  }
}

describe("projectsSimulationIsolation", () => {
  it("módulo Projetos não chama endpoints oficiais de update de produto/material/BOM", () => {
    const files = collectProjectFiles().filter((f) => !f.endsWith("projectSimulationMode.ts"));
    for (const pattern of BLOCKED_OFFICIAL_WRITE_PATTERNS) {
      for (const file of files) {
        const content = readFileSync(file, "utf8");
        assert.equal(
          content.includes(pattern),
          false,
          `${file} contém padrão proibido: ${pattern}`
        );
      }
    }
  });

  it("isOfficialProductWriteFetch bloqueia PATCH em /api/products", () => {
    assert.equal(isOfficialProductWriteFetch("/api/products/abc", "PATCH"), true);
    assert.equal(isOfficialProductWriteFetch("/api/projects/abc", "PATCH"), false);
    assert.equal(isOfficialProductWriteFetch("/api/projects/lookup/products/x/snapshot", "GET"), false);
  });

  it("importação de BOM salva somente em ProjectStructureLine", () => {
    const snap = readFileSync(
      join(process.cwd(), "src", "lib", "projectsProductEngineeringSnapshot.ts"),
      "utf8"
    );
    const routes = readFileSync(join(process.cwd(), "src", "lib", "projectsRoutes.ts"), "utf8");
    assert.match(snap, /prisma\.projectStructureLine\.create/);
    assert.equal(snap.includes("prisma.productBOM.create"), false);
    assert.equal(snap.includes("prisma.productBOM.update"), false);
    assert.match(routes, /import-product-snapshot/);
    assert.match(routes, /engineering-snapshot/);
  });

  it("edição de custo importado salva snapshot via PATCH structure-lines", () => {
    const panel = readFileSync(
      join(process.cwd(), "src", "components", "projects", "ProjectProductSimulationPanel.tsx"),
      "utf8"
    );
    assert.match(panel, /onSaveToProject/);
    assert.match(panel, /unitCost/);
    assert.match(panel, /Salvar no projeto/);
    assert.equal(panel.includes("/api/products/"), false);
  });

  it("rollup de custo propaga alterações sem gravar cadastro oficial", () => {
    const rollup = readFileSync(
      join(process.cwd(), "src", "lib", "projectsEngineeringCostRollup.ts"),
      "utf8"
    );
    const service = readFileSync(join(process.cwd(), "src", "lib", "projectsService.ts"), "utf8");
    assert.match(rollup, /recalculateEngineeringCostRollup/);
    assert.match(service, /persistEngineeringCostRollupForVersion/);
    assert.equal(rollup.includes("prisma.product.update"), false);
    assert.equal(rollup.includes("prisma.material.update"), false);
  });

  it("processo/HH importado cria linhas MANUAL/PROCESS no projeto", () => {
    const snap = readFileSync(
      join(process.cwd(), "src", "lib", "projectsProductEngineeringSnapshot.ts"),
      "utf8"
    );
    assert.match(snap, /nodeType: "PROCESS"/);
    assert.match(snap, /unit: "HH"/);
    assert.match(snap, /sourceOfficialRoutingId/);
  });

  it("UI exibe texto de simulação sem alterar cadastro oficial", () => {
    const mode = readFileSync(join(process.cwd(), "src", "lib", "projectSimulationMode.ts"), "utf8");
    const banner = readFileSync(
      join(process.cwd(), "src", "components", "projects", "ProjectSimulationBanner.tsx"),
      "utf8"
    );
    const panel = readFileSync(
      join(process.cwd(), "src", "components", "projects", "ProjectProductSimulationPanel.tsx"),
      "utf8"
    );
    assert.match(mode, new RegExp(PROJECT_SIMULATION_BANNER_TITLE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(mode, /cadastro oficial/i);
    assert.match(banner, /PROJECT_SIMULATION_BANNER_TITLE/);
    assert.match(panel, /PROJECT_SIMULATION_MODE|project-simulation/);
    assert.match(panel, /Edição de simulação do projeto/);
  });

  it("componentes reaproveitados usam mode project-simulation", () => {
    const bom = readFileSync(
      join(process.cwd(), "src", "components", "projects", "ProjectBomSimulationTable.tsx"),
      "utf8"
    );
    assert.match(bom, /PROJECT_SIMULATION_MODE|project-simulation/);
    assert.match(bom, /formatCurrency|formatNumber/);
    assert.equal(bom.includes("updateProduct"), false);
  });

  it("snapshot de produto é read-only (findUnique, sem update)", () => {
    const snap = readFileSync(join(process.cwd(), "src", "lib", "projectsProductSnapshot.ts"), "utf8");
    assert.match(snap, /prisma\.product\.findUnique/);
    assert.equal(snap.includes("prisma.product.update"), false);
    assert.equal(snap.includes("prisma.material.update"), false);
    assert.equal(snap.includes("prisma.productBOM"), false);
  });
});
