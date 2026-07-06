import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  computeProductionCostPublicationDifference,
  formatProductionCostPublicationDelta,
} from "./productProductionCostPublicationStatus.js";

describe("productProductionCostPublicationStatus pure", () => {
  it("diferença zero quando custos iguais", () => {
    const diff = computeProductionCostPublicationDifference(5.478818, 5.478818);
    assert.equal(diff.amount, 0);
    assert.equal(diff.percent, 0);
  });

  it("formata queda de custo sem sinal positivo", () => {
    const formatted = formatProductionCostPublicationDelta({ amount: -1.5, percent: -25 });
    assert.match(formatted.amountLabel, /^-/);
    assert.match(formatted.percentLabel, /^-/);
  });
});
