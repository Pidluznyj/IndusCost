import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PrismaClient } from "@prisma/client";
import { COMMERCIAL_PRICE_TIER_CODES } from "./commissions/commission-commercial-tier.js";
import {
  calculateSalesOrderItemCommercialMargin,
  summarizeSalesOrderCommercialMargins,
  unavailableCommercialMarginItem,
  type SalesOrderCommercialMarginItemPayload,
} from "./salesOrderCommercialMargin.js";
import { resolveSalesOrderItemCommercialValues } from "./salesOrderItemCommercialValues.js";
import {
  aggregateCommercialMarginSummaries,
  buildCommercialMarginItemDTO,
  buildCommercialMarginSummaryDTO,
  buildMonthlyCommercialMarginRows,
  commercialMarginIdentityKey,
  summarizeCompositionTotals,
} from "./salesOrderCommercialMarginReadModel.js";
import {
  getSalesOrderCommercialMargin,
  getSalesOrderCommercialMarginAggregate,
  getSalesOrdersCommercialMargins,
} from "./salesOrderCommercialMarginReadService.server.js";
import { roundPricingMoney, roundPricingPercent } from "./pricingCalculations.js";

/** Fixture equivalente ao PD 02820 (composição Nomus). */
const PD02820_ITEMS = [
  {
    id: "i10",
    productId: "prod-a",
    orderedQuantity: 400,
    canceledQuantity: 0,
    grossUnitPrice: 4.32,
    netTotalValue: 1641.6,
  },
  {
    id: "i20",
    productId: "prod-b",
    orderedQuantity: 100,
    canceledQuantity: 0,
    grossUnitPrice: 5.97,
    netTotalValue: 567.15,
  },
  {
    id: "i30",
    productId: "prod-c",
    orderedQuantity: 100,
    canceledQuantity: 0,
    grossUnitPrice: 5.97,
    netTotalValue: 567.15,
  },
] as const;

const TAX = 0.2875;
const OTHER = 0.02;
const FREIGHT_RATE = 0.03;
const FREIGHT_ABS = 0;

function completeMargin(input: {
  soldQuantity: number;
  negotiatedUnitPrice: number;
  cost: number;
  commissionRate: number;
}): SalesOrderCommercialMarginItemPayload {
  return calculateSalesOrderItemCommercialMargin({
    soldQuantity: input.soldQuantity,
    negotiatedUnitPrice: input.negotiatedUnitPrice,
    frozenTotalCost: input.cost,
    rates: {
      taxRate: TAX,
      commissionRate: input.commissionRate,
      otherRate: OTHER,
      freightRate: FREIGHT_RATE,
      freight: FREIGHT_ABS,
    },
    historicalContextId: "ctx",
    priceTableVersionId: "ver-ATACADO",
    referenceDate: "2024-06-15",
    lowerMarginBand: "ATACADO",
    upperMarginBand: "ATACADO",
  });
}

function buildPd02820Summary(orderId: string) {
  const items = PD02820_ITEMS.map((row) => {
    const composition = resolveSalesOrderItemCommercialValues({
      orderedQuantity: row.orderedQuantity,
      canceledQuantity: row.canceledQuantity,
      grossUnitPrice: row.grossUnitPrice,
      netTotalValue: row.netTotalValue,
    });
    // Motor atual usa negotiatedPrice (bruto unitário) — não alteramos a fórmula aqui.
    const margin = completeMargin({
      soldQuantity: composition.activeQuantity,
      negotiatedUnitPrice: row.grossUnitPrice,
      cost: row.grossUnitPrice * 0.4,
      commissionRate: 0.05,
    });
    return buildCommercialMarginItemDTO({
      orderId,
      itemId: row.id,
      margin,
      composition,
    });
  });

  const commercialMargin = summarizeSalesOrderCommercialMargins(items, {
    totalActiveSoldValue: items.reduce((s, i) => s + i.soldValue, 0),
  });

  return buildCommercialMarginSummaryDTO({
    orderId,
    commercialMargin,
    items,
  });
}

