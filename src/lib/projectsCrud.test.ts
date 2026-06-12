import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { buildLaborLinePayload, calculateLaborLineTotal } from "./projectsUiUtils.js";

describe("projectsCrud", () => {
  it("endpoints DELETE existem para projeto, produtos, itens e moldes", () => {
    const routes = readFileSync(join(process.cwd(), "src", "lib", "projectsRoutes.ts"), "utf8");
    assert.match(routes, /delete\("\/api\/projects\/:id"/i);
    assert.match(routes, /assertProjectsDeleteSuperAdmin/);
    assert.match(routes, /deleteProject\(/);
    assert.match(routes, /delete\("\/api\/projects\/:id\/simulated-products\/:simulatedProductId"/i);
    assert.match(routes, /delete\("\/api\/projects\/:id\/simulated-items\/:simulatedItemId"/i);
    assert.match(routes, /delete\("\/api\/projects\/:id\/molds\/:moldId"/i);
    assert.match(routes, /delete\("\/api\/projects\/:id\/structure-lines\/:lineId"/i);
    assert.match(routes, /patch\("\/api\/projects\/:id\/simulated-products/i);
    assert.match(routes, /patch\("\/api\/projects\/:id\/simulated-items/i);
    assert.match(routes, /patch\("\/api\/projects\/:id\/molds/i);
    assert.match(routes, /patch\("\/api\/projects\/:id\/structure-lines/i);
  });

  it("linha HH calcula total = horas * valor hora com perda", () => {
    assert.equal(calculateLaborLineTotal(10, 50, 0), 500);
    assert.equal(calculateLaborLineTotal(8, 75, 10), 660);
    assert.equal(Number.isFinite(calculateLaborLineTotal(0, 100, 0)), true);
    assert.equal(Number.isFinite(calculateLaborLineTotal(5, 0, 0)), true);
  });

  it("linha HH mapeia para MANUAL + PROCESS + unidade HH", () => {
    const payload = buildLaborLinePayload({
      description: "Hora-homem",
      hours: "12",
      hourlyRate: "85,50",
      lossPercent: "5",
      notes: "Montagem",
    });
    assert.equal(payload.sourceType, "MANUAL");
    assert.equal(payload.lineType, "PROCESS");
    assert.equal(payload.unit, "HH");
    assert.equal(payload.quantity, 12);
    assert.equal(payload.unitCost, 85.5);
    assert.equal(payload.lossPercent, 5);
  });

  it("linha HH aceita perda sem NaN/Infinity", () => {
    const total = calculateLaborLineTotal(100, 50, 999);
    assert.equal(Number.isFinite(total), true);
    assert.equal(Number.isNaN(total), false);
  });

  it("custos incluem HH via lineType PROCESS em serviceCost", () => {
    const calc = readFileSync(join(process.cwd(), "src", "lib", "projectsCalculations.ts"), "utf8");
    assert.match(calc, /case "SERVICE":\s*\n\s*case "PROCESS":/);
    assert.match(calc, /serviceCost \+= total/);
  });

  it("edição de linha existente altera apenas snapshot no PATCH", () => {
    const routes = readFileSync(join(process.cwd(), "src", "lib", "projectsRoutes.ts"), "utf8");
    assert.match(routes, /unitCostSnapshot: unitCost/);
    assert.equal(routes.includes("prisma.product.update"), false);
    assert.equal(routes.includes("prisma.material.update"), false);
  });

  it("exclusão usa modal padrão com mensagem de simulação", () => {
    const modal = readFileSync(
      join(process.cwd(), "src", "components", "projects", "ProjectDeleteConfirmModal.tsx"),
      "utf8"
    );
    const mod = readFileSync(join(process.cwd(), "src", "components", "ProjectsModule.tsx"), "utf8");
    assert.match(modal, /Confirmar exclusão/);
    assert.match(modal, /Nenhum cadastro oficial será/);
    assert.match(modal, /alterado/);
    assert.match(mod, /ProjectDeleteConfirmModal/);
    assert.equal(mod.includes("window.confirm"), false);
  });

  it("UI guiada permite criar, editar e excluir itens do projeto", () => {
    const mod = readFileSync(join(process.cwd(), "src", "components", "ProjectsModule.tsx"), "utf8");
    assert.match(mod, /ProjectEngineeringItemModal/);
    assert.match(mod, /ProjectGuidedMoldModal/);
    assert.match(mod, /ProjectOtherCostsModal/);
    assert.match(mod, /ProjectSimulatedItemFormModal/);
    assert.match(mod, /ProjectItemsTab/);
    assert.match(mod, /method: "PATCH"/);
    assert.match(mod, /method: "DELETE"/);
    assert.match(mod, /guidedMoldMode/);
    assert.equal(mod.includes("ProjectMoldFormModal"), false);
    assert.match(mod, /ProjectStructureLineModal/);
    assert.match(mod, /ProjectSimulatedProductWorkspace/);
  });

  it("molde pode ser criado, editado e excluído via UI", () => {
    const mod = readFileSync(join(process.cwd(), "src", "components", "ProjectsModule.tsx"), "utf8");
    assert.match(mod, /editingMold/);
    assert.match(mod, /kind: "mold"/);
    assert.match(mod, /\/molds\/\$\{editingMold\.id\}/);
  });

  it("exclusão de projeto inteiro só aparece para super admin", () => {
    const mod = readFileSync(join(process.cwd(), "src", "components", "ProjectsModule.tsx"), "utf8");
    assert.match(mod, /canDeleteProject/);
    assert.match(mod, /kind: "project"/);
    assert.match(mod, /Excluir projeto/);
    assert.match(mod, /canDelete={canDelete}/);
  });
});
