import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { civilDateToLocalDate } from "./financeCivilDate.js";
import {
  buildProductionCostItemsByProductId,
  buildPriceTableCostSnapshotJson,
  mapProductionCostTableItemToPriceSnapshot,
  PRICE_TABLE_PRODUCTION_COST_SOURCE,
} from "./priceTableProductionCostResolver.js";

describe("priceTableProductionCostResolver", () => {
  it("mapProductionCostTableItemToPriceSnapshot converte decimais", () => {
    const snap = mapProductionCostTableItemToPriceSnapshot({
      id: "item-1",
      productId: "prod-a",
      productCodeSnapshot: "PA",
      productNameSnapshot: "Produto A",
      unitProductionCost: "150.5",
      materialCost: 50,
      processCost: 0,
      laborCost: 60,
      machineCost: 30,
      overheadCost: 10,
      otherCost: 0.5,
      calculationHash: "hash-1",
      calculationSnapshot: { frozen: true },
    });
    assert.equal(snap.unitProductionCost, 150.5);
    assert.equal(snap.materialCost, 50);
  });

  it("buildProductionCostItemsByProductId deduplica por productId (último vence)", () => {
    const map = buildProductionCostItemsByProductId([
      {
        id: "i1",
        productId: "prod-a",
        productCodeSnapshot: "PA",
        productNameSnapshot: "A",
        unitProductionCost: 10,
        materialCost: 1,
        processCost: 0,
        laborCost: 0,
        machineCost: 0,
        overheadCost: 0,
        otherCost: 0,
        calculationHash: null,
        calculationSnapshot: null,
      },
      {
        id: "i2",
        productId: "prod-a",
        productCodeSnapshot: "PA",
        productNameSnapshot: "A",
        unitProductionCost: 20,
        materialCost: 2,
        processCost: 0,
        laborCost: 0,
        machineCost: 0,
        overheadCost: 0,
        otherCost: 0,
        calculationHash: null,
        calculationSnapshot: null,
      },
    ]);
    assert.equal(map.size, 1);
    assert.equal(map.get("prod-a")?.unitProductionCost, 20);
  });

  it("buildPriceTableCostSnapshotJson marca fonte versionada", () => {
    const item = mapProductionCostTableItemToPriceSnapshot({
      id: "item-1",
      productId: "prod-a",
      productCodeSnapshot: "PA",
      productNameSnapshot: "Produto A",
      unitProductionCost: 100,
      materialCost: 40,
      processCost: 0,
      laborCost: 30,
      machineCost: 20,
      overheadCost: 10,
      otherCost: 0,
      calculationHash: "h1",
      calculationSnapshot: { x: 1 },
    });
    const json = buildPriceTableCostSnapshotJson({
      productionCostTableVersionId: "pcv-1",
      productionCostTableVersionCode: "2026-06",
      revision: 1,
      effectiveDate: "2026-06-01",
      item,
    });
    assert.equal(json.costSource, PRICE_TABLE_PRODUCTION_COST_SOURCE);
    assert.equal(json.unitProductionCost, 100);
    assert.equal(json.productionCostTableItemId, "item-1");
  });
});
