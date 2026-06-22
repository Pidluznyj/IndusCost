import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  consolidateAdminSellerMetricsRows,
  mergeSellerOptionsByNormalizedName,
  sortAdminSellerOptions,
  toMoneyNumber,
} from "./adminSellerOptions.js";
import type { AdminSellerOption } from "./adminSellerOptionsTypes.js";

function seller(partial: Partial<AdminSellerOption> & Pick<AdminSellerOption, "displayName" | "normalizedName">): AdminSellerOption {
  const externalSellerId = partial.externalSellerId ?? 10;
  const externalSellerIds =
    partial.externalSellerIds ?? (externalSellerId != null ? [externalSellerId] : []);
  const sellerIdentityKey =
    partial.sellerIdentityKey ?? partial.normalizedName.toLowerCase();
  return {
    externalSellerId,
    externalSellerIds,
    sellerIdentityKey,
    responsible: partial.responsible ?? partial.displayName,
    displayName: partial.displayName,
    normalizedName: partial.normalizedName,
    ordersCount: partial.ordersCount ?? 0,
    ordersValue: partial.ordersValue ?? 0,
    proposalsCount: partial.proposalsCount ?? 0,
    proposalsValue: partial.proposalsValue ?? 0,
    source: "sales_orders",
    confidence: partial.confidence ?? "HIGH",
    mergedFragmentCount: partial.mergedFragmentCount ?? 1,
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

  it("consolida três IDs Nomus com o mesmo nome em uma opção", () => {
    const merged = consolidateAdminSellerMetricsRows([
      {
        external_seller_id: 464,
        responsible: "GISLENE LIMA",
        orders_count: 100,
        orders_value: 10_000_000,
        proposals_count: 2,
        proposals_value: 50_000,
      },
      {
        external_seller_id: 646,
        responsible: "GISLENE LIMA",
        orders_count: 80,
        orders_value: 8_000_000,
        proposals_count: 1,
        proposals_value: 20_000,
      },
      {
        external_seller_id: 645,
        responsible: "GISLENE LIMA",
        orders_count: 20,
        orders_value: 2_000_000,
        proposals_count: 0,
        proposals_value: 0,
      },
    ]);
    assert.equal(merged.length, 1);
    assert.equal(merged[0]?.displayName, "GISLENE LIMA");
    assert.deepEqual(merged[0]?.externalSellerIds, [464, 645, 646]);
    assert.equal(merged[0]?.externalSellerId, 464);
    assert.equal(merged[0]?.ordersCount, 200);
    assert.equal(merged[0]?.mergedFragmentCount, 3);
    assert.equal(merged[0]?.sellerIdentityKey, "gislene lima");
  });

  it("fetchAdminSellerOptionsFromDb usa consolidação por nome normalizado", () => {
    const src = readFileSync(join(process.cwd(), "src/lib/adminSellerOptions.ts"), "utf8");
    assert.match(src, /consolidateAdminSellerMetricsRows/);
    assert.match(src, /consolidateSellerRowFragments/);
    assert.match(src, /"SalesOrder"/);
    assert.match(src, /source: "sales_orders"/);
    assert.doesNotMatch(src, /mergeSellerOptionsByNormalizedName\(rawSellers\)/);
  });
});
