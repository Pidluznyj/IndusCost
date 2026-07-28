import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { randomUUID } from "node:crypto";
import type {
  MaterialStockSpreadsheetOutboxRepository,
  MaterialStockSpreadsheetOutboxRow,
} from "./repository.server.js";
import { runMaterialStockSpreadsheetMirrorWorker } from "./worker.server.js";
import type { MaterialStockSpreadsheetMirrorPayload } from "./types.js";

function makeRow(
  overrides: Partial<MaterialStockSpreadsheetOutboxRow> & {
    payloadJson: MaterialStockSpreadsheetMirrorPayload;
  }
): MaterialStockSpreadsheetOutboxRow {
  const now = new Date("2026-07-28T12:00:00.000Z");
  return {
    id: overrides.id ?? randomUUID(),
    materialId: overrides.materialId ?? "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    materialCode: overrides.materialCode ?? "MP-1",
    eventType: overrides.eventType ?? "CONFERENCE",
    status: overrides.status ?? "PENDING",
    deduplicationKey: overrides.deduplicationKey ?? "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    idempotencyKey: overrides.idempotencyKey ?? randomUUID(),
    payloadJson: overrides.payloadJson,
    attempts: overrides.attempts ?? 0,
    maxAttempts: overrides.maxAttempts ?? 5,
    availableAt: overrides.availableAt ?? now,
    lastAttemptAt: overrides.lastAttemptAt ?? null,
    lockedAt: overrides.lockedAt ?? null,
    lockedBy: overrides.lockedBy ?? null,
    lockToken: overrides.lockToken ?? null,
    lastErrorCode: overrides.lastErrorCode ?? null,
    lastErrorMessage: overrides.lastErrorMessage ?? null,
    syncedAt: overrides.syncedAt ?? null,
    requestId: overrides.requestId ?? null,
    createdAt: overrides.createdAt ?? now,
    updatedAt: overrides.updatedAt ?? now,
  };
}

function createMemoryRepo(seed: MaterialStockSpreadsheetOutboxRow[]) {
  const rows = seed.map((r) => ({ ...r }));
  const repo: MaterialStockSpreadsheetOutboxRepository = {
    async findActiveByDeduplicationKey() {
      return null;
    },
    async create() {
      throw new Error("unused");
    },
    async touchPending() {
      throw new Error("unused");
    },
    async claimNext(workerId, now) {
      const idx = rows.findIndex(
        (r) => r.status === "PENDING" && r.availableAt.getTime() <= now.getTime()
      );
      if (idx < 0) return null;
      const row = rows[idx];
      row.status = "PROCESSING";
      row.attempts += 1;
      row.lastAttemptAt = now;
      row.lockedAt = now;
      row.lockedBy = workerId;
      row.lockToken = randomUUID();
      return { ...row };
    },
    async markSynced(id, lockToken, syncedAt) {
      const row = rows.find((r) => r.id === id)!;
      assert.equal(row.lockToken, lockToken);
      row.status = "SYNCED";
      row.syncedAt = syncedAt;
      row.lockToken = null;
      return { ...row };
    },
    async markRetry(id, lockToken, input) {
      const row = rows.find((r) => r.id === id)!;
      assert.equal(row.lockToken, lockToken);
      row.status = "PENDING";
      row.attempts = input.attempts;
      row.availableAt = input.availableAt;
      row.lastAttemptAt = input.lastAttemptAt;
      row.lastErrorCode = input.error.code;
      row.lastErrorMessage = input.error.message;
      row.lockToken = null;
      return { ...row };
    },
    async markError(id, lockToken, input) {
      const row = rows.find((r) => r.id === id)!;
      assert.equal(row.lockToken, lockToken);
      row.status = "ERROR";
      row.attempts = input.attempts;
      row.lastAttemptAt = input.lastAttemptAt;
      row.lastErrorCode = input.error.code;
      row.lastErrorMessage = input.error.message;
      row.lockToken = null;
      return { ...row };
    },
    async requeue() {
      return null;
    },
    async list() {
      return { rows: [...rows], total: rows.length };
    },
    async findLatestSynced() {
      return null;
    },
  };
  return { repo, rows };
}

