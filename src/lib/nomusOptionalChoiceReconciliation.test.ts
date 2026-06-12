import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  optionalItemMatchesCurrent,
  semanticOptionalItemMatchesCurrent,
  strictOptionalItemMatchesCurrent,
} from "./nomusOptionalChoiceReconciliation.js";
import type { AggregatedOptionalItem } from "./nomusOptionalPricingSelection.js";

function optionalItem(
  componentCode: string,
  lineIds: number[],
  qty = 0.001
): AggregatedOptionalItem {
  return {
    componentCode,
    componentDescription: null,
    plannedQuantity: qty,
    nomusSourceLineIds: lineIds,
    isOptional: true,
    isAlternative: false,
    isPreferred: false,
  };
}

describe("nomusOptionalChoiceReconciliation", () => {
  it("drift de externalLineId não marca stale quando código e qty iguais", () => {
    const choice = {
      componentCode: "114.02",
      plannedQuantity: 0.001,
      nomusSourceLineIds: [99],
    };
    const current = optionalItem("114.02", [200], 0.001);
    assert.equal(strictOptionalItemMatchesCurrent(choice, current), false);
    assert.equal(semanticOptionalItemMatchesCurrent(choice, current), true);
    assert.equal(optionalItemMatchesCurrent(choice, current), true);
  });

  it("mudança real de quantidade continua stale", () => {
    const choice = {
      componentCode: "114.02",
      plannedQuantity: 0.001,
      nomusSourceLineIds: [99],
    };
    const current = optionalItem("114.02", [99], 0.002);
    assert.equal(optionalItemMatchesCurrent(choice, current), false);
  });

  it("componente removido do pool continua stale", () => {
    const choice = {
      componentCode: "114.02",
      plannedQuantity: 0.001,
      nomusSourceLineIds: [99],
    };
    assert.equal(optionalItemMatchesCurrent(choice, undefined), false);
  });
});
