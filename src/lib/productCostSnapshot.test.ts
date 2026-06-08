import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildCurrentCostSnapshotFromAnalysis,
  isCostAnalysisFailure,
} from "./productCostSnapshot.js";

describe("productCostSnapshot", () => {
  it("isCostAnalysisFailure detecta payload de erro", () => {
    assert.equal(isCostAnalysisFailure({ error: "BOM_CYCLE" }), true);
    assert.equal(isCostAnalysisFailure({ productId: "p1" }), false);
    assert.equal(isCostAnalysisFailure(null), false);
  });

  it("buildCurrentCostSnapshotFromAnalysis mapeia análise válida", () => {
    const snapshot = buildCurrentCostSnapshotFromAnalysis({
      productId: "p1",
      sku: "SKU-1",
      totalMaterialCost: 10,
      totalHH_Unit: 2,
      totalHM_Unit: 3,
      totalIndustrialCost: 15,
      costAnalysisPartial: true,
      details: { materials: [{ code: "MP1", lineCost: 10 }] },
    });
    assert.ok(snapshot);
    assert.equal(snapshot!.productId, "p1");
    assert.equal(snapshot!.sku, "SKU-1");
    assert.equal(snapshot!.totalIndustrialCost, 15);
    assert.equal(snapshot!.costAnalysisPartial, true);
    assert.equal(snapshot!.materials?.length, 1);
  });

  it("buildCurrentCostSnapshotFromAnalysis retorna null para falha", () => {
    assert.equal(buildCurrentCostSnapshotFromAnalysis({ error: "CONFIG_MISSING" }), null);
    assert.equal(buildCurrentCostSnapshotFromAnalysis(null), null);
  });
});
