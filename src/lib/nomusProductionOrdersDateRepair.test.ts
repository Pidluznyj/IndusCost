/**
 * Persistência idempotente do reparo de datas (OP-14.1) — memória.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { NOMUS_PRODUCTION_ORDER_OP_05800_FIXTURE } from "@/src/lib/fixtures/nomusProductionOrderOp05800.js";
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
};

function createMemoryDb(initial: Stored[]) {
  const store = new Map(initial.map((row) => [row.id, { ...row }]));
  const updates: Array<{ id: string; dataKeys: string[] }> = [];

  return {
    updates,
    store,
    nomusProductionOrder: {
      findMany: async (args: {
        where?: { externalId?: number; AND?: unknown };
        select?: Record<string, boolean>;
        orderBy?: unknown;
        skip?: number;
        take?: number;
      }) => {
        let rows = [...store.values()];
        if (args.where?.externalId != null) {
          rows = rows.filter((r) => r.externalId === args.where!.externalId);
        }
        rows.sort((a, b) => a.externalId - b.externalId);
        if (args.skip) rows = rows.slice(args.skip);
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
      update: async (args: { where: { id: string }; data: Record<string, unknown>; select?: unknown }) => {
        const row = store.get(args.where.id);
        if (!row) throw new Error("not found");
        updates.push({ id: args.where.id, dataKeys: Object.keys(args.data) });
        Object.assign(row, args.data);
        return { id: row.id };
      },
    },
  };
}

describe("OP-14.1 — reparo persistência idempotente", () => {
  it("apply preenche datas e segunda execução não duplica alteração", async () => {
    const syncedAt = new Date("2026-07-01T12:00:00.000Z");
    const db = createMemoryDb([
      {
        id: "op-1",
        externalId: 30347,
        name: "OP 05800 - 003",
        status: "Encerrada",
        rawJson: NOMUS_PRODUCTION_ORDER_OP_05800_FIXTURE,
        openedAt: null,
        releasedAt: null,
        plannedAt: null,
        deliveryAt: null,
        closedAt: null,
        nomusUpdatedAt: null,
        payloadHash: "abc",
        firstSeenAt: syncedAt,
        lastSeenAt: syncedAt,
        lastChangedAt: syncedAt,
        syncedAt,
      },
    ]);

    const first = await runProductionOrderDateRepairFromRawJson(db as never, {
      mode: "apply",
      limit: null,
      offset: 0,
      externalId: null,
      onlyNullDates: true,
    });
    assert.equal(first.counters.scanned, 1);
    assert.equal(first.counters.updated, 1);
    assert.equal(db.updates.length, 1);
    assert.deepEqual(db.updates[0]!.dataKeys.sort(), [
      "closedAt",
      "deliveryAt",
      "nomusUpdatedAt",
      "openedAt",
      "plannedAt",
      "releasedAt",
    ]);

    const row = db.store.get("op-1")!;
    assert.ok(row.openedAt);
    assert.ok(row.releasedAt);
    assert.ok(row.deliveryAt);
    assert.equal(row.closedAt, null);
    assert.equal(row.payloadHash, "abc");
    assert.equal(row.syncedAt.toISOString(), syncedAt.toISOString());
    assert.equal(row.lastChangedAt.toISOString(), syncedAt.toISOString());
    assert.equal(row.rawJson, NOMUS_PRODUCTION_ORDER_OP_05800_FIXTURE);

    const second = await runProductionOrderDateRepairFromRawJson(db as never, {
      mode: "apply",
      limit: null,
      offset: 0,
      externalId: null,
      onlyNullDates: false,
    });
    assert.equal(second.counters.updated, 0);
    assert.equal(second.counters.unchanged, 1);
    assert.equal(db.updates.length, 1);
  });
});
