import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { calculateSalesOrderItemMargin } from "./salesOrderMarginMath.js";
import {
  assembleSalesOrderMarginItemInput,
  buildSalesOrderMarginInputsFromResolutions,
  extractSalesOrderItemRevenue,
  indexSalesOrderMarginProducts,
  registerSalesOrderMarginExternalProductMapping,
  resolveSalesOrderItemCost,
  resolveSalesOrderItemCosts,
  resolveSalesOrderItemCostFromVersionedProduction,
  resolveSalesOrderItemProduct,
  resolveSalesOrderItemProducts,
  type SalesOrderMarginResolverItem,
} from "./salesOrderMarginResolver.js";
import {
  DEFAULT_SALES_ORDER_MARGIN_COST_POLICY,
  type SalesOrderMarginCostPolicy,
} from "./salesOrderMarginTypes.js";

const LEGACY_LIVE_COST_POLICY: SalesOrderMarginCostPolicy = {
  ...DEFAULT_SALES_ORDER_MARGIN_COST_POLICY,
  allowLiveCostFallback: true,
};

const PRODUCT_A = {
  id: "prod-a",
  sku: "100.01AA",
  name: "Produto A",
  sourceExternalId: "9001",
};

const PRODUCT_B = {
  id: "prod-b",
  sku: "200.02BB",
  name: "Produto B",
};

function item(overrides: Partial<SalesOrderMarginResolverItem> = {}): SalesOrderMarginResolverItem {
  return {
    salesOrderItemId: "item-1",
    productId: null,
    externalProductId: null,
    skuSnapshot: null,
    productNameSnapshot: null,
    quantity: 10,
    negotiatedPrice: 100,
    totalNetValue: 1000,
    ...overrides,
  };
}

function buildIndex() {
  return indexSalesOrderMarginProducts([PRODUCT_A, PRODUCT_B]);
}

describe("salesOrderMarginResolver — produto", () => {
  it("1. resolve produto por productId", () => {
    const index = buildIndex();
    const result = resolveSalesOrderItemProduct(item({ productId: "prod-a" }), index);
    assert.equal(result.productId, "prod-a");
    assert.equal(result.resolutionSource, "LOCAL_PRODUCT_ID");
    assert.equal(result.confidence, "HIGH");
  });

  it("2. resolve produto por externalProductId", () => {
    const index = buildIndex();
    registerSalesOrderMarginExternalProductMapping(index, 9001, PRODUCT_A);
    const result = resolveSalesOrderItemProduct(item({ externalProductId: 9001 }), index);
    assert.equal(result.productId, "prod-a");
    assert.equal(result.resolutionSource, "EXTERNAL_PRODUCT_ID");
  });

  it("3. resolve produto por SKU", () => {
    const index = buildIndex();
    const result = resolveSalesOrderItemProduct(item({ skuSnapshot: "200.02BB" }), index);
    assert.equal(result.productId, "prod-b");
    assert.equal(result.resolutionSource, "SKU");
  });

  it("4. SKU com espaços/caixa diferente resolve", () => {
    const index = buildIndex();
    const result = resolveSalesOrderItemProduct(item({ skuSnapshot: "  100.01aa  " }), index);
    assert.equal(result.productId, "prod-a");
    assert.equal(result.resolutionSource, "SKU");
  });

  it("5. item sem produto retorna NOT_FOUND", () => {
    const index = buildIndex();
    const result = resolveSalesOrderItemProduct(item({ skuSnapshot: "INEXISTENTE" }), index);
    assert.equal(result.productId, null);
    assert.equal(result.resolutionSource, "NOT_FOUND");
    assert.equal(result.confidence, "MISSING");
  });
});

