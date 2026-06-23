import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Prisma } from "@prisma/client";
import {
  isTitleRealAllocated,
  resolveCostCenterApScopeFromStatus,
  resolveCostCenterTitleAmount,
  resolveOpenOnlyFromApStatus,
  resolveTitleAllocatedAmount,
  resolveTitleUnallocatedGap,
} from "./financeCostCenterAllocationMetrics.js";

function alloc(percentage: number, amount?: number) {
  return {
    amount: amount == null ? null : new Prisma.Decimal(amount),
    percentage: new Prisma.Decimal(percentage),
  };
}

describe("financeCostCenterAllocationMetrics", () => {
  it("título 100% alocado por valor não tem gap", () => {
    const rows = [alloc(100, 1000)];
    assert.equal(resolveTitleAllocatedAmount(rows, 1000), 1000);
    assert.equal(resolveTitleUnallocatedGap(rows, 1000), 0);
    assert.equal(isTitleRealAllocated(rows, 1000), true);
  });

  it("alocação parcial gera gap proporcional", () => {
    const rows = [alloc(60, 600)];
    assert.equal(resolveTitleUnallocatedGap(rows, 1000), 400);
    assert.equal(isTitleRealAllocated(rows, 1000), false);
  });

  it("percentual 100% com valor insuficiente ainda é gap", () => {
    const rows = [alloc(100, 500)];
    assert.equal(resolveTitleUnallocatedGap(rows, 1000), 500);
    assert.equal(isTitleRealAllocated(rows, 1000), false);
  });

  it("sem alocação = gap integral", () => {
    assert.equal(resolveTitleUnallocatedGap([], 800), 800);
  });

  it("status Todos usa escopo all_in_filter e amountPayable como base", () => {
    assert.equal(resolveCostCenterApScopeFromStatus("all"), "all_in_filter");
    assert.equal(resolveOpenOnlyFromApStatus("all"), false);
    const settled = resolveCostCenterTitleAmount(
      { balancePayable: 0, amountPayable: 5000, amountPaid: 5000 },
      "all_in_filter"
    );
    assert.equal(settled, 5000);
    const open = resolveCostCenterTitleAmount(
      { balancePayable: 600, amountPayable: 1000, amountPaid: 400 },
      "open_only"
    );
    assert.equal(open, 600);
    const gerencial = resolveCostCenterTitleAmount(
      { balancePayable: 600, amountPayable: 1000, amountPaid: 400 },
      "all_in_filter"
    );
    assert.equal(gerencial, 1000);
  });

  it("status Em aberto usa escopo open_only", () => {
    assert.equal(resolveCostCenterApScopeFromStatus("open"), "open_only");
    assert.equal(resolveOpenOnlyFromApStatus("open"), true);
  });
});
