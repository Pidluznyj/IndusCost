import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  mergeSellerOptionsByNormalizedName,
  sortAdminSellerOptions,
  toMoneyNumber,
} from "./adminSellerOptions.js";
import type { AdminSellerOption } from "./adminSellerOptionsTypes.js";

function seller(partial: Partial<AdminSellerOption> & Pick<AdminSellerOption, "displayName" | "normalizedName">): AdminSellerOption {
  return {
    externalSellerId: partial.externalSellerId ?? 10,
    responsible: partial.responsible ?? "Carlos",
    displayName: partial.displayName,
    normalizedName: partial.normalizedName,
    ordersCount: partial.ordersCount ?? 0,
    ordersValue: partial.ordersValue ?? 0,
    proposalsCount: partial.proposalsCount ?? 0,
    proposalsValue: partial.proposalsValue ?? 0,
    source: "sales_orders",
    confidence: partial.confidence ?? "HIGH",
    ...partial,
  };
}

describe("adminSellerOptions", () => {
  it("vendedor com pedido e sem proposta aparece com ordersCount > 0", () => {
    const row = seller({
      displayName: "Carlos",
      normalizedName: "CARLOS",
      ordersCount: 5,
      ordersValue: 100000,
      proposalsCount: 0,
    });
    assert.ok(row.ordersCount > 0);
    assert.equal(row.source, "sales_orders");
  });

  it("vendedor só com proposta não infla ordersValue", () => {
    const row = seller({
      displayName: "Maria",
      normalizedName: "MARIA",
      ordersCount: 0,
      ordersValue: 0,
      proposalsCount: 4,
      proposalsValue: 80000,
    });
    assert.equal(row.ordersValue, 0);
    assert.equal(row.proposalsCount, 4);
  });

  it("ordenação usa pedidos como base principal", () => {
    const sorted = sortAdminSellerOptions([
      seller({ displayName: "A", normalizedName: "A", ordersCount: 2, proposalsCount: 10 }),
      seller({ displayName: "B", normalizedName: "B", ordersCount: 8, proposalsCount: 0 }),
    ]);
    assert.equal(sorted[0]?.displayName, "B");
  });

  it("merge soma pedidos e propostas separadamente", () => {
    const merged = mergeSellerOptionsByNormalizedName([
      seller({
        displayName: "Carlos",
        normalizedName: "CARLOS",
        externalSellerId: 1,
        ordersCount: 3,
        proposalsCount: 1,
        confidence: "HIGH",
      }),
      seller({
        displayName: "Carlos",
        normalizedName: "CARLOS",
        externalSellerId: null,
        ordersCount: 2,
        proposalsCount: 2,
        confidence: "MEDIUM",
      }),
    ]);
    assert.equal(merged.length, 1);
    assert.equal(merged[0]?.ordersCount, 5);
    assert.equal(merged[0]?.proposalsCount, 3);
  });

  it("toMoneyNumber não retorna NaN", () => {
    assert.equal(toMoneyNumber("bad"), 0);
    assert.ok(Number.isFinite(toMoneyNumber(12500.5)));
  });

  it("fetchAdminSellerOptionsFromDb usa SalesOrder como fonte principal", () => {
    const src = readFileSync(join(process.cwd(), "src/lib/adminSellerOptions.ts"), "utf8");
    assert.match(src, /"SalesOrder"/);
    assert.match(src, /source: "sales_orders"/);
    assert.doesNotMatch(src, /sales_orders_and_proposals/);
    assert.match(src, /orders_by_seller/);
    assert.match(src, /proposals_by_seller/);
  });
});
