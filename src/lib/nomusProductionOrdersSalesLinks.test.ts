import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Prisma } from "@prisma/client";
import { NOMUS_PRODUCTION_ORDER_OP_05800_FIXTURE } from "@/src/lib/fixtures/nomusProductionOrderOp05800.js";
import {
  mapNomusProductionOrderForPersist,
  mapNomusProductionOrderSalesLink,
} from "@/src/lib/nomusProductionOrdersMapper.js";
import { persistNomusProductionOrder } from "@/src/lib/nomusProductionOrdersPersist.server.js";
import {
  reconcilePendingNomusProductionOrderSalesLinks,
  syncNomusProductionOrderSalesLinks,
} from "@/src/lib/nomusProductionOrdersSalesLinks.server.js";

type LinkRow = {
  id: string;
  productionOrderId: string;
  productionOrderExternalId: number;
  externalSalesOrderId: number;
  externalSalesOrderItemId: number;
  itemNumber: string | null;
  customerName: string | null;
  linkedQuantity: Prisma.Decimal | null;
  rawJson: unknown;
  salesOrderId: string | null;
  salesOrderItemId: string | null;
  isCurrent: boolean;
  removedAt: Date | null;
  firstSeenAt: Date;
  lastSeenAt: Date;
  updatedAt: Date;
};

function linkMapKey(productionOrderExternalId: number, externalSalesOrderItemId: number) {
  return `${productionOrderExternalId}:${externalSalesOrderItemId}`;
}