const payload: MaterialStockSpreadsheetMirrorPayload = {
  operation: "UPSERT",
  eventId: "e1",
  idempotencyKey: "i1",
  eventType: "CONFERENCE",
  occurredAt: "2026-07-28T12:00:00.000Z",
  materialId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  code: "MP-1",
  description: "Aço",
  unit: "kg",
  currentQuantity: 10,
  contingencyQuantity: null,
  minimumQuantity: null,
  recommendedQuantity: null,
  lastStockConferenceAt: null,
  stockConferenceVersion: 2,
  materialStatus: "ACTIVE",
};

const enabledConfig = {
  enabled: true,
  webhookUrl: "https://prod.westus.logic.azure.com/workflows/x",
  webhookSecret: "secret",
  allowedHosts: ["logic.azure.com"],
  httpTimeoutMs: 1000,
  maxAttempts: 5,
  workerIntervalMs: 5000,
  workerBatchSize: 5,
};

describe("runMaterialStockSpreadsheetMirrorWorker", () => {
  it("marca SYNCED em sucesso externo", async () => {
    const { repo, rows } = createMemoryRepo([
      makeRow({ payloadJson: payload }),
    ]);
    const result = await runMaterialStockSpreadsheetMirrorWorker({
      repository: repo,
      workerId: "w1",
      config: enabledConfig,
      fetchImpl: async () => new Response("ok", { status: 200 }),
      now: () => new Date("2026-07-28T12:00:00.000Z"),
    });
    assert.equal(result.synced, 1);
    assert.equal(rows[0].status, "SYNCED");
  });

  it("retry em falha externa retryable; ERROR quando esgota", async () => {
    const { repo, rows } = createMemoryRepo([
      makeRow({ payloadJson: payload, maxAttempts: 2 }),
    ]);
    const r1 = await runMaterialStockSpreadsheetMirrorWorker({
      repository: repo,
      workerId: "w1",
      config: enabledConfig,
      fetchImpl: async () => new Response("fail", { status: 500 }),
      now: () => new Date("2026-07-28T12:00:00.000Z"),
    });
    assert.equal(r1.retried, 1);
    assert.equal(rows[0].status, "PENDING");

    rows[0].availableAt = new Date("2026-07-28T12:00:00.000Z");
    const r2 = await runMaterialStockSpreadsheetMirrorWorker({
      repository: repo,
      workerId: "w1",
      config: enabledConfig,
      fetchImpl: async () => new Response("fail", { status: 500 }),
      now: () => new Date("2026-07-28T12:00:00.000Z"),
    });
    assert.equal(r2.errored, 1);
    assert.equal(rows[0].status, "ERROR");
  });

  it("erro de config (segredo) marca ERROR sem retry infinito", async () => {
    const prevEnabled = process.env.MATERIAL_STOCK_SPREADSHEET_MIRROR_ENABLED;
    const prevUrl = process.env.MATERIAL_STOCK_SPREADSHEET_WEBHOOK_URL;
    const prevSecret = process.env.MATERIAL_STOCK_SPREADSHEET_WEBHOOK_SECRET;
    process.env.MATERIAL_STOCK_SPREADSHEET_MIRROR_ENABLED = "true";
    process.env.MATERIAL_STOCK_SPREADSHEET_WEBHOOK_URL =
      "https://prod.westus.logic.azure.com/workflows/x";
    delete process.env.MATERIAL_STOCK_SPREADSHEET_WEBHOOK_SECRET;
    try {
      const { repo, rows } = createMemoryRepo([
        makeRow({ payloadJson: payload, maxAttempts: 5 }),
      ]);
      const result = await runMaterialStockSpreadsheetMirrorWorker({
        repository: repo,
        workerId: "w1",
        now: () => new Date("2026-07-28T12:00:00.000Z"),
      });
      assert.equal(result.errored, 1);
      assert.equal(rows[0].status, "ERROR");
      assert.equal(rows[0].lastErrorCode, "SECRET_MISSING");
    } finally {
      if (prevEnabled == null) delete process.env.MATERIAL_STOCK_SPREADSHEET_MIRROR_ENABLED;
      else process.env.MATERIAL_STOCK_SPREADSHEET_MIRROR_ENABLED = prevEnabled;
      if (prevUrl == null) delete process.env.MATERIAL_STOCK_SPREADSHEET_WEBHOOK_URL;
      else process.env.MATERIAL_STOCK_SPREADSHEET_WEBHOOK_URL = prevUrl;
      if (prevSecret == null) delete process.env.MATERIAL_STOCK_SPREADSHEET_WEBHOOK_SECRET;
      else process.env.MATERIAL_STOCK_SPREADSHEET_WEBHOOK_SECRET = prevSecret;
    }
  });
});
