import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Prisma } from "@prisma/client";
import { NOMUS_PRODUCTION_ORDER_OP_05800_FIXTURE } from "@/src/lib/fixtures/nomusProductionOrderOp05800.js";
import { mapNomusProductionOrderHeader } from "@/src/lib/nomusProductionOrdersMapper.js";
import {
  persistNomusProductionOrder,
  persistNomusProductionOrdersBatch,
} from "@/src/lib/nomusProductionOrdersPersist.server.js";
import { upsertNomusProductionOrderHeader } from "@/src/lib/nomusProductionOrdersRepository.server.js";
import { stableNomusProductionOrderPayloadHash } from "@/src/lib/nomusProductionOrdersParsers.js";

type StoredOp = {
  id: string;
  externalId: number;
  name: string | null;
  status: string | null;
  quantity: Prisma.Decimal | null;
  rawJson: unknown;
  payloadHash: string;
  firstSeenAt: Date;
  lastSeenAt: Date;
  lastChangedAt: Date;
  syncedAt: Date;
};

function cloneFixture(overrides: Record<string, unknown> = {}) {
  return {
    ...NOMUS_PRODUCTION_ORDER_OP_05800_FIXTURE,
    ...overrides,
  };
}

function createMemoryPrisma(options?: { failExternalIds?: Set<number> }) {
  const store = new Map<number, StoredOp>();
  const linkStore = new Map<string, Record<string, unknown>>();
  let idSeq = 0;
  let linkSeq = 0;
  const failExternalIds = options?.failExternalIds ?? new Set<number>();
  const calls: Array<{ op: string; externalId?: number; dataKeys?: string[] }> = [];

  const linkKey = (productionOrderExternalId: number, externalSalesOrderItemId: number) =>
    `${productionOrderExternalId}:${externalSalesOrderItemId}`;

  const nomusProductionOrder = {
    findUnique: async (args: {
      where: { externalId: number };
      select?: Record<string, boolean>;
    }) => {
      const row = store.get(args.where.externalId) ?? null;
      calls.push({ op: "findUnique", externalId: args.where.externalId });
      if (!row) return null;
      if (!args.select) return { ...row };
      const picked: Record<string, unknown> = {};
      for (const key of Object.keys(args.select)) {
        if (args.select[key]) picked[key] = (row as Record<string, unknown>)[key];
      }
      return picked;
    },
    create: async (args: { data: Record<string, unknown>; select?: { id: boolean } }) => {
      const externalId = args.data.externalId as number;
      calls.push({ op: "create", externalId, dataKeys: Object.keys(args.data) });
      if (failExternalIds.has(externalId)) {
        throw new Error(`TRANSACIONAL_FAIL externalId=${externalId}`);
      }
      if (store.has(externalId)) {
        throw new Error(`Unique constraint failed on externalId=${externalId}`);
      }
      const id = `op-${++idSeq}`;
      const row: StoredOp = {
        id,
        externalId,
        name: (args.data.name as string | null) ?? null,
        status: (args.data.status as string | null) ?? null,
        quantity: (args.data.quantity as Prisma.Decimal | null) ?? null,
        rawJson: args.data.rawJson,
        payloadHash: args.data.payloadHash as string,
        firstSeenAt: args.data.firstSeenAt as Date,
        lastSeenAt: args.data.lastSeenAt as Date,
        lastChangedAt: args.data.lastChangedAt as Date,
        syncedAt: args.data.syncedAt as Date,
      };
      store.set(externalId, row);
      return args.select?.id ? { id } : { ...row };
    },
    update: async (args: {
      where: { externalId: number };
      data: Record<string, unknown>;
      select?: { id: boolean };
    }) => {
      const existing = store.get(args.where.externalId);
      calls.push({
        op: "update",
        externalId: args.where.externalId,
        dataKeys: Object.keys(args.data),
      });
      if (!existing) throw new Error(`OP not found ${args.where.externalId}`);
      if (failExternalIds.has(args.where.externalId)) {
        throw new Error(`TRANSACIONAL_FAIL externalId=${args.where.externalId}`);
      }
      const next: StoredOp = {
        ...existing,
        ...(args.data.name !== undefined ? { name: args.data.name as string | null } : {}),
        ...(args.data.status !== undefined
          ? { status: args.data.status as string | null }
          : {}),
        ...(args.data.quantity !== undefined
          ? { quantity: args.data.quantity as Prisma.Decimal | null }
          : {}),
        ...(args.data.rawJson !== undefined ? { rawJson: args.data.rawJson } : {}),
        ...(args.data.payloadHash !== undefined
          ? { payloadHash: args.data.payloadHash as string }
          : {}),
        ...(args.data.syncedAt !== undefined ? { syncedAt: args.data.syncedAt as Date } : {}),
        ...(args.data.lastSeenAt !== undefined
          ? { lastSeenAt: args.data.lastSeenAt as Date }
          : {}),
        ...(args.data.lastChangedAt !== undefined
          ? { lastChangedAt: args.data.lastChangedAt as Date }
          : {}),
      };
      store.set(args.where.externalId, next);
      return args.select?.id ? { id: next.id } : { ...next };
    },
  };

  const nomusProductionOrderSalesLink = {
    findUnique: async (args: {
      where: {
        productionOrderExternalId_externalSalesOrderItemId: {
          productionOrderExternalId: number;
          externalSalesOrderItemId: number;
        };
      };
      select?: Record<string, boolean>;
    }) => {
      const key = linkKey(
        args.where.productionOrderExternalId_externalSalesOrderItemId.productionOrderExternalId,
        args.where.productionOrderExternalId_externalSalesOrderItemId.externalSalesOrderItemId
      );
      const row = linkStore.get(key) ?? null;
      if (!row) return null;
      if (!args.select) return { ...row };
      const picked: Record<string, unknown> = {};
      for (const k of Object.keys(args.select)) {
        if (args.select[k]) picked[k] = row[k];
      }
      return picked;
    },
    create: async (args: { data: Record<string, unknown> }) => {
      const id = `link-${++linkSeq}`;
      const row = { id, isCurrent: true, ...args.data };
      linkStore.set(
        linkKey(
          args.data.productionOrderExternalId as number,
          args.data.externalSalesOrderItemId as number
        ),
        row
      );
      return row;
    },
    update: async (args: { where: { id: string }; data: Record<string, unknown> }) => {
      for (const [key, row] of linkStore) {
        if (row.id === args.where.id) {
          const next = { ...row, ...args.data };
          linkStore.set(key, next);
          return next;
        }
      }
      throw new Error(`link not found ${args.where.id}`);
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
      for (const [key, row] of linkStore) {
        if (row.productionOrderId !== args.where.productionOrderId) continue;
        if (args.where.isCurrent != null && row.isCurrent !== args.where.isCurrent) continue;
        const notIn = args.where.externalSalesOrderItemId?.notIn;
        if (notIn && notIn.includes(row.externalSalesOrderItemId as number)) continue;
        linkStore.set(key, { ...row, ...args.data });
        count += 1;
      }
      return { count };
    },
    findMany: async () => [...linkStore.values()],
  };

  const prisma = {
    nomusProductionOrder,
    nomusProductionOrderSalesLink,
    salesOrder: {
      findFirst: async () => null,
    },
    salesOrderItem: {
      findFirst: async () => null,
    },
    $transaction: async <T>(fn: (tx: typeof prisma) => Promise<T>) => fn(prisma),
    __store: store,
    __linkStore: linkStore,
    __calls: calls,
  };

  return prisma;
}

