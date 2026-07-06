import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Proposal } from "@/src/types/commercial";
import { proposalFinancialRollup, proposalStatusCounts } from "./proposalIndicatorsStats";

function baseProposal(partial: Partial<Proposal> & { id: string; status: Proposal["status"] }): Proposal {
  return {
    number: 1,
    customerId: "c",
    validityDays: 30,
    freightCondition: "CIF",
    totalItems: 0,
    totalGrossValue: 0,
    totalDiscount: 0,
    totalNetValue: 0,
    totalCost: 0,
    totalMarginValue: 0,
    totalMarginPerc: 0,
    totalTaxes: 0,
    totalCommission: 0,
    totalFreight: 0,
    items: [],
    createdAt: "",
    updatedAt: "",
    ...partial,
  };
}

describe("proposalIndicatorsStats", () => {
  it("agrega financeiro e status", () => {
    const rows: Proposal[] = [
      baseProposal({ id: "a", status: "DRAFT", totalNetValue: 100, totalMarginPerc: 10 }),
      baseProposal({ id: "b", status: "APPROVED", totalNetValue: 200, totalMarginPerc: 20 }),
    ];
    const c = proposalStatusCounts(rows);
    assert.equal(c.DRAFT, 1);
    assert.equal(c.APPROVED, 1);
    const f = proposalFinancialRollup(rows);
    assert.equal(f.totalNet, 300);
    assert.ok(f.avgMarginPerc > 0);
  });
});
