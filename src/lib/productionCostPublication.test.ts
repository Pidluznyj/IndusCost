import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildProductionCostCalculationHash,
  buildProductionCostDraftItemFromAnalysis,
  mapOfficialCostToItemBreakdown,
  productionCostTableCodeFromEffectiveDate,
  productionCostTableNameFromCode,
} from "./productionCostPublication.js";
import { civilDateToLocalDate } from "./financeCivilDate.js";
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

describe("productionCostPublication", () => {
  it("productionCostTableCodeFromEffectiveDate retorna YYYY-MM", () => {
    assert.equal(
      productionCostTableCodeFromEffectiveDate(civilDateToLocalDate("2026-06-01")),
      "2026-06"
    );
  });

  it("productionCostTableNameFromCode inclui revisão", () => {
    assert.equal(productionCostTableNameFromCode("2026-06", 2), "Custo de produção 2026-06 (rev. 2)");
  });

  it("mapOfficialCostToItemBreakdown distribui MP/HH/HM/overhead", () => {
    const breakdown = mapOfficialCostToItemBreakdown(sampleResolved());
    assert.equal(breakdown.materialCost, 50);
    assert.equal(breakdown.laborCost, 20);
    assert.equal(breakdown.machineCost, 15);
    assert.equal(breakdown.overheadCost, 15);
    assert.equal(breakdown.processCost, 0);
    assert.equal(breakdown.otherCost, 0);
  });

  it("buildProductionCostDraftItemFromAnalysis inclui snapshot e hash", () => {
    const item = buildProductionCostDraftItemFromAnalysis(
      { id: "prod-a", sku: "PA-001", name: "Produto A", type: "PRODUCT" },
      sampleResolved(),
      {
        productType: "PRODUCT",
        warnings: [],
        excludedBomLines: [],
        details: { materials: [] },
        totalIndustrialCost: 100,
      },
      new Date("2026-06-01T12:00:00.000Z")
    );
    assert.equal(item.unitProductionCost, 100);
    assert.equal(item.productCodeSnapshot, "PA-001");
    assert.ok(item.calculationHash);
    assert.ok(item.calculationSnapshot);
    const snapshot = item.calculationSnapshot as {
      finalUnitCost: number;
      snapshotKind: string;
      bomStructure: { lines: unknown[] };
    };
    assert.equal(snapshot.finalUnitCost, 100);
    assert.equal(snapshot.snapshotKind, "FROZEN_AT_GENERATION");
    assert.ok(Array.isArray(snapshot.bomStructure.lines));
  });

  it("buildProductionCostCalculationHash é estável para mesmo snapshot", () => {
    const item = buildProductionCostDraftItemFromAnalysis(
      { id: "prod-a", sku: "PA-001", name: "Produto A" },
      sampleResolved(),
      { summary: { totalIndustrialCost: 100 } },
      new Date("2026-06-01T12:00:00.000Z")
    );
    const hash1 = item.calculationHash!;
    const hash2 = buildProductionCostCalculationHash(item.calculationSnapshot as never);
    assert.equal(hash1, hash2);
  });
});
