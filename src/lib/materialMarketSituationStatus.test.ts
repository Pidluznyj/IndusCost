import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  classifyMaterialMarketSituation,
  classifyMaterialMarketSituationFromQuotes,
  MATERIAL_MARKET_SITUATION_STATUS_LABELS,
  MATERIAL_MARKET_SITUATION_THRESHOLDS,
} from "./materialMarketSituationStatus.js";

describe("materialMarketSituationStatus", () => {
  it("documenta limiares esperados", () => {
    assert.equal(MATERIAL_MARKET_SITUATION_THRESHOLDS.MIN_QUOTES, 2);
    assert.equal(MATERIAL_MARKET_SITUATION_THRESHOLDS.NORMAL_BAND_PERCENT, 5);
    assert.equal(MATERIAL_MARKET_SITUATION_THRESHOLDS.CRITICAL_ABOVE_AVG_PERCENT, 20);
    assert.equal(MATERIAL_MARKET_SITUATION_THRESHOLDS.CRITICAL_NEAR_MAX_PERCENT, 5);
  });

  it("cota única → INSUFFICIENT_DATA", () => {
    const result = classifyMaterialMarketSituation({
      prices: [100],
      currentPrice: 100,
    });
    assert.equal(result.status, "INSUFFICIENT_DATA");
    assert.equal(result.statusLabel, MATERIAL_MARKET_SITUATION_STATUS_LABELS.INSUFFICIENT_DATA);
    assert.match(result.reason, /Menos de 2 cotações/);
  });

  it("sem preço atual → INSUFFICIENT_DATA", () => {
    const result = classifyMaterialMarketSituation({
      prices: [100, 110],
      currentPrice: null,
    });
    assert.equal(result.status, "INSUFFICIENT_DATA");
    assert.match(result.reason, /Sem preço atual/);
  });

  it("queda simulada → OPORTUNIDADE", () => {
    const result = classifyMaterialMarketSituation({
      prices: [80, 100, 100],
      currentPrice: 80,
    });
    assert.equal(result.status, "OPORTUNIDADE");
    assert.ok((result.deviationPercent ?? 0) < -5);
    assert.match(result.reason, /abaixo da média histórica/);
  });

  it("próximo da média → NORMAL", () => {
    const result = classifyMaterialMarketSituation({
      prices: [150, 100, 200],
      currentPrice: 150,
    });
    assert.equal(result.status, "NORMAL");
    assert.ok(Math.abs(result.deviationPercent ?? 0) <= 5);
    assert.match(result.reason, /faixa normal/);
  });

  it("alta moderada → ATENCAO", () => {
    const result = classifyMaterialMarketSituation({
      prices: [180, 100, 200],
      currentPrice: 180,
    });
    assert.equal(result.status, "ATENCAO");
    assert.ok((result.deviationPercent ?? 0) > 5);
    assert.ok((result.deviationPercent ?? 0) <= 20);
    assert.match(result.reason, /acima da média histórica/);
  });

  it("alta significativa → CRITICO", () => {
    const result = classifyMaterialMarketSituation({
      prices: [240, 50, 300],
      currentPrice: 240,
    });
    assert.equal(result.status, "CRITICO");
    assert.ok((result.deviationPercent ?? 0) > 20);
    assert.match(result.reason, /acima do limite de 20%/);
  });

  it("próximo do máximo histórico → CRITICO", () => {
    const result = classifyMaterialMarketSituation({
      prices: [100, 98, 95],
      currentPrice: 99,
    });
    assert.equal(result.status, "CRITICO");
    assert.equal(result.historicalMax, 100);
    assert.match(result.reason, /máximo histórico/);
  });

  it("classifica a partir de cotações BRL ordenadas", () => {
    const result = classifyMaterialMarketSituationFromQuotes([
      {
        quoteDate: "2026-01-01",
        createdAt: "2026-01-01T10:00:00Z",
        netPrice: 100,
        currency: "BRL",
        status: "ACTIVE",
      },
      {
        quoteDate: "2026-02-01",
        createdAt: "2026-02-01T10:00:00Z",
        netPrice: 85,
        currency: "BRL",
        status: "ACTIVE",
      },
    ]);
    assert.equal(result.status, "OPORTUNIDADE");
    assert.equal(result.currentPrice, 85);
  });

  it("ignora cotações não BRL no histórico", () => {
    const result = classifyMaterialMarketSituationFromQuotes([
      {
        quoteDate: "2026-01-01",
        createdAt: "2026-01-01T10:00:00Z",
        netPrice: 100,
        currency: "USD",
        status: "ACTIVE",
      },
      {
        quoteDate: "2026-02-01",
        createdAt: "2026-02-01T10:00:00Z",
        netPrice: 90,
        currency: "BRL",
        status: "ACTIVE",
      },
    ]);
    assert.equal(result.status, "INSUFFICIENT_DATA");
    assert.equal(result.quoteCount, 1);
  });
});
