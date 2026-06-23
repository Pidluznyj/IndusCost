import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Prisma } from "@prisma/client";
import {
  isTitleRealAllocated,
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
});
