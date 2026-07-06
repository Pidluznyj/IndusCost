import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_PRICING_BATCH_ITEM_SCOPE,
  filterProductsForPricingBatchScope,
  filterProductsForPricingBatchSearch,
  matchesPricingBatchItemScope,
  matchesPricingBatchProductSearch,
  parsePricingBatchItemScope,
  pricingBatchItemTypeLabel,
  pruneSelectedIdsForPricingBatchScope,
  resolvePricingBatchItemType,
} from "./pricingBatchItemScope.js";
import {
  buildPricingBatchRateParams,
  computePricingBatchSuggestedPrice,
  resolvePricingBatchCostErrorMessage,
} from "./pricingBatchSimulation.js";

const sampleProducts = [
  { id: "p1", sku: "100.01", name: "Produto A", type: "PRODUCT" },
  { id: "c1", sku: "200.01", name: "Componente B", type: "COMPONENT" },
  { id: "p2", sku: "100.02", name: "Produto C", type: "PRODUCT" },
];

describe("pricingBatchItemScope", () => {
  it("padrão inicial continua produtos", () => {
    assert.equal(DEFAULT_PRICING_BATCH_ITEM_SCOPE, "products");
    assert.equal(parsePricingBatchItemScope(undefined), "products");
    assert.equal(parsePricingBatchItemScope("invalid"), "products");
  });

  it("escopo produtos lista apenas PRODUCT", () => {
    const rows = filterProductsForPricingBatchScope(sampleProducts, "products");
    assert.equal(rows.length, 2);
    assert.ok(rows.every((row) => row.type === "PRODUCT"));
  });

  it("escopo componentes lista apenas COMPONENT", () => {
    const rows = filterProductsForPricingBatchScope(sampleProducts, "components");
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.type, "COMPONENT");
  });

  it("escopo all lista ambos", () => {
    assert.equal(filterProductsForPricingBatchScope(sampleProducts, "all").length, 3);
  });

  it("troca de escopo remove seleção invisível", () => {
    const pruned = pruneSelectedIdsForPricingBatchScope(
      ["p1", "c1", "p2"],
      sampleProducts,
      "products"
    );
    assert.deepEqual(pruned, ["p1", "p2"]);
  });

  it("labels de tipo", () => {
    assert.equal(pricingBatchItemTypeLabel("PRODUCT"), "Produto");
    assert.equal(pricingBatchItemTypeLabel("COMPONENT"), "Componente");
    assert.equal(resolvePricingBatchItemType("COMPONENT"), "COMPONENT");
    assert.equal(matchesPricingBatchItemScope("COMPONENT", "components"), true);
    assert.equal(matchesPricingBatchItemScope("PRODUCT", "components"), false);
  });

  it("busca por SKU, código externo ou nome", () => {
    const rows = [
      { id: "1", sku: "100.01", name: "Produto A", sourceExternalId: "NOM-100" },
      { id: "2", sku: "200.01", name: "Componente B", sourceExternalId: null },
    ];
    assert.equal(filterProductsForPricingBatchSearch(rows, "nom-100").length, 1);
    assert.equal(filterProductsForPricingBatchSearch(rows, "200.01").length, 1);
    assert.equal(filterProductsForPricingBatchSearch(rows, "componente").length, 1);
    assert.ok(matchesPricingBatchProductSearch(rows[0]!, "100.01"));
    assert.equal(filterProductsForPricingBatchSearch(rows, "inexistente").length, 0);
  });
});

describe("pricingBatchSimulation", () => {
  it("calcula PV com fórmula oficial do lote", () => {
    const params = buildPricingBatchRateParams({
      taxPercent: 10,
      commission: 5,
      desiredMargin: 15,
      otherVariables: 0,
      freightOut: 2,
    });
    const result = computePricingBatchSuggestedPrice(100, params);
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.ok(Math.abs(result.suggestedPrice - 145.7142857143) < 0.0001);
    }
  });

  it("rejeita divisor inválido sem custo zero silencioso", () => {
    const params = buildPricingBatchRateParams({
      taxPercent: 50,
      commission: 20,
      desiredMargin: 40,
      otherVariables: 0,
      freightOut: 0,
    });
    const result = computePricingBatchSuggestedPrice(100, params);
    assert.equal(result.ok, false);
  });

  it("mensagem de custo não resolvido", () => {
    assert.match(
      resolvePricingBatchCostErrorMessage({ error: true, message: "Sem roteiro" }),
      /Sem roteiro/
    );
    assert.match(resolvePricingBatchCostErrorMessage(null), /Custo não resolvido/);
  });
});

describe("pricing batch UI wiring", () => {
  it("PricingModule envia itemScope e usa helper de escopo", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const root = join(import.meta.dirname, "..");
    const moduleSrc = readFileSync(join(root, "components/PricingModule.tsx"), "utf8");
    assert.match(moduleSrc, /batchItemScope/);
    assert.match(moduleSrc, /itemScope: batchItemScope/);
    assert.match(moduleSrc, /PRICING_BATCH_ITEM_SCOPE_OPTIONS/);
    assert.match(moduleSrc, /DEFAULT_PRICING_BATCH_ITEM_SCOPE/);
    assert.match(moduleSrc, /Filtrar por SKU, código ou nome/);
    assert.match(moduleSrc, /filterProductsForPricingBatchSearch/);
  });

  it("server usa motor server-side de lote", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const server = readFileSync(join(import.meta.dirname, "..", "..", "server.ts"), "utf8");
    assert.match(server, /simulatePricingBatch/);
    assert.match(server, /applyPricingBatchPremises/);
    assert.match(server, /itemScope/);
  });
});
