import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Prisma } from "@prisma/client";
import {
  assembleSalesOrderFlowEvidenceBatch,
  type AssembleSalesOrderFlowEvidenceBatchInput,
  type SalesOrderFlowEvidencePack,
} from "./salesOrderFlowEvidence.js";
import {
  buildSalesOrderFlowFingerprint,
  buildSalesOrderItemFlowFingerprint,
  SALES_ORDER_FLOW_COMPUTATION_VERSION,
} from "./salesOrderFlowFingerprint.js";
import { resolveSalesOrderFlow } from "./salesOrderFlowEngine.js";
import { resolveSalesOrderItemFlowFromEvidence } from "./salesOrderItemFlowEngine.js";
import {
  recomputeSalesOrderFlow,
  SalesOrderFlowOrderNotFoundError,
} from "./salesOrderFlowRecompute.server.js";
import {
  findSalesOrderFlowEventsByOrderId,
  findSalesOrderFlowSnapshotByOrderId,
  findSalesOrderItemFlowSnapshotsByOrderId,
  type SalesOrderFlowRepositoryDb,
} from "./salesOrderFlowRepository.server.js";

const ORDER_ID = "11111111-1111-1111-1111-111111111111";
const ITEM_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1";
const ITEM_B = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2";
const PRODUCT = "p1111111-1111-1111-1111-111111111111";
const CUSTOMER = "c1111111-1111-1111-1111-111111111111";
const FIXED_NOW = new Date("2026-07-17T15:00:00.000Z");

function buildPack(options?: {
  itemAStatus?: string;
  itemANormalized?: string;
  itemBStatus?: string;
  itemBNormalized?: string;
  includeNfeForA?: boolean;
  includeDocForA?: boolean;
}): SalesOrderFlowEvidencePack {
  const itemAStatus = options?.itemAStatus ?? "2";
  const itemANormalized = options?.itemANormalized ?? "RELEASED";
  const itemBStatus = options?.itemBStatus ?? "2";
  const itemBNormalized = options?.itemBNormalized ?? "RELEASED";

  const orders: AssembleSalesOrderFlowEvidenceBatchInput["orders"] = [
    {
      id: ORDER_ID,
      orderCode: "PD-54",
      status: "SENT_TO_NOMUS",
      externalSalesOrderId: 54001,
      expectedDeliveryDate: "2026-08-01T00:00:00.000Z",
      totalNetValue: 200,
      customerId: CUSTOMER,
      Customer: {
        id: CUSTOMER,
        companyName: "Cliente",
        tradeName: "Cliente",
        taxId: "00.000.000/0001-00",
      },
      items: [
        {
          id: ITEM_A,
          salesOrderId: ORDER_ID,
          productId: PRODUCT,
          skuSnapshot: "SKU-A",
          productNameSnapshot: "Item A",
          quantity: 10,
          nomusQuantityFulfilled: options?.includeNfeForA ? 10 : 0,
          nomusItemStatusRaw: itemAStatus,
          nomusItemStatusNormalized: itemANormalized,
          nomusIsCanceled: false,
          nomusIsStale: false,
          nomusIsCut: false,
          nomusItemExternalId: 501,
        },
        {
          id: ITEM_B,
          salesOrderId: ORDER_ID,
          productId: PRODUCT,
          skuSnapshot: "SKU-B",
          productNameSnapshot: "Item B",
          quantity: 5,
          nomusQuantityFulfilled: 0,
          nomusItemStatusRaw: itemBStatus,
          nomusItemStatusNormalized: itemBNormalized,
          nomusIsCanceled: false,
          nomusIsStale: false,
          nomusIsCut: false,
          nomusItemExternalId: 502,
        },
      ],
    },
  ];

  const map = assembleSalesOrderFlowEvidenceBatch({
    orders,
    products: [
      {
        id: PRODUCT,
        type: "PRODUCT",
        costingMode: "PURCHASED",
        hasProductRouting: false,
        hasProductBom: false,
      },
    ],
    allocations: options?.includeDocForA
      ? [
          {
            auditKey: "alloc-a",
            salesOrderId: ORDER_ID,
            salesOrderItemId: ITEM_A,
            stockDocumentExternalId: 9001,
            nfeExternalId: options.includeNfeForA ? 8001 : null,
            quantityUsedForOrder: 10,
          },
        ]
      : [],
    stockDocuments: options?.includeDocForA
      ? [
          {
            id: "d1111111-1111-1111-1111-111111111111",
            externalId: 9001,
            idNfe: options.includeNfeForA ? 8001 : null,
            statusRaw: "ATIVO",
          },
        ]
      : [],
    nfes: options?.includeNfeForA
      ? [
          {
            id: "n1111111-1111-1111-1111-111111111111",
            externalId: 8001,
            status: 1,
          },
        ]
      : [],
    nfeLinks: options?.includeNfeForA
      ? [
          {
            id: "l1111111-1111-1111-1111-111111111111",
            salesOrderId: ORDER_ID,
            nfeExternalId: 8001,
          },
        ]
      : [],
    loadedAt: "2026-07-17T12:00:00.000Z",
  });

  return map.get(ORDER_ID)!;
}

