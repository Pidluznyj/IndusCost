import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  computeMaterialMarketQuoteAnalytics,
  MATERIAL_MARKET_QUOTE_TREND_THRESHOLD_PERCENT,
} from "./materialMarketQuoteAnalytics.js";

function quote(date: string, netPrice: number) {
  return { quoteDate: date, netPrice, currency: "BRL" };
}

describe("materialMarketQuoteAnalytics", () => {
  it("retorna estado vazio quando não há cotações", () => {
    const result = computeMaterialMarketQuoteAnalytics({ quotes: [], period: "30d" });
    assert.equal(result.empty, true);
    assert.equal(result.quoteCount, 0);
    assert.equal(result.currentPrice, null);
    assert.equal(result.average, null);
    assert.ok(result.weeklyVariation.reason);
  });

  it("calcula média, mínimo, máximo e amplitude com múltiplas cotações", () => {
    const result = computeMaterialMarketQuoteAnalytics({
      quotes: [
        quote("2026-06-01", 100),
        quote("2026-06-15", 120),
        quote("2026-07-01", 110),
        quote("2026-07-08", 130),
      ],
      period: "all",
      referenceDate: new Date("2026-07-08T12:00:00Z"),
    });

    assert.equal(result.empty, false);
    assert.equal(result.quoteCount, 4);
    assert.equal(result.currentPrice, 130);
    assert.equal(result.minPrice, 100);
    assert.equal(result.maxPrice, 130);
    assert.equal(result.amplitude, 30);
    assert.equal(result.average, 115);
    assert.equal(result.median, 115);
    assert.ok(result.standardDeviation > 0);
    assert.ok(result.volatility != null && result.volatility > 0);
  });

  it("cotação única: preço atual = min = max, variações insuficientes", () => {
    const result = computeMaterialMarketQuoteAnalytics({
      quotes: [quote("2026-07-01", 250)],
      period: "all",
    });

    assert.equal(result.empty, false);
    assert.equal(result.quoteCount, 1);
    assert.equal(result.currentPrice, 250);
    assert.equal(result.minPrice, 250);
    assert.equal(result.maxPrice, 250);
    assert.equal(result.amplitude, 0);
    assert.equal(result.standardDeviation, 0);
    assert.equal(result.volatility, 0);
    assert.equal(result.weeklyVariation.percent, null);
    assert.equal(result.monthlyVariation.percent, null);
    assert.equal(result.annualVariation.percent, null);
    assert.ok(result.weeklyVariation.reason?.includes("Apenas uma cotação"));
    assert.equal(result.trend, null);
  });

  it("variação semanal com datas conhecidas", () => {
    const result = computeMaterialMarketQuoteAnalytics({
      quotes: [
        quote("2026-07-08", 110),
        quote("2026-07-01", 100),
      ],
      period: "all",
      referenceDate: new Date("2026-07-08T12:00:00Z"),
    });

    assert.equal(result.weeklyVariation.percent, 10);
    assert.equal(result.weeklyVariation.reason, null);
  });

  it("variação mensal com datas conhecidas", () => {
    const result = computeMaterialMarketQuoteAnalytics({
      quotes: [
        quote("2026-07-08", 120),
        quote("2026-06-05", 100),
      ],
      period: "all",
      referenceDate: new Date("2026-07-08T12:00:00Z"),
    });

    assert.equal(result.monthlyVariation.percent, 20);
    assert.equal(result.monthlyVariation.reason, null);
  });

  it("filtra cotações pelo período informado", () => {
    const result7d = computeMaterialMarketQuoteAnalytics({
      quotes: [
        quote("2026-07-08", 130),
        quote("2026-06-01", 100),
      ],
      period: "7d",
      referenceDate: new Date("2026-07-08T12:00:00Z"),
    });
    assert.equal(result7d.quoteCount, 1);
    assert.equal(result7d.currentPrice, 130);

    const resultAll = computeMaterialMarketQuoteAnalytics({
      quotes: [
        quote("2026-07-08", 130),
        quote("2026-06-01", 100),
      ],
      period: "all",
    });
    assert.equal(resultAll.quoteCount, 2);
  });

  it("classifica tendência com limiar documentado", () => {
    const up = computeMaterialMarketQuoteAnalytics({
      quotes: [
        quote("2026-07-08", 120),
        quote("2026-07-07", 118),
        quote("2026-06-20", 100),
        quote("2026-06-15", 100),
      ],
      period: "all",
      referenceDate: new Date("2026-07-08T12:00:00Z"),
    });
    assert.equal(up.trend, "UP");
    assert.equal(up.trendLabel, "Alta");

    const down = computeMaterialMarketQuoteAnalytics({
      quotes: [
        quote("2026-07-08", 90),
        quote("2026-07-07", 92),
        quote("2026-06-20", 110),
        quote("2026-06-15", 110),
      ],
      period: "all",
      referenceDate: new Date("2026-07-08T12:00:00Z"),
    });
    assert.equal(down.trend, "DOWN");

    assert.ok(MATERIAL_MARKET_QUOTE_TREND_THRESHOLD_PERCENT === 2);
  });
});
