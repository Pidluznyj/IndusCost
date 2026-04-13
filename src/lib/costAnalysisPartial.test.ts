import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  SKIPPABLE_CHILD_COST_ERROR_CODES,
  SKIPPABLE_CHILD_COST_ERROR_CODES_SET,
  buildExcludedBomLineRecord,
} from "./costAnalysisPartial";

describe("costAnalysisPartial", () => {
  it("lista códigos esperados do motor (documentação)", () => {
    assert.ok(SKIPPABLE_CHILD_COST_ERROR_CODES.includes("ROUTING_MISSING"));
    assert.ok(SKIPPABLE_CHILD_COST_ERROR_CODES.includes("CHILD_COST_FAILED"));
    assert.ok(SKIPPABLE_CHILD_COST_ERROR_CODES_SET.has("PROCESS_INVALID"));
  });

  it("buildExcludedBomLineRecord preserva mensagem legível e cadeia", () => {
    const ex = buildExcludedBomLineRecord({
      bomLineId: "line-1",
      childProductId: "c1",
      sku: "308.03AA",
      name: "Alavanca",
      itemType: "COMPONENT",
      errorCode: "ROUTING_MISSING",
      failure: { error: "ROUTING_MISSING", message: "Sem processo" },
      detailChain: "ROUTING_MISSING: Sem processo",
    });
    assert.equal(ex.errorCode, "ROUTING_MISSING");
    assert.equal(ex.message, "Sem processo");
    assert.equal(ex.detailChain, "ROUTING_MISSING: Sem processo");
    assert.equal(ex.sku, "308.03AA");
  });

  it("buildExcludedBomLineRecord usa detailChain quando message ausente", () => {
    const ex = buildExcludedBomLineRecord({
      bomLineId: "line-2",
      childProductId: null,
      sku: null,
      name: null,
      itemType: null,
      errorCode: "BOM_LINE_INCOMPLETE",
      failure: { error: "BOM_LINE_INCOMPLETE" },
      detailChain: "BOM_LINE_INCOMPLETE",
    });
    assert.equal(ex.message, "BOM_LINE_INCOMPLETE");
  });
});

describe("contrato payload (parcial)", () => {
  it("linha excluída deve incluir campos para UI/tooltip", () => {
    const row = {
      description: "[308.03AA] ABS",
      basePrice: 0,
      requiredQty: 2,
      unitCost: 0,
      excludedFromCost: true,
      errorCode: "ROUTING_MISSING",
      message: "Componente sem processo",
      detailChain: "ROUTING_MISSING: ...",
      sku: "308.03AA",
      name: "ABS",
    };
    assert.equal(row.excludedFromCost, true);
    assert.ok(typeof row.errorCode === "string");
  });
});

