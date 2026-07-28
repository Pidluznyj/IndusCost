import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applySpreadsheetUpsert,
  assertMirrorPayloadHasNoCosts,
  buildMaterialStockSpreadsheetMirrorPayload,
  computeMaterialStockSpreadsheetMirrorBackoffMs,
  resolveSpreadsheetUpsertTarget,
} from "./queueRules.js";
import { MATERIAL_STOCK_SPREADSHEET_FORBIDDEN_PAYLOAD_KEYS } from "./types.js";

describe("materialStockSpreadsheetMirror queueRules", () => {
  it("payload de espelho não inclui custos", () => {
    const payload = buildMaterialStockSpreadsheetMirrorPayload({
      eventId: "evt-1",
      idempotencyKey: "idem-1",
      eventType: "CONFERENCE",
      occurredAt: new Date("2026-07-28T12:00:00.000Z"),
      material: {
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        code: "MP-1",
        description: "Aço",
        unit: "kg",
        quantity: 100,
        contingencyQuantity: 10,
        minimumQuantity: 20,
        recommendedQuantity: 40,
        lastStockConferenceAt: new Date("2026-07-28T11:00:00.000Z"),
        stockConferenceVersion: 3,
        status: "ACTIVE",
      },
    });
    assert.equal(payload.operation, "UPSERT");
    assert.equal(payload.materialId, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
    assert.equal(payload.code, "MP-1");
    assert.equal(payload.currentQuantity, 100);
    const check = assertMirrorPayloadHasNoCosts(
      payload as unknown as Record<string, unknown>
    );
    assert.equal(check.ok, true);
    for (const key of MATERIAL_STOCK_SPREADSHEET_FORBIDDEN_PAYLOAD_KEYS) {
      assert.equal(
        Object.prototype.hasOwnProperty.call(payload, key),
        false,
        key
      );
    }
  });

  it("backoff segue padrão do projeto", () => {
    assert.equal(computeMaterialStockSpreadsheetMirrorBackoffMs(1), 5_000);
    assert.equal(computeMaterialStockSpreadsheetMirrorBackoffMs(2), 10_000);
    assert.equal(computeMaterialStockSpreadsheetMirrorBackoffMs(10), 300_000);
  });

  it("upsert localiza por materialId/code e não duplica; nunca só por descrição", () => {
    const rows = [
      {
        materialId: "id-1",
        code: "MP-1",
        description: "Aço",
        currentQuantity: 10,
      },
    ];
    const byDesc = resolveSpreadsheetUpsertTarget(
      [{ description: "Aço" }],
      { materialId: "id-2", code: "MP-2" }
    );
    assert.equal(byDesc.action, "insert");

    const updated = applySpreadsheetUpsert(rows, {
      materialId: "id-1",
      code: "MP-1",
      description: "Aço especial",
      currentQuantity: 55,
    });
    assert.equal(updated.length, 1);
    assert.equal(updated[0].currentQuantity, 55);

    const inserted = applySpreadsheetUpsert(updated, {
      materialId: "id-2",
      code: "MP-2",
      description: "Cobre",
      currentQuantity: 3,
    });
    assert.equal(inserted.length, 2);

    const byCode = applySpreadsheetUpsert(inserted, {
      materialId: "other-id",
      code: "MP-2",
      description: "Cobre v2",
      currentQuantity: 9,
    });
    assert.equal(byCode.length, 2);
    assert.equal(byCode[1].currentQuantity, 9);
    assert.equal(byCode[1].materialId, "other-id");
  });
});
