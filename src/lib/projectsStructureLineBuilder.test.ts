import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  buildProjectStructureLineFromContext,
  previewProjectStructureLineTotal,
  ProjectStructureLineValidationError,
  resolveMaterialDefaultLossPercent,
  resolveProjectStructureLineCostSource,
  validateProjectStructureLineCreate,
} from "./projectsStructureLineBuilder.js";

describe("projectsStructureLineBuilder", () => {
  it("calcula total de material: quantity * currentCost * (1 + loss/100)", () => {
    const built = buildProjectStructureLineFromContext({
      sourceType: "EXISTING_MATERIAL",
      quantity: 0.04,
      lossPercent: 5,
      existingMaterial: {
        id: "mat-1",
        code: "PP-001",
        description: "Polipropileno",
        unit: "KG",
        currentCost: 12.5,
        supplier: "Fornecedor A",
        standardLoss: 3,
      },
    });
    assert.equal(built.unitCostSnapshot, 12.5);
    assert.equal(built.totalCost, previewProjectStructureLineTotal(0.04, 12.5, 5));
    assert.ok(Math.abs(built.totalCost - 0.525) < 0.0001);
    assert.equal(built.costSource, "MATERIAL_CURRENT_COST");
    assert.equal(built.isMissingCost, false);
    assert.equal(built.descriptionSnapshot, "PP-001 — Polipropileno");
    assert.equal(built.unitSnapshot, "KG");
    assert.equal(built.supplierNameSnapshot, "Fornecedor A");
    assert.equal(built.countsInSimulatedProductCost, true);
  });

  it("alterar quantidade recalcula total", () => {
    const a = previewProjectStructureLineTotal(1, 10, 0);
    const b = previewProjectStructureLineTotal(2, 10, 0);
    assert.equal(a, 10);
    assert.equal(b, 20);
  });

  it("alterar perda recalcula total", () => {
    const a = previewProjectStructureLineTotal(1, 10, 0);
    const b = previewProjectStructureLineTotal(1, 10, 10);
    assert.equal(a, 10);
    assert.equal(b, 11);
  });

  it("material sem custo marca isMissingCost e costSource MISSING", () => {
    const built = buildProjectStructureLineFromContext({
      sourceType: "EXISTING_MATERIAL",
      quantity: 1,
      lossPercent: 0,
      existingMaterial: {
        id: "mat-2",
        code: "ABS-0",
        description: "Sem custo",
        unit: "KG",
        currentCost: 0,
      },
    });
    assert.equal(built.isMissingCost, true);
    assert.equal(built.costSource, "MISSING");
    assert.equal(built.unitCostSnapshot, 0);
    assert.equal(built.totalCost, 0);
  });

  it("componente simulado usa quotedUnitCost ou estimatedUnitCost", () => {
    const built = buildProjectStructureLineFromContext({
      sourceType: "SIMULATED_ITEM",
      quantity: 2,
      lossPercent: 0,
      simulatedItem: {
        description: "Haste nova",
        unit: "UN",
        quotedUnitCost: 8.5,
        estimatedUnitCost: 7,
        supplierName: "Projeto",
      },
    });
    assert.equal(built.unitCostSnapshot, 8.5);
    assert.equal(built.totalCost, 17);
    assert.equal(built.costSource, "PROJECT_SIMULATED_ITEM");
    assert.equal(built.supplierNameSnapshot, "Projeto");
  });

  it("valida quantidade > 0", () => {
    assert.throws(
      () =>
        validateProjectStructureLineCreate({
          sourceType: "EXISTING_MATERIAL",
          quantity: 0,
          existingMaterial: { id: "m", code: "C", description: "D", unit: "KG", currentCost: 1 },
        }),
      ProjectStructureLineValidationError
    );
  });

  it("resolve perda padrão do material", () => {
    assert.equal(resolveMaterialDefaultLossPercent({ standardLoss: 4 }), 4);
    assert.equal(resolveMaterialDefaultLossPercent({ standardLoss: null }), 0);
  });

  it("resolve costSource por origem", () => {
    assert.equal(resolveProjectStructureLineCostSource("EXISTING_MATERIAL"), "MATERIAL_CURRENT_COST");
    assert.equal(resolveProjectStructureLineCostSource("SIMULATED_ITEM"), "PROJECT_SIMULATED_ITEM");
    assert.equal(resolveProjectStructureLineCostSource("MANUAL"), "MANUAL_PROJECT_ENTRY");
  });

  it("não retorna NaN ou Infinity no total", () => {
    const built = buildProjectStructureLineFromContext({
      sourceType: "MANUAL",
      quantity: 1,
      lossPercent: 0,
      manualDescription: "Item livre",
      manualUnit: "UN",
      manualUnitCost: 5,
    });
    assert.ok(Number.isFinite(built.totalCost));
    assert.ok(!Number.isNaN(built.totalCost));
  });

  it("POST structure-lines usa builder e não grava Product/ProductBOM", () => {
    const routes = readFileSync(join(process.cwd(), "src", "lib", "projectsRoutes.ts"), "utf8");
    assert.match(routes, /buildProjectStructureLineFromContext/);
    assert.match(routes, /existingMaterialId: existingMaterial\?\.id/);
    assert.equal(routes.includes("prisma.product.create"), false);
    assert.equal(routes.includes("prisma.productBOM.create"), false);
    assert.match(routes, /Use importação de produto para estrutura oficial/);
  });
});
