/**
 * Consistência cross-screen: o mesmo Pedido (fixture PD 02820) deve expor
 * a mesma margem comercial R$ / % / cobertura / status em todas as superfícies
 * que consomem o read model canônico.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PrismaClient } from "@prisma/client";
import { COMMERCIAL_PRICE_TIER_CODES } from "./commissions/commission-commercial-tier.js";
import {
  commercialMarginIdentityKey,
  aggregateCommercialMarginPayloads,
  resolveCommercialMarginDisplayStatus,
} from "./salesOrderCommercialMarginReadModel.js";
import {
  getSalesOrderCommercialMargin,
  getSalesOrderCommercialMarginAggregate,
  getSalesOrdersCommercialMargins,
} from "./salesOrderCommercialMarginReadService.server.js";
import { buildSalesOrderManagementMarginEconomics } from "./salesOrderManagementMargin.js";
import type { SalesOrderMarginSummaryPayload } from "./salesOrderMarginTypes.js";

const PD02820_ITEMS = [
  {
    id: "i10",
    productId: "prod-a",
    quantity: 400,
    negotiatedPrice: 4.32,
    totalNetValue: 1641.6,
  },
  {
    id: "i20",
    productId: "prod-b",
    quantity: 100,
    negotiatedPrice: 5.97,
    totalNetValue: 567.15,
  },
  {
    id: "i30",
    productId: "prod-c",
    quantity: 100,
    negotiatedPrice: 5.97,
    totalNetValue: 567.15,
  },
] as const;

function snapshotRates() {
  return {
    rates: { taxRate: 0.2875, otherRate: 0.02, freightRate: 0.03 },
    freight: 0,
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
    frozenTotalCost: salePrice * 0.4,
    marginPct,
    salePrice,
    commissionPerc,
    formulaSnapshotJson: snapshotRates(),
  };
}

function makePrismaMock() {
  const counters = {
    salesOrderFindMany: 0,
    priceTableFindMany: 0,
    priceTableItemFindMany: 0,
  };
  const orders = [
    {
      id: "pd-02820",
      issueDate: new Date("2024-06-15T12:00:00.000Z"),
      customerId: "cust-1",
      items: PD02820_ITEMS.map((row) => ({
        id: row.id,
        salesOrderId: "pd-02820",
        productId: row.productId,
        quantity: row.quantity,
        negotiatedPrice: row.negotiatedPrice,
        totalNetValue: row.totalNetValue,
        unitCost: null,
        nomusIsCanceled: false,
        nomusIsCut: false,
        nomusItemStatusNormalized: "RELEASED",
        flowItemSnapshot: { canceledQuantity: 0, cutQuantity: 0 },
      })),
    },
  ];
  const productIds = [...new Set(PD02820_ITEMS.map((i) => i.productId))];

  const db = {
    salesOrder: {
      findMany: async (args: {
        where?: { id?: { in?: string[] } };
        select?: { id?: true; items?: unknown };
      }) => {
        counters.salesOrderFindMany += 1;
        let rows = orders;
        if (args.where?.id?.in) {
          const set = new Set(args.where.id.in);
          rows = rows.filter((o) => set.has(o.id));
        }
        if (args.select?.id && !args.select.items) {
          return rows.map((o) => ({ id: o.id }));
        }
        return rows.map((o) => ({
          id: o.id,
          issueDate: o.issueDate,
          customerId: o.customerId,
          items: o.items,
        }));
      },
    },
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
        const code = String(args.where.priceTableId).replace("table-", "");
        return [{ id: `ver-${code}` }];
      },
    },
    priceTableItem: {
      findMany: async () => {
        counters.priceTableItemFindMany += 1;
        const prices = { ATACADO: 4.32, VAREJO_1: 5.97, VAREJO_2: 6.5, VAREJO_3: 7.2 } as const;
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

describe("cross-screen commercial margin — PD 02820", () => {
  it("individual ≡ lote ≡ agregado ≡ gestão ≡ 360 ≡ finance portfolio", async () => {
    const { db, counters } = makePrismaMock();

    const individual = await getSalesOrderCommercialMargin(db, "pd-02820");
    assert.ok(individual);

    const batch = await getSalesOrdersCommercialMargins(db, ["pd-02820"]);
    const fromBatch = batch.get("pd-02820");
    assert.ok(fromBatch);

    const aggregate = await getSalesOrderCommercialMarginAggregate(db, {
      orderIds: ["pd-02820"],
    });
    assert.ok(aggregate.orders[0]);

    // Gestão: consolida a partir do commercialMargin do summary (mesmo payload).
    const managementRowSummary: SalesOrderMarginSummaryPayload = {
      netRevenue: individual.commercialSoldTotalValue,
      totalCost: 0,
      marginValue: individual.commercialMarginTotalValue,
      marginPercent: individual.commercialMarginTotalPercent,
      markup: null,
      itemsCount: individual.itemsActive,
      validItemsCount: individual.itemsCalculated,
      ignoredItemsCount: individual.itemsUnavailable,
      hasMissingCost: individual.itemsUnavailable > 0,
      hasMissingProduct: false,
      hasNegativeMargin: (individual.commercialMarginTotalValue ?? 0) < 0,
      hasInvalidRevenue: false,
      status: individual.isComplete ? "OK" : "PARTIAL",
      statusLabel: "OK",
      statusSeverity: "success",
      totalSalesRevenueInScope: individual.totalActiveSoldValue,
      marginRevenueCovered: individual.commercialSoldTotalValue,
      marginRevenueUncovered: Math.max(
        0,
        individual.totalActiveSoldValue - individual.commercialSoldTotalValue
      ),
      marginCoveragePercent: individual.commercialMarginCoveragePercent,
      itemsTotal: individual.itemsActive,
      itemsWithCost: individual.itemsCalculated,
      itemsWithoutCost: individual.itemsUnavailable,
      costCoverageStatus: individual.isComplete ? "FULL" : "PARTIAL",
      commercialMargin: individual.commercialMargin,
    };
    const management = buildSalesOrderManagementMarginEconomics([
      { marginSummary: managementRowSummary },
    ]);

    // Cliente 360 / Finance: agregam payloads comerciais oficiais.
    const portfolioCommercial = aggregateCommercialMarginPayloads([
      individual.commercialMargin,
    ]);

    const expected = commercialMarginIdentityKey(individual.commercialMargin);
    assert.deepEqual(commercialMarginIdentityKey(fromBatch.commercialMargin), expected);
    assert.deepEqual(
      commercialMarginIdentityKey(aggregate.orders[0]!.commercialMargin),
      expected
    );
    assert.deepEqual(
      commercialMarginIdentityKey(aggregate.commercialMargin),
      expected
    );
    assert.deepEqual(
      commercialMarginIdentityKey(management.consolidated!.commercialMargin!),
      expected
    );
    assert.deepEqual(commercialMarginIdentityKey(portfolioCommercial), expected);

    // Composição PD 02820
    assert.equal(individual.composition.grossActiveTotalValue, 2922);
    assert.equal(individual.composition.discountTotalValue, 146.1);
    assert.equal(individual.composition.netActiveTotalValue, 2775.9);

    // Status padronizado
    assert.ok(
      ["COMPLETE", "PARTIAL", "UNAVAILABLE"].includes(
        resolveCommercialMarginDisplayStatus(individual.commercialMargin)
      )
    );

    // Query budget: formação não escala por item
    assert.ok(counters.priceTableItemFindMany <= 4);
    assert.ok(counters.priceTableFindMany <= 4);
  });

  it("não usa média simples entre pedidos", async () => {
    const a = {
      commercialMarginTotalValue: 100,
      commercialMarginTotalPercent: 10,
      commercialSoldTotalValue: 1000,
      totalActiveSoldValue: 1000,
      commercialMarginCoveragePercent: 100,
      itemsCalculated: 1,
      itemsUnavailable: 0,
      itemsActive: 1,
      isComplete: true,
      warnings: [] as string[],
    };
    const b = {
      commercialMarginTotalValue: 400,
      commercialMarginTotalPercent: 40,
      commercialSoldTotalValue: 1000,
      totalActiveSoldValue: 1000,
      commercialMarginCoveragePercent: 100,
      itemsCalculated: 1,
      itemsUnavailable: 0,
      itemsActive: 1,
      isComplete: true,
      warnings: [] as string[],
    };
    const c = {
      ...b,
      commercialMarginTotalValue: 900,
      commercialMarginTotalPercent: 45,
      commercialSoldTotalValue: 2000,
      totalActiveSoldValue: 2000,
    };
    const weighted = aggregateCommercialMarginPayloads([a, c]);
    // (100+900)/(1000+2000)=33.33…; média simples (10+45)/2=27.5
    assert.equal(weighted.commercialMarginTotalValue, 1000);
    assert.equal(weighted.commercialMarginTotalPercent, 33.33);
    assert.notEqual(weighted.commercialMarginTotalPercent, 27.5);
  });
});
