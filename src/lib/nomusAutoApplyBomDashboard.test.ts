import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  bucketBlockingReasons,
  classifyAutoApplyProduct,
} from "./nomusAutoApplyBomDashboard";
import type { NomusBomAutoApplyProductResult } from "./nomusBomAutoApplyAfterSyncTypes";

describe("nomusAutoApplyBomDashboard — classificação", () => {
  it("308.05AB bloqueado com divergência e item local aparece nos filtros certos", () => {
    const product: NomusBomAutoApplyProductResult = {
      parentCode: "308.05AB",
      productId: "p-308",
      status: "BLOCKED",
      canApply: false,
      blockingReasons: [
        "Existem itens locais (somente IndusCost) pendentes de decisão.",
      ],
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
