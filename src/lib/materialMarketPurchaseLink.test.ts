import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildMaterialMarketPurchaseLinkListResponse,
  buildMaterialMarketPurchaseTimeline,
  computeMaterialMarketPurchaseEstimatedSavings,
  computeMaterialMarketPurchaseSavingsFromContext,
  MATERIAL_MARKET_PURCHASE_SAVINGS_FORMULA,
  parseMaterialMarketPurchaseLinkInput,
  serializeMaterialMarketPurchaseLinkForApi,
} from "./materialMarketPurchaseLink.js";
import fs from "node:fs";
import path from "node:path";

describe("materialMarketPurchaseLink", () => {
  it("documenta fórmula de economia obtida", () => {
    assert.match(MATERIAL_MARKET_PURCHASE_SAVINGS_FORMULA, /referenceUnitPriceBrl/);
    assert.match(MATERIAL_MARKET_PURCHASE_SAVINGS_FORMULA, /negotiatedPrice/);
    assert.match(MATERIAL_MARKET_PURCHASE_SAVINGS_FORMULA, /quantityPurchased/);
  });

  it("calcula economia: (referência - negociado) × quantidade", () => {
    const result = computeMaterialMarketPurchaseEstimatedSavings({
      referenceUnitPriceBrl: 10,
      negotiatedPrice: 8,
      quantityPurchased: 5,
    });
    assert.equal(result.unitSavings, 2);
    assert.equal(result.estimatedSavings, 10);
    assert.equal(result.hasSavings, true);
  });

  it("preserva economia negativa e marca hasSavings=false", () => {
    const result = computeMaterialMarketPurchaseEstimatedSavings({
      referenceUnitPriceBrl: 8,
      negotiatedPrice: 10,
      quantityPurchased: 2,
    });
    assert.equal(result.estimatedSavings, -4);
    assert.equal(result.hasSavings, false);
  });

  it("parse cria payload manual sem exigir PurchaseOrder formal", () => {
    const parsed = parseMaterialMarketPurchaseLinkInput({
      quoteId: "11111111-1111-4111-8111-111111111111",
      supplierName: "Fornecedor X",
      quantityPurchased: 3,
      negotiatedPrice: 9.5,
      purchaseDate: "2026-07-01",
      purchaseOrderNumber: "PC-123",
      choiceReason: "Melhor prazo",
    });
    assert.equal(parsed.ok, true);
    if (parsed.ok) {
      assert.equal(parsed.value.purchaseOrderId, null);
      assert.equal(parsed.value.purchaseOrderNumber, "PC-123");
      assert.equal(parsed.value.supplierName, "Fornecedor X");
    }
  });

  it("parse rejeita purchaseOrderId inválido sem FK", () => {
    const parsed = parseMaterialMarketPurchaseLinkInput({
      quoteId: "11111111-1111-4111-8111-111111111111",
      supplierName: "Fornecedor X",
      quantityPurchased: 1,
      negotiatedPrice: 1,
      purchaseDate: "2026-07-01",
      purchaseOrderId: "nao-e-uuid",
    });
    assert.equal(parsed.ok, false);
    if (!parsed.ok) assert.equal(parsed.field, "purchaseOrderId");
  });

  it("usa netPriceBrl da cotação como referência", () => {
    const savings = computeMaterialMarketPurchaseSavingsFromContext({
      quote: {
        id: "q1",
        materialId: "m1",
        currency: "USD",
        netPrice: 2,
        netPriceBrl: 12,
      },
      negotiatedPrice: 10,
      quantityPurchased: 4,
      currentCost: 20,
    });
    assert.equal(savings.ok, true);
    if (savings.ok) {
      assert.equal(savings.value.referenceSource, "quoteNetPriceBrl");
      assert.equal(savings.value.referenceUnitPriceBrl, 12);
      assert.equal(savings.value.estimatedSavings, 8);
    }
  });

  it("timeline inclui evento de compra e soma economia positiva", () => {
    const list = buildMaterialMarketPurchaseLinkListResponse([
      {
        id: "l1",
        materialId: "m1",
        quoteId: "q1",
        supplierName: "A",
        quantityPurchased: 2,
        negotiatedPrice: 8,
        purchaseDate: "2026-07-02",
        estimatedSavings: 4,
        referenceUnitPriceBrl: 10,
        createdAt: "2026-07-02T12:00:00.000Z",
      },
      {
        id: "l2",
        materialId: "m1",
        quoteId: "q2",
        supplierName: "B",
        quantityPurchased: 1,
        negotiatedPrice: 12,
        purchaseDate: "2026-07-01",
        estimatedSavings: -2,
        referenceUnitPriceBrl: 10,
        createdAt: "2026-07-01T12:00:00.000Z",
      },
    ]);
    const timeline = buildMaterialMarketPurchaseTimeline(list.items);
    assert.equal(timeline.items.length, 2);
    assert.equal(timeline.items[0].type, "PURCHASE_LINKED");
    assert.equal(timeline.items[0].title, "Compra vinculada");
    assert.equal(timeline.totalEstimatedSavings, 4);
  });

  it("schema não tem FK formal a PurchaseOrder", () => {
    const schema = fs.readFileSync(path.join(process.cwd(), "prisma/schema.prisma"), "utf8");
    assert.match(schema, /model MaterialMarketPurchaseLink/);
    assert.match(schema, /purchaseOrderId\s+String\?\s+@db\.Uuid/);
    assert.doesNotMatch(
      schema,
      /purchaseOrderId.*references: \[id\].*PurchaseOrder/s
    );
    assert.doesNotMatch(schema, /model PurchaseOrder\b/);
  });

  it("serializa registro API com economia", () => {
    const item = serializeMaterialMarketPurchaseLinkForApi({
      id: "l1",
      materialId: "m1",
      quoteId: "q1",
      supplierName: "A",
      quantityPurchased: "2",
      negotiatedPrice: "8",
      purchaseDate: new Date("2026-07-02T00:00:00.000Z"),
      estimatedSavings: "4",
      referenceUnitPriceBrl: "10",
      createdAt: new Date("2026-07-02T12:00:00.000Z"),
    });
    assert.equal(item.estimatedSavings, 4);
    assert.equal(item.hasSavings, true);
    assert.equal(item.purchaseDate, "2026-07-02");
  });
});