function createLinkDb(options?: {
  salesOrders?: Array<{ id: string; externalSalesOrderId: number }>;
  salesOrderItems?: Array<{
    id: string;
    salesOrderId: string;
    nomusItemExternalId: number;
  }>;
}) {
  const links = new Map<string, LinkRow>();
  const salesOrders = options?.salesOrders ?? [];
  const salesOrderItems = options?.salesOrderItems ?? [];
  let linkSeq = 0;

  const db = {
    salesOrder: {
      findFirst: async (args: {
        where: { externalSalesOrderId: number };
        select?: { id: boolean };
        orderBy?: unknown;
      }) => {
        const row = salesOrders.find(
          (s) => s.externalSalesOrderId === args.where.externalSalesOrderId
        );
        return row ? { id: row.id } : null;
      },
    },
    salesOrderItem: {
      findFirst: async (args: {
        where: {
          salesOrderId?: string;
          nomusItemExternalId: number;
        };
        select?: { id: boolean };
        orderBy?: unknown;
      }) => {
        const row = salesOrderItems.find((item) => {
          if (item.nomusItemExternalId !== args.where.nomusItemExternalId) return false;
          if (args.where.salesOrderId && item.salesOrderId !== args.where.salesOrderId) {
            return false;
          }
          return true;
        });
        return row ? { id: row.id } : null;
      },
    },
    nomusProductionOrderSalesLink: {
      findUnique: async (args: {
        where: {
          productionOrderExternalId_externalSalesOrderItemId: {
            productionOrderExternalId: number;
            externalSalesOrderItemId: number;
          };
        };
        select?: Record<string, boolean>;
      }) => {
        const key = linkMapKey(
          args.where.productionOrderExternalId_externalSalesOrderItemId
            .productionOrderExternalId,
          args.where.productionOrderExternalId_externalSalesOrderItemId
            .externalSalesOrderItemId
        );
        const row = links.get(key) ?? null;
        if (!row) return null;
        if (!args.select) return { ...row };
        const picked: Record<string, unknown> = {};
        for (const k of Object.keys(args.select)) {
          if (args.select[k]) picked[k] = (row as Record<string, unknown>)[k];
        }
        return picked;
      },
      create: async (args: { data: Record<string, unknown> }) => {
        const id = `link-${++linkSeq}`;
        const now = new Date();
        const row: LinkRow = {
          id,
          productionOrderId: args.data.productionOrderId as string,
          productionOrderExternalId: args.data.productionOrderExternalId as number,
          externalSalesOrderId: args.data.externalSalesOrderId as number,
          externalSalesOrderItemId: args.data.externalSalesOrderItemId as number,
          itemNumber: (args.data.itemNumber as string | null) ?? null,
          customerName: (args.data.customerName as string | null) ?? null,
          linkedQuantity: (args.data.linkedQuantity as Prisma.Decimal | null) ?? null,
          rawJson: args.data.rawJson,
          salesOrderId: (args.data.salesOrderId as string | null) ?? null,
          salesOrderItemId: (args.data.salesOrderItemId as string | null) ?? null,
          isCurrent: (args.data.isCurrent as boolean) ?? true,
          removedAt: (args.data.removedAt as Date | null) ?? null,
          firstSeenAt: (args.data.firstSeenAt as Date) ?? now,
          lastSeenAt: (args.data.lastSeenAt as Date) ?? now,
          updatedAt: now,
        };
        links.set(
          linkMapKey(row.productionOrderExternalId, row.externalSalesOrderItemId),
          row
        );
        return row;
      },
      update: async (args: { where: { id: string }; data: Record<string, unknown> }) => {
        for (const [key, row] of links) {
          if (row.id !== args.where.id) continue;
          const next: LinkRow = {
            ...row,
            ...args.data,
            updatedAt: new Date(),
          } as LinkRow;
          links.set(key, next);
          return next;
        }
        throw new Error(`link ${args.where.id} not found`);
      },
      updateMany: async (args: {
        where: {
          productionOrderId: string;
          isCurrent?: boolean;
          externalSalesOrderItemId?: { notIn: number[] };
        };
        data: Record<string, unknown>;
      }) => {
        let count = 0;
        for (const [key, row] of links) {
          if (row.productionOrderId !== args.where.productionOrderId) continue;
          if (args.where.isCurrent != null && row.isCurrent !== args.where.isCurrent) continue;
          const notIn = args.where.externalSalesOrderItemId?.notIn;
          if (notIn && notIn.includes(row.externalSalesOrderItemId)) continue;
          links.set(key, { ...row, ...args.data, updatedAt: new Date() } as LinkRow);
          count += 1;
        }
        return { count };
      },
      findMany: async (args: {
        where: {
          OR?: Array<Record<string, unknown>>;
          productionOrderExternalId?: { in: number[] };
          externalSalesOrderId?: { in: number[] };
        };
        select?: Record<string, boolean>;
        take?: number;
        orderBy?: unknown;
      }) => {
        let rows = [...links.values()];
        if (args.where.OR) {
          rows = rows.filter(
            (row) => row.salesOrderId == null || row.salesOrderItemId == null
          );
        }
        if (args.where.productionOrderExternalId?.in) {
          rows = rows.filter((row) =>
            args.where.productionOrderExternalId!.in.includes(row.productionOrderExternalId)
          );
        }
        if (args.where.externalSalesOrderId?.in) {
          rows = rows.filter((row) =>
            args.where.externalSalesOrderId!.in.includes(row.externalSalesOrderId)
          );
        }
        if (args.take != null) rows = rows.slice(0, args.take);
        return rows.map((row) => {
          if (!args.select) return { ...row };
          const picked: Record<string, unknown> = {};
          for (const k of Object.keys(args.select)) {
            if (args.select[k]) picked[k] = (row as Record<string, unknown>)[k];
          }
          return picked;
        });
      },
    },
    __links: links,
    /** Permite “aparecer” pedido/item local depois (resolução posterior). */
    __addSalesOrder(order: { id: string; externalSalesOrderId: number }) {
      salesOrders.push(order);
    },
    __addSalesOrderItem(item: {
      id: string;
      salesOrderId: string;
      nomusItemExternalId: number;
    }) {
      salesOrderItems.push(item);
    },
  };

  return db;
}

function mappedLink(raw: unknown) {
  const link = mapNomusProductionOrderSalesLink(raw);
  assert.ok(link);
  return link!;
}

describe("mapNomusProductionOrderSalesLink — campos oficiais", () => {
  it("mapeia idPedido/id/item/nomeCliente/quantidade (OP 05800)", () => {
    const link = mappedLink({
      id: 11324,
      idPedido: 2530,
      item: "00010",
      nomeCliente: "Esmaltec S/A",
      quantidade: "15.000",
    });
    assert.equal(link.externalSalesOrderId, 2530);
    assert.equal(link.externalSalesOrderItemId, 11324);
    assert.equal(link.itemNumber, "00010");
    assert.equal(link.customerName, "Esmaltec S/A");
    assert.ok(link.linkedQuantity?.equals(new Prisma.Decimal(15000)));
  });

  it("não inventa vínculo sem idPedido/id oficiais", () => {
    assert.equal(mapNomusProductionOrderSalesLink({ nomeCliente: "X", quantidade: "1" }), null);
    assert.equal(mapNomusProductionOrderSalesLink({ idPedido: 2530 }), null);
    assert.equal(mapNomusProductionOrderSalesLink({ id: 11324 }), null);
  });
});

