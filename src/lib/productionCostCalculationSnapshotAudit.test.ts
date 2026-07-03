import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildProductionCostBomStructureHashInput,
  extractProductionCostBomAuditStructureFromAnalysis,
  extractProductionCostWarningsFromAnalysis,
  normalizeProductionCostBomLineAudit,
  PRODUCTION_COST_SNAPSHOT_KIND,
} from "./productionCostCalculationSnapshotAudit.js";
import {
  buildProductionCostCalculationHash,
  buildProductionCostCalculationSnapshot,
  buildProductionCostDraftItemFromAnalysis,
} from "./productionCostPublication.js";
import type { OfficialProductFinalCostSuccess } from "./productOfficialFinalCost.js";

function sampleResolved(overrides?: Partial<OfficialProductFinalCostSuccess>): OfficialProductFinalCostSuccess {
  return {
    ok: true,
    productId: "prod-a",
    sku: "PA-001",
    finalUnitCost: 100,
    source: "PRODUCT_ENGINEERING_FINAL_COST",
    costAnalysisPartial: false,
    breakdown: {
      totalMaterialCost: 50,
      totalHH_Unit: 20,
      totalHM_Unit: 15,
      totalCIF_Unit: 10,
      totalOPEX_Unit: 5,
    },
    ...overrides,
  };
}

function sampleAnalysis(overrides?: Record<string, unknown>) {
  return {
    productId: "prod-a",
    sku: "PA-001",
    name: "Produto A",
    productType: "PRODUCT",
    totalMaterialCost: 50,
    totalHH_Unit: 20,
    totalHM_Unit: 15,
    warnings: [
      {
        code: "PARTIAL_CHILD",
        severity: "warning",
        message: "Filho parcial ignorado.",
        context: "BOM_LINE",
      },
    ],
    excludedBomLines: [
      {
        bomLineId: "bom-x",
        childProductId: "child-1",
        sku: "CH-01",
        name: "Filho sem roteiro",
        itemType: "COMPONENT",
        errorCode: "ROUTING_MISSING",
        message: "Roteiro ausente.",
        detailChain: "ROUTING_MISSING",
      },
    ],
    details: {
      materials: [
        {
          lineType: "MATERIAL",
          materialId: "mat-1",
          childProductId: null,
          sku: "MP-100",
          description: "Aço",
          bomLineId: "bom-1",
          quantity: 2,
          lossPercentage: 5,
          unit: "KG",
          unitCostUsed: 10,
          requiredQty: 2.105263,
          unitCost: 21.05263,
        },
        {
          lineType: "COMPONENT",
          materialId: null,
          childProductId: "comp-1",
          sku: "309.86AA",
          description: "Mangote",
          bomLineId: "bom-2",
          quantity: 1,
          lossPercentage: 0,
          unitCostUsed: 0.537299,
          requiredQty: 1,
          unitCost: 0.537299,
        },
      ],
    },
    ...overrides,
  };
}

