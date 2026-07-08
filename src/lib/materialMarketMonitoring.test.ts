import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_MATERIAL_MARKET_CRITICALITY,
  DEFAULT_MATERIAL_MARKET_MONITORING_FREQUENCY_DAYS,
  MATERIAL_MARKET_CRITICALITY_LABELS,
  parseMaterialMarketMonitoringInput,
  serializeMaterialForApi,
} from "./materialMarketMonitoring.js";

describe("materialMarketMonitoring", () => {
  it("desmarcado zera criticidade e frequência na persistência", () => {
    const parsed = parseMaterialMarketMonitoringInput({
      isMarketMonitored: false,
      marketCriticality: "CRITICAL",
      marketMonitoringFrequencyDays: 30,
      marketNotes: "  ",
    });
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    assert.equal(parsed.value.isMarketMonitored, false);
    assert.equal(parsed.value.marketCriticality, null);
    assert.equal(parsed.value.marketMonitoringFrequencyDays, null);
    assert.equal(parsed.value.marketNotes, null);
  });

  it("marcado aplica defaults de criticidade e frequência", () => {
    const parsed = parseMaterialMarketMonitoringInput({ isMarketMonitored: true });
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    assert.equal(parsed.value.marketCriticality, DEFAULT_MATERIAL_MARKET_CRITICALITY);
    assert.equal(
      parsed.value.marketMonitoringFrequencyDays,
      DEFAULT_MATERIAL_MARKET_MONITORING_FREQUENCY_DAYS
    );
  });

  it("rejeita frequência inválida", () => {
    const parsed = parseMaterialMarketMonitoringInput({
      isMarketMonitored: true,
      marketMonitoringFrequencyDays: 0,
    });
    assert.equal(parsed.ok, false);
  });

  it("serializeMaterialForApi expõe campos apenas quando monitorado", () => {
    const off = serializeMaterialForApi({
      isMarketMonitored: false,
      marketCriticality: "HIGH",
      marketMonitoringFrequencyDays: 14,
    });
    assert.equal(off.isMarketMonitored, false);
    assert.equal(off.marketCriticality, null);

    const on = serializeMaterialForApi({
      isMarketMonitored: true,
      marketCriticality: "HIGH",
      marketMonitoringFrequencyDays: 14,
      marketNotes: "PP reforçado",
    });
    assert.equal(on.marketCriticality, "HIGH");
    assert.equal(on.marketMonitoringFrequencyDays, 14);
    assert.equal(on.marketNotes, "PP reforçado");
  });

  it("labels de criticidade em português", () => {
    assert.equal(MATERIAL_MARKET_CRITICALITY_LABELS.CRITICAL, "Crítica");
  });
});
