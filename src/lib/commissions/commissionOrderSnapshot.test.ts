import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  aggregateOrderSnapshotTotals,
  buildCommissionOrderItemSnapshotSourceHash,
  buildCommissionOrderSnapshotSourceHash,
} from "./commissionOrderSnapshot.js";

describe("commissionOrderSnapshot", () => {
  it("item hash é determinístico", () => {
    const input = {
      salesOrderId: "order-1",
      nfeId: 100,
      salesOrderItemId: "item-1",
      productId: "prod-1",
      soldAmount: 1200,
      marginPercent: 35.5,
      commissionRatePercent: 2,
      grossCommissionAmount: 24,
      finalCommissionAmount: 24,
      ruleId: "rule-1",
      status: "COMMISSIONABLE",
    };
    const a = buildCommissionOrderItemSnapshotSourceHash(input);
    const b = buildCommissionOrderItemSnapshotSourceHash(input);
    assert.equal(a, b);
    assert.equal(a.length, 64);
  });

  it("item hash muda quando valores calculados mudam", () => {
    const base = {
      salesOrderId: "order-1",
      nfeId: null,
      salesOrderItemId: "item-1",
      productId: "prod-1",
      soldAmount: 500,
      marginPercent: 20,
      commissionRatePercent: 2,
      grossCommissionAmount: 10,
      finalCommissionAmount: 10,
      ruleId: "rule-1",
      status: "COMMISSIONABLE",
    };
    const original = buildCommissionOrderItemSnapshotSourceHash(base);
    const changed = buildCommissionOrderItemSnapshotSourceHash({
      ...base,
      commissionRatePercent: 5,
      grossCommissionAmount: 25,
      finalCommissionAmount: 25,
    });
    assert.notEqual(original, changed);
  });

  it("order hash agrega itens em ordem estável", () => {
    const itemA = {
      salesOrderItemId: "a",
      productId: "p1",
      soldAmount: 100,
      marginPercent: 10,
      commissionRatePercent: 2,
      grossCommissionAmount: 2,
      finalCommissionAmount: 2,
      ruleId: "r1",
      status: "COMMISSIONABLE",
    };
    const itemB = {
      salesOrderItemId: "b",
      productId: "p2",
      soldAmount: 200,
      marginPercent: 15,
      commissionRatePercent: 3,
      grossCommissionAmount: 6,
      finalCommissionAmount: 0,
      ruleId: "r1",
      status: "CUSTOMER_EXCLUDED",
    };

    const hash1 = buildCommissionOrderSnapshotSourceHash({
      salesOrderId: "order-1",
      nfeId: 55,
      saleDate: "2026-06-15T00:00:00.000Z",
      rawSellerId: 42,
      canonicalSellerId: "seller-1",
      items: [itemA, itemB],
    });
    const hash2 = buildCommissionOrderSnapshotSourceHash({
      salesOrderId: "order-1",
      nfeId: 55,
      saleDate: "2026-06-15T00:00:00.000Z",
      rawSellerId: 42,
      canonicalSellerId: "seller-1",
      items: [itemB, itemA],
    });

    assert.equal(hash1, hash2);
  });

  it("aggregateOrderSnapshotTotals soma linhas", () => {
    const totals = aggregateOrderSnapshotTotals([
      { soldAmount: 100, grossCommissionAmount: 2, finalCommissionAmount: 2 },
      { soldAmount: 50, grossCommissionAmount: 5, finalCommissionAmount: 0 },
    ]);
    assert.equal(totals.totalSoldAmount, 150);
    assert.equal(totals.totalGrossCommissionAmount, 7);
    assert.equal(totals.totalFinalCommissionAmount, 2);
  });
});
