import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Prisma } from "@prisma/client";
import {
  appendSalesOrderFlowEvent,
  findSalesOrderFlowEventsByOrderId,
  findSalesOrderFlowManagementByOrderId,
  findSalesOrderFlowManagementByOrderIds,
  findSalesOrderFlowSnapshotByOrderId,
  findSalesOrderFlowSnapshotsByFingerprint,
  findSalesOrderFlowSnapshotsByOrderIds,
  findSalesOrderItemFlowSnapshotsByFingerprint,
  findSalesOrderItemFlowSnapshotsByOrderId,
  findSalesOrderItemFlowSnapshotsByOrderIds,
  replaceSalesOrderItemFlowSnapshotsForOrder,
  toFlowDecimal,
  updateSalesOrderFlowManagement,
  upsertSalesOrderFlowManagement,
  upsertSalesOrderFlowSnapshot,
  upsertSalesOrderItemFlowSnapshot,
  type SalesOrderFlowEventWrite,
  type SalesOrderFlowManagementWrite,
  type SalesOrderFlowRepositoryDb,
  type SalesOrderFlowSnapshotWrite,
  type SalesOrderItemFlowSnapshotWrite,
} from "./salesOrderFlowRepository.server.js";

type ItemRow = Record<string, unknown> & {
  id: string;
  salesOrderId: string;
  salesOrderItemId: string;
  fingerprint: string;
  orderedQuantity: Prisma.Decimal | null;
  orderValue?: never;
};

type OrderRow = Record<string, unknown> & {
  id: string;
  salesOrderId: string;
  fingerprint: string;
  orderValue: Prisma.Decimal;
};

type EventRow = Record<string, unknown> & {
  id: string;
  salesOrderId: string;
  dedupeKey: string;
  occurredAt: Date;
};

type MgmtRow = Record<string, unknown> & {
  id: string;
  salesOrderId: string;
  priority: string;
  isBlocked: boolean;
  internalNote: string | null;
};