describe("syncNomusProductionOrderSalesLinks", () => {
  it("um vínculo — preserva externo sem pedido local", async () => {
    const db = createLinkDb();
    const syncedAt = new Date("2026-07-16T12:00:00.000Z");
    const result = await syncNomusProductionOrderSalesLinks(db as never, {
      productionOrderId: "op-1",
      productionOrderExternalId: 30347,
      salesLinks: [
        mappedLink({
          id: 11324,
          idPedido: 2530,
          item: "00010",
          nomeCliente: "Esmaltec S/A",
          quantidade: "15.000",
        }),
      ],
      syncedAt,
    });
    assert.equal(result.linksCreated, 1);
    assert.equal(result.salesOrderResolved, 0);
    assert.equal(result.salesOrderItemResolved, 0);
    const row = db.__links.get(linkMapKey(30347, 11324))!;
    assert.equal(row.externalSalesOrderId, 2530);
    assert.equal(row.externalSalesOrderItemId, 11324);
    assert.equal(row.salesOrderId, null);
    assert.equal(row.salesOrderItemId, null);
    assert.equal(row.isCurrent, true);
  });

  it("vários vínculos na mesma OP", async () => {
    const db = createLinkDb({
      salesOrders: [{ id: "so-1", externalSalesOrderId: 10 }],
      salesOrderItems: [
        { id: "soi-1", salesOrderId: "so-1", nomusItemExternalId: 100 },
        { id: "soi-2", salesOrderId: "so-1", nomusItemExternalId: 200 },
      ],
    });
    const result = await syncNomusProductionOrderSalesLinks(db as never, {
      productionOrderId: "op-1",
      productionOrderExternalId: 1,
      salesLinks: [
        mappedLink({ id: 100, idPedido: 10, item: "1", quantidade: "1.000" }),
        mappedLink({ id: 200, idPedido: 10, item: "2", quantidade: "2.000" }),
      ],
      syncedAt: new Date(),
    });
    assert.equal(result.linksCreated, 2);
    assert.equal(result.salesOrderResolved, 2);
    assert.equal(result.salesOrderItemResolved, 2);
    assert.equal(db.__links.size, 2);
  });

  it("OP sem vínculo marca ausentes e não cria linhas", async () => {
    const db = createLinkDb();
    // seed previous current link
    await syncNomusProductionOrderSalesLinks(db as never, {
      productionOrderId: "op-1",
      productionOrderExternalId: 1,
      salesLinks: [mappedLink({ id: 100, idPedido: 10, item: "1", quantidade: "1" })],
      syncedAt: new Date("2026-01-01T00:00:00.000Z"),
    });
    const removedAt = new Date("2026-02-01T00:00:00.000Z");
    const result = await syncNomusProductionOrderSalesLinks(db as never, {
      productionOrderId: "op-1",
      productionOrderExternalId: 1,
      salesLinks: [],
      syncedAt: removedAt,
    });
    assert.equal(result.linksCreated, 0);
    assert.equal(result.linksMarkedAbsent, 1);
    const row = db.__links.get(linkMapKey(1, 100))!;
    assert.equal(row.isCurrent, false);
    assert.equal(row.removedAt?.toISOString(), removedAt.toISOString());
  });

  it("pedido inexistente localmente preserva vínculo externo", async () => {
    const db = createLinkDb();
    await syncNomusProductionOrderSalesLinks(db as never, {
      productionOrderId: "op-1",
      productionOrderExternalId: 1,
      salesLinks: [mappedLink({ id: 11324, idPedido: 2530, item: "00010", quantidade: "15.000" })],
      syncedAt: new Date(),
    });
    const row = db.__links.get(linkMapKey(1, 11324))!;
    assert.equal(row.externalSalesOrderId, 2530);
    assert.equal(row.salesOrderId, null);
  });

  it("item inexistente localmente preserva vínculo externo", async () => {
    const db = createLinkDb({
      salesOrders: [{ id: "so-2530", externalSalesOrderId: 2530 }],
    });
    await syncNomusProductionOrderSalesLinks(db as never, {
      productionOrderId: "op-1",
      productionOrderExternalId: 30347,
      salesLinks: [mappedLink({ id: 11324, idPedido: 2530, item: "00010", quantidade: "15.000" })],
      syncedAt: new Date(),
    });
    const row = db.__links.get(linkMapKey(30347, 11324))!;
    assert.equal(row.salesOrderId, "so-2530");
    assert.equal(row.salesOrderItemId, null);
  });

  it("resolução posterior via reconcilePending", async () => {
    const db = createLinkDb();
    await syncNomusProductionOrderSalesLinks(db as never, {
      productionOrderId: "op-1",
      productionOrderExternalId: 30347,
      salesLinks: [mappedLink({ id: 11324, idPedido: 2530, item: "00010", quantidade: "15.000" })],
      syncedAt: new Date(),
    });
    assert.equal(db.__links.get(linkMapKey(30347, 11324))!.salesOrderId, null);

    db.__addSalesOrder({ id: "so-2530", externalSalesOrderId: 2530 });
    db.__addSalesOrderItem({
      id: "soi-11324",
      salesOrderId: "so-2530",
      nomusItemExternalId: 11324,
    });

    const reconciled = await reconcilePendingNomusProductionOrderSalesLinks(db as never, {
      externalSalesOrderIds: [2530],
    });
    assert.equal(reconciled.updated, 1);
    assert.equal(reconciled.salesOrderResolved, 1);
    assert.equal(reconciled.salesOrderItemResolved, 1);
    const row = db.__links.get(linkMapKey(30347, 11324))!;
    assert.equal(row.salesOrderId, "so-2530");
    assert.equal(row.salesOrderItemId, "soi-11324");
  });

  it("vínculo removido → isCurrent=false + removedAt (sem delete)", async () => {
    const db = createLinkDb();
    await syncNomusProductionOrderSalesLinks(db as never, {
      productionOrderId: "op-1",
      productionOrderExternalId: 1,
      salesLinks: [
        mappedLink({ id: 100, idPedido: 10, item: "1", quantidade: "1" }),
        mappedLink({ id: 200, idPedido: 10, item: "2", quantidade: "2" }),
      ],
      syncedAt: new Date("2026-01-01T00:00:00.000Z"),
    });
    const removedAt = new Date("2026-03-01T00:00:00.000Z");
    const result = await syncNomusProductionOrderSalesLinks(db as never, {
      productionOrderId: "op-1",
      productionOrderExternalId: 1,
      salesLinks: [mappedLink({ id: 100, idPedido: 10, item: "1", quantidade: "1" })],
      syncedAt: removedAt,
    });
    assert.equal(result.linksMarkedAbsent, 1);
    assert.equal(db.__links.size, 2);
    assert.equal(db.__links.get(linkMapKey(1, 200))!.isCurrent, false);
    assert.equal(db.__links.get(linkMapKey(1, 200))!.removedAt?.toISOString(), removedAt.toISOString());
    assert.equal(db.__links.get(linkMapKey(1, 100))!.isCurrent, true);
  });

  it("vínculo reativado limpa removedAt", async () => {
    const db = createLinkDb();
    await syncNomusProductionOrderSalesLinks(db as never, {
      productionOrderId: "op-1",
      productionOrderExternalId: 1,
      salesLinks: [mappedLink({ id: 100, idPedido: 10, item: "1", quantidade: "1" })],
      syncedAt: new Date("2026-01-01T00:00:00.000Z"),
    });
    await syncNomusProductionOrderSalesLinks(db as never, {
      productionOrderId: "op-1",
      productionOrderExternalId: 1,
      salesLinks: [],
      syncedAt: new Date("2026-02-01T00:00:00.000Z"),
    });
    assert.equal(db.__links.get(linkMapKey(1, 100))!.isCurrent, false);

    const reappearAt = new Date("2026-03-01T00:00:00.000Z");
    const result = await syncNomusProductionOrderSalesLinks(db as never, {
      productionOrderId: "op-1",
      productionOrderExternalId: 1,
      salesLinks: [mappedLink({ id: 100, idPedido: 10, item: "1", quantidade: "9.000" })],
      syncedAt: reappearAt,
    });
    assert.equal(result.linksReactivated, 1);
    const row = db.__links.get(linkMapKey(1, 100))!;
    assert.equal(row.isCurrent, true);
    assert.equal(row.removedAt, null);
    assert.equal(row.lastSeenAt.toISOString(), reappearAt.toISOString());
    assert.ok(row.linkedQuantity?.equals(new Prisma.Decimal(9000)));
  });

  it("várias OPs no mesmo item de pedido", async () => {
    const db = createLinkDb({
      salesOrders: [{ id: "so-1", externalSalesOrderId: 2530 }],
      salesOrderItems: [
        { id: "soi-11324", salesOrderId: "so-1", nomusItemExternalId: 11324 },
      ],
    });
    await syncNomusProductionOrderSalesLinks(db as never, {
      productionOrderId: "op-a",
      productionOrderExternalId: 30347,
      salesLinks: [mappedLink({ id: 11324, idPedido: 2530, item: "00010", quantidade: "15.000" })],
      syncedAt: new Date(),
    });
    await syncNomusProductionOrderSalesLinks(db as never, {
      productionOrderId: "op-b",
      productionOrderExternalId: 30348,
      salesLinks: [mappedLink({ id: 11324, idPedido: 2530, item: "00010", quantidade: "5.000" })],
      syncedAt: new Date(),
    });
    assert.equal(db.__links.size, 2);
    assert.equal(db.__links.get(linkMapKey(30347, 11324))!.salesOrderItemId, "soi-11324");
    assert.equal(db.__links.get(linkMapKey(30348, 11324))!.salesOrderItemId, "soi-11324");
    assert.notEqual(
      db.__links.get(linkMapKey(30347, 11324))!.id,
      db.__links.get(linkMapKey(30348, 11324))!.id
    );
  });
});

