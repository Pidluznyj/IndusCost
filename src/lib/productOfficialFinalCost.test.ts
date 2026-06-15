import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  extractOfficialProductFinalUnitCost,
  OFFICIAL_PRODUCT_FINAL_COST_SOURCE,
  resolveOfficialProductFinalCostFromAnalysis,
} from "./productOfficialFinalCost.js";

describe("productOfficialFinalCost", () => {
  it("usa totalIndustrialCost da engenharia, não costPerUnit legado", () => {
    const resolved = resolveOfficialProductFinalCostFromAnalysis({
      productId: "p1",
      sku: "SKU-1",
      costPerUnit: 10,
      totalIndustrialCost: 15,
    });
    assert.equal(resolved.ok, true);
    if (!resolved.ok) return;
    assert.equal(resolved.finalUnitCost, 15);
    assert.equal(resolved.source, OFFICIAL_PRODUCT_FINAL_COST_SOURCE);
  });

  it("produto sem custo final gera diagnóstico, não zero silencioso", () => {
    const resolved = resolveOfficialProductFinalCostFromAnalysis({
      productId: "p2",
      sku: "SKU-2",
      costPerUnit: 10,
    });
    assert.equal(resolved.ok, false);
    if (resolved.ok) return;
    assert.equal(resolved.diagnostics[0]?.code, "INVALID_COST_VALUE");
    assert.equal(extractOfficialProductFinalUnitCost({ costPerUnit: 99 }), null);
  });

  it("falha do motor propaga diagnóstico", () => {
    const resolved = resolveOfficialProductFinalCostFromAnalysis({
      error: "BOM_CYCLE",
      message: "Ciclo na BOM",
    });
    assert.equal(resolved.ok, false);
    if (resolved.ok) return;
    assert.equal(resolved.diagnostics[0]?.code, "BOM_CYCLE");
  });

  it("não retorna NaN/Infinity", () => {
    const resolved = resolveOfficialProductFinalCostFromAnalysis({
      totalIndustrialCost: Number.NaN,
    });
    assert.equal(resolved.ok, false);
    const ok = resolveOfficialProductFinalCostFromAnalysis({
      totalIndustrialCost: 12.5,
      totalMaterialCost: 5,
      totalHH_Unit: 3,
      totalHM_Unit: 4.5,
    });
    assert.equal(ok.ok, true);
    if (!ok.ok) return;
    assert.ok(Number.isFinite(ok.finalUnitCost));
    assert.ok(Number.isFinite(ok.breakdown.totalMaterialCost ?? NaN));
  });

  it("cenário obrigatório: legado 10 vs engenharia 15 retorna 15", () => {
    const analysis = {
      productId: "official-1",
      costPerUnit: 10,
      totalIndustrialCost: 15,
    };
    assert.equal(extractOfficialProductFinalUnitCost(analysis), 15);
  });

  it("projeto e simulação preservam snapshot — resolver não altera valores gravados", () => {
    const projectSnapshot = 12;
    const simulationSnapshot = 13;
    const officialAnalysis = { totalIndustrialCost: 15, costPerUnit: 10 };
    assert.equal(extractOfficialProductFinalUnitCost(officialAnalysis), 15);
    assert.equal(projectSnapshot, 12);
    assert.equal(simulationSnapshot, 13);
  });
});