describe("mapNomusProductionOrderHeader", () => {
  it("converte datas/quantidades e mapeia vínculos oficiais itensPedido", () => {
    const mapped = mapNomusProductionOrderHeader(NOMUS_PRODUCTION_ORDER_OP_05800_FIXTURE);
    assert.equal(mapped.ok, true);
    if (!mapped.ok) return;
    assert.equal(mapped.row.externalId, 30347);
    assert.ok(mapped.row.quantity?.equals(new Prisma.Decimal(15400)));
    assert.ok(mapped.row.openedAt);
    assert.equal(mapped.row.salesLinks.length, 1);
    assert.equal(mapped.row.salesLinks[0]!.externalSalesOrderId, 2530);
    assert.equal(mapped.row.salesLinks[0]!.externalSalesOrderItemId, 11324);
    assert.equal(
      mapped.row.payloadHash,
      stableNomusProductionOrderPayloadHash(NOMUS_PRODUCTION_ORDER_OP_05800_FIXTURE)
    );
  });
});

describe("persistNomusProductionOrder — cabeçalho idempotente", () => {
  it("criação", async () => {
    const prisma = createMemoryPrisma();
    const syncedAt = new Date("2026-07-16T15:00:00.000Z");
    const result = await persistNomusProductionOrder(prisma as never, cloneFixture(), {
      syncedAt,
    });
    assert.equal(result.outcome, "created");
    assert.equal(result.externalId, 30347);
    assert.ok(result.productionOrderId);
    const stored = prisma.__store.get(30347)!;
    assert.equal(stored.status, "Encerrada");
    assert.ok(stored.quantity?.equals(new Prisma.Decimal(15400)));
    assert.deepEqual(stored.rawJson, cloneFixture());
    assert.equal(stored.firstSeenAt.toISOString(), syncedAt.toISOString());
    assert.equal(stored.lastChangedAt.toISOString(), syncedAt.toISOString());
  });

  it("segunda execução inalterada (sem UPDATE completo)", async () => {
    const prisma = createMemoryPrisma();
    const firstAt = new Date("2026-07-16T15:00:00.000Z");
    const secondAt = new Date("2026-07-16T16:00:00.000Z");
    await persistNomusProductionOrder(prisma as never, cloneFixture(), { syncedAt: firstAt });
    prisma.__calls.length = 0;

    const second = await persistNomusProductionOrder(prisma as never, cloneFixture(), {
      syncedAt: secondAt,
    });
    assert.equal(second.outcome, "unchanged");
    const updateCall = prisma.__calls.find((c) => c.op === "update");
    assert.ok(updateCall);
    assert.deepEqual(updateCall!.dataKeys?.sort(), ["lastSeenAt", "syncedAt"]);
    const stored = prisma.__store.get(30347)!;
    assert.equal(stored.lastChangedAt.toISOString(), firstAt.toISOString());
    assert.equal(stored.syncedAt.toISOString(), secondAt.toISOString());
    assert.equal(stored.lastSeenAt.toISOString(), secondAt.toISOString());
  });

  it("mudança de status atualiza a mesma OP", async () => {
    const prisma = createMemoryPrisma();
    await persistNomusProductionOrder(prisma as never, cloneFixture());
    const idBefore = prisma.__store.get(30347)!.id;

    const result = await persistNomusProductionOrder(
      prisma as never,
      cloneFixture({ status: "Em produção" })
    );
    assert.equal(result.outcome, "updated");
    assert.equal(prisma.__store.get(30347)!.id, idBefore);
    assert.equal(prisma.__store.get(30347)!.status, "Em produção");
    assert.equal(prisma.__store.size, 1);
  });

  it("mudança de quantidade atualiza a mesma OP", async () => {
    const prisma = createMemoryPrisma();
    await persistNomusProductionOrder(prisma as never, cloneFixture());
    const idBefore = prisma.__store.get(30347)!.id;

    const result = await persistNomusProductionOrder(
      prisma as never,
      cloneFixture({ quantidade: "30.000" })
    );
    assert.equal(result.outcome, "updated");
    assert.equal(prisma.__store.get(30347)!.id, idBefore);
    assert.ok(prisma.__store.get(30347)!.quantity?.equals(new Prisma.Decimal(30000)));
  });

  it("mudança de payload atualiza rawJson e hash", async () => {
    const prisma = createMemoryPrisma();
    await persistNomusProductionOrder(prisma as never, cloneFixture());
    const hashBefore = prisma.__store.get(30347)!.payloadHash;

    const nextPayload = cloneFixture({ prioridade: "Alta", observacaoExtra: "x" });
    const result = await persistNomusProductionOrder(prisma as never, nextPayload);
    assert.equal(result.outcome, "updated");
    assert.notEqual(prisma.__store.get(30347)!.payloadHash, hashBefore);
    assert.equal(
      prisma.__store.get(30347)!.payloadHash,
      stableNomusProductionOrderPayloadHash(nextPayload)
    );
    assert.equal(
      (prisma.__store.get(30347)!.rawJson as { observacaoExtra?: string }).observacaoExtra,
      "x"
    );
  });

  it("externalId duplicado no lote não cria segunda linha", async () => {
    const prisma = createMemoryPrisma();
    const batch = await persistNomusProductionOrdersBatch(prisma as never, [
      cloneFixture(),
      cloneFixture({ status: "Em produção" }),
    ]);
    assert.equal(batch.summary.created, 1);
    assert.equal(batch.summary.updated, 1);
    assert.equal(prisma.__store.size, 1);
    assert.equal(batch.results[0]!.productionOrderId, batch.results[1]!.productionOrderId);
    assert.equal(prisma.__store.get(30347)!.status, "Em produção");
  });

  it("payload inválido", async () => {
    const prisma = createMemoryPrisma();
    const result = await persistNomusProductionOrder(prisma as never, { nome: "sem id" });
    assert.equal(result.outcome, "invalid");
    assert.deepEqual(result.reasons, ["MISSING_EXTERNAL_ID"]);
    assert.equal(prisma.__store.size, 0);
  });

  it("falha transacional isola as demais OPs do lote", async () => {
    const prisma = createMemoryPrisma({ failExternalIds: new Set([999]) });
    const batch = await persistNomusProductionOrdersBatch(prisma as never, [
      cloneFixture({ id: 999, nome: "OP FAIL" }),
      cloneFixture({ id: 1000, nome: "OP OK", quantidade: "20" }),
    ]);
    assert.equal(batch.summary.error, 1);
    assert.equal(batch.summary.created, 1);
    assert.equal(batch.results[0]!.outcome, "error");
    assert.match(batch.results[0]!.error ?? "", /TRANSACIONAL_FAIL/);
    assert.equal(batch.results[1]!.outcome, "created");
    assert.equal(prisma.__store.has(999), false);
    assert.equal(prisma.__store.has(1000), true);
  });
});

describe("upsertNomusProductionOrderHeader", () => {
  it("nome da OP não é chave — só externalId", async () => {
    const prisma = createMemoryPrisma();
    const mappedA = mapNomusProductionOrderHeader(
      cloneFixture({ id: 1, nome: "OP A" })
    );
    const mappedB = mapNomusProductionOrderHeader(
      cloneFixture({ id: 1, nome: "OP B RENOMEADA", status: "Aberta" })
    );
    assert.equal(mappedA.ok && mappedB.ok, true);
    if (!mappedA.ok || !mappedB.ok) return;

    const first = await upsertNomusProductionOrderHeader(
      prisma as never,
      mappedA.row,
      new Date("2026-01-01T00:00:00.000Z")
    );
    const second = await upsertNomusProductionOrderHeader(
      prisma as never,
      mappedB.row,
      new Date("2026-01-02T00:00:00.000Z")
    );
    assert.equal(first.action, "create");
    assert.equal(second.action, "update");
    assert.equal(first.productionOrderId, second.productionOrderId);
    assert.equal(prisma.__store.size, 1);
    assert.equal(prisma.__store.get(1)!.name, "OP B RENOMEADA");
  });
});