describe("persist OP 05800 - 003 vínculo oficial", () => {
  it("persiste externalSalesOrderId 2530 e externalSalesOrderItemId 11324", async () => {
    const opStore = new Map<number, { id: string; payloadHash: string }>();
    const db = createLinkDb({
      salesOrders: [{ id: "so-2530", externalSalesOrderId: 2530 }],
      salesOrderItems: [
        { id: "soi-11324", salesOrderId: "so-2530", nomusItemExternalId: 11324 },
      ],
    });

    const prisma = {
      ...db,
      nomusProductionOrder: {
        findUnique: async (args: { where: { externalId: number } }) => {
          const row = opStore.get(args.where.externalId);
          return row ? { id: row.id, payloadHash: row.payloadHash } : null;
        },
        create: async (args: { data: { externalId: number; payloadHash: string } }) => {
          const id = "op-30347";
          opStore.set(args.data.externalId, {
            id,
            payloadHash: args.data.payloadHash,
          });
          return { id };
        },
        update: async () => ({ id: "op-30347" }),
      },
      $transaction: async <T>(fn: (tx: typeof prisma) => Promise<T>) => fn(prisma),
    };

    const mapped = mapNomusProductionOrderForPersist(NOMUS_PRODUCTION_ORDER_OP_05800_FIXTURE);
    assert.equal(mapped.ok, true);
    if (!mapped.ok) return;
    assert.equal(mapped.row.salesLinks[0]!.externalSalesOrderId, 2530);
    assert.equal(mapped.row.salesLinks[0]!.externalSalesOrderItemId, 11324);

    const result = await persistNomusProductionOrder(prisma as never, NOMUS_PRODUCTION_ORDER_OP_05800_FIXTURE);
    assert.equal(result.outcome, "created");
    assert.equal(result.links?.linksCreated, 1);
    assert.equal(result.links?.salesOrderResolved, 1);
    assert.equal(result.links?.salesOrderItemResolved, 1);
    const link = db.__links.get(linkMapKey(30347, 11324))!;
    assert.equal(link.externalSalesOrderId, 2530);
    assert.equal(link.externalSalesOrderItemId, 11324);
    assert.equal(link.salesOrderId, "so-2530");
    assert.equal(link.salesOrderItemId, "soi-11324");
    assert.equal(link.itemNumber, "00010");
    assert.ok(link.linkedQuantity?.equals(new Prisma.Decimal(15000)));
  });
});
