import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  aggregateMaterialBomImpactItems,
  buildMaterialBomImpactResponse,
  MATERIAL_BOM_IMPACT_EMPTY_MESSAGE,
  resolveOfficialMaterialEffectiveUnitCost,
} from "./materialBomImpact.js";
import type { BomUsageLine } from "./productBomUsage.js";
import { MATERIAL_COST_SOURCE_LIVE_MATERIAL } from "./materialCostEngineResolver.js";

function usage(overrides: Partial<BomUsageLine> & Pick<BomUsageLine, "parentProductId" | "parentSku">): BomUsageLine {
  return {
    bomLineId: overrides.bomLineId ?? `bom-${overrides.parentProductId}`,
    parentProductId: overrides.parentProductId,
    parentSku: overrides.parentSku,
    parentName: overrides.parentName ?? overrides.parentSku,
    parentDescription: null,
    parentType: overrides.parentType ?? "PRODUCT",
    parentStatus: "ACTIVE",
    quantity: overrides.quantity ?? 1,
    lossPercentage: overrides.lossPercentage ?? 0,
    notes: null,
    sourceSystem: null,
    isNomusControlled: false,
    localException: false,
    nomusComponentCode: null,
    lastNomusSyncAt: null,
  };
}

describe("materialBomImpact", () => {
  it("lista produtos que usam a MP sem duplicar quando há várias linhas BOM", () => {
    const items = aggregateMaterialBomImpactItems({
      usages: [
        usage({ parentProductId: "p1", parentSku: "100.01AA", parentName: "Panela", quantity: 2 }),
        usage({
          parentProductId: "p1",
          parentSku: "100.01AA",
          parentName: "Panela",
          quantity: 0.5,
          bomLineId: "bom-p1-b",
        }),
        usage({
          parentProductId: "p2",
          parentSku: "200.01AA",
          parentName: "Tampa",
          quantity: 1,
          parentType: "COMPONENT",
        }),
      ],
      materialUnit: "kg",
      effectiveUnitCost: 10,
      unitSavings: 1.5,
    });

    assert.equal(items.length, 2);
    assert.equal(items[0]?.productSku, "100.01AA");
    assert.equal(items[0]?.quantityConsumed, 2.5);
    assert.equal(items[0]?.estimatedCurrentCost, 25);
    assert.equal(items[0]?.potentialImpact, 3.75);
    assert.equal(items[0]?.componentId, null);

    assert.equal(items[1]?.productSku, "200.01AA");
    assert.equal(items[1]?.componentId, "p2");
    assert.equal(items[1]?.componentName, "Tampa");
    assert.equal(items[1]?.estimatedCurrentCost, 10);
  });

  it("retorna lista vazia quando não há vínculos BOM", () => {
    const response = buildMaterialBomImpactResponse(
      aggregateMaterialBomImpactItems({
        usages: [],
        materialUnit: "kg",
        effectiveUnitCost: 10,
      })
    );
    assert.equal(response.hasLinks, false);
    assert.equal(response.totalProducts, 0);
    assert.deepEqual(response.items, []);
    assert.match(MATERIAL_BOM_IMPACT_EMPTY_MESSAGE, /Nenhum produto vinculado/i);
  });

  it("calcula custo efetivo oficial com frete e perda (mesma fórmula do motor)", () => {
    const unit = resolveOfficialMaterialEffectiveUnitCost({
      ok: true,
      landedCost: 11,
      standardLossPct: 10,
      currentCost: 10,
      freight: 1,
      costSource: MATERIAL_COST_SOURCE_LIVE_MATERIAL,
    });
    assert.equal(unit, roundApprox(11 / 0.9));
  });

  it("agrega quantidade com perda BOM como no motor (quantity / (1 - loss))", () => {
    const items = aggregateMaterialBomImpactItems({
      usages: [
        usage({
          parentProductId: "p1",
          parentSku: "A",
          quantity: 1,
          lossPercentage: 10,
        }),
      ],
      materialUnit: "un",
      effectiveUnitCost: 9,
    });
    const qty = roundApprox(1 / 0.9);
    assert.equal(items[0]?.quantityConsumed, qty);
    assert.equal(items[0]?.estimatedCurrentCost, roundApprox(qty * 9));
    assert.equal(items[0]?.potentialImpact, null);
  });
});

function roundApprox(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}
