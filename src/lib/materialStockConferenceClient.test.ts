import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyConferenceSuccessToListItem,
  assertConferencePayloadHasNoCostFields,
  createConferenceIdempotencyKey,
  MATERIAL_STOCK_CONFERENCE_DEFAULT_REASON,
  parseStockConferenceQuantityInput,
  previewStockConferenceDifference,
  submitMaterialStockConference,
  type MaterialStockConferenceApiResult,
} from "./materialStockConferenceClient.js";
import type { MaterialStockTabletListItem } from "./materialStockTabletTypes.js";

function item(overrides: Partial<MaterialStockTabletListItem> = {}): MaterialStockTabletListItem {
  return {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    code: "MP-1",
    description: "Aço",
    unit: "kg",
    currentQuantity: 500,
    contingencyQuantity: 50,
    minimumQuantity: 100,
    recommendedQuantity: 200,
    stockStatus: "SAUDAVEL",
    lastStockConferenceAt: null,
    lastStockConferenceUser: null,
    stockConferenceVersion: 3,
    updatedAt: "2026-07-28T10:00:00.000Z",
    ...overrides,
  };
}

function successResult(
  overrides: Partial<MaterialStockConferenceApiResult> = {}
): MaterialStockConferenceApiResult {
  return {
    ok: true,
    created: true,
    idempotent: false,
    conference: {
      id: "c1",
      materialId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      previousQuantity: 500,
      reportedQuantity: 450,
      difference: -50,
      unitSnapshot: "kg",
      reason: "CONFERENCIA_FISICA",
      notes: null,
      userId: "u1",
      userName: "Operador",
      recordedAt: "2026-07-28T12:00:00.000Z",
      source: "TABLET_CONFERENCE",
      previousVersion: 3,
      previousUpdatedAt: "2026-07-28T10:00:00.000Z",
      idempotencyKey: "k1",
    },
    material: {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      code: "MP-1",
      quantity: 450,
      stockConferenceVersion: 4,
      lastStockConferenceAt: "2026-07-28T12:00:00.000Z",
      lastStockConferenceUserId: "u1",
      updatedAt: "2026-07-28T12:00:00.000Z",
      stockStatus: "ATENCAO",
    },
    ...overrides,
  };
}

describe("materialStockConferenceClient — Decimal e validação", () => {
  it("aceita Decimal pt-BR e não converte vazio para zero", () => {
    assert.deepEqual(parseStockConferenceQuantityInput("450,5"), {
      ok: true,
      value: 450.5,
    });
    assert.deepEqual(parseStockConferenceQuantityInput("12.750000"), {
      ok: true,
      value: 12.75,
    });
    assert.deepEqual(parseStockConferenceQuantityInput(""), {
      ok: false,
      reason: "EMPTY",
    });
    assert.deepEqual(parseStockConferenceQuantityInput("   "), {
      ok: false,
      reason: "EMPTY",
    });
    assert.deepEqual(parseStockConferenceQuantityInput("abc"), {
      ok: false,
      reason: "INVALID",
    });
    assert.equal(MATERIAL_STOCK_CONFERENCE_DEFAULT_REASON, "CONFERENCIA_FISICA");
  });

  it("preview calcula diferença sem marcar como salvo", () => {
    const preview = previewStockConferenceDifference(500, "450");
    assert.equal(preview.previous, 500);
    assert.equal(preview.reported, 450);
    assert.equal(preview.difference, -50);
    const empty = previewStockConferenceDifference(500, "");
    assert.equal(empty.reported, null);
    assert.equal(empty.difference, null);
  });
});

