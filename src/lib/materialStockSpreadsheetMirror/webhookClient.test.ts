import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { deliverMaterialStockSpreadsheetMirrorWebhook } from "./webhookClient.server.js";
import type { MaterialStockSpreadsheetMirrorPayload } from "./types.js";

const basePayload: MaterialStockSpreadsheetMirrorPayload = {
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
  stockConferenceVersion: 1,
  materialStatus: "ACTIVE",
};

describe("deliverMaterialStockSpreadsheetMirrorWebhook", () => {
  it("falha com segredo ausente sem chamar rede", async () => {
    let called = false;
    const result = await deliverMaterialStockSpreadsheetMirrorWebhook(basePayload, {
      config: {
        enabled: true,
        webhookUrl: "https://prod.westus.logic.azure.com/workflows/x",
        webhookSecret: null,
        allowedHosts: ["logic.azure.com"],
        httpTimeoutMs: 1000,
        maxAttempts: 5,
        workerIntervalMs: 5000,
        workerBatchSize: 5,
      },
      fetchImpl: async () => {
        called = true;
        return new Response("ok", { status: 200 });
      },
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "SECRET_MISSING");
    assert.equal(called, false);
  });

  it("falha com destino inválido", async () => {
    const result = await deliverMaterialStockSpreadsheetMirrorWebhook(basePayload, {
      config: {
        enabled: true,
        webhookUrl: "https://127.0.0.1/hook",
        webhookSecret: "secret",
        allowedHosts: ["logic.azure.com"],
        httpTimeoutMs: 1000,
        maxAttempts: 5,
        workerIntervalMs: 5000,
        workerBatchSize: 5,
      },
      fetchImpl: async () => new Response("ok", { status: 200 }),
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "DESTINATION_INVALID");
  });

  it("envia UPSERT sem chaves de custo e valida resposta 2xx", async () => {
    let body = "";
    const result = await deliverMaterialStockSpreadsheetMirrorWebhook(basePayload, {
      config: {
        enabled: true,
        webhookUrl: "https://prod.westus.logic.azure.com/workflows/x",
        webhookSecret: "secret",
        allowedHosts: ["logic.azure.com"],
        httpTimeoutMs: 1000,
        maxAttempts: 5,
        workerIntervalMs: 5000,
        workerBatchSize: 5,
      },
      fetchImpl: async (_url, init) => {
        body = String(init?.body ?? "");
        return new Response("{}", { status: 202 });
      },
    });
    assert.equal(result.ok, true);
    assert.match(body, /"operation":"UPSERT"/);
    assert.doesNotMatch(body, /currentCost|averageCost|landedCost/);
  });
});