describe("salesOrderMarginResolver — custo", () => {
  it("6. produto encontrado com custo oficial retorna custo vivo estimado", () => {
    const cost = resolveSalesOrderItemCost({
      salesOrderItemId: "item-1",
      productId: "prod-a",
      analysis: { summary: { totalIndustrialCost: 42.5 } },
      costPolicy: LEGACY_LIVE_COST_POLICY,
    });
    assert.equal(cost.unitCost, 42.5);
    assert.equal(cost.costSource, "LIVE_PRODUCT_COST");
    assert.equal(cost.marginCostMode, "LIVE_ESTIMATE");
    assert.equal(cost.costConfidence, "HIGH");
  });

  it("7. produto encontrado sem custo retorna MISSING_COST", () => {
    const cost = resolveSalesOrderItemCost({
      salesOrderItemId: "item-1",
      productId: "prod-a",
      analysis: { error: "BOM_CYCLE" },
      costPolicy: LEGACY_LIVE_COST_POLICY,
    });
    assert.equal(cost.unitCost, null);
    assert.equal(cost.costSource, "MISSING_COST");
    assert.equal(cost.marginCostMode, "MISSING");
  });

  it("6b. SalesOrderItem.unitCost comercial não substitui custo de produção", () => {
    const cost = resolveSalesOrderItemCost({
      salesOrderItemId: "item-1",
      productId: "prod-a",
      storedUnitCost: 77,
      analysis: { summary: { totalIndustrialCost: 999 } },
      costPolicy: LEGACY_LIVE_COST_POLICY,
    });
    assert.equal(cost.unitCost, 999);
    assert.equal(cost.costSource, "LIVE_PRODUCT_COST");
    assert.equal(cost.marginCostMode, "LIVE_ESTIMATE");
  });

  it("6c. unitCost = 0 usa fallback vivo", () => {
    const cost = resolveSalesOrderItemCost({
      salesOrderItemId: "item-1",
      productId: "prod-a",
      storedUnitCost: 0,
      analysis: { summary: { totalIndustrialCost: 42.5 } },
      costPolicy: LEGACY_LIVE_COST_POLICY,
    });
    assert.equal(cost.unitCost, 42.5);
    assert.equal(cost.costSource, "LIVE_PRODUCT_COST");
    assert.equal(cost.marginCostMode, "LIVE_ESTIMATE");
  });

  it("6d. custo zero não gera margem OK silenciosa", () => {
    const index = buildIndex();
    const row = item({ productId: "prod-a", unitCost: 0, totalNetValue: 1000 });
    const product = resolveSalesOrderItemProduct(row, index);
    const cost = resolveSalesOrderItemCost({
      salesOrderItemId: row.salesOrderItemId,
      productId: product.productId,
    });
    const input = assembleSalesOrderMarginItemInput(row, product, cost);
    const margin = calculateSalesOrderItemMargin(input);
    assert.notEqual(margin.status, "OK");
    assert.equal(margin.status, "SEM_CUSTO");
    assert.equal(margin.marginPercent, null);
  });
});

