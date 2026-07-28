import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { enqueueMaterialStockSpreadsheetMirror } from "./enqueue.server.js";
import { MATERIAL_STOCK_SPREADSHEET_MIRROR_ACTIVE_STATUSES } from "./types.js";

function createDb() {
  const material = {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    code: "MP-1",
    description: "Aço",
    unit: "kg",
    quantity: 42,
    contingencyQuantity: 5,
    minimumQuantity: 10,
    recommendedQuantity: 20,
    lastStockConferenceAt: new Date("2026-07-28T10:00:00.000Z"),
    stockConferenceVersion: 4,
    status: "ACTIVE",
  };
  const outbox: Array<Record<string, unknown>> = [];

  const api = {
    material: {
      async findUnique() {
        return { ...material };
      },
    },
    materialStockSpreadsheetOutbox: {
      async findFirst(args: {
        where: { deduplicationKey: string; status: { in: string[] } };
      }) {
        return (
          outbox.find(
            (r) =>
              r.deduplicationKey === args.where.deduplicationKey &&
              (args.where.status.in as string[]).includes(String(r.status))
          ) ?? null
        );
      },
      async create({ data }: { data: Record<string, unknown> }) {
        const row = {
          ...data,
          id: data.id ?? "outbox-1",
          createdAt: new Date(),
          updatedAt: new Date(),
          attempts: 0,
          lastAttemptAt: null,
          lockedAt: null,
          lockedBy: null,
          lockToken: null,
          lastErrorCode: null,
          lastErrorMessage: null,
          syncedAt: null,
        };
        outbox.push(row);
        return row;
      },
      async update({
        where,
        data,
      }: {
        where: { id: string };
        data: Record<string, unknown>;
      }) {
        const row = outbox.find((r) => r.id === where.id)!;
        Object.assign(row, data, { updatedAt: new Date() });
        return { ...row };
      },
    },
    getOutbox: () => outbox,
    getMaterialQty: () => material.quantity,
  };
  return api;
}

describe("enqueueMaterialStockSpreadsheetMirror", () => {
  it("cria evento PENDING após alteração e colapsa concorrentes do mesmo material", async () => {
    const db = createDb();
    const first = await enqueueMaterialStockSpreadsheetMirror(db as any, {
      materialId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      eventType: "CONFERENCE",
    });
    assert.equal(first.ok, true);
    if (!first.ok) return;
    assert.equal(db.getOutbox().length, 1);
    assert.equal(db.getOutbox()[0].status, "PENDING");
    assert.ok(
      MATERIAL_STOCK_SPREADSHEET_MIRROR_ACTIVE_STATUSES.includes("PENDING")
    );

    const second = await enqueueMaterialStockSpreadsheetMirror(db as any, {
      materialId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      eventType: "LEVELS_UPDATE",
    });
    assert.equal(second.ok, true);
    if (!second.ok) return;
    assert.equal(second.deduplicated, true);
    assert.equal(db.getOutbox().length, 1);
    assert.equal(db.getOutbox()[0].eventType, "LEVELS_UPDATE");
    assert.equal(db.getMaterialQty(), 42);
  });

  it("payload enfileirado não contém custos", async () => {
    const db = createDb();
    await enqueueMaterialStockSpreadsheetMirror(db as any, {
      materialId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      eventType: "MATERIAL_MASTER",
    });
    const payload = JSON.stringify(db.getOutbox()[0].payloadJson);
    assert.doesNotMatch(payload, /currentCost|averageCost|standardCost|freight/);
    assert.match(payload, /"code":"MP-1"/);
    assert.match(payload, /"operation":"UPSERT"/);
  });
});