describe("salesOrderCommercialMarginReadModel — PD 02820 composição", () => {
  it("totais bruto/desconto/líquido oficiais", () => {
    const summary = buildPd02820Summary("pd-02820");
    assert.equal(summary.composition.grossActiveTotalValue, 2922);
    assert.equal(summary.composition.discountTotalValue, 146.1);
    assert.equal(summary.composition.netActiveTotalValue, 2775.9);
    assert.equal(summary.items[0]?.composition.effectiveNetUnitPrice, 4.104);
    assert.equal(summary.items[1]?.composition.effectiveNetUnitPrice, 5.6715);
    assert.equal(summary.items[2]?.composition.effectiveNetUnitPrice, 5.6715);
  });

  it("cancelados ficam fora da composição ativa", () => {
    const composition = resolveSalesOrderItemCommercialValues({
      orderedQuantity: 400,
      canceledQuantity: 400,
      isFullyCanceled: true,
      grossUnitPrice: 4.32,
      netTotalValue: 1641.6,
    });
    const margin = unavailableCommercialMarginItem({
      soldQuantity: 0,
      negotiatedUnitPrice: 4.32,
      soldValue: 0,
      referenceDate: "2024-06-15",
      reasonCode: "ITEM_CANCELED",
    });
    const item = buildCommercialMarginItemDTO({
      orderId: "o",
      itemId: "canceled",
      margin,
      composition,
    });
    const totals = summarizeCompositionTotals([item]);
    assert.equal(totals.grossActiveTotalValue, 0);
    assert.equal(totals.netActiveTotalValue, 0);
  });
});

describe("salesOrderCommercialMarginReadModel — consistência individual/lote/agregado", () => {
  it("mesmo Pedido: individual ≡ lote ≡ relatório ≡ agregado de período", () => {
    const individual = buildPd02820Summary("pd-02820");
    const batchMap = new Map([
      ["pd-02820", individual],
      ["other", buildPd02820Summary("other")],
    ]);
    const fromBatch = batchMap.get("pd-02820")!;
    const reportView = buildCommercialMarginSummaryDTO({
      orderId: fromBatch.orderId,
      commercialMargin: fromBatch.commercialMargin,
      items: fromBatch.items,
    });
    const period = aggregateCommercialMarginSummaries([individual], {
      orderIds: ["pd-02820"],
      issueDateFrom: "2024-01-01",
      issueDateTo: "2024-12-31",
    });

    const a = commercialMarginIdentityKey(individual);
    const b = commercialMarginIdentityKey(fromBatch);
    const c = commercialMarginIdentityKey(reportView);
    const d = commercialMarginIdentityKey(period.orders[0]!);
    const e = commercialMarginIdentityKey(period.commercialMargin);

    assert.deepEqual(a, b);
    assert.deepEqual(a, c);
    assert.deepEqual(a, d);
    assert.deepEqual(a, e);
  });

  it("agregação ponderada — não média simples de %", () => {
    const low = buildPd02820Summary("low");
    // Pedido artificial com margem diferente e soldValue menor.
    const highItems = [
      buildCommercialMarginItemDTO({
        orderId: "high",
        itemId: "h1",
        margin: completeMargin({
          soldQuantity: 10,
          negotiatedUnitPrice: 200,
          cost: 40,
          commissionRate: 0.03,
        }),
        composition: resolveSalesOrderItemCommercialValues({
          orderedQuantity: 10,
          grossUnitPrice: 200,
          netTotalValue: 2000,
        }),
      }),
    ];
    const high = buildCommercialMarginSummaryDTO({
      orderId: "high",
      commercialMargin: summarizeSalesOrderCommercialMargins(highItems, {
        totalActiveSoldValue: highItems[0]!.soldValue,
      }),
      items: highItems,
    });

    const agg = aggregateCommercialMarginSummaries([low, high]);
    const expectedValue = roundPricingMoney(
      (low.commercialMarginTotalValue ?? 0) + (high.commercialMarginTotalValue ?? 0)
    );
    const expectedSold = roundPricingMoney(
      low.commercialSoldTotalValue + high.commercialSoldTotalValue
    );
    const expectedPercent =
      expectedSold > 0
        ? roundPricingPercent((expectedValue / expectedSold) * 100)
        : null;

    assert.equal(agg.commercialMarginTotalValue, expectedValue);
    assert.equal(agg.commercialMarginTotalPercent, expectedPercent);

    const naiveAvg =
      ((low.commercialMarginTotalPercent ?? 0) + (high.commercialMarginTotalPercent ?? 0)) /
      2;
    assert.notEqual(
      Number(agg.commercialMarginTotalPercent?.toFixed(4)),
      Number(naiveAvg.toFixed(4))
    );
  });

  it("UNAVAILABLE e cobertura são preservados", () => {
    const ok = buildPd02820Summary("ok");
    const unavailableItem = buildCommercialMarginItemDTO({
      orderId: "partial",
      itemId: "u1",
      margin: unavailableCommercialMarginItem({
        soldQuantity: 5,
        negotiatedUnitPrice: 10,
        soldValue: 50,
        referenceDate: "2024-06-15",
        reasonCode: "HISTORICAL_FORMATION_NOT_FOUND",
      }),
      composition: resolveSalesOrderItemCommercialValues({
        orderedQuantity: 5,
        grossUnitPrice: 10,
        netTotalValue: 50,
      }),
    });
    const partial = buildCommercialMarginSummaryDTO({
      orderId: "partial",
      commercialMargin: summarizeSalesOrderCommercialMargins(
        [...ok.items, unavailableItem],
        {
          totalActiveSoldValue:
            ok.totalActiveSoldValue + unavailableItem.soldValue,
        }
      ),
      items: [...ok.items, unavailableItem],
    });

    assert.equal(partial.isComplete, false);
    assert.ok(partial.itemsUnavailable >= 1);
    assert.ok(
      partial.unavailableReasonCodes.includes("HISTORICAL_FORMATION_NOT_FOUND")
    );
    assert.ok(
      (partial.commercialMarginCoveragePercent ?? 100) < 100 ||
        partial.itemsUnavailable > 0
    );
  });

  it("não inclui campos de margem gerencial no DTO", () => {
    const summary = buildPd02820Summary("pd");
    const json = JSON.stringify(summary);
    assert.doesNotMatch(json, /managerialMargin/i);
    assert.doesNotMatch(json, /marginAmount/);
    assert.match(json, /commercialMargin/);
  });
});

