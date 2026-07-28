import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  calculateSalesOrderItemCommercialMargin,
  unavailableCommercialMarginItem,
} from "./salesOrderCommercialMargin.js";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("salesOrderCommercialMargin — política sem Proposta", () => {
  it("adapter server não consulta Proposal/ProposalItem", () => {
    const src = readFileSync(
      join(process.cwd(), "src/lib/salesOrderCommercialMargin.server.ts"),
      "utf8"
    );
    assert.doesNotMatch(src, /proposalItem/i);
    assert.doesNotMatch(src, /prisma\.proposal\b/);
    assert.doesNotMatch(src, /pricingSnapshotJson/);
    assert.doesNotMatch(src, /EXACT_PROPOSAL/);
    assert.match(src, /loadHistoricalCommercialFormationsBatch/);
    assert.match(src, /findMany/);
  });

  it("select de margem não pede canceledQuantity em SalesOrderItem", () => {
    const src = readFileSync(
      join(process.cwd(), "src/lib/salesOrderMarginService.server.ts"),
      "utf8"
    );
    assert.match(src, /flowItemSnapshot:\s*\{/);
    assert.match(src, /canceledQuantity:\s*true/);
    // O campo direto no item quebra o Prisma (campo só existe no flow snapshot).
    assert.doesNotMatch(
      src,
      /quantity:\s*true,\s*\n\s*canceledQuantity:\s*true/
    );
  });

  it("formação histórica completa marca HISTORICAL_PRICE_FORMATION", () => {
    const item = calculateSalesOrderItemCommercialMargin({
      soldQuantity: 1,
      negotiatedUnitPrice: 250,
      frozenTotalCost: 100,
      rates: {
        taxRate: 0.2875,
        commissionRate: 0.05,
        otherRate: 0.02,
        freightRate: 0.03,
        freight: 0,
      },
      historicalContextId: "a|b|c|d",
      referenceDate: "2024-06-01",
    });
    assert.equal(item.calculationSource, "HISTORICAL_PRICE_FORMATION");
    assert.equal(item.historicalContextId, "a|b|c|d");
    assert.equal(item.isComplete, true);
  });

  it("falha cadastral → UNAVAILABLE com reasonCode", () => {
    const item = unavailableCommercialMarginItem({
      soldQuantity: 2,
      negotiatedUnitPrice: 100,
      soldValue: 200,
      reasonCode: "HISTORICAL_FORMATION_NOT_FOUND",
    });
    assert.equal(item.calculationSource, "UNAVAILABLE");
    assert.equal(item.reasonCode, "HISTORICAL_FORMATION_NOT_FOUND");
    assert.equal(item.isComplete, false);
    assert.equal(item.costUnit, null);
  });
});
