import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  bucketBlockingReasons,
  classifyAutoApplyProduct,
} from "./nomusAutoApplyBomDashboard";
import {
  enrichDashboardProductRow,
  filterDashboardProducts,
  matchesDashboardSearch,
} from "./nomusAutoApplyBomDashboardShared";
import type { NomusBomAutoApplyProductResult } from "./nomusBomAutoApplyAfterSyncTypes";
import type { AutoApplyBomDashboardProductRow } from "./nomusAutoApplyBomDashboardTypes";

function sample308(): AutoApplyBomDashboardProductRow {
  const product: NomusBomAutoApplyProductResult = {
    parentCode: "308.05AB",
    productId: "p-308",
    status: "BLOCKED",
    canApply: false,
    blockingReasons: ["Existem itens locais (somente IndusCost) pendentes de decisão."],
    actionsPreview: [
      {
        actionType: "UPDATE_PRODUCT_BOM_QUANTITY",
        componentCode: "115.01--",
        currentQuantity: 0.0048,
        effectiveQuantity: 0.002185,
      },
      {
        actionType: "UPDATE_PRODUCT_BOM_QUANTITY",
        componentCode: "121.25--",
        currentQuantity: 0.0001,
        effectiveQuantity: 0.000046,
      },
      {
        actionType: "UPDATE_PRODUCT_BOM_NOMUS_METADATA",
        componentCode: "132.01--",
        currentQuantity: 1,
        effectiveQuantity: 1,
      },
      {
        actionType: "UPDATE_PRODUCT_BOM_NOMUS_METADATA",
        componentCode: "132.02--",
        currentQuantity: 1,
        effectiveQuantity: 1,
      },
      {
        actionType: "KEEP_PRODUCT_BOM_LINE",
        componentCode: "115.08--",
        currentQuantity: 0.001,
        effectiveQuantity: 0.001,
      },
    ],
  };
  const classified = classifyAutoApplyProduct(product);
  return enrichDashboardProductRow({
    parentCode: product.parentCode,
    productId: product.productId,
    status: product.status,
    canApply: product.canApply,
    ...classified,
    pendingTypeLabel: "",
    recommendedAction: "",
    recommendedTab: "overview",
    severity: 0,
    actionsCount: 0,
    actionsSummaryLines: [],
  });
}

describe("nomusAutoApplyBomDashboard — classificação", () => {
  it("308.05AB bloqueado com divergência e item local aparece nos filtros certos", () => {
    const product: NomusBomAutoApplyProductResult = {
      parentCode: "308.05AB",
      productId: "p-308",
      status: "BLOCKED",
      canApply: false,
      blockingReasons: ["Existem itens locais (somente IndusCost) pendentes de decisão."],
      actionsPreview: [
        {
          actionType: "UPDATE_PRODUCT_BOM_QUANTITY",
          componentCode: "115.01--",
          currentQuantity: 0.0048,
          effectiveQuantity: 0.002185,
        },
        {
          actionType: "UPDATE_PRODUCT_BOM_QUANTITY",
          componentCode: "121.25--",
          currentQuantity: 0.0001,
          effectiveQuantity: 0.000046,
        },
        {
          actionType: "UPDATE_PRODUCT_BOM_NOMUS_METADATA",
          componentCode: "132.01--",
          currentQuantity: 1,
          effectiveQuantity: 1,
        },
        {
          actionType: "KEEP_PRODUCT_BOM_LINE",
          componentCode: "115.08--",
          currentQuantity: 0.001,
          effectiveQuantity: 0.001,
        },
      ],
    };

    const row = classifyAutoApplyProduct(product);
    assert.equal(row.quantityDiffCount, 2);
    assert.equal(row.metadataOnlyCount, 1);
    assert.ok(row.filterBuckets.includes("BLOCKED"));
    assert.ok(row.filterBuckets.includes("DIVERGENT"));
    assert.ok(row.filterBuckets.includes("LOCAL_PENDING"));
    assert.ok(row.categories.includes("QUANTITY_DIVERGENT"));
  });

  it("agrega buckets de bloqueio para relatório real-like", () => {
    const products: NomusBomAutoApplyProductResult[] = [
      {
        parentCode: "A",
        productId: "1",
        status: "BLOCKED",
        canApply: false,
        blockingReasons: ["Opcionais de precificação ainda não estão resolvidos."],
      },
      {
        parentCode: "B",
        productId: "2",
        status: "BLOCKED",
        canApply: false,
        blockingReasons: ["Existem itens locais (somente IndusCost) pendentes de decisão."],
      },
      {
        parentCode: "C",
        productId: null,
        status: "SKIPPED",
        canApply: false,
        blockingReasons: ["Produto não cadastrado no IndusCost para este código pai."],
      },
    ];
    const buckets = bucketBlockingReasons(products);
    assert.ok(buckets.some((b) => b.key === "OPTIONAL_PENDING" && b.count >= 1));
    assert.ok(buckets.some((b) => b.key === "LOCAL_ITEM_PENDING" && b.count >= 1));
    assert.ok(buckets.some((b) => b.key === "NOT_IN_INDUS" && b.count >= 1));
  });
});

describe("nomusAutoApplyBomDashboardShared — busca e filtro", () => {
  it("filtro BLOCKED + busca 308.05 encontra 308.05AB", () => {
    const row = sample308();
    const others: AutoApplyBomDashboardProductRow[] = [
      enrichDashboardProductRow({
        parentCode: "100.01AA",
        productId: "x",
        status: "NO_CHANGES",
        canApply: true,
        primaryReason: "Alinhado",
        blockingReasons: [],
        categories: [],
        filterBuckets: ["NO_CHANGES"],
        quantityDiffCount: 0,
        metadataOnlyCount: 0,
        localOnlyLineCodes: [],
        actionsPreview: [],
        pendingTypeLabel: "",
        recommendedAction: "",
        recommendedTab: "overview",
        severity: 0,
        actionsCount: 0,
        actionsSummaryLines: [],
      }),
    ];
    const all = [row, ...others];

    assert.ok(matchesDashboardSearch(row, "308.05"));
    assert.ok(matchesDashboardSearch(row, "115.01--"));
    assert.ok(matchesDashboardSearch(row, "UPDATE_PRODUCT_BOM_QUANTITY"));
    assert.ok(matchesDashboardSearch(row, "itens locais"));

    const filtered = filterDashboardProducts(all, { filter: "BLOCKED", search: "308.05" });
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0].parentCode, "308.05AB");
    assert.equal(filtered[0].pendingTypeLabel, "Item local pendente");
    assert.equal(filtered[0].recommendedTab, "effective-pricing-bom");
    assert.equal(filtered[0].actionsCount, 5);
  });
});
