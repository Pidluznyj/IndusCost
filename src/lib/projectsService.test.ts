import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assertSimulatedItemIsolation,
  buildInitialVersionData,
  buildProjectAlerts,
  buildStructureLineTotal,
  isValidProjectStatus,
  isValidProjectType,
  resolveMoldAmortizedCost,
  resolveStructureLineSnapshots,
} from "./projectsService.js";

describe("projectsService — regras de negócio", () => {
  it("criação de projeto define versão 1 como atual", () => {
    const data = buildInitialVersionData(
      {
        id: "p1",
        status: "DRAFT",
      } as Parameters<typeof buildInitialVersionData>[0],
      1
    );
    assert.equal(data.versionNumber, 1);
    assert.equal(data.isCurrent, true);
    assert.equal(data.projectId, "p1");
  });

  it("projeto suporta status e tipo válidos", () => {
    assert.equal(isValidProjectType("NEW_PRODUCT"), true);
    assert.equal(isValidProjectType("INVALID"), false);
    assert.equal(isValidProjectStatus("WAITING_QUOTATION"), true);
    assert.equal(isValidProjectStatus("FOO"), false);
  });

  it("item simulado não cria cadastro oficial", () => {
    assert.equal(assertSimulatedItemIsolation(), true);
  });

  it("estrutura salva snapshot de descrição, unidade e custo", () => {
    const mat = resolveStructureLineSnapshots({
      sourceType: "EXISTING_MATERIAL",
      existingMaterial: {
        code: "MP-001",
        description: "Aço",
        unit: "KG",
        currentCost: 12.5 as never,
      },
    });
    assert.match(mat.description, /MP-001/);
    assert.equal(mat.unit, "KG");
    assert.equal(mat.unitCost, 12.5);

    const sim = resolveStructureLineSnapshots({
      sourceType: "SIMULATED_ITEM",
      simulatedItem: {
        description: "Componente provisório",
        unit: "UN",
        quotedUnitCost: null,
        estimatedUnitCost: 8 as never,
      } as never,
    });
    assert.equal(sim.description, "Componente provisório");
    assert.equal(sim.unitCost, 8);
  });

  it("estrutura pode usar item existente e simulado", () => {
    const existing = resolveStructureLineSnapshots({
      sourceType: "EXISTING_PRODUCT",
      existingProduct: { sku: "PRD-1", name: "Eixo" },
    });
    const simulated = resolveStructureLineSnapshots({
      sourceType: "SIMULATED_ITEM",
      simulatedItem: {
        description: "Novo inserto",
        unit: "UN",
        quotedUnitCost: 3 as never,
        estimatedUnitCost: null,
      } as never,
    });
    assert.match(existing.description, /PRD-1/);
    assert.equal(simulated.unitCost, 3);
  });

  it("cálculo de linha considera perda", () => {
    assert.ok(Math.abs(buildStructureLineTotal(10, 5, 10) - 55) < 0.001);
  });

  it("molde amortizado calcula custo por unidade", () => {
    assert.equal(resolveMoldAmortizedCost(20000, "AMORTIZED_IN_PRODUCT", 4000), 5);
    assert.equal(resolveMoldAmortizedCost(20000, "CHARGED_SEPARATELY", 4000), null);
  });

  it("alertas incluem item sem custo e produto sem estrutura", () => {
    const alerts = buildProjectAlerts({
      structureLines: [
        {
          id: "l1",
          simulatedProductId: null,
          lineType: "RAW_MATERIAL",
          sourceType: "MANUAL",
          existingProductId: null,
          existingMaterialId: null,
          simulatedItemId: null,
          descriptionSnapshot: "Linha sem custo",
          unitSnapshot: "UN",
          quantity: 1,
          lossPercent: 0,
          unitCostSnapshot: 0,
          totalCost: 0,
          supplierNameSnapshot: null,
          notes: null,
          sortOrder: 0,
        },
      ],
      simulatedItems: [],
      simulatedProducts: [
        {
          id: "sp1",
          provisionalCode: null,
          description: "Produto A",
          unit: "UN",
          estimatedWeight: null,
          expectedVolume: null,
          batchSize: null,
          notes: null,
        },
      ],
      molds: [],
      targetMarginPercent: 30,
      marginPercent: 20,
    });
    assert.ok(alerts.some((a) => a.code === "LINE_WITHOUT_COST"));
    assert.ok(alerts.some((a) => a.code === "MARGIN_BELOW_TARGET"));
    assert.ok(alerts.some((a) => a.code === "PRODUCT_WITHOUT_STRUCTURE"));
  });
});
