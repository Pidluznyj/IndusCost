import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { NomusBomAutoApplyProductResult } from "./nomusBomAutoApplyAfterSyncTypes";
import {
  countEligibleAutoApplyRevalidationProducts,
  DEFAULT_REVALIDATION_BATCH_SIZE,
  DEFAULT_REVALIDATION_CONCURRENCY,
} from "./nomusAutoApplyDashboardRevalidation";

function product(
  status: NomusBomAutoApplyProductResult["status"]
): NomusBomAutoApplyProductResult {
  return {
    parentCode: "100.01AA",
    productId: "p1",
    status,
    canApply: status === "READY_TO_APPLY",
    blockingReasons: status === "BLOCKED" ? ["Bloqueado"] : [],
  };
}

describe("nomusAutoApplyDashboardRevalidation", () => {
  it("usa concorrência e lote conservadores para evitar OOM", () => {
    assert.equal(DEFAULT_REVALIDATION_CONCURRENCY, 2);
    assert.ok(DEFAULT_REVALIDATION_BATCH_SIZE >= 10);
    assert.ok(DEFAULT_REVALIDATION_BATCH_SIZE <= 25);
  });

  it("countEligibleAutoApplyRevalidationProducts conta status que exigem preview read-only", () => {
    const products = [
      product("BLOCKED"),
      product("SKIPPED"),
      product("NO_CHANGES"),
      product("READY_TO_APPLY"),
      product("APPLIED"),
      product("ERROR"),
    ];
    assert.equal(countEligibleAutoApplyRevalidationProducts(products), 5);
  });

  it("countEligibleAutoApplyRevalidationProducts retorna 0 para lista vazia", () => {
    assert.equal(countEligibleAutoApplyRevalidationProducts([]), 0);
  });
});
