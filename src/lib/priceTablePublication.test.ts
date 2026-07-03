import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildPriceTableFormulaSnapshot,
  calculatePriceTableItemFromFrozenCost,
} from "./priceTablePublication.js";

describe("priceTablePublication", () => {
  it("calculatePriceTableItemFromFrozenCost aplica margem/impostos/comissão sobre custo congelado", () => {
    const result = calculatePriceTableItemFromFrozenCost(100, {
      taxRate: 0.1,
      commissionRate: 0.05,
      otherRate: 0,
      marginRate: 0.2,
      freight: 10,
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.ok(Math.abs(result.result.divisor - 0.65) < 1e-9);
    assert.ok(result.result.salePrice > 169 && result.result.salePrice < 170);
  });

  it("calculatePriceTableItemFromFrozenCost rejeita custo zero ou negativo", () => {
    const result = calculatePriceTableItemFromFrozenCost(0, {
      taxRate: 0,
      commissionRate: 0,
      otherRate: 0,
      marginRate: 0.2,
      freight: 0,
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "NO_COST_AVAILABLE");
  });

  it("buildPriceTableFormulaSnapshot referencia custo de produção versionado", () => {
    const snapshot = buildPriceTableFormulaSnapshot({
      priceTableId: "pt-1",
      priceTableVersionId: "ptv-1",
      productionCostTableVersionId: "pcv-1",
      productionCostTableVersionCode: "2026-06",
      productionCostRevision: 2,
      taxRuleId: "tax-1",
      marginPct: 25,
      rates: {
        taxRate: 0.1,
        commissionRate: 0.05,
        otherRate: 0,
        marginRate: 0.25,
        freight: 0,
      },
      divisor: 0.6,
      outputs: {
        frozenTotalCost: 100,
        frozenTaxCost: 20,
        frozenOtherCost: 10,
        salePrice: 200,
      },
    });
    assert.equal(snapshot.costSource, "VERSIONED_PRODUCTION_COST_TABLE");
    assert.equal(snapshot.productionCostTableVersionId, "pcv-1");
    assert.equal(snapshot.divisor, 0.6);
  });
});
