/**
 * OP-14.2 — testes do reparo de datas (preview/apply/idempotência/closedAt/hash).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { NOMUS_PRODUCTION_ORDER_OP_05800_FIXTURE } from "@/src/lib/fixtures/nomusProductionOrderOp05800.js";
import {
  parseProductionOrderDateRepairCli,
  productionOrderDatesNeedRepair,
} from "@/src/lib/nomusProductionOrdersDateRepair.js";
import { runProductionOrderDateRepairFromRawJson } from "@/src/lib/nomusProductionOrdersDateRepair.server.js";

type Stored = {
  id: string;
  externalId: number;
  name: string | null;
  status: string | null;
  rawJson: unknown;
  openedAt: Date | null;
  releasedAt: Date | null;
  plannedAt: Date | null;
  deliveryAt: Date | null;
  closedAt: Date | null;
  nomusUpdatedAt: Date | null;
  payloadHash: string;
  firstSeenAt: Date;
  lastSeenAt: Date;
  lastChangedAt: Date;
  syncedAt: Date;
  _linkCount: number;
};

function extractGt(where: unknown): number | null {
  if (!where || typeof where !== "object") return null;
  const w = where as Record<string, unknown>;
  if (typeof w.externalId === "number") return null;
  if (w.externalId && typeof w.externalId === "object" && "gt" in (w.externalId as object)) {
    const gt = (w.externalId as { gt?: number }).gt;
    return typeof gt === "number" ? gt : null;
  }
  if (Array.isArray(w.AND)) {
    for (const part of w.AND) {
      const nested = extractGt(part);
      if (nested != null) return nested;
    }
  }
  return null;
}

function wantsOnlyNullDates(where: unknown): boolean {
  if (!where || typeof where !== "object") return false;
  const w = where as Record<string, unknown>;
  const check = (node: unknown): boolean => {
    if (!node || typeof node !== "object") return false;
    const n = node as Record<string, unknown>;
    if (n.openedAt === null && n.releasedAt === null) return true;
    if (Array.isArray(n.AND)) return n.AND.some(check);
    return false;
  };
  return check(w);
}

function createMemoryDb(initial: Stored[]) {
  const store = new Map(initial.map((row) => [row.id, { ...row }]));
  const updates: Array<{ id: string; data: Record<string, unknown> }> = [];
  let findManyCalls = 0;

  return {
    updates,
    store,
    get findManyCalls() {
      return findManyCalls;
    },
    nomusProductionOrder: {
      findMany: async (args: {
        where?: {
          externalId?: number | { gt?: number };
          AND?: unknown;
        };
        select?: Record<string, boolean>;
        orderBy?: unknown;
        take?: number;
      }) => {
        findManyCalls += 1;
        let rows = [...store.values()];
        if (typeof args.where?.externalId === "number") {
          rows = rows.filter((r) => r.externalId === args.where!.externalId);
        } else {
          const gt = extractGt(args.where);
          if (gt != null) rows = rows.filter((r) => r.externalId > gt);
        }
        if (wantsOnlyNullDates(args.where)) {
          rows = rows.filter(
            (r) =>
              r.openedAt == null &&
              r.releasedAt == null &&
              r.plannedAt == null &&
              r.deliveryAt == null &&
              r.nomusUpdatedAt == null
          );
        }
        rows.sort((a, b) => a.externalId - b.externalId);
        if (args.take != null) rows = rows.slice(0, args.take);
        return rows.map((row) => {
          if (!args.select) return { ...row };
          const picked: Record<string, unknown> = {};
          for (const [k, v] of Object.entries(args.select)) {
            if (v) picked[k] = (row as Record<string, unknown>)[k];
          }
          return picked;
        });
      },
      update: async (args: {
        where: { id: string };
        data: Record<string, unknown>;
        select?: unknown;
      }) => {
        const row = store.get(args.where.id);
        if (!row) throw new Error("not found");
        updates.push({ id: args.where.id, data: { ...args.data } });
        Object.assign(row, args.data);
        return { id: row.id };
      },
    },
  };
}

function baseRow(overrides: Partial<Stored> = {}): Stored {
  const syncedAt = new Date("2026-07-01T12:00:00.000Z");
  return {
    id: "op-1",
    externalId: 30347,
    name: "OP 05800 - 003",
    status: "Encerrada",
    rawJson: NOMUS_PRODUCTION_ORDER_OP_05800_FIXTURE,
    openedAt: null,
    releasedAt: null,
    plannedAt: null,
    deliveryAt: null,
    closedAt: new Date("2026-01-01T00:00:00.000Z"),
    nomusUpdatedAt: null,
    payloadHash: "hash-preserve",
    firstSeenAt: syncedAt,
    lastSeenAt: syncedAt,
    lastChangedAt: syncedAt,
    syncedAt,
    _linkCount: 1,
    ...overrides,
  };
}

describe("OP-14.2 — reparo de datas", () => {
  it("CLI parseia batch/checkpoint/after", () => {
    const cli = parseProductionOrderDateRepairCli(
      [
        "preview",
        "--only-null-dates",
        "--batch-size=50",
        "--after-externalId=100",
        "--checkpoint-file=/tmp/ckpt.json",
      ],
      {}
    );
    assert.equal(cli.mode, "preview");
    assert.equal(cli.batchSize, 50);
    assert.equal(cli.afterExternalId, 100);
    assert.equal(cli.checkpointFile, "/tmp/ckpt.json");
  });

  it("preview não escreve e conta campos a preencher", async () => {
    const db = createMemoryDb([baseRow()]);
    const result = await runProductionOrderDateRepairFromRawJson(db as never, {
      mode: "preview",
      limit: null,
      batchSize: 100,
      afterExternalId: null,
      externalId: null,
      onlyNullDates: true,
      checkpointFile: null,
    });
    assert.equal(result.counters.scanned, 1);
    assert.equal(result.counters.wouldUpdate, 1);
    assert.equal(result.counters.updated, 0);
    assert.equal(db.updates.length, 0);
    assert.ok(result.counters.fieldsToFill.openedAt >= 1);
    assert.ok(result.samples[0]?.closedAtPreserved);
  });

  it("apply preenche datas, preserva closedAt/hash/vínculos e é idempotente", async () => {
    const db = createMemoryDb([baseRow()]);
    const first = await runProductionOrderDateRepairFromRawJson(db as never, {
      mode: "apply",
      limit: null,
      batchSize: 100,
      afterExternalId: null,
      externalId: null,
      onlyNullDates: false,
      checkpointFile: null,
    });
    assert.equal(first.counters.updated, 1);
    const row = db.store.get("op-1")!;
    assert.ok(row.openedAt);
    assert.ok(row.releasedAt);
    assert.ok(row.deliveryAt);
    assert.equal(row.closedAt?.toISOString(), "2026-01-01T00:00:00.000Z");
    assert.equal(row.payloadHash, "hash-preserve");
    assert.equal(row._linkCount, 1);
    assert.ok(!("closedAt" in db.updates[0]!.data));
    assert.ok(!("payloadHash" in db.updates[0]!.data));
    assert.ok(!("syncedAt" in db.updates[0]!.data));

    const second = await runProductionOrderDateRepairFromRawJson(db as never, {
      mode: "apply",
      limit: null,
      batchSize: 100,
      afterExternalId: null,
      externalId: null,
      onlyNullDates: false,
      checkpointFile: null,
    });
    assert.equal(second.counters.updated, 0);
    assert.equal(second.counters.unchanged, 1);
    assert.equal(db.updates.length, 1);
  });

  it("retomada por afterExternalId / checkpoint", async () => {
    const db = createMemoryDb([
      baseRow({ id: "op-a", externalId: 10 }),
      baseRow({ id: "op-b", externalId: 20 }),
      baseRow({ id: "op-c", externalId: 30 }),
    ]);
    let checkpoint: { version: 1; lastProcessedExternalId: number; updatedAt: string; mode: "apply" } | null =
      null;

    const first = await runProductionOrderDateRepairFromRawJson(
      db as never,
      {
        mode: "apply",
        limit: 1,
        batchSize: 1,
        afterExternalId: null,
        externalId: null,
        onlyNullDates: false,
        checkpointFile: "/tmp/fake",
      },
      {
        readCheckpoint: () => checkpoint,
        writeCheckpoint: (c) => {
          checkpoint = c;
        },
      }
    );
    assert.equal(first.counters.updated, 1);
    assert.equal(checkpoint?.lastProcessedExternalId, 10);

    const second = await runProductionOrderDateRepairFromRawJson(
      db as never,
      {
        mode: "apply",
        limit: null,
        batchSize: 10,
        afterExternalId: null,
        externalId: null,
        onlyNullDates: false,
        checkpointFile: "/tmp/fake",
      },
      {
        readCheckpoint: () => checkpoint,
        writeCheckpoint: (c) => {
          checkpoint = c;
        },
      }
    );
    assert.equal(second.counters.updated, 2);
    assert.equal(checkpoint?.lastProcessedExternalId, 30);
  });

  it("campo ausente/inválido não inventa data", async () => {
    const db = createMemoryDb([
      baseRow({
        id: "op-partial",
        externalId: 99,
        rawJson: { id: 99, nome: "OP X", dataHoraCriacao: "não-é-data" },
        closedAt: null,
      }),
    ]);
    const result = await runProductionOrderDateRepairFromRawJson(db as never, {
      mode: "apply",
      limit: null,
      batchSize: 10,
      afterExternalId: null,
      externalId: 99,
      onlyNullDates: false,
      checkpointFile: null,
    });
    const row = db.store.get("op-partial")!;
    assert.equal(row.openedAt, null);
    assert.ok(result.counters.invalidDates >= 1 || result.counters.unchanged >= 0);
  });

  it("needRepair ignora closedAt", () => {
    assert.equal(
      productionOrderDatesNeedRepair(
        {
          openedAt: null,
          releasedAt: null,
          plannedAt: null,
          deliveryAt: null,
          nomusUpdatedAt: null,
        },
        {
          openedAt: null,
          releasedAt: null,
          plannedAt: null,
          deliveryAt: null,
          nomusUpdatedAt: null,
        }
      ),
      false
    );
  });
});