function createMemoryDb() {
  const items = new Map<string, ItemRow>();
  const orders = new Map<string, OrderRow>();
  const events = new Map<string, EventRow>();
  const eventsById = new Map<string, EventRow>();
  const management = new Map<string, MgmtRow>();
  let seq = 0;
  const calls: string[] = [];

  const pick = <T extends Record<string, unknown>>(
    row: T,
    select?: Record<string, boolean>
  ): Record<string, unknown> | T => {
    if (!select) return { ...row };
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(select)) {
      if (select[key]) out[key] = row[key];
    }
    return out;
  };

  const db: SalesOrderFlowRepositoryDb = {
    salesOrderItemFlowSnapshot: {
      findUnique: async (args: {
        where: { salesOrderItemId: string };
        select?: Record<string, boolean>;
      }) => {
        calls.push("item.findUnique");
        const row = items.get(args.where.salesOrderItemId) ?? null;
        return row ? pick(row, args.select) : null;
      },
      findMany: async (args: {
        where: {
          salesOrderId?: string | { in: string[] };
          fingerprint?: string;
        };
        orderBy?: unknown;
      }) => {
        calls.push("item.findMany");
        let rows = [...items.values()];
        if (typeof args.where.salesOrderId === "string") {
          rows = rows.filter((r) => r.salesOrderId === args.where.salesOrderId);
        } else if (args.where.salesOrderId && "in" in args.where.salesOrderId) {
          const set = new Set(args.where.salesOrderId.in);
          rows = rows.filter((r) => set.has(r.salesOrderId));
        }
        if (args.where.fingerprint) {
          rows = rows.filter((r) => r.fingerprint === args.where.fingerprint);
        }
        rows.sort((a, b) =>
          a.salesOrderId === b.salesOrderId
            ? a.salesOrderItemId.localeCompare(b.salesOrderItemId)
            : a.salesOrderId.localeCompare(b.salesOrderId)
        );
        return rows.map((r) => ({ ...r }));
      },
      create: async (args: { data: Record<string, unknown>; select?: { id: boolean } }) => {
        calls.push("item.create");
        const id = `item-snap-${++seq}`;
        const row: ItemRow = {
          id,
          ...args.data,
          orderedQuantity: (args.data.orderedQuantity as Prisma.Decimal | null) ?? null,
        } as ItemRow;
        items.set(row.salesOrderItemId, row);
        return args.select?.id ? { id } : { ...row };
      },
      update: async (args: {
        where: { salesOrderItemId: string };
        data: Record<string, unknown>;
        select?: { id: boolean };
      }) => {
        calls.push("item.update");
        const existing = items.get(args.where.salesOrderItemId);
        if (!existing) throw new Error("item snapshot missing");
        const next = { ...existing, ...args.data } as ItemRow;
        items.set(args.where.salesOrderItemId, next);
        return args.select?.id ? { id: next.id } : { ...next };
      },
      deleteMany: async (args: {
        where: {
          salesOrderId: string;
          salesOrderItemId?: { notIn: string[] };
        };
      }) => {
        calls.push("item.deleteMany");
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
        calls.push("order.findUnique");
        const row = orders.get(args.where.salesOrderId) ?? null;
        return row ? pick(row, args.select) : null;
      },
      findMany: async (args: {
        where: { salesOrderId?: { in: string[] }; fingerprint?: string };
        orderBy?: unknown;
      }) => {
        calls.push("order.findMany");
        let rows = [...orders.values()];
        if (args.where.salesOrderId?.in) {
          const set = new Set(args.where.salesOrderId.in);
          rows = rows.filter((r) => set.has(r.salesOrderId));
        }
        if (args.where.fingerprint) {
          rows = rows.filter((r) => r.fingerprint === args.where.fingerprint);
        }
        rows.sort((a, b) => a.salesOrderId.localeCompare(b.salesOrderId));
        return rows.map((r) => ({ ...r }));
      },
      create: async (args: { data: Record<string, unknown>; select?: { id: boolean } }) => {
        calls.push("order.create");
        const id = `order-snap-${++seq}`;
        const row: OrderRow = {
          id,
          ...args.data,
          orderValue: args.data.orderValue as Prisma.Decimal,
        } as OrderRow;
        orders.set(row.salesOrderId, row);
        return args.select?.id ? { id } : { ...row };
      },
      update: async (args: {
        where: { salesOrderId: string };
        data: Record<string, unknown>;
        select?: { id: boolean };
      }) => {
        calls.push("order.update");
        const existing = orders.get(args.where.salesOrderId);
        if (!existing) throw new Error("order snapshot missing");
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
        calls.push("event.findUnique");
        const row = events.get(args.where.dedupeKey) ?? null;
        return row ? pick(row, args.select) : null;
      },
      count: async (args: { where: { salesOrderId: string } }) => {
        calls.push("event.count");
        return [...events.values()].filter((e) => e.salesOrderId === args.where.salesOrderId)
          .length;
      },
      findMany: async (args: {
        where: { salesOrderId: string };
        orderBy?: unknown;
        skip?: number;
        take?: number;
      }) => {
        calls.push("event.findMany");
        let rows = [...events.values()].filter(
          (e) => e.salesOrderId === args.where.salesOrderId
        );
        rows.sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime());
        const skip = args.skip ?? 0;
        const take = args.take ?? rows.length;
        return rows.slice(skip, skip + take).map((r) => ({ ...r }));
      },
      create: async (args: { data: Record<string, unknown>; select?: { id: boolean } }) => {
        calls.push("event.create");
        if (events.has(args.data.dedupeKey as string)) {
          throw new Error("Unique constraint failed on dedupeKey");
        }
        const id = `event-${++seq}`;
        const row: EventRow = {
          id,
          ...args.data,
          occurredAt: (args.data.occurredAt as Date) ?? new Date(),
        } as EventRow;
        events.set(row.dedupeKey, row);
        eventsById.set(id, row);
        return args.select?.id ? { id } : { ...row };
      },
    },
    salesOrderFlowManagement: {
      findUnique: async (args: {
        where: { salesOrderId: string };
        select?: Record<string, boolean>;
      }) => {
        calls.push("mgmt.findUnique");
        const row = management.get(args.where.salesOrderId) ?? null;
        return row ? pick(row, args.select) : null;
      },
      findMany: async (args: { where: { salesOrderId: { in: string[] } } }) => {
        calls.push("mgmt.findMany");
        const set = new Set(args.where.salesOrderId.in);
        return [...management.values()]
          .filter((r) => set.has(r.salesOrderId))
          .map((r) => ({ ...r }));
      },
      create: async (args: { data: Record<string, unknown>; select?: { id: boolean } }) => {
        calls.push("mgmt.create");
        const id = `mgmt-${++seq}`;
        const row: MgmtRow = {
          id,
          priority: "NORMAL",
          isBlocked: false,
          internalNote: null,
          ...args.data,
        } as MgmtRow;
        management.set(row.salesOrderId, row);
        return args.select?.id ? { id } : { ...row };
      },
      update: async (args: {
        where: { salesOrderId: string };
        data: Record<string, unknown>;
        select?: { id: boolean };
      }) => {
        calls.push("mgmt.update");
        const existing = management.get(args.where.salesOrderId);
        if (!existing) throw new Error("mgmt missing");
        const next = { ...existing, ...args.data } as MgmtRow;
        management.set(args.where.salesOrderId, next);
        return args.select?.id ? { id: next.id } : { ...next };
      },
    },
  } as unknown as SalesOrderFlowRepositoryDb;

  return { db, items, orders, events, management, calls };
}

