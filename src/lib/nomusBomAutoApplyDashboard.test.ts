import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isEligibleForBatchApply } from "./nomusBomApplyStatus";

describe("nomusBomAutoApplyDashboard — seleção apply", () => {
  it("sem alteração não pode ser selecionado para apply", () => {
    assert.equal(
      isEligibleForBatchApply({
        parentCode: "100.01",
        productId: "p",
        status: "NO_CHANGES",
        canApply: true,
        blockingReasons: [],
      }),
      false
    );
  });

  it("ignorados não podem ser selecionados", () => {
    assert.equal(
      isEligibleForBatchApply({
        parentCode: "100.02",
        productId: null,
        status: "SKIPPED",
        canApply: false,
        blockingReasons: [],
      }),
      false
    );
  });
});
