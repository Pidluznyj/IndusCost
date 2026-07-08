import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  auditEventRequiresReason,
  buildMaterialMarketAuditEventData,
  detectMaterialMarketQuoteChangeEvents,
  mapOfficialQuoteAuditToUnifiedEvent,
  mergeMaterialMarketAuditEvents,
  serializeMaterialMarketAuditEventForApi,
  validateMaterialMarketAuditReason,
} from "./materialMarketAudit.js";

describe("materialMarketAudit", () => {
  it("detecta alteração de preço", () => {
    const events = detectMaterialMarketQuoteChangeEvents({
      before: { id: "q1", netPrice: 100 },
      after: { id: "q1", netPrice: 120 },
    });
    assert.deepEqual(events, ["PRICE_CHANGED"]);
  });

  it("exige motivo para rejeição", () => {
    const result = validateMaterialMarketAuditReason({
      entityType: "APPROVAL",
      eventType: "REJECTED",
      reason: "",
    });
    assert.equal(result.ok, false);
    if (result.ok === false) {
      assert.equal(result.code, "AUDIT_REASON_REQUIRED");
    }
  });

  it("exige motivo para preço em cotação oficial", () => {
    assert.equal(
      auditEventRequiresReason({ eventType: "PRICE_CHANGED", isOfficialQuote: true }),
      true
    );
    const built = buildMaterialMarketAuditEventData({
      materialId: "m1",
      entityType: "QUOTE",
      entityId: "q1",
      eventType: "PRICE_CHANGED",
      isOfficialQuote: true,
      beforeJson: { netPrice: 10 },
      afterJson: { netPrice: 12 },
    });
    assert.equal(built.ok, false);
  });

  it("permite criação sem motivo", () => {
    const built = buildMaterialMarketAuditEventData({
      materialId: "m1",
      entityType: "QUOTE",
      entityId: "q1",
      eventType: "CREATED",
      userName: "Ana",
    });
    assert.equal(built.ok, true);
    if (built.ok) {
      assert.equal(built.data.eventType, "CREATED");
      assert.equal(built.data.userName, "Ana");
    }
  });

  it("mapeia auditoria legada de cotação oficial", () => {
    const item = mapOfficialQuoteAuditToUnifiedEvent({
      id: "a1",
      materialId: "m1",
      quoteId: "q1",
      action: "SET_OFFICIAL",
      changedAt: "2026-03-01T10:00:00.000Z",
      reason: "Atualização trimestral",
    });
    assert.equal(item.eventType, "SET_OFFICIAL");
    assert.equal(item.reason, "Atualização trimestral");
    assert.equal(item.legacySource, "MaterialOfficialQuoteAudit");
  });

  it("ordena eventos do mais recente ao mais antigo", () => {
    const merged = mergeMaterialMarketAuditEvents([
      serializeMaterialMarketAuditEventForApi({
        id: "1",
        entityType: "QUOTE",
        eventType: "CREATED",
        occurredAt: "2026-01-01T00:00:00.000Z",
      }),
      serializeMaterialMarketAuditEventForApi({
        id: "2",
        entityType: "QUOTE",
        eventType: "UPDATED",
        occurredAt: "2026-03-01T00:00:00.000Z",
      }),
    ]);
    assert.equal(merged[0]?.id, "2");
  });

  it("exige motivo para CONFIG_CHANGED", () => {
    const built = buildMaterialMarketAuditEventData({
      materialId: "m1",
      entityType: "ALERT_CONFIG",
      entityId: "m1",
      eventType: "CONFIG_CHANGED",
      beforeJson: { risePercentThreshold: 10 },
      afterJson: { risePercentThreshold: 15 },
    });
    assert.equal(built.ok, false);
  });
});
