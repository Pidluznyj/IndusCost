import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildSalesOrderMarginCoverageHint,
  computeSalesOrderMarginCoverageFromItems,
  marginLabelLooksLikeTotal,
  mergeSalesOrderMarginCoveragePayloads,
  resolveSalesOrderMarginMoneyLabel,
} from "./salesOrderMarginCoverage.js";
import type { SalesOrderMarginItemResult } from "./salesOrderMarginTypes.js";

function item(
  overrides: Partial<SalesOrderMarginItemResult> & Pick<SalesOrderMarginItemResult, "status" | "netRevenue">
): SalesOrderMarginItemResult {
  return {
    salesOrderItemId: "i1",
    productId: "p1",
    productSku: "SKU",
    productName: "Produto",
    quantity: 1,
    netUnitRevenue: overrides.netRevenue,
    unitCost: 10,
    totalCost: 10,
    marginValue: overrides.netRevenue - 10,
    marginPercent: 50,
    markup: 2,
    statusLabel: "OK",
    statusSeverity: "success",
    costSource: "OFFICIAL_FINAL_COST",
    costConfidence: "HIGH",
    notes: [],
    ...overrides,
  };
}

describe("salesOrderMarginCoverage", () => {
  it("FULL quando toda receita tem custo", () => {
    const coverage = computeSalesOrderMarginCoverageFromItems([
      item({ status: "OK", netRevenue: 1000, marginValue: 400 }),
    ]);
    assert.equal(coverage.costCoverageStatus, "FULL");
    assert.equal(coverage.totalSalesRevenueInScope, 1000);
    assert.equal(coverage.marginRevenueCovered, 1000);
    assert.equal(coverage.marginRevenueUncovered, 0);
  });

  it("PARTIAL quando há linhas SEM_CUSTO", () => {
    const coverage = computeSalesOrderMarginCoverageFromItems([
      item({ status: "OK", netRevenue: 300, marginValue: 100 }),
      item({ status: "SEM_CUSTO", netRevenue: 700, marginValue: null, totalCost: null }),
    ]);
    assert.equal(coverage.costCoverageStatus, "PARTIAL");
    assert.equal(coverage.totalSalesRevenueInScope, 1000);
    assert.equal(coverage.marginRevenueCovered, 300);
    assert.equal(coverage.marginRevenueUncovered, 700);
    assert.equal(coverage.itemsWithoutCost, 1);
  });

  it("NONE quando nenhuma linha tem custo", () => {
    const coverage = computeSalesOrderMarginCoverageFromItems([
      item({ status: "SEM_CUSTO", netRevenue: 500, marginValue: null, totalCost: null }),
    ]);
    assert.equal(coverage.costCoverageStatus, "NONE");
    assert.equal(coverage.itemsWithCost, 0);
  });

  it("merge agrega cobertura entre pedidos", () => {
    const merged = mergeSalesOrderMarginCoveragePayloads([
      computeSalesOrderMarginCoverageFromItems([
        item({ status: "OK", netRevenue: 200, marginValue: 50 }),
      ]),
      computeSalesOrderMarginCoverageFromItems([
        item({ status: "SEM_CUSTO", netRevenue: 800, marginValue: null, totalCost: null }),
      ]),
    ]);
    assert.equal(merged.costCoverageStatus, "PARTIAL");
    assert.equal(merged.totalSalesRevenueInScope, 1000);
    assert.equal(merged.marginRevenueCovered, 200);
  });

  it("labels distinguem margem parcial de total", () => {
    assert.match(resolveSalesOrderMarginMoneyLabel({ costCoverageStatus: "PARTIAL" }), /parcial/i);
    assert.match(resolveSalesOrderMarginMoneyLabel({ costCoverageStatus: "FULL" }), /gerencial/i);
    assert.equal(marginLabelLooksLikeTotal("Margem R$ total"), true);
    assert.equal(marginLabelLooksLikeTotal("Margem parcial (R$)"), false);
  });

  it("hint explica receita coberta vs vendida", () => {
    const hint = buildSalesOrderMarginCoverageHint(
      computeSalesOrderMarginCoverageFromItems([
        item({ status: "OK", netRevenue: 269726.82, marginValue: 181307.85 }),
        item({ status: "SEM_CUSTO", netRevenue: 779130.82, marginValue: null, totalCost: null }),
      ]),
      (n) => `R$ ${n.toFixed(2)}`
    );
    assert.match(hint, /269726\.82/);
    assert.match(hint, /1048857\.64/);
    assert.match(hint, /sem custo/i);
  });
});