function snapshotRates() {
  return {
    rates: {
      taxRate: 0.2875,
      otherRate: 0.02,
      freightRate: 0.03,
    },
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

function makeCommercialPrismaMock(orders: Array<{
  id: string;
  issueDate: Date;
  customerId?: string;
  items: Array<{
    id: string;
    productId: string;
    quantity: number;
    negotiatedPrice: number;
    totalNetValue: number;
  }>;
}>) {
  const counters = {
    salesOrderFindMany: 0,
    priceTableFindMany: 0,
    priceTableVersionFindMany: 0,
    priceTableItemFindMany: 0,
  };

  const productIds = [
    ...new Set(orders.flatMap((o) => o.items.map((i) => i.productId))),
  ];

  const db = {
    salesOrder: {
      findMany: async (args: {
        where?: { id?: { in?: string[] }; customerId?: string };
        select?: { id?: true; items?: unknown };
      }) => {
        counters.salesOrderFindMany += 1;
        let rows = orders;
        if (args.where?.id?.in) {
          const set = new Set(args.where.id.in);
          rows = rows.filter((o) => set.has(o.id));
        }
        if (args.where?.customerId) {
          rows = rows.filter((o) => o.customerId === args.where?.customerId);
        }
        // Select só ids (agregado passo 1).
        if (args.select && args.select.id && !args.select.items) {
          return rows.map((o) => ({ id: o.id }));
        }
        return rows.map((o) => ({
          id: o.id,
          issueDate: o.issueDate,
          customerId: o.customerId ?? null,
          items: o.items.map((item) => ({
            id: item.id,
            salesOrderId: o.id,
            productId: item.productId,
            quantity: item.quantity,
            negotiatedPrice: item.negotiatedPrice,
            totalNetValue: item.totalNetValue,
            unitCost: null,
            nomusIsCanceled: false,
            nomusIsCut: false,
            nomusItemStatusNormalized: "RELEASED",
            flowItemSnapshot: { canceledQuantity: 0, cutQuantity: 0 },
          })),
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
        counters.priceTableVersionFindMany += 1;
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

describe("salesOrderCommercialMarginReadService — fonte única + batch", () => {
  it("individual ≡ lote ≡ agregado (mesmo Pedido PD 02820)", async () => {
    const orders = [
      {
        id: "pd-02820",
        issueDate: new Date("2024-06-15T12:00:00.000Z"),
        customerId: "cust-1",
        items: PD02820_ITEMS.map((row) => ({
          id: row.id,
          productId: row.productId,
          quantity: row.orderedQuantity,
          negotiatedPrice: row.grossUnitPrice,
          totalNetValue: row.netTotalValue,
        })),
      },
    ];
    const { db, counters } = makeCommercialPrismaMock(orders);

    const individual = await getSalesOrderCommercialMargin(db, "pd-02820");
    const batch = await getSalesOrdersCommercialMargins(db, ["pd-02820"]);
    const aggregate = await getSalesOrderCommercialMarginAggregate(db, {
      orderIds: ["pd-02820"],
    });

    assert.ok(individual);
    const fromBatch = batch.get("pd-02820");
    assert.ok(fromBatch);
    assert.ok(aggregate.orders[0]);

    assert.deepEqual(
      commercialMarginIdentityKey(individual),
      commercialMarginIdentityKey(fromBatch)
    );
    assert.deepEqual(
      commercialMarginIdentityKey(individual),
      commercialMarginIdentityKey(aggregate.orders[0]!)
    );
    assert.deepEqual(
      commercialMarginIdentityKey(individual.commercialMargin),
      commercialMarginIdentityKey(aggregate.commercialMargin)
    );

    assert.equal(individual.composition.grossActiveTotalValue, 2922);
    assert.equal(individual.composition.discountTotalValue, 146.1);
    assert.equal(individual.composition.netActiveTotalValue, 2775.9);

    // Batch: formação histórica não escala por item (1 findMany de itens de tabela).
    assert.ok(counters.priceTableItemFindMany >= 1);
    assert.ok(
      counters.priceTableItemFindMany <= 3,
      "orçamento: poucas consultas de PriceTableItem"
    );
  });

  it("filtros amplos: primeiro só ids, depois batch (sem N+1 por Pedido)", async () => {
    const orders = [
      {
        id: "o1",
        issueDate: new Date("2024-06-15T12:00:00.000Z"),
        customerId: "cust-1",
        items: [
          {
            id: "a",
            productId: "prod-a",
            quantity: 10,
            negotiatedPrice: 5.97,
            totalNetValue: 59.7,
          },
        ],
      },
      {
        id: "o2",
        issueDate: new Date("2024-06-15T12:00:00.000Z"),
        customerId: "cust-1",
        items: [
          {
            id: "b",
            productId: "prod-b",
            quantity: 20,
            negotiatedPrice: 4.32,
            totalNetValue: 86.4,
          },
        ],
      },
    ];
    const { db, counters } = makeCommercialPrismaMock(orders);

    const aggregate = await getSalesOrderCommercialMarginAggregate(db, {
      customerId: "cust-1",
      issueDateFrom: "2024-06-01",
      issueDateTo: "2024-06-30",
    });

    assert.equal(aggregate.orderCount, 2);
    // 1× ids + 1× load completo — não 1 findMany por pedido com itens.
    assert.equal(counters.salesOrderFindMany, 2);
    // Mesma data civil → um batch de formação.
    assert.equal(counters.priceTableFindMany, 1);
    assert.equal(counters.priceTableItemFindMany, 1);
  });
});

describe("buildMonthlyCommercialMarginRows", () => {
  it("pondera % por mês com a mesma lógica do card (Σ margem / Σ líquido coberto)", () => {
    const rows = buildMonthlyCommercialMarginRows(
      [
        {
          issueDate: "2026-01-10",
          commercialMargin: {
            commercialMarginTotalValue: 100,
            commercialMarginTotalPercent: 50,
            commercialSoldTotalValue: 200,
            totalActiveSoldValue: 200,
            commercialMarginCoveragePercent: 100,
            itemsCalculated: 1,
            itemsUnavailable: 0,
            itemsActive: 1,
            isComplete: true,
            warnings: [],
          },
        },
        {
          issueDate: "2026-01-20",
          commercialMargin: {
            commercialMarginTotalValue: 50,
            commercialMarginTotalPercent: 25,
            commercialSoldTotalValue: 200,
            totalActiveSoldValue: 200,
            commercialMarginCoveragePercent: 100,
            itemsCalculated: 1,
            itemsUnavailable: 0,
            itemsActive: 1,
            isComplete: true,
            warnings: [],
          },
        },
        {
          issueDate: "2026-02-05",
          commercialMargin: {
            commercialMarginTotalValue: 80,
            commercialMarginTotalPercent: 40,
            commercialSoldTotalValue: 200,
            totalActiveSoldValue: 200,
            commercialMarginCoveragePercent: 100,
            itemsCalculated: 1,
            itemsUnavailable: 0,
            itemsActive: 1,
            isComplete: true,
            warnings: [],
          },
        },
      ],
      2026
    );

    assert.equal(rows[0]!.marginPercent, 37.5); // (100+50)/(200+200)
    assert.equal(rows[0]!.marginAmount, 150);
    assert.equal(rows[0]!.ordersCount, 2);
    assert.equal(rows[1]!.marginPercent, 40);
    assert.equal(rows[2]!.marginPercent, null);
  });
});
