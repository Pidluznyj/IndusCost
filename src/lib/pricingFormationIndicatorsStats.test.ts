import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { pricingFormationRollup } from "./pricingFormationIndicatorsStats";

describe("pricingFormationIndicatorsStats", () => {
  it("conta premissas e cardinalidades distintas", () => {
    const r = pricingFormationRollup([
      { id: "1", productId: "p1", taxRuleId: "t1" },
      { id: "2", productId: "p1", taxRuleId: "t2" },
      { id: "3", productId: "p2", taxRuleId: "t2" },
    ]);
    assert.equal(r.premissas, 3);
    assert.equal(r.produtosDistintos, 2);
    assert.equal(r.regrasFiscaisDistintas, 2);
  });
});