describe("salesOrderMarginResolver — performance e montagem", () => {
  it("8. não faz N+1 para produtos repetidos no resolver de custo", async () => {
    const items = [
      item({ salesOrderItemId: "i1", productId: "prod-a" }),
      item({ salesOrderItemId: "i2", productId: "prod-a" }),
      item({ salesOrderItemId: "i3", productId: "prod-b" }),
    ];
    const index = buildIndex();
    const products = resolveSalesOrderItemProducts(items, index);
    let calls = 0;
    const costs = await resolveSalesOrderItemCosts(
      items,
      products,
      async (productId) => {
      calls += 1;
      return {
        analysis: {
          productId,
          summary: { totalIndustrialCost: productId === "prod-a" ? 10 : 20 },
        },
      };
    },
      new Map(),
      LEGACY_LIVE_COST_POLICY
    );
    assert.equal(calls, 2);
    assert.equal(costs.get("i1")?.unitCost, 10);
    assert.equal(costs.get("i1")?.costSource, "LIVE_PRODUCT_COST");
    assert.equal(costs.get("i3")?.unitCost, 20);
  });

  it("8b. linha com unitCost comercial Nomus ainda resolve custo de produção", async () => {
    const items = [
      item({ salesOrderItemId: "i1", productId: "prod-a", unitCost: 55 }),
      item({ salesOrderItemId: "i2", productId: "prod-a", unitCost: 0 }),
    ];
    const index = buildIndex();
    const products = resolveSalesOrderItemProducts(items, index);
    let calls = 0;
    const costs = await resolveSalesOrderItemCosts(
      items,
      products,
      async () => {
      calls += 1;
      return { analysis: { summary: { totalIndustrialCost: 999 } } };
    },
      new Map(),
      LEGACY_LIVE_COST_POLICY
    );
    assert.equal(calls, 1);
    assert.equal(costs.get("i1")?.unitCost, 999);
    assert.equal(costs.get("i1")?.costSource, "LIVE_PRODUCT_COST");
    assert.equal(costs.get("i2")?.unitCost, 999);
    assert.equal(costs.get("i2")?.costSource, "LIVE_PRODUCT_COST");
  });

  it("9. monta input de margem com receita líquida correta", () => {
    const index = buildIndex();
    const row = item({ productId: "prod-a", totalNetValue: 850, negotiatedPrice: 99 });
    const product = resolveSalesOrderItemProduct(row, index);
    const cost = resolveSalesOrderItemCost({
      salesOrderItemId: row.salesOrderItemId,
      productId: product.productId,
      analysis: { summary: { totalIndustrialCost: 30 } },
      costPolicy: LEGACY_LIVE_COST_POLICY,
    });
    const input = assembleSalesOrderMarginItemInput(row, product, cost);
    assert.equal(input.netTotalValue, 850);
    assert.equal(input.netUnitPrice, 85);
  });

  it("10. monta input de margem com custo unitário correto", () => {
    const index = buildIndex();
    const row = item({ productId: "prod-a" });
    const product = resolveSalesOrderItemProduct(row, index);
    const cost = resolveSalesOrderItemCost({
      salesOrderItemId: row.salesOrderItemId,
      productId: product.productId,
      analysis: { summary: { totalIndustrialCost: 55 } },
      costPolicy: LEGACY_LIVE_COST_POLICY,
    });
    const input = assembleSalesOrderMarginItemInput(row, product, cost);
    assert.equal(input.unitCost, 55);
    assert.equal(input.costSource, "LIVE_PRODUCT_COST");
    assert.equal(input.marginCostMode, "LIVE_ESTIMATE");
  });

  it("11. item sem produto vira status SEM_PRODUTO_VINCULADO", () => {
    const index = buildIndex();
    const row = item({ skuSnapshot: "ZZZ" });
    const product = resolveSalesOrderItemProduct(row, index);
    const cost = resolveSalesOrderItemCost({
      salesOrderItemId: row.salesOrderItemId,
      productId: product.productId,
    });
    const input = assembleSalesOrderMarginItemInput(row, product, cost);
    const margin = calculateSalesOrderItemMargin(input);
    assert.equal(margin.status, "SEM_PRODUTO_VINCULADO");
  });

  it("12. item sem custo vira status SEM_CUSTO", () => {
    const index = buildIndex();
    const row = item({ productId: "prod-a" });
    const product = resolveSalesOrderItemProduct(row, index);
    const cost = resolveSalesOrderItemCost({
      salesOrderItemId: row.salesOrderItemId,
      productId: product.productId,
    });
    const input = assembleSalesOrderMarginItemInput(row, product, cost);
    const margin = calculateSalesOrderItemMargin(input);
    assert.equal(margin.status, "SEM_CUSTO");
  });

  it("receita via quantity × negotiatedPrice quando totalNetValue ausente", () => {
    const revenue = extractSalesOrderItemRevenue(
      item({ totalNetValue: null, negotiatedPrice: 25, quantity: 4 })
    );
    assert.equal(revenue.netTotalValue, 100);
    assert.equal(revenue.netUnitPrice, 25);
  });

  it("pipeline completo com resoluções", () => {
    const rows = [
      item({ salesOrderItemId: "i1", productId: "prod-a" }),
      item({ salesOrderItemId: "i2", productId: "prod-b", totalNetValue: 500 }),
    ];
    const index = buildIndex();
    const products = resolveSalesOrderItemProducts(rows, index);
    const costs = new Map([
      [
        "i1",
        resolveSalesOrderItemCost({
          salesOrderItemId: "i1",
          productId: "prod-a",
          analysis: { summary: { totalIndustrialCost: 60 } },
          costPolicy: LEGACY_LIVE_COST_POLICY,
        }),
      ],
      [
        "i2",
        resolveSalesOrderItemCost({
          salesOrderItemId: "i2",
          productId: "prod-b",
          analysis: { summary: { totalIndustrialCost: 100 } },
          costPolicy: LEGACY_LIVE_COST_POLICY,
        }),
      ],
    ]);
    const inputs = buildSalesOrderMarginInputsFromResolutions(rows, products, costs);
    assert.equal(inputs.length, 2);
    assert.equal(inputs[0]?.unitCost, 60);
    assert.equal(inputs[1]?.netTotalValue, 500);
  });
});

describe("salesOrderMarginResolver — frontend safety", () => {
  it("13. build não reintroduz Prisma no resolver puro", () => {
    const src = readFileSync(
      join(process.cwd(), "src", "lib", "salesOrderMarginResolver.ts"),
      "utf8"
    );
    assert.doesNotMatch(src, /@prisma\/client/);
    assert.doesNotMatch(src, /src\/lib\/prisma/);
    assert.doesNotMatch(src, /\.server/);
  });
});
