import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Prisma } from "@prisma/client";
import { describe, it } from "node:test";
import {
  aggregateInventoryPhysicalBalances,
  computeInventoryManagerialValuation,
  INVENTORY_INDUSTRIAL_COST_UNAVAILABLE,
  INVENTORY_RETAIL_VALUATION_UNAVAILABLE,
  indexUnitAmountByProductId,
  type InventoryValuationLine,
} from "./inventoryManagerialValuation.js";
import {
  loadInventoryMaterialFrozenCosts,
  loadInventoryValuationUnitPrices,
} from "./inventoryManagerialValuation.server.js";

const D = (value: string | number) => new Prisma.Decimal(value);

function line(
  partial: Partial<InventoryValuationLine> & Pick<InventoryValuationLine, "itemId">
): InventoryValuationLine {
  return {
    itemType: "FINISHED_PRODUCT",
    productId: "product-1",
    materialId: null,
    physicalQuantity: D(100),
    ...partial,
  };
}

function prices(entries: Array<[string, string | number | null]>): Map<string, Prisma.Decimal | null> {
  return new Map(
    entries.map(([id, amount]) => [id, amount == null ? null : D(amount)])
  );
}

describe("inventory managerial valuation", () => {
  it("1. saldo 100 e Varejo 1 a 10 vale 1000", () => {
    const result = computeInventoryManagerialValuation({
      lines: [line({ itemId: "i1", physicalQuantity: D(100) })],
      retailPriceByProductId: prices([["product-1", 10]]),
      industrialCostByProductId: prices([["product-1", 6]]),
    });
    assert.equal(result.salesPotential.value, 1000);
    assert.equal(result.salesPotential.coveredItems, 1);
    assert.equal(result.salesPotential.uncoveredItems, 0);
  });

  it("2. saldo 100 e custo industrial 6 vale 600", () => {
    const result = computeInventoryManagerialValuation({
      lines: [line({ itemId: "i1", physicalQuantity: D(100) })],
      retailPriceByProductId: prices([["product-1", 10]]),
      industrialCostByProductId: prices([["product-1", 6]]),
    });
    assert.equal(result.industrialCost.value, 600);
    assert.equal(result.industrialCost.coveredItems, 1);
  });

  it("3. dois produtos somam venda e custo", () => {
    const result = computeInventoryManagerialValuation({
      lines: [
        line({ itemId: "i1", productId: "p1", physicalQuantity: D(2) }),
        line({ itemId: "i2", productId: "p2", physicalQuantity: D(3) }),
      ],
      retailPriceByProductId: prices([
        ["p1", 10],
        ["p2", 4],
      ]),
      industrialCostByProductId: prices([
        ["p1", 6],
        ["p2", 1],
      ]),
    });
    assert.equal(result.salesPotential.value, 32);
    assert.equal(result.industrialCost.value, 15);
    assert.equal(result.populationItemCount, 2);
  });

  it("4. saldo zero não entra na cobertura", () => {
    const result = computeInventoryManagerialValuation({
      lines: [
        line({ itemId: "i1", physicalQuantity: D(0) }),
        line({ itemId: "i2", productId: "p2", physicalQuantity: D(5) }),
      ],
      retailPriceByProductId: prices([
        ["product-1", 10],
        ["p2", 2],
      ]),
      industrialCostByProductId: prices([
        ["product-1", 1],
        ["p2", 1],
      ]),
    });
    assert.equal(result.populationItemCount, 1);
    assert.equal(result.salesPotential.coveredItems, 1);
    assert.equal(result.salesPotential.value, 10);
  });

  it("5. preço ausente não soma e conta descoberta", () => {
    const result = computeInventoryManagerialValuation({
      lines: [line({ itemId: "i1" })],
      retailPriceByProductId: prices([]),
      industrialCostByProductId: prices([["product-1", 6]]),
    });
    assert.equal(result.salesPotential.value, 0);
    assert.equal(result.salesPotential.coveredItems, 0);
    assert.equal(result.salesPotential.uncoveredItems, 1);
    assert.equal(result.salesPotential.available, true);
  });

  it("6. custo ausente não soma e conta descoberta", () => {
    const result = computeInventoryManagerialValuation({
      lines: [line({ itemId: "i1" })],
      retailPriceByProductId: prices([["product-1", 10]]),
      industrialCostByProductId: prices([]),
    });
    assert.equal(result.industrialCost.value, 0);
    assert.equal(result.industrialCost.uncoveredItems, 1);
    assert.equal(result.salesPotential.value, 1000);
  });

  it("7. preço zero publicado cobre o item e soma zero", () => {
    const result = computeInventoryManagerialValuation({
      lines: [line({ itemId: "i1", physicalQuantity: D(4) })],
      retailPriceByProductId: prices([["product-1", 0]]),
      industrialCostByProductId: prices([["product-1", 2]]),
    });
    assert.equal(result.salesPotential.coveredItems, 1);
    assert.equal(result.salesPotential.uncoveredItems, 0);
    assert.equal(result.salesPotential.value, 0);
  });

  it("8. custo zero oficial cobre o item e soma zero", () => {
    const result = computeInventoryManagerialValuation({
      lines: [line({ itemId: "i1", physicalQuantity: D(4) })],
      retailPriceByProductId: prices([["product-1", 8]]),
      industrialCostByProductId: prices([["product-1", 0]]),
    });
    assert.equal(result.industrialCost.coveredItems, 1);
    assert.equal(result.industrialCost.value, 0);
  });

  it("9. item sem productId não usa descrição", () => {
    const src = readFileSync(new URL("./inventoryManagerialValuation.ts", import.meta.url), "utf8");
    assert.doesNotMatch(src, /description/);
    const result = computeInventoryManagerialValuation({
      lines: [line({ itemId: "i1", productId: null })],
      retailPriceByProductId: prices([["product-1", 10]]),
      industrialCostByProductId: prices([["product-1", 6]]),
    });
    assert.equal(result.salesPotential.value, 0);
    assert.equal(result.salesPotential.uncoveredItems, 1);
    assert.equal(result.industrialCost.uncoveredItems, 1);
  });

  it("PA e componentes somam o valor de venda; MP fica de fora", () => {
    const result = computeInventoryManagerialValuation({
      lines: [
        line({ itemId: "pa", itemType: "FINISHED_PRODUCT", productId: "pa-1", physicalQuantity: D(100) }),
        line({ itemId: "comp", itemType: "COMPONENT", productId: "c-1", physicalQuantity: D(50) }),
        line({ itemId: "mp", itemType: "RAW_MATERIAL", productId: "m-1", physicalQuantity: D(1000) }),
      ],
      retailPriceByProductId: prices([
        ["pa-1", 10],
        ["c-1", 4],
        ["m-1", 99],
      ]),
      industrialCostByProductId: prices([
        ["pa-1", 6],
        ["c-1", 2],
        ["m-1", 1],
      ]),
    });
    assert.equal(result.byItemType.finishedProduct.salesPotential.value, 1000);
    assert.equal(result.byItemType.component.salesPotential.value, 200);
    assert.equal(result.byItemType.rawMaterial.includedInRetailValuation, false);
    assert.equal(result.byItemType.rawMaterial.positiveItemCount, 1);
    assert.equal(result.byItemType.rawMaterial.salesPotential.value, 0);
    assert.equal(
      (result.byItemType.finishedProduct.salesPotential.value ?? 0) +
        (result.byItemType.component.salesPotential.value ?? 0),
      result.salesPotential.value
    );
    assert.equal(result.salesPotential.value, 1200);
  });

  it("10. matéria-prima não recebe Varejo 1", () => {
    const result = computeInventoryManagerialValuation({
      lines: [
        line({
          itemId: "mp",
          itemType: "RAW_MATERIAL",
          productId: "product-1",
          physicalQuantity: D(50),
        }),
      ],
      retailPriceByProductId: prices([["product-1", 10]]),
      industrialCostByProductId: prices([["product-1", 6]]),
    });
    assert.equal(result.salesPotential.value, 0);
    assert.equal(result.salesPotential.coveredItems, 0);
    assert.equal(result.salesPotential.uncoveredItems, 0);
    assert.equal(result.industrialCost.value, 0);
    assert.equal(result.populationItemCount, 0);
    assert.equal(result.excludedPositiveItems, 1);
  });

  it("11. componente com produto e preço entra na valorização", () => {
    const result = computeInventoryManagerialValuation({
      lines: [
        line({
          itemId: "c1",
          itemType: "COMPONENT",
          productId: "comp-product",
          physicalQuantity: D(7),
        }),
      ],
      retailPriceByProductId: prices([["comp-product", 3]]),
      industrialCostByProductId: prices([["comp-product", 2]]),
    });
    assert.equal(result.salesPotential.value, 21);
    assert.equal(result.industrialCost.value, 14);
    assert.equal(result.salesPotential.coveredItems, 1);
  });

  it("13. Decimal não acumula erro de ponto flutuante", () => {
    const result = computeInventoryManagerialValuation({
      lines: [
        line({ itemId: "a", productId: "p", physicalQuantity: D("0.1") }),
        line({ itemId: "b", productId: "p", physicalQuantity: D("0.1") }),
        line({ itemId: "c", productId: "p", physicalQuantity: D("0.1") }),
      ],
      retailPriceByProductId: prices([["p", "0.1"]]),
      industrialCostByProductId: prices([["p", "0.2"]]),
    });
    assert.equal(result.salesPotential.value, 0.03);
    assert.equal(result.industrialCost.value, 0.06);
    assert.notEqual(0.1 * 0.1 + 0.1 * 0.1 + 0.1 * 0.1, 0.03);
  });

  it("14. Varejo 1 inexistente não vira zero e não escolhe outra tabela", () => {
    const result = computeInventoryManagerialValuation({
      lines: [line({ itemId: "i1" })],
      retailPriceByProductId: null,
      industrialCostByProductId: prices([["product-1", 6]]),
    });
    assert.equal(result.salesPotential.available, false);
    assert.equal(result.salesPotential.value, null);
    assert.equal(result.salesPotential.unavailableReason, INVENTORY_RETAIL_VALUATION_UNAVAILABLE);
    assert.equal(result.salesPotential.uncoveredItems, 1);
    assert.equal(result.industrialCost.value, 600);
  });

  it("15. custo oficial inexistente deixa a cobertura explícita", () => {
    const result = computeInventoryManagerialValuation({
      lines: [line({ itemId: "i1" }), line({ itemId: "i2", productId: "p2" })],
      retailPriceByProductId: prices([
        ["product-1", 10],
        ["p2", 1],
      ]),
      industrialCostByProductId: null,
    });
    assert.equal(result.industrialCost.available, false);
    assert.equal(result.industrialCost.value, null);
    assert.equal(result.industrialCost.unavailableReason, INVENTORY_INDUSTRIAL_COST_UNAVAILABLE);
    assert.equal(result.industrialCost.coveredItems, 0);
    assert.equal(result.industrialCost.uncoveredItems, 2);
    assert.equal(result.industrialCost.coveragePercent, 0);
  });

  it("saldo negativo da população fica fora da soma e não se esconde", () => {
    const result = computeInventoryManagerialValuation({
      lines: [line({ itemId: "i1", physicalQuantity: D(-4) })],
      retailPriceByProductId: prices([["product-1", 10]]),
      industrialCostByProductId: prices([["product-1", 6]]),
    });
    assert.equal(result.salesPotential.value, 0);
    assert.equal(result.salesPotential.negativePhysicalItems, 1);
    assert.equal(result.populationItemCount, 0);
  });

  it("vários almoxarifados do mesmo item somam o saldo físico", () => {
    const lines = aggregateInventoryPhysicalBalances([
      { itemId: "i1", itemType: "FINISHED_PRODUCT", productId: "p", physicalQuantity: "40" },
      { itemId: "i1", itemType: "FINISHED_PRODUCT", productId: "p", physicalQuantity: "60" },
    ]);
    const result = computeInventoryManagerialValuation({
      lines,
      retailPriceByProductId: prices([["p", 2]]),
      industrialCostByProductId: prices([["p", 1]]),
    });
    assert.equal(result.salesPotential.value, 200);
    assert.equal(result.salesPotential.coveredItems, 1);
  });

  it("preço duplicado do mesmo produto não escolhe uma linha", () => {
    const indexed = indexUnitAmountByProductId([
      { productId: "p", amount: 10 },
      { productId: "p", amount: 99 },
    ]);
    const result = computeInventoryManagerialValuation({
      lines: [line({ itemId: "i1", productId: "p", physicalQuantity: D(2) })],
      retailPriceByProductId: indexed,
      industrialCostByProductId: prices([["p", 1]]),
    });
    assert.equal(result.salesPotential.uncoveredItems, 1);
    assert.equal(result.salesPotential.value, 0);
  });

  it("card de PA usa venda e, sem preço, o custo industrial", () => {
    const result = computeInventoryManagerialValuation({
      lines: [
        line({ itemId: "com-preco", productId: "p1", physicalQuantity: D(10) }),
        line({ itemId: "sem-preco", productId: "p2", physicalQuantity: D(4) }),
        line({ itemId: "sem-nada", productId: "p3", physicalQuantity: D(8) }),
      ],
      retailPriceByProductId: prices([["p1", 10]]),
      industrialCostByProductId: prices([
        ["p1", 99],
        ["p2", 5],
      ]),
    });
    const card = result.byItemType.finishedProduct;
    assert.equal(card.cardBasis, "MIXED");
    assert.equal(card.saleItemCount, 1);
    assert.equal(card.costItemCount, 1);
    assert.equal(card.uncoveredItemCount, 1);
    assert.equal(card.cardValue, 120);
    assert.equal(card.salesPotential.value, 100);
    assert.equal(card.manufacturingCost?.value, 1010);
    assert.equal(card.manufacturingCost?.coveredItems, 2);
    assert.equal(card.manufacturingCost?.uncoveredItems, 1);
  });

  it("preço zero publicado não cai para o custo", () => {
    const result = computeInventoryManagerialValuation({
      lines: [line({ itemId: "i1", productId: "p", physicalQuantity: D(3) })],
      retailPriceByProductId: prices([["p", 0]]),
      industrialCostByProductId: prices([["p", 50]]),
    });
    const card = result.byItemType.finishedProduct;
    assert.equal(card.cardBasis, "SALE");
    assert.equal(card.cardValue, 0);
    assert.equal(card.costItemCount, 0);
  });

  it("MP usa saldo físico × custo atual de suprimentos", () => {
    const result = computeInventoryManagerialValuation({
      lines: [
        line({
          itemId: "mp1",
          itemType: "RAW_MATERIAL",
          productId: "nao-usar",
          materialId: "mat-1",
          physicalQuantity: D(100),
        }),
        line({
          itemId: "mp2",
          itemType: "RAW_MATERIAL",
          productId: null,
          materialId: null,
          physicalQuantity: D(40),
        }),
      ],
      retailPriceByProductId: prices([["nao-usar", 999]]),
      industrialCostByProductId: prices([["nao-usar", 999]]),
      supplyCostByMaterialId: prices([["mat-1", "1.5"]]),
    });
    const card = result.byItemType.rawMaterial;
    assert.equal(card.cardBasis, "SUPPLY_COST");
    assert.equal(card.cardValue, 150);
    assert.equal(card.costItemCount, 1);
    assert.equal(card.uncoveredItemCount, 1);
    assert.equal(card.saleItemCount, 0);
    assert.equal(result.salesPotential.value, 0);
    assert.equal(card.manufacturingCost, null);
  });

  it("PA e componente separam valor de venda e custo de fabricação", () => {
    const result = computeInventoryManagerialValuation({
      lines: [
        line({ itemId: "pa", itemType: "FINISHED_PRODUCT", productId: "pa", physicalQuantity: D(10) }),
        line({ itemId: "comp", itemType: "COMPONENT", productId: "comp", physicalQuantity: D(2) }),
      ],
      retailPriceByProductId: prices([
        ["pa", 8],
        ["comp", 5],
      ]),
      industrialCostByProductId: prices([
        ["pa", 3],
        ["comp", 1.5],
      ]),
    });
    assert.equal(result.byItemType.finishedProduct.salesPotential.value, 80);
    assert.equal(result.byItemType.finishedProduct.manufacturingCost?.value, 30);
    assert.equal(result.byItemType.component.salesPotential.value, 10);
    assert.equal(result.byItemType.component.manufacturingCost?.value, 3);
    assert.equal(result.salesPotential.value, 90);
    assert.equal(result.industrialCost.value, 33);
    assert.equal(result.byItemType.rawMaterial.manufacturingCost, null);
  });
});

