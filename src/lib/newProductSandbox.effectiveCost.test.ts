import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { effectiveUnitCostFromMaterialPayload } from "./newProductSandbox";

describe("effectiveUnitCostFromMaterialPayload", () => {
  it("usa calculations.effectiveCost quando presente (espelha GET /api/materials)", () => {
    const u = effectiveUnitCostFromMaterialPayload({
      currentCost: 10,
      freight: 0,
      standardLoss: 0,
      calculations: { effectiveCost: 12.5, landedCost: 10 },
    });
    assert.equal(u, 12.5);
  });

  it("recalcula quando não há calculations (perda e frete)", () => {
    const u = effectiveUnitCostFromMaterialPayload({
      currentCost: 100,
      freight: 10,
      standardLoss: 10,
      calculations: undefined,
    });
    assert.ok(Math.abs(u - 110 / 0.9) < 1e-9);
  });
});
