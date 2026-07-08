import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyMaterialMarketAlertStatusUpdate,
  parseMaterialMarketAlertStatusPatch,
} from "./materialMarketAlert.js";
import {
  dedupeMaterialMarketAlertProposals,
  evaluateMaterialMarketAlerts,
  MATERIAL_MARKET_ALERT_DEFAULT_THRESHOLDS,
  shouldUpdateOpenMaterialMarketAlert,
} from "./materialMarketAlertEngine.js";

const BASE_INPUT = {
  materialId: "mat-1",
  materialCode: "MP-001",
  materialDescription: "Aço laminado",
  isMarketMonitored: true,
  marketMonitoringFrequencyDays: 7,
  referenceDate: new Date("2026-07-01T12:00:00Z"),
};

describe("materialMarketAlertEngine", () => {
  it("expõe limiares padrão documentados", () => {
    assert.equal(MATERIAL_MARKET_ALERT_DEFAULT_THRESHOLDS.priceChangePercent, 10);
    assert.equal(MATERIAL_MARKET_ALERT_DEFAULT_THRESHOLDS.supplierAboveAvgPercent, 15);
    assert.equal(MATERIAL_MARKET_ALERT_DEFAULT_THRESHOLDS.noRecentQuoteDays, 90);
    assert.equal(MATERIAL_MARKET_ALERT_DEFAULT_THRESHOLDS.savingsOpportunityPercent, 10);
  });

  it("não gera alertas para material não monitorado", () => {
    const proposals = evaluateMaterialMarketAlerts({
      ...BASE_INPUT,
      isMarketMonitored: false,
      quotes: [{ quoteDate: "2026-06-01", netPrice: 100, status: "ACTIVE" }],
    });
    assert.equal(proposals.length, 0);
  });

  it("alta forte de preço gera PRICE_UP_PCT e BREAK_MAX", () => {
    const proposals = evaluateMaterialMarketAlerts({
      ...BASE_INPUT,
      quotes: [
        { quoteDate: "2026-06-30", netPrice: 130, supplierName: "Fornecedor A", status: "ACTIVE" },
        { quoteDate: "2026-05-01", netPrice: 100, supplierName: "Fornecedor B", status: "ACTIVE" },
        { quoteDate: "2026-04-01", netPrice: 105, supplierName: "Fornecedor C", status: "ACTIVE" },
      ],
    });

    const types = proposals.map((p) => p.alertType);
    assert.ok(types.includes("PRICE_UP_PCT"));
    assert.ok(types.includes("BREAK_MAX"));

    const priceUp = proposals.find((p) => p.alertType === "PRICE_UP_PCT");
    assert.ok(priceUp);
    assert.match(priceUp!.message, /alta de/i);
    assert.ok(priceUp!.severity === "WARNING" || priceUp!.severity === "CRITICAL");
  });

  it("material sem cotação recente gera NO_RECENT_QUOTE", () => {
    const proposals = evaluateMaterialMarketAlerts({
      ...BASE_INPUT,
      quotes: [
        {
          quoteDate: "2026-01-01",
          netPrice: 80,
          supplierName: "Fornecedor A",
          status: "ACTIVE",
        },
      ],
    });

    const stale = proposals.find((p) => p.alertType === "NO_RECENT_QUOTE");
    assert.ok(stale);
    assert.equal(stale!.severity, "CRITICAL");
    assert.match(stale!.message, /dias/i);
  });

  it("material sem nenhuma cotação gera NO_RECENT_QUOTE", () => {
    const proposals = evaluateMaterialMarketAlerts({
      ...BASE_INPUT,
      quotes: [],
    });
    assert.equal(proposals.length, 1);
    assert.equal(proposals[0]!.alertType, "NO_RECENT_QUOTE");
  });

  it("dedupe evita propostas duplicadas do mesmo tipo", () => {
    const proposal = {
      materialId: "mat-1",
      alertType: "PRICE_UP_PCT" as const,
      title: "Alta",
      message: "msg",
      severity: "WARNING" as const,
      metadata: {},
      triggeredAt: new Date(),
    };
    const deduped = dedupeMaterialMarketAlertProposals([proposal, proposal]);
    assert.equal(deduped.length, 1);
  });

  it("shouldUpdateOpenMaterialMarketAlert detecta mudança de mensagem", () => {
    const proposal = {
      materialId: "mat-1",
      alertType: "PRICE_UP_PCT" as const,
      title: "Alta relevante",
      message: "Nova mensagem",
      severity: "WARNING" as const,
      metadata: { changePercent: 12 },
      triggeredAt: new Date(),
    };
    assert.equal(
      shouldUpdateOpenMaterialMarketAlert(
        { title: "Alta relevante", message: "Antiga", metadata: { changePercent: 12 } },
        proposal
      ),
      true
    );
    assert.equal(
      shouldUpdateOpenMaterialMarketAlert(
        { title: "Alta relevante", message: "Nova mensagem", metadata: { changePercent: 12 } },
        proposal
      ),
      false
    );
  });

  it("PATCH para RESOLVED atualiza status e resolvedBy", () => {
    const parsed = parseMaterialMarketAlertStatusPatch({ status: "RESOLVED" });
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;

    const update = applyMaterialMarketAlertStatusUpdate({
      currentStatus: "OPEN",
      targetStatus: parsed.status,
      userId: "user-1",
      now: new Date("2026-07-01T12:00:00Z"),
    });
    assert.equal(update.status, "RESOLVED");
    assert.equal(update.resolvedBy, "user-1");
    assert.ok(update.resolvedAt);
    assert.equal(update.readBy, "user-1");
  });

  it("PATCH para READ mantém alerta legível sem resolver", () => {
    const update = applyMaterialMarketAlertStatusUpdate({
      currentStatus: "OPEN",
      targetStatus: "READ",
      userId: "user-2",
    });
    assert.equal(update.status, "READ");
    assert.ok(update.readAt);
    assert.equal(update.readBy, "user-2");
    assert.equal(update.resolvedAt, undefined);
  });
});