type ItemRow = Record<string, unknown> & {
  id: string;
  salesOrderId: string;
  salesOrderItemId: string;
  currentStage: string;
  fingerprint: string;
  stageEnteredAt: Date | null;
  computedAt: Date;
  orderedQuantity: Prisma.Decimal | null;
};

type OrderRow = Record<string, unknown> & {
  id: string;
  salesOrderId: string;
  currentStage: string;
  fingerprint: string;
  computedAt: Date;
};

type EventRow = Record<string, unknown> & {
  id: string;
  salesOrderId: string;
  dedupeKey: string;
  eventType: string;
  fromStage: string | null;
  toStage: string | null;
  occurredAt: Date;
};

function createMemoryRecomputeDb(options?: { failOnOrderUpsert?: boolean }) {
  const items = new Map<string, ItemRow>();
  const orders = new Map<string, OrderRow>();
  const events = new Map<string, EventRow>();
  let seq = 0;
  let committedItems = new Map<string, ItemRow>();
  let committedOrders = new Map<string, OrderRow>();
  let committedEvents = new Map<string, EventRow>();

  const pick = <T extends Record<string, unknown>>(
    row: T,
    select?: Record<string, boolean>
  ) => {
    if (!select) return { ...row };
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(select)) {
      if (select[key]) out[key] = row[key];
    }
    return out;
  };

  const cloneMaps = () => {
    committedItems = new Map(
      [...items.entries()].map(([k, v]) => [k, { ...v }])
    );
    committedOrders = new Map(
      [...orders.entries()].map(([k, v]) => [k, { ...v }])
    );
    committedEvents = new Map(
      [...events.entries()].map(([k, v]) => [k, { ...v }])
    );
  };

  const restoreMaps = () => {
    items.clear();
    orders.clear();
    events.clear();
    for (const [k, v] of committedItems) items.set(k, { ...v });
    for (const [k, v] of committedOrders) orders.set(k, { ...v });
    for (const [k, v] of committedEvents) events.set(k, { ...v });
  };

  const buildDelegates = (): SalesOrderFlowRepositoryDb =>
    ({
      salesOrderItemFlowSnapshot: {
        findUnique: async (args: {
          where: { salesOrderItemId: string };
          select?: Record<string, boolean>;
        }) => {
          const row = items.get(args.where.salesOrderItemId) ?? null;
          return row ? pick(row, args.select) : null;
        },
        findMany: async (args: {
          where: { salesOrderId?: string | { in: string[] }; fingerprint?: string };
          orderBy?: unknown;
        }) => {
          let rows = [...items.values()];
          if (typeof args.where.salesOrderId === "string") {
            rows = rows.filter((r) => r.salesOrderId === args.where.salesOrderId);
          }
          rows.sort((a, b) => a.salesOrderItemId.localeCompare(b.salesOrderItemId));
          return rows.map((r) => ({ ...r }));
        },
        create: async (args: { data: Record<string, unknown>; select?: { id: boolean } }) => {
          const id = `item-${++seq}`;
          const row = { id, ...args.data } as ItemRow;
          items.set(row.salesOrderItemId, row);
          return args.select?.id ? { id } : { ...row };
        },
        update: async (args: {
          where: { salesOrderItemId: string };
          data: Record<string, unknown>;
          select?: { id: boolean };
        }) => {
          const existing = items.get(args.where.salesOrderItemId);
          if (!existing) throw new Error("missing item");
          const next = { ...existing, ...args.data } as ItemRow;
          items.set(args.where.salesOrderItemId, next);
          return args.select?.id ? { id: next.id } : { ...next };
        },
        deleteMany: async (args: {
          where: { salesOrderId: string; salesOrderItemId?: { notIn: string[] } };
        }) => {
          let count = 0;
          for (const [key, row] of [...items.entries()]) {
            if (row.salesOrderId !== args.where.salesOrderId) continue;
            const notIn = args.where.salesOrderItemId?.notIn;
            if (notIn && notIn.includes(row.salesOrderItemId)) continue;
            items.delete(key);
            count += 1;
          }
          return { count };
        },
      },
      salesOrderFlowSnapshot: {
        findUnique: async (args: {
          where: { salesOrderId: string };
          select?: Record<string, boolean>;
        }) => {
          const row = orders.get(args.where.salesOrderId) ?? null;
          return row ? pick(row, args.select) : null;
        },
        findMany: async () => [...orders.values()].map((r) => ({ ...r })),
        create: async (args: { data: Record<string, unknown>; select?: { id: boolean } }) => {
          if (options?.failOnOrderUpsert) {
            throw new Error("TRANSACIONAL_FAIL order create");
          }
          const id = `order-${++seq}`;
          const row = { id, ...args.data } as OrderRow;
          orders.set(row.salesOrderId, row);
          return args.select?.id ? { id } : { ...row };
        },
        update: async (args: {
          where: { salesOrderId: string };
          data: Record<string, unknown>;
          select?: { id: boolean };
        }) => {
          if (options?.failOnOrderUpsert) {
            throw new Error("TRANSACIONAL_FAIL order update");
          }
          const existing = orders.get(args.where.salesOrderId);
          if (!existing) throw new Error("missing order");
          const next = { ...existing, ...args.data } as OrderRow;
          orders.set(args.where.salesOrderId, next);
          return args.select?.id ? { id: next.id } : { ...next };
        },
      },
      salesOrderFlowEvent: {
        findUnique: async (args: {
          where: { dedupeKey: string };
          select?: Record<string, boolean>;
        }) => {
          const row = events.get(args.where.dedupeKey) ?? null;
          return row ? pick(row, args.select) : null;
        },
        count: async (args: { where: { salesOrderId: string } }) =>
          [...events.values()].filter((e) => e.salesOrderId === args.where.salesOrderId)
            .length,
        findMany: async (args: {
          where: { salesOrderId: string };
          skip?: number;
          take?: number;
          orderBy?: unknown;
        }) => {
          let rows = [...events.values()].filter(
            (e) => e.salesOrderId === args.where.salesOrderId
          );
          rows.sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime());
          const skip = args.skip ?? 0;
          const take = args.take ?? rows.length;
          return rows.slice(skip, skip + take).map((r) => ({ ...r }));
        },
        create: async (args: { data: Record<string, unknown>; select?: { id: boolean } }) => {
          const id = `event-${++seq}`;
          const row = {
            id,
            ...args.data,
            occurredAt: (args.data.occurredAt as Date) ?? new Date(),
          } as EventRow;
          events.set(row.dedupeKey, row);
          return args.select?.id ? { id } : { ...row };
        },
      },
      salesOrderFlowManagement: {
        findUnique: async () => null,
        findMany: async () => [],
        create: async () => {
          throw new Error("not used");
        },
        update: async () => {
          throw new Error("not used");
        },
      },
    }) as unknown as SalesOrderFlowRepositoryDb;

  const delegates = buildDelegates();

  const db = {
    ...delegates,
    salesOrderItem: {
      findMany: async () => [
        { id: ITEM_A, totalNetValue: new Prisma.Decimal(100) },
        { id: ITEM_B, totalNetValue: new Prisma.Decimal(100) },
      ],
    },
    $transaction: async <T>(fn: (tx: SalesOrderFlowRepositoryDb) => Promise<T>): Promise<T> => {
      const snapshotItems = new Map(
        [...items.entries()].map(([k, v]) => [k, { ...v }])
      );
      const snapshotOrders = new Map(
        [...orders.entries()].map(([k, v]) => [k, { ...v }])
      );
      const snapshotEvents = new Map(
        [...events.entries()].map(([k, v]) => [k, { ...v }])
      );
      try {
        const result = await fn(delegates);
        cloneMaps();
        return result;
      } catch (error) {
        items.clear();
        orders.clear();
        events.clear();
        for (const [k, v] of snapshotItems) items.set(k, v);
        for (const [k, v] of snapshotOrders) orders.set(k, v);
        for (const [k, v] of snapshotEvents) events.set(k, v);
        throw error;
      }
    },
  };

  return { db, items, orders, events, restoreMaps, cloneMaps };
}