describe("loadInventoryValuationUnitPrices", () => {
  it("12. preço e custo fabril saem da mesma linha do Varejo 1", async () => {
    const calls = { priceItems: 0, retailVersion: 0 };
    const productIds = ["p1", "p2", "p3"];
    const db = {
      priceTable: {
        findUnique: async () => ({ id: "table-varejo", status: "ACTIVE" }),
      },
      priceTableVersion: {
        findFirst: async () => {
          calls.retailVersion += 1;
          return { id: "version-1" };
        },
      },
      priceTableItem: {
        findMany: async (args: { where: { productId: { in: string[] } } }) => {
          calls.priceItems += 1;
          assert.deepEqual(args.where.productId.in, productIds);
          return productIds.map((productId) => ({
            productId,
            salePrice: new Prisma.Decimal(10),
            frozenTotalCost: new Prisma.Decimal(4),
          }));
        },
      },
    };

    const loaded = await loadInventoryValuationUnitPrices(
      db as never,
      productIds,
      new Date("2026-09-25T12:00:00.000Z")
    );

    assert.equal(calls.priceItems, 1);
    assert.equal(calls.retailVersion, 1);
    assert.equal(loaded.retailPriceByProductId?.get("p2")?.toString(), "10");
    assert.equal(loaded.industrialCostByProductId?.get("p3")?.toString(), "4");
    assert.equal(loaded.industrialUnavailableReason, null);
  });

  it("MP usa o custo posto congelado da tabela oficial", async () => {
    const calls = { versions: 0, items: 0 };
    const db = {
      materialCostTableVersion: {
        findFirst: async () => {
          calls.versions += 1;
          return { id: "mp-version" };
        },
      },
      materialCostTableItem: {
        findMany: async (args: { where: { materialId: { in: string[] } } }) => {
          calls.items += 1;
          assert.deepEqual(args.where.materialId.in, ["mat-1"]);
          return [{ materialId: "mat-1", landedCostSnapshot: new Prisma.Decimal("1.5") }];
        },
      },
    };
    const loaded = await loadInventoryMaterialFrozenCosts(db as never, ["mat-1"], new Date("2026-09-25T12:00:00.000Z"));
    assert.equal(calls.versions, 1);
    assert.equal(calls.items, 1);
    assert.equal(loaded.supplyCostByMaterialId?.get("mat-1")?.toString(), "1.5");
    assert.equal(loaded.supplyCostUnavailableReason, null);
  });

  it("14. tabela Varejo 1 ausente não consulta itens de preço", async () => {
    let priceItems = 0;
    const db = {
      priceTable: { findUnique: async () => null },
      priceTableVersion: { findFirst: async () => null },
      priceTableItem: {
        findMany: async () => {
          priceItems += 1;
          return [];
        },
      },
    };
    const loaded = await loadInventoryValuationUnitPrices(db as never, ["p1"], new Date());
    assert.equal(priceItems, 0);
    assert.equal(loaded.retailPriceByProductId, null);
    assert.equal(loaded.retailUnavailableReason, INVENTORY_RETAIL_VALUATION_UNAVAILABLE);
    assert.equal(loaded.industrialCostByProductId, null);
  });
});