describe("productionCostCalculationSnapshotAudit", () => {
  it("extracts material and component BOM lines from analysis", () => {
    const structure = extractProductionCostBomAuditStructureFromAnalysis(sampleAnalysis());
    assert.equal(structure.lineCount, 2);
    assert.equal(structure.materialLineCount, 1);
    assert.equal(structure.componentLineCount, 1);
    assert.equal(structure.lines[0]?.materialId, "mat-1");
    assert.equal(structure.lines[0]?.unit, "KG");
    assert.equal(structure.lines[1]?.childProductId, "comp-1");
    assert.equal(structure.excludedBomLines.length, 1);
  });

  it("extracts warnings from analysis", () => {
    const warnings = extractProductionCostWarningsFromAnalysis(sampleAnalysis());
    assert.equal(warnings.length, 1);
    assert.equal(warnings[0]?.code, "PARTIAL_CHILD");
  });

  it("calculationSnapshot includes material/component structure and metadata", () => {
    const snapshot = buildProductionCostCalculationSnapshot(
      sampleResolved(),
      sampleAnalysis(),
      { name: "Produto A", type: "PRODUCT" },
      new Date("2026-06-01T12:00:00.000Z")
    );
    assert.equal(snapshot.snapshotKind, PRODUCTION_COST_SNAPSHOT_KIND);
    assert.equal(snapshot.productType, "PRODUCT");
    assert.equal(snapshot.productName, "Produto A");
    assert.equal(snapshot.bomStructure.lines.length, 2);
    assert.equal(snapshot.warnings.length, 1);
    assert.equal(snapshot.breakdown.materialCost, 50);
    assert.equal(snapshot.breakdown.laborCost, 20);
    assert.equal(snapshot.breakdown.machineCost, 15);
    assert.match(snapshot.liveBomNotice, /BOM viva/);
  });

  it("buildProductionCostDraftItemFromAnalysis embeds audit structure", () => {
    const item = buildProductionCostDraftItemFromAnalysis(
      { id: "prod-a", sku: "PA-001", name: "Produto A", type: "PRODUCT" },
      sampleResolved(),
      sampleAnalysis(),
      new Date("2026-06-01T12:00:00.000Z")
    );
    const snapshot = item.calculationSnapshot as {
      bomStructure: { lines: unknown[] };
      productType: string;
    };
    assert.equal(snapshot.productType, "PRODUCT");
    assert.equal(snapshot.bomStructure.lines.length, 2);
    assert.ok(item.calculationHash);
  });

  it("calculationHash changes when relevant BOM quantity changes in a new draft", () => {
    const base = buildProductionCostCalculationSnapshot(
      sampleResolved(),
      sampleAnalysis(),
      { name: "Produto A", type: "PRODUCT" }
    );
    const changedAnalysis = sampleAnalysis({
      details: {
        materials: [
          {
            ...(sampleAnalysis().details as { materials: unknown[] }).materials[0],
            requiredQty: 3.5,
            unitCost: 35,
          },
          (sampleAnalysis().details as { materials: unknown[] }).materials[1],
        ],
      },
    });
    const changed = buildProductionCostCalculationSnapshot(
      sampleResolved({ finalUnitCost: 115 }),
      changedAnalysis,
      { name: "Produto A", type: "PRODUCT" }
    );
    const hashBase = buildProductionCostCalculationHash(base);
    const hashChanged = buildProductionCostCalculationHash(changed);
    assert.notEqual(hashBase, hashChanged);
    assert.notDeepEqual(
      buildProductionCostBomStructureHashInput(base.bomStructure),
      buildProductionCostBomStructureHashInput(changed.bomStructure)
    );
  });

  it("published item keeps calculation snapshot stable after source BOM changes (simulated)", () => {
    const frozenItem = buildProductionCostDraftItemFromAnalysis(
      { id: "prod-a", sku: "PA-001", name: "Produto A", type: "PRODUCT" },
      sampleResolved(),
      sampleAnalysis(),
      new Date("2026-06-01T12:00:00.000Z")
    );
    const originalSnapshotJson = JSON.stringify(frozenItem.calculationSnapshot);
    const originalHash = frozenItem.calculationHash;

    const liveAnalysisAfterBomChange = sampleAnalysis({
      details: {
        materials: [
          {
            lineType: "MATERIAL",
            materialId: "mat-1",
            sku: "MP-100",
            description: "Aço alterado",
            bomLineId: "bom-1",
            quantity: 99,
            requiredQty: 99,
            unitCostUsed: 10,
            unitCost: 990,
          },
        ],
      },
    });
    const liveSnapshot = buildProductionCostCalculationSnapshot(
      sampleResolved({ finalUnitCost: 500 }),
      liveAnalysisAfterBomChange,
      { name: "Produto A", type: "PRODUCT" }
    );

    assert.notEqual(JSON.stringify(liveSnapshot), originalSnapshotJson);
    assert.equal(JSON.stringify(frozenItem.calculationSnapshot), originalSnapshotJson);
    assert.equal(frozenItem.calculationHash, originalHash);
  });
});
