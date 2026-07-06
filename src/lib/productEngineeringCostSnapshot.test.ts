import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { civilDateToLocalDate } from "./financeCivilDate.js";
import {
  incrementalProductionCostVersionCode,
  isCalculableProductionUnitCost,
  isExplicitlyValidZeroProductionCost,
  isProductionCostTableEligibleItemType,
  productionCostTableEligibleItemTypesFilter,
  resolveFrozenCostTraceStatus,
} from "./productEngineeringCostSnapshot.js";
import type { OfficialProductFinalCostSuccess } from "./productOfficialFinalCost.js";

function success(finalUnitCost: number, partial = false): OfficialProductFinalCostSuccess {
  return {
    ok: true,
    productId: "p1",
    sku: "SKU",
    finalUnitCost,
    source: "PRODUCT_ENGINEERING_FINAL_COST",
    costAnalysisPartial: partial,
    breakdown: {
      totalMaterialCost: finalUnitCost,
      totalHH_Unit: 0,
      totalHM_Unit: 0,
      totalCIF_Unit: 0,
      totalOPEX_Unit: 0,
    },
  };
}

describe("productEngineeringCostSnapshot", () => {
  it("elegibilidade da tabela oficial inclui PRODUCT e COMPONENT", () => {
    assert.equal(isProductionCostTableEligibleItemType("PRODUCT"), true);
    assert.equal(isProductionCostTableEligibleItemType("COMPONENT"), true);
    assert.equal(isProductionCostTableEligibleItemType("MATERIAL"), false);
    assert.deepEqual(productionCostTableEligibleItemTypesFilter(), {
      in: ["PRODUCT", "COMPONENT"],
    });
  });

  it("rejeita custo zero silencioso", () => {
    const resolved = success(0);
    assert.equal(isCalculableProductionUnitCost(resolved, {}), false);
  });

  it("aceita zero explícito BOM_ONLY", () => {
    const resolved = success(0);
    assert.equal(
      isExplicitlyValidZeroProductionCost(resolved, { costingMode: "BOM_ONLY" }),
      true
    );
    assert.equal(isCalculableProductionUnitCost(resolved, { costingMode: "BOM_ONLY" }), true);
  });

  it("código incremental AUTO inclui data e SKU", () => {
    const code = incrementalProductionCostVersionCode(civilDateToLocalDate("2026-07-01"), "619.24AA");
    assert.equal(code, "AUTO-2026-07-01-619.24AA");
  });

  it("status ATUALIZADO quando hash publicado = hash vivo", () => {
    const status = resolveFrozenCostTraceStatus({
      liveCiu: 10,
      liveHash: "abc",
      publishedCost: 10,
      publishedHash: "abc",
      publishedVersionStatus: "PUBLISHED",
      draftHash: null,
      draftVersionStatus: null,
    });
    assert.equal(status, "ATUALIZADO");
  });

  it("status CUSTO_DIVERGENTE quando custo difere", () => {
    const status = resolveFrozenCostTraceStatus({
      liveCiu: 12,
      liveHash: "new",
      publishedCost: 10,
      publishedHash: "old",
      publishedVersionStatus: "PUBLISHED",
      draftHash: null,
      draftVersionStatus: null,
    });
    assert.equal(status, "CUSTO_DIVERGENTE");
  });

  it("status SNAPSHOT_TECNICO_SEM_IMPACTO quando custo igual e hash difere", () => {
    const status = resolveFrozenCostTraceStatus({
      liveCiu: 0.912785,
      liveHash: "live-hash",
      publishedCost: 0.912785,
      publishedHash: "pub-hash",
      publishedVersionStatus: "PUBLISHED",
      draftHash: "draft-hash",
      draftVersionStatus: "DRAFT",
      draftUnitCost: 0.912785,
    });
    assert.equal(status, "SNAPSHOT_TECNICO_SEM_IMPACTO");
  });

  it("SEM_CUSTO_CONGELADO sem publicado nem draft", () => {
    const status = resolveFrozenCostTraceStatus({
      liveCiu: 5,
      liveHash: "h1",
      publishedCost: null,
      publishedHash: null,
      publishedVersionStatus: null,
      draftHash: null,
      draftVersionStatus: null,
    });
    assert.equal(status, "SEM_CUSTO_CONGELADO");
  });
});
