import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { interpretFinanceBillingNfeSyncRunResponse } from "./financeBillingNfeSyncRun.js";

describe("financeBillingNfeSyncRun", () => {
  it("returns fallback on 500", () => {
    const result = interpretFinanceBillingNfeSyncRunResponse(500, { error: "fail" });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.conflict, false);
  });
});