function itemWrite(
  overrides: Partial<SalesOrderItemFlowSnapshotWrite> &
    Pick<SalesOrderItemFlowSnapshotWrite, "salesOrderId" | "salesOrderItemId" | "fingerprint">
): SalesOrderItemFlowSnapshotWrite {
  return {
    currentStage: "WAITING_PRODUCTION_ORDER",
    fulfillmentClassification: "OPEN",
    computationVersion: "v1",
    computedAt: new Date("2026-07-17T12:00:00.000Z"),
    orderedQuantity: new Prisma.Decimal("10.5"),
    ...overrides,
  };
}

function orderWrite(
  overrides: Partial<SalesOrderFlowSnapshotWrite> &
    Pick<SalesOrderFlowSnapshotWrite, "salesOrderId" | "fingerprint">
): SalesOrderFlowSnapshotWrite {
  return {
    currentStage: "WAITING_PRODUCTION_ORDER",
    computationVersion: "v1",
    computedAt: new Date("2026-07-17T12:00:00.000Z"),
    orderValue: new Prisma.Decimal("1234.56"),
    ...overrides,
  };
}

describe("salesOrderFlowRepository (OP-53)", () => {
  it("toFlowDecimal preserva Prisma.Decimal", () => {
    const d = new Prisma.Decimal("12.345678");
    assert.equal(toFlowDecimal(d), d);
    assert.ok(toFlowDecimal("9.1").equals(new Prisma.Decimal("9.1")));
  });

  it("upsert item + leitura por pedido preserva Decimal", async () => {
    const { db, items } = createMemoryDb();
    const qty = new Prisma.Decimal("10.500000");
    const created = await upsertSalesOrderItemFlowSnapshot(
      db,
      itemWrite({
        salesOrderId: "ord-1",
        salesOrderItemId: "item-1",
        fingerprint: "fp-item-1",
        orderedQuantity: qty,
      })
    );
    assert.equal(created.action, "create");

    const updated = await upsertSalesOrderItemFlowSnapshot(
      db,
      itemWrite({
        salesOrderId: "ord-1",
        salesOrderItemId: "item-1",
        fingerprint: "fp-item-1b",
        orderedQuantity: new Prisma.Decimal("11.000000"),
        currentStage: "WAITING_INVOICE",
      })
    );
    assert.equal(updated.action, "update");
    assert.equal(updated.id, created.id);

    const rows = await findSalesOrderItemFlowSnapshotsByOrderId(db, "ord-1");
    assert.equal(rows.length, 1);
    assert.ok(rows[0]!.orderedQuantity instanceof Prisma.Decimal);
    assert.ok(rows[0]!.orderedQuantity!.equals(new Prisma.Decimal("11.000000")));
    assert.equal(items.get("item-1")!.fingerprint, "fp-item-1b");
  });

  it("leitura em lote de itens usa uma findMany (sem N+1)", async () => {
    const { db, calls } = createMemoryDb();
    await upsertSalesOrderItemFlowSnapshot(
      db,
      itemWrite({ salesOrderId: "a", salesOrderItemId: "i1", fingerprint: "f1" })
    );
    await upsertSalesOrderItemFlowSnapshot(
      db,
      itemWrite({ salesOrderId: "b", salesOrderItemId: "i2", fingerprint: "f2" })
    );
    calls.length = 0;

    const map = await findSalesOrderItemFlowSnapshotsByOrderIds(db, ["a", "b", "a", "c"]);
    assert.equal(calls.filter((c) => c === "item.findMany").length, 1);
    assert.equal(map.get("a")!.length, 1);
    assert.equal(map.get("b")!.length, 1);
    assert.equal(map.get("c")!.length, 0);
  });

  it("substituição segura remove órfãos e upserta restantes", async () => {
    const { db, items } = createMemoryDb();
    await upsertSalesOrderItemFlowSnapshot(
      db,
      itemWrite({ salesOrderId: "ord-1", salesOrderItemId: "keep", fingerprint: "k1" })
    );
    await upsertSalesOrderItemFlowSnapshot(
      db,
      itemWrite({ salesOrderId: "ord-1", salesOrderItemId: "orphan", fingerprint: "o1" })
    );
    await upsertSalesOrderItemFlowSnapshot(
      db,
      itemWrite({ salesOrderId: "ord-2", salesOrderItemId: "other", fingerprint: "x1" })
    );

    const result = await replaceSalesOrderItemFlowSnapshotsForOrder(db, "ord-1", [
      itemWrite({
        salesOrderId: "ord-1",
        salesOrderItemId: "keep",
        fingerprint: "k2",
        currentStage: "SHIPPED_COMPLETED",
      }),
      itemWrite({
        salesOrderId: "ord-1",
        salesOrderItemId: "new",
        fingerprint: "n1",
      }),
    ]);

    assert.equal(result.deleted, 1);
    assert.equal(result.upserted.length, 2);
    assert.equal(items.has("orphan"), false);
    assert.equal(items.has("other"), true);
    assert.equal(items.get("keep")!.fingerprint, "k2");
    assert.ok(items.has("new"));
  });

  it("consulta item por fingerprint", async () => {
    const { db } = createMemoryDb();
    await upsertSalesOrderItemFlowSnapshot(
      db,
      itemWrite({ salesOrderId: "ord-1", salesOrderItemId: "i1", fingerprint: "same" })
    );
    await upsertSalesOrderItemFlowSnapshot(
      db,
      itemWrite({ salesOrderId: "ord-1", salesOrderItemId: "i2", fingerprint: "other" })
    );
    const rows = await findSalesOrderItemFlowSnapshotsByFingerprint(db, "same");
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.salesOrderItemId, "i1");
  });

  it("upsert pedido + lote + fingerprint; Decimal em orderValue", async () => {
    const { db, calls } = createMemoryDb();
    const created = await upsertSalesOrderFlowSnapshot(
      db,
      orderWrite({
        salesOrderId: "ord-1",
        fingerprint: "fp-o1",
        orderValue: new Prisma.Decimal("99.990000"),
      })
    );
    assert.equal(created.action, "create");

    const again = await upsertSalesOrderFlowSnapshot(
      db,
      orderWrite({
        salesOrderId: "ord-1",
        fingerprint: "fp-o1b",
        orderValue: new Prisma.Decimal("100.000000"),
      })
    );
    assert.equal(again.action, "update");

    const one = await findSalesOrderFlowSnapshotByOrderId(db, "ord-1");
    assert.ok(one);
    assert.ok(one!.orderValue instanceof Prisma.Decimal);
    assert.ok(one!.orderValue.equals(new Prisma.Decimal("100.000000")));

    await upsertSalesOrderFlowSnapshot(
      db,
      orderWrite({ salesOrderId: "ord-2", fingerprint: "fp-o1b" })
    );
    calls.length = 0;
    const map = await findSalesOrderFlowSnapshotsByOrderIds(db, ["ord-1", "ord-2", "missing"]);
    assert.equal(calls.filter((c) => c === "order.findMany").length, 1);
    assert.ok(map.get("ord-1"));
    assert.ok(map.get("ord-2"));
    assert.equal(map.get("missing"), null);

    const byFp = await findSalesOrderFlowSnapshotsByFingerprint(db, "fp-o1b");
    assert.equal(byFp.length, 2);
  });

  it("eventos: append-only com dedupeKey e paginação", async () => {
    const { db } = createMemoryDb();
    const base: Omit<SalesOrderFlowEventWrite, "dedupeKey" | "occurredAt"> = {
      salesOrderId: "ord-1",
      eventType: "STAGE_CHANGED",
      fromStage: "A",
      toStage: "B",
    };

    const t0 = new Date("2026-07-01T10:00:00.000Z");
    const t1 = new Date("2026-07-02T10:00:00.000Z");
    const t2 = new Date("2026-07-03T10:00:00.000Z");

    const a = await appendSalesOrderFlowEvent(db, {
      ...base,
      dedupeKey: "e1",
      occurredAt: t0,
    });
    const dup = await appendSalesOrderFlowEvent(db, {
      ...base,
      dedupeKey: "e1",
      occurredAt: t1,
    });
    assert.equal(a.action, "created");
    assert.equal(dup.action, "duplicate");
    assert.equal(dup.id, a.id);

    await appendSalesOrderFlowEvent(db, {
      ...base,
      dedupeKey: "e2",
      occurredAt: t1,
    });
    await appendSalesOrderFlowEvent(db, {
      ...base,
      dedupeKey: "e3",
      occurredAt: t2,
    });

    const page0 = await findSalesOrderFlowEventsByOrderId(db, "ord-1", {
      page: 0,
      pageSize: 2,
    });
    assert.equal(page0.total, 3);
    assert.equal(page0.items.length, 2);
    assert.equal(page0.hasMore, true);
    assert.equal(page0.items[0]!.dedupeKey, "e3");

    const page1 = await findSalesOrderFlowEventsByOrderId(db, "ord-1", {
      page: 1,
      pageSize: 2,
    });
    assert.equal(page1.items.length, 1);
    assert.equal(page1.hasMore, false);
    assert.equal(page1.items[0]!.dedupeKey, "e1");
  });

  it("management: consulta, upsert e update parcial", async () => {
    const { db, calls } = createMemoryDb();
    const write: SalesOrderFlowManagementWrite = {
      salesOrderId: "ord-1",
      priority: "HIGH",
      isBlocked: true,
      blockReason: "crédito",
      internalNote: "nota",
    };
    const created = await upsertSalesOrderFlowManagement(db, write);
    assert.equal(created.action, "create");

    const found = await findSalesOrderFlowManagementByOrderId(db, "ord-1");
    assert.equal(found!.priority, "HIGH");
    assert.equal(found!.isBlocked, true);

    const updated = await updateSalesOrderFlowManagement(db, "ord-1", {
      isBlocked: false,
      internalNote: "liberado",
    });
    assert.ok(updated);
    assert.equal(updated!.isBlocked, false);
    assert.equal(updated!.internalNote, "liberado");
    assert.equal(updated!.priority, "HIGH");

    const missing = await updateSalesOrderFlowManagement(db, "missing", {
      priority: "LOW",
    });
    assert.equal(missing, null);

    await upsertSalesOrderFlowManagement(db, {
      salesOrderId: "ord-2",
      priority: "NORMAL",
    });
    calls.length = 0;
    const map = await findSalesOrderFlowManagementByOrderIds(db, ["ord-1", "ord-2"]);
    assert.equal(calls.filter((c) => c === "mgmt.findMany").length, 1);
    assert.equal(map.get("ord-1")!.priority, "HIGH");
    assert.equal(map.get("ord-2")!.priority, "NORMAL");
  });

  it("não expõe delegates de SalesOrder/Nomus no tipo do repository", () => {
    const keys = Object.keys(createMemoryDb().db).sort();
    assert.deepEqual(keys, [
      "salesOrderFlowEvent",
      "salesOrderFlowManagement",
      "salesOrderFlowSnapshot",
      "salesOrderItemFlowSnapshot",
    ]);
  });
});
