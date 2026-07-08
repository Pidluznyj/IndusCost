import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_MATERIAL_MARKET_ALERT_CONFIG,
  resolveAlertConfig,
  parseMaterialMarketAlertGlobalConfigInput,
  parseMaterialMarketAlertMaterialConfigInput,
  toEngineThresholdsFromEffectiveConfig,
} from "./materialMarketAlertConfig.js";
import { evaluateMaterialMarketAlerts } from "./materialMarketAlertEngine.js";

const GLOBAL = { ...DEFAULT_MATERIAL_MARKET_ALERT_CONFIG };

const BASE_EVAL = {
  materialId: "mat-1",
  materialCode: "MP-001",
  materialDescription: "Aço laminado",
  isMarketMonitored: true,
  marketMonitoringFrequencyDays: 7,
  referenceDate: new Date("2026-07-01T12:00:00Z"),
};

describe("materialMarketAlertConfig", () => {
  it("resolveAlertConfig usa global quando material não tem override", () => {
    const effective = resolveAlertConfig(GLOBAL, null);
    assert.equal(effective.risePercentThreshold, 10);
    assert.equal(effective.fallPercentThreshold, 10);
    assert.equal(effective.daysWithoutQuote, 90);
    assert.equal(effective.alertsEnabled, true);
    assert.equal(effective.usesGlobalConfig, true);
  });

  it("override material tem precedência sobre global", () => {
    const effective = resolveAlertConfig(GLOBAL, {
      risePercentThreshold: 5,
      fallPercentThreshold: null,
      daysWithoutQuote: 30,
      alertsEnabled: null,
    });
    assert.equal(effective.risePercentThreshold, 5);
    assert.equal(effective.fallPercentThreshold, 10);
    assert.equal(effective.daysWithoutQuote, 30);
    assert.equal(effective.usesGlobalConfig, false);
    assert.deepEqual(effective.materialOverrides, {
      risePercentThreshold: 5,
      daysWithoutQuote: 30,
    });
  });

  it("alertsEnabled=false no material suprime geração de alertas", () => {
    const effective = resolveAlertConfig(GLOBAL, { alertsEnabled: false });
    assert.equal(effective.alertsEnabled, false);

    const proposals = evaluateMaterialMarketAlerts({
      ...BASE_EVAL,
      alertsEnabled: effective.alertsEnabled,
      quotes: [
        { quoteDate: "2026-06-30", netPrice: 130, status: "ACTIVE" },
        { quoteDate: "2026-05-01", netPrice: 100, status: "ACTIVE" },
      ],
    });
    assert.equal(proposals.length, 0);
  });

  it("limiar customizado de alta dispara PRICE_UP_PCT", () => {
    const effective = resolveAlertConfig(
      { ...GLOBAL, risePercentThreshold: 5 },
      { risePercentThreshold: 5 }
    );
    const thresholds = toEngineThresholdsFromEffectiveConfig(effective);

    const proposals = evaluateMaterialMarketAlerts({
      ...BASE_EVAL,
      thresholds: {
        risePercentThreshold: thresholds.risePercentThreshold,
        fallPercentThreshold: thresholds.fallPercentThreshold,
        noRecentQuoteDays: thresholds.noRecentQuoteDays,
      },
      quotes: [
        { quoteDate: "2026-06-30", netPrice: 106, status: "ACTIVE" },
        { quoteDate: "2026-05-01", netPrice: 100, status: "ACTIVE" },
      ],
    });

    const priceUp = proposals.find((p) => p.alertType === "PRICE_UP_PCT");
    assert.ok(priceUp, "deveria gerar alerta com limiar de 5%");
  });

  it("limiar alto de alta não dispara PRICE_UP_PCT para variação moderada", () => {
    const effective = resolveAlertConfig(
      { ...GLOBAL, risePercentThreshold: 20 },
      null
    );
    const thresholds = toEngineThresholdsFromEffectiveConfig(effective);

    const proposals = evaluateMaterialMarketAlerts({
      ...BASE_EVAL,
      thresholds: {
        risePercentThreshold: thresholds.risePercentThreshold,
        fallPercentThreshold: thresholds.fallPercentThreshold,
        noRecentQuoteDays: thresholds.noRecentQuoteDays,
      },
      quotes: [
        { quoteDate: "2026-06-30", netPrice: 115, status: "ACTIVE" },
        { quoteDate: "2026-05-01", netPrice: 100, status: "ACTIVE" },
      ],
    });

    assert.equal(
      proposals.some((p) => p.alertType === "PRICE_UP_PCT"),
      false
    );
  });

  it("parse global config valida campos", () => {
    const ok = parseMaterialMarketAlertGlobalConfigInput({
      risePercentThreshold: 12,
      fallPercentThreshold: 8,
      daysWithoutQuote: 60,
      alertsEnabled: false,
    });
    assert.equal(ok.ok, true);
    if (ok.ok) {
      assert.equal(ok.value.risePercentThreshold, 12);
      assert.equal(ok.value.alertsEnabled, false);
    }

    const bad = parseMaterialMarketAlertGlobalConfigInput({
      daysWithoutQuote: 0,
    });
    assert.equal(bad.ok, false);
  });

  it("parse material config aceita null para herdar global", () => {
    const ok = parseMaterialMarketAlertMaterialConfigInput({
      risePercentThreshold: null,
      clearOverrides: false,
    });
    assert.equal(ok.ok, true);
    if (ok.ok) {
      assert.equal(ok.value.risePercentThreshold, null);
      assert.equal(ok.clearOverrides, false);
    }
  });
});