describe("materialStockConferenceClient — submit sucesso/erro/conflito", () => {
  it("sucesso retorna payload sem campos de custo", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (_url, init) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      assert.deepEqual(assertConferencePayloadHasNoCostFields(body), []);
      assert.equal(body.reportedQuantity, 450);
      assert.equal(body.contingencyQuantity, 40);
      assert.equal(body.recommendedQuantity, 180);
      assert.equal(body.reason, "CONFERENCIA_FISICA");
      const headers = init?.headers as Record<string, string>;
      assert.equal(headers["Idempotency-Key"], "idem-1");
      return new Response(JSON.stringify(successResult()), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;
    try {
      const result = await submitMaterialStockConference({
        materialId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        reportedQuantity: 450,
        contingencyQuantity: 40,
        recommendedQuantity: 180,
        reason: "CONFERENCIA_FISICA",
        expectedVersion: 3,
        idempotencyKey: "idem-1",
      });
      assert.equal(result.ok, true);
      if (result.ok) {
        assert.equal(result.data.material.quantity, 450);
        assert.deepEqual(
          assertConferencePayloadHasNoCostFields(
            result.data.material as unknown as Record<string, unknown>
          ),
          []
        );
      }
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("erro de rede/servidor não altera saldo e permite mensagem", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ error: "INVALID_FIELD", message: "Falha X" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      })) as typeof fetch;
    try {
      const result = await submitMaterialStockConference({
        materialId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        reportedQuantity: 450,
        contingencyQuantity: 50,
        recommendedQuantity: null,
        reason: "CONFERENCIA_FISICA",
        expectedVersion: 3,
        idempotencyKey: "idem-err",
      });
      assert.equal(result.ok, false);
      if (!result.ok && result.kind === "error") {
        assert.match(result.message, /Falha X/);
      }
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("conflito 409 devolve saldo do servidor sem sobrescrever", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          error: "CONFLICT",
          message: "Alterado",
          details: {
            currentQuantity: 480,
            stockConferenceVersion: 9,
            updatedAt: "2026-07-28T13:00:00.000Z",
          },
        }),
        { status: 409, headers: { "Content-Type": "application/json" } }
      )) as typeof fetch;
    try {
      const result = await submitMaterialStockConference({
        materialId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        reportedQuantity: 450,
        contingencyQuantity: 50,
        recommendedQuantity: 200,
        reason: "CONFERENCIA_FISICA",
        expectedVersion: 3,
        idempotencyKey: "idem-409",
      });
      assert.equal(result.ok, false);
      if (!result.ok && result.kind === "conflict") {
        assert.equal(result.conflict.serverQuantity, 480);
        assert.equal(result.conflict.reportedQuantity, 450);
        assert.equal(result.conflict.stockConferenceVersion, 9);
      }
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("duplo envio usa a mesma Idempotency-Key no body headers", async () => {
    const originalFetch = globalThis.fetch;
    const keys: string[] = [];
    globalThis.fetch = (async (_url, init) => {
      const headers = init?.headers as Record<string, string>;
      keys.push(headers["Idempotency-Key"]);
      return new Response(JSON.stringify(successResult()), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;
    try {
      const key = createConferenceIdempotencyKey();
      await submitMaterialStockConference({
        materialId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        reportedQuantity: 450,
        contingencyQuantity: 50,
        recommendedQuantity: 200,
        reason: "PERDA",
        expectedVersion: 3,
        idempotencyKey: key,
      });
      await submitMaterialStockConference({
        materialId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        reportedQuantity: 450,
        contingencyQuantity: 50,
        recommendedQuantity: 200,
        reason: "PERDA",
        expectedVersion: 3,
        idempotencyKey: key,
      });
      assert.equal(keys[0], key);
      assert.equal(keys[1], key);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("materialStockConferenceClient — atualização da lista", () => {
  it("atualiza estoque/status/data/usuário sem campos de custo", () => {
    const before = item();
    const after = applyConferenceSuccessToListItem(before, successResult());
    assert.equal(after.currentQuantity, 450);
    assert.equal(after.stockStatus, "ATENCAO");
    assert.equal(after.stockConferenceVersion, 4);
    assert.equal(after.lastStockConferenceAt, "2026-07-28T12:00:00.000Z");
    assert.equal(after.lastStockConferenceUser?.name, "Operador");
    assert.equal(after.contingencyQuantity, 50);
    assert.equal(after.minimumQuantity, 100);
    assert.equal(after.recommendedQuantity, 200);
    assert.ok(!("currentCost" in after));
    assert.ok(!("freight" in after));
    assert.ok(!("standardLoss" in after));
    assert.ok(!("conversionFactor" in after));
  });
});
