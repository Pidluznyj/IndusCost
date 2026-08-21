import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PrismaClient } from "@prisma/client";
import {
  calculateCommercialMarginsForSalesOrders,
  loadHistoricalCommercialFormationsBatch,
  loadHistoricalCommercialFormationsForBuckets,
} from "./salesOrderCommercialMargin.server.js";
import { COMMERCIAL_PRICE_TIER_CODES } from "./commissions/commission-commercial-tier.js";

function snapshotRates() {
  return {
    rates: {
      taxRate: 0.2875,
      otherRate: 0.02,
      freightRate: 0.03,
    },
    freight: 1.5,
    freightPercent: 3,
  };
}

function makeTierItem(
  versionId: string,
  productId: string,
  salePrice: number,
  commissionPerc: number,
  marginPct: number
) {
  return {
    priceTableVersionId: versionId,
    productId,
    frozenTotalCost: 100,
    marginPct,
    salePrice,
    commissionPerc,
    formulaSnapshotJson: snapshotRates(),
  };
}

/** Versões vigentes das 4 faixas — mesmo shape do select real do loader em lote. */
function makeVersionRows() {
  return COMMERCIAL_PRICE_TIER_CODES.map((code, index) => ({
    id: `ver-${code}`,
    priceTableId: `table-${code}`,
    status: "PUBLISHED",
    effectiveFrom: null,
    effectiveTo: null,
    publishedAt: new Date("2024-01-01T00:00:00.000Z"),
    versionNumber: index + 1,
  }));
}

function makeCountingDb(productIds: string[]) {
  const counters = {
    priceTableFindMany: 0,
    priceTableVersionFindMany: 0,
    priceTableItemFindMany: 0,
  };

  const db = {
    priceTable: {
      findMany: async () => {
        counters.priceTableFindMany += 1;
        return COMMERCIAL_PRICE_TIER_CODES.map((code) => ({
          id: `table-${code}`,
          code,
          name: code,
        }));
      },
    },
    priceTableVersion: {
      findMany: async (args: { where: { priceTableId: { in: string[] } } }) => {
        counters.priceTableVersionFindMany += 1;
        const allowed = new Set(args.where.priceTableId.in);
        return makeVersionRows().filter((row) => allowed.has(row.priceTableId));
      },
    },
    priceTableItem: {
      findMany: async () => {
        counters.priceTableItemFindMany += 1;
        const prices = { ATACADO: 200, VAREJO_1: 220, VAREJO_2: 250, VAREJO_3: 280 } as const;
        const commissions = { ATACADO: 6, VAREJO_1: 5, VAREJO_2: 4, VAREJO_3: 3 } as const;
        const margins = { ATACADO: 30, VAREJO_1: 40, VAREJO_2: 50, VAREJO_3: 60 } as const;
        const items = [];
        for (const productId of productIds) {
          for (const code of COMMERCIAL_PRICE_TIER_CODES) {
            items.push(
              makeTierItem(
                `ver-${code}`,
                productId,
                prices[code],
                commissions[code],
                margins[code]
              )
            );
          }
        }
        return items;
      },
    },
  } as unknown as PrismaClient;

  return { db, counters };
}

describe("salesOrderCommercialMargin — query budget (anti N+1)", () => {
  it("loadHistoricalCommercialFormationsBatch: consultas fixas, não por produto", async () => {
    const productIds = ["p1", "p2", "p3", "p4", "p5"];
    const { db, counters } = makeCountingDb(productIds);

    const map = await loadHistoricalCommercialFormationsBatch(
      db,
      productIds,
      new Date("2024-06-15T12:00:00.000Z")
    );

    assert.equal(map.size, productIds.length);
    for (const productId of productIds) {
      const row = map.get(productId);
      assert.ok(row?.ok, `expected formation for ${productId}`);
    }

    // Orçamento: 1× tabelas + 1× versões (todas as faixas) + 1× itens — independente de N produtos.
    assert.equal(counters.priceTableFindMany, 1);
    assert.equal(counters.priceTableVersionFindMany, 1);
    assert.equal(counters.priceTableItemFindMany, 1);
    assert.ok(
      counters.priceTableItemFindMany < productIds.length,
      "priceTableItem.findMany não pode escalar com N produtos"
    );
  });

  it("loadHistoricalCommercialFormationsForBuckets: consultas fixas, não por DATA", async () => {
    const productIds = ["p1", "p2", "p3"];
    const { db, counters } = makeCountingDb(productIds);

    const buckets = [
      new Date("2024-03-05T12:00:00.000Z"),
      new Date("2024-06-15T12:00:00.000Z"),
      new Date("2024-11-20T12:00:00.000Z"),
    ].map((referenceDate) => ({ referenceDate, productIds }));

    const perBucket = await loadHistoricalCommercialFormationsForBuckets(db, buckets);

    assert.equal(perBucket.length, buckets.length);
    for (const map of perBucket) {
      assert.equal(map.size, productIds.length);
      for (const productId of productIds) {
        assert.ok(map.get(productId)?.ok, `expected formation for ${productId}`);
      }
    }

    // Mesmo conjunto de versões vigente nas 3 datas → 1× tabelas + 1× versões + 1× itens.
    assert.equal(counters.priceTableFindMany, 1);
    assert.equal(counters.priceTableVersionFindMany, 1);
    assert.equal(counters.priceTableItemFindMany, 1);
  });

  it("calculateCommercialMarginsForSalesOrders: sem Prisma no loop de itens nem por data", async () => {
    const productIds = ["pa", "pb", "pc"];
    const { db, counters } = makeCountingDb(productIds);

    const orders = [
      {
        id: "o1",
        issueDate: new Date("2024-06-15T12:00:00.000Z"),
        items: productIds.map((productId, idx) => ({
          id: `item-${idx}`,
          productId,
          quantity: 2,
          canceledQuantity: 0,
          negotiatedPrice: 220,
        })),
      },
      {
        id: "o2",
        issueDate: new Date("2024-06-15T12:00:00.000Z"),
        items: [
          {
            id: "item-x",
            productId: "pa",
            quantity: 1,
            canceledQuantity: 0,
            negotiatedPrice: 220,
          },
        ],
      },
      // Data DIFERENTE, mesmas versões vigentes → não pode gerar novas consultas
      // de versão nem uma rodada extra de itens.
      {
        id: "o3",
        issueDate: new Date("2024-09-10T12:00:00.000Z"),
        items: [
          {
            id: "item-y",
            productId: "pb",
            quantity: 1,
            canceledQuantity: 0,
            negotiatedPrice: 220,
          },
        ],
      },
    ];

    const result = await calculateCommercialMarginsForSalesOrders(db, orders);
    assert.equal(result.size, 3);
    const o1 = result.get("o1");
    assert.ok(o1);
    assert.equal(o1.summary.itemsCalculated, 3);
    assert.equal(o1.summary.isComplete, true);
    const o3 = result.get("o3");
    assert.ok(o3);
    assert.equal(o3.summary.itemsCalculated, 1);

    // Datas distintas com o mesmo conjunto vigente → um único lote de consultas.
    assert.equal(counters.priceTableFindMany, 1);
    assert.equal(counters.priceTableVersionFindMany, 1);
    assert.equal(counters.priceTableItemFindMany, 1);
  });
});