describe("salesOrderFlowFingerprint (OP-54)", () => {
  it("é estável para o mesmo resultado de motor", () => {
    const pack = buildPack();
    const item = resolveSalesOrderItemFlowFromEvidence(pack, ITEM_A)!;
    const a = buildSalesOrderItemFlowFingerprint(item);
    const b = buildSalesOrderItemFlowFingerprint(item);
    assert.equal(a, b);
    assert.equal(a.length, 64);

    const order = resolveSalesOrderFlow([item], {
      salesOrderId: ORDER_ID,
      itemFinancials: [{ salesOrderItemId: ITEM_A, plannedNetValue: 100 }],
    });
    const ofa = buildSalesOrderFlowFingerprint(order, [a]);
    const ofb = buildSalesOrderFlowFingerprint(order, [a]);
    assert.equal(ofa, ofb);
    assert.equal(SALES_ORDER_FLOW_COMPUTATION_VERSION, "sales-order-flow/v1");
  });
});

describe("recomputeSalesOrderFlow (OP-54)", () => {
  it("primeira execução cria snapshots dos itens e do pedido", async () => {
    const { db, items, orders } = createMemoryRecomputeDb();
    const pack = buildPack();

    const result = await recomputeSalesOrderFlow(db as never, ORDER_ID, {
      evidencePack: pack,
      now: () => FIXED_NOW,
      itemFinancials: [
        { salesOrderItemId: ITEM_A, plannedNetValue: 100 },
        { salesOrderItemId: ITEM_B, plannedNetValue: 100 },
      ],
      source: "manual",
      emitObservabilityLog: false,
    });

    assert.equal(result.action, "created");
    assert.equal(result.skippedWrite, false);
    assert.equal(result.items.created, 2);
    assert.equal(result.items.deleted, 0);
    assert.equal(result.computedAt, FIXED_NOW.toISOString());
    assert.ok(result.events.created >= 3); // 2 itens + pedido SNAPSHOT_CREATED
    assert.equal(items.size, 2);
    assert.equal(orders.size, 1);
    assert.equal(orders.get(ORDER_ID)!.computedAt.toISOString(), FIXED_NOW.toISOString());
    assert.equal(result.observability.source, "manual");
    assert.equal(result.observability.metrics.snapshotsCreated > 0, true);
    assert.ok(result.observability.sourceFingerprint.length <= 12);
    assert.doesNotMatch(
      JSON.stringify(result.observability),
      /rawJson|password|token|nomusRaw/i
    );

    const orderSnap = await findSalesOrderFlowSnapshotByOrderId(db, ORDER_ID);
    assert.ok(orderSnap);
    assert.equal(orderSnap!.fingerprint, result.orderFingerprint);

    const page = await findSalesOrderFlowEventsByOrderId(db, ORDER_ID, { pageSize: 50 });
    assert.ok(page.items.some((e) => e.eventType === "SNAPSHOT_CREATED"));
  });

  it("segunda execução idêntica não escreve (idempotente)", async () => {
    const { db, items, orders, events } = createMemoryRecomputeDb();
    const pack = buildPack();
    const opts = {
      evidencePack: pack,
      now: () => FIXED_NOW,
      itemFinancials: [
        { salesOrderItemId: ITEM_A, plannedNetValue: 100 },
        { salesOrderItemId: ITEM_B, plannedNetValue: 100 },
      ],
      emitObservabilityLog: false,
    };

    const first = await recomputeSalesOrderFlow(db as never, ORDER_ID, opts);
    const itemFpBefore = items.get(ITEM_A)!.fingerprint;
    const stageEnteredBefore = items.get(ITEM_A)!.stageEnteredAt;
    const orderComputedBefore = orders.get(ORDER_ID)!.computedAt;
    const eventCountBefore = events.size;

    const second = await recomputeSalesOrderFlow(db as never, ORDER_ID, {
      ...opts,
      now: () => new Date("2026-07-17T16:00:00.000Z"),
      emitObservabilityLog: false,
    });

    assert.equal(second.action, "unchanged");
    assert.equal(second.skippedWrite, true);
    assert.equal(second.computedAt, null);
    assert.equal(second.orderFingerprint, first.orderFingerprint);
    assert.equal(items.get(ITEM_A)!.fingerprint, itemFpBefore);
    assert.equal(
      items.get(ITEM_A)!.stageEnteredAt?.toISOString(),
      stageEnteredBefore?.toISOString()
    );
    assert.equal(orders.get(ORDER_ID)!.computedAt.toISOString(), orderComputedBefore.toISOString());
    assert.equal(events.size, eventCountBefore);
    assert.equal(second.items.upserted, 0);
  });

  it("mudança de etapa persiste e cria evento STAGE_CHANGED", async () => {
    const { db, events } = createMemoryRecomputeDb();
    const packWaiting = buildPack();
    const financials = [
      { salesOrderItemId: ITEM_A, plannedNetValue: 100 },
      { salesOrderItemId: ITEM_B, plannedNetValue: 100 },
    ];

    const first = await recomputeSalesOrderFlow(db as never, ORDER_ID, {
      evidencePack: packWaiting,
      now: () => FIXED_NOW,
      itemFinancials: financials,
      emitObservabilityLog: false,
    });
    assert.equal(first.action, "created");
    const itemABefore = (await findSalesOrderItemFlowSnapshotsByOrderId(db, ORDER_ID)).find(
      (r) => r.salesOrderItemId === ITEM_A
    );
    assert.ok(itemABefore);
    assert.notEqual(itemABefore!.currentStage, "SHIPPED_COMPLETED");

    // A avança para enviado; B permanece — mudança parcial de etapa no item.
    const packShippedA = buildPack({
      includeDocForA: true,
      includeNfeForA: true,
      itemAStatus: "4",
      itemANormalized: "FULFILLED",
    });

    const second = await recomputeSalesOrderFlow(db as never, ORDER_ID, {
      evidencePack: packShippedA,
      now: () => new Date("2026-07-17T16:00:00.000Z"),
      itemFinancials: financials,
      emitObservabilityLog: false,
    });

    assert.equal(second.action, "updated");
    assert.equal(second.skippedWrite, false);
    assert.notEqual(second.orderFingerprint, first.orderFingerprint);
    assert.ok(second.events.created >= 1);

    const itemA = (await findSalesOrderItemFlowSnapshotsByOrderId(db, ORDER_ID)).find(
      (r) => r.salesOrderItemId === ITEM_A
    );
    assert.ok(itemA);
    assert.equal(itemA!.currentStage, "SHIPPED_COMPLETED");
    assert.notEqual(itemA!.fingerprint, itemABefore!.fingerprint);

    const page = await findSalesOrderFlowEventsByOrderId(db, ORDER_ID, { pageSize: 50 });
    assert.ok(
      page.items.some(
        (e) =>
          e.eventType === "STAGE_CHANGED" &&
          e.salesOrderItemId === ITEM_A &&
          e.toStage === "SHIPPED_COMPLETED"
      )
    );
    assert.ok(events.size >= 1);
  });

  it("mudança parcial atualiza só fingerprints afetados e remove órfãos", async () => {
    const { db, items } = createMemoryRecomputeDb();
    const financials = [
      { salesOrderItemId: ITEM_A, plannedNetValue: 100 },
      { salesOrderItemId: ITEM_B, plannedNetValue: 100 },
    ];

    await recomputeSalesOrderFlow(db as never, ORDER_ID, {
      evidencePack: buildPack(),
      now: () => FIXED_NOW,
      itemFinancials: financials,
      emitObservabilityLog: false,
    });
    const fpBBefore = items.get(ITEM_B)!.fingerprint;

    // Cancela item B → fingerprint/stage mudam; A permanece.
    const packPartial = buildPack({
      itemBStatus: "9",
      itemBNormalized: "CANCELED",
    });

    const result = await recomputeSalesOrderFlow(db as never, ORDER_ID, {
      evidencePack: packPartial,
      now: () => new Date("2026-07-17T17:00:00.000Z"),
      itemFinancials: financials,
      emitObservabilityLog: false,
    });

    assert.equal(result.action, "updated");
    assert.equal(items.size, 2);
    assert.notEqual(items.get(ITEM_B)!.fingerprint, fpBBefore);
    assert.equal(items.get(ITEM_B)!.currentStage, "CANCELED");
  });

  it("falha transacional não deixa pedido e itens em versões diferentes", async () => {
    const { db, items, orders } = createMemoryRecomputeDb({ failOnOrderUpsert: true });

    await assert.rejects(
      () =>
        recomputeSalesOrderFlow(db as never, ORDER_ID, {
          evidencePack: buildPack(),
          now: () => FIXED_NOW,
          itemFinancials: [
            { salesOrderItemId: ITEM_A, plannedNetValue: 100 },
            { salesOrderItemId: ITEM_B, plannedNetValue: 100 },
          ],
          emitObservabilityLog: false,
        }),
      /TRANSACIONAL_FAIL/
    );

    assert.equal(items.size, 0);
    assert.equal(orders.size, 0);
  });

  it("pedido inexistente lança erro auditável", async () => {
    const { db } = createMemoryRecomputeDb();
    await assert.rejects(
      () =>
        recomputeSalesOrderFlow(db as never, ORDER_ID, {
          evidencePack: null,
          emitObservabilityLog: false,
        }),
      (err: unknown) => {
        assert.ok(err instanceof SalesOrderFlowOrderNotFoundError);
        assert.equal(err.salesOrderId, ORDER_ID);
        return true;
      }
    );
  });
});
