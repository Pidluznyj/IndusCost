import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PrismaClient } from "@prisma/client";
import {
  calculateCommercialMarginsForSalesOrders,
  loadHistoricalCommercialFormationsBatch,
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

describe("salesOrderCommercialMargin — query budget (anti N+1)", () => {
  it("loadHistoricalCommercialFormationsBatch: consultas fixas, não por produto", async () => {
    const productIds = ["p1", "p2", "p3", "p4", "p5"];
    const counters = {
      priceTableFindMany: 0,
      priceTableVersionFindMany: 0,
      priceTableItemFindMany: 0,
    };

    const versionByTable = new Map(
      COMMERCIAL_PRICE_TIER_CODES.map((code, i) => [
        `table-${code}`,
        { id: `ver-${code}`, code },
      ])
    );

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
        findMany: async (args: { where: { priceTableId: string } }) => {
          counters.priceTableVersionFindMany += 1;
          const v = versionByTable.get(args.where.priceTableId);
          return v ? [{ id: v.id }] : [];
        },
      },
      priceTableItem: {
        findMany: async () => {
          counters.priceTableItemFindMany += 1;
          const items = [];
          for (const productId of productIds) {
            for (const code of COMMERCIAL_PRICE_TIER_CODES) {
              const prices = { ATACADO: 200, VAREJO_1: 220, VAREJO_2: 250, VAREJO_3: 280 } as const;
              const commissions = { ATACADO: 6, VAREJO_1: 5, VAREJO_2: 4, VAREJO_3: 3 } as const;
              const margins = { ATACADO: 30, VAREJO_1: 40, VAREJO_2: 50, VAREJO_3: 60 } as const;
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

    // Orçamento: 1× tabelas + 4× versões (faixas) + 1× itens — independente de N produtos.
    assert.equal(counters.priceTableFindMany, 1);
    assert.equal(counters.priceTableVersionFindMany, COMMERCIAL_PRICE_TIER_CODES.length);
    assert.equal(counters.priceTableItemFindMany, 1);
    assert.ok(
      counters.priceTableItemFindMany < productIds.length,
      "priceTableItem.findMany não pode escalar com N produtos"
    );
  });

  it("calculateCommercialMarginsForSalesOrders: sem Prisma no loop de itens", async () => {
    const counters = {
      priceTableFindMany: 0,
      priceTableVersionFindMany: 0,
      priceTableItemFindMany: 0,
    };
    const productIds = ["pa", "pb", "pc"];

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
        findMany: async (args: { where: { priceTableId: string } }) => {
          counters.priceTableVersionFindMany += 1;
          const code = String(args.where.priceTableId).replace("table-", "");
          return [{ id: `ver-${code}` }];
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
    ];

    const result = await calculateCommercialMarginsForSalesOrders(db, orders);
    assert.equal(result.size, 2);
    const o1 = result.get("o1");
    assert.ok(o1);
    assert.equal(o1.summary.itemsCalculated, 3);
    assert.equal(o1.summary.isComplete, true);

    // Mesma data → um único batch (não por pedido nem por item).
    assert.equal(counters.priceTableFindMany, 1);
    assert.equal(counters.priceTableVersionFindMany, 4);
    assert.equal(counters.priceTableItemFindMany, 1);
  });
});
