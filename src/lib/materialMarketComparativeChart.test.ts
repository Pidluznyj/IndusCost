import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildMaterialMarketComparativeChartResponse,
  mergeComparativeChartSeriesForDisplay,
  parseMaterialMarketComparativeChartQuery,
  shouldApplyComparativeChartNormalization,
} from "./materialMarketComparativeChart.js";
import { resolveMaterialMarketPriceHistoryPeriodRange } from "./materialMarketPriceHistory.js";

const REF = new Date("2026-07-08T12:00:00Z");

function quoteRow(
  overrides: Partial<{
    id: string;
    quoteDate: string;
    netPrice: number;
    currency: string;
    ptaxVenda: number | null;
    netPriceBrl: number | null;
    createdAt: string;
  }> = {}
) {
  return {
    id: overrides.id ?? "q1",
    materialId: "m1",
    quoteDate: overrides.quoteDate ?? "2026-06-01",
    price: overrides.netPrice ?? 10,
    currency: overrides.currency ?? "BRL",
    unit: "kg",
    netPrice: overrides.netPrice ?? 10,
    status: "ACTIVE",
    ptaxVenda: overrides.ptaxVenda ?? null,
    netPriceBrl: overrides.netPriceBrl ?? null,
    createdAt: overrides.createdAt ?? "2026-06-01T10:00:00Z",
    updatedAt: overrides.createdAt ?? "2026-06-01T10:00:00Z",
  };
}

describe("materialMarketComparativeChart", () => {
  it("parse usa 90d como padrão", () => {
    const parsed = parseMaterialMarketComparativeChartQuery({ period: "invalid" }, REF);
    assert.equal(parsed.ok, true);
    if (parsed.ok) {
      assert.equal(parsed.range.preset, "90d");
    }
  });

  it("mapeia DTO com histórico completo", () => {
    const range = resolveMaterialMarketPriceHistoryPeriodRange("90d", undefined, undefined, REF)!;
    const response = buildMaterialMarketComparativeChartResponse({
      range,
      rows: [
        quoteRow({ id: "q1", quoteDate: "2026-06-01", netPrice: 10, netPriceBrl: 10 }),
        quoteRow({ id: "q2", quoteDate: "2026-06-15", netPrice: 11, netPriceBrl: 11 }),
        quoteRow({ id: "q3", quoteDate: "2026-07-01", netPrice: 12, netPriceBrl: 12 }),
      ],
      brentSnapshots: [
        {
          quoteDate: "2026-06-01",
          price: 78,
          status: "SUCCESS",
          collectedAt: "2026-06-01T14:00:00Z",
        },
        {
          quoteDate: "2026-06-15",
          price: 80,
          status: "SUCCESS",
          collectedAt: "2026-06-15T14:00:00Z",
        },
        {
          quoteDate: "2026-07-01",
          price: 82,
          status: "SUCCESS",
          collectedAt: "2026-07-01T14:00:00Z",
        },
      ],
      ptaxRatesByDate: new Map([
        ["2026-06-01", 5.1],
        ["2026-06-15", 5.2],
        ["2026-07-01", 5.3],
      ]),
    });

    assert.equal(response.hasFewDataPoints, false);
    assert.ok(response.series.materialBRL.length > 0);
    assert.equal(response.series.materialBRL.filter((p) => p.value != null).length, 3);
    assert.ok(response.series.ptaxSell.some((p) => p.value === 5.1));
    assert.ok(response.series.brentUSD.some((p) => p.value === 78));
    assert.equal(response.warnings.length, 0);
  });

  it("Brent parcial gera aviso sem quebrar", () => {
    const range = resolveMaterialMarketPriceHistoryPeriodRange("30d", undefined, undefined, REF)!;
    const response = buildMaterialMarketComparativeChartResponse({
      range,
      rows: [
        quoteRow({ id: "q1", quoteDate: "2026-06-20", netPrice: 10 }),
        quoteRow({ id: "q2", quoteDate: "2026-06-25", netPrice: 11 }),
        quoteRow({ id: "q3", quoteDate: "2026-07-01", netPrice: 12 }),
      ],
      brentSnapshots: [
        {
          quoteDate: "2026-06-20",
          price: 75,
          status: "SUCCESS",
          collectedAt: "2026-06-20T14:00:00Z",
        },
      ],
      ptaxRatesByDate: new Map([["2026-06-20", 5.0]]),
    });

    assert.ok(
      response.warnings.some((w) => /Brent indisponíveis para parte do período/i.test(w))
    );
    assert.ok(response.series.brentUSD.length > 0);
    assert.ok(response.series.brentUSD.some((p) => p.value === 75));
  });

  it("poucas cotações marca hasFewDataPoints", () => {
    const range = resolveMaterialMarketPriceHistoryPeriodRange("90d", undefined, undefined, REF)!;
    const response = buildMaterialMarketComparativeChartResponse({
      range,
      rows: [
        quoteRow({ id: "q1", quoteDate: "2026-06-01", netPrice: 10 }),
        quoteRow({ id: "q2", quoteDate: "2026-07-01", netPrice: 11 }),
      ],
      brentSnapshots: [],
      ptaxRatesByDate: new Map(),
    });

    assert.equal(response.hasFewDataPoints, true);
    assert.ok(response.warnings.some((w) => /Poucas cotações/i.test(w)));
  });

  it("normalização quando material ~10 BRL e Brent ~80 USD", () => {
    assert.equal(
      shouldApplyComparativeChartNormalization([10, 5.2, 80]),
      true
    );

    const range = resolveMaterialMarketPriceHistoryPeriodRange("90d", undefined, undefined, REF)!;
    const response = buildMaterialMarketComparativeChartResponse({
      range,
      rows: [
        quoteRow({ id: "q1", quoteDate: "2026-06-01", netPrice: 10, netPriceBrl: 10 }),
        quoteRow({ id: "q2", quoteDate: "2026-06-15", netPrice: 10.5, netPriceBrl: 10.5 }),
        quoteRow({ id: "q3", quoteDate: "2026-07-01", netPrice: 11, netPriceBrl: 11 }),
      ],
      brentSnapshots: [
        {
          quoteDate: "2026-06-01",
          price: 80,
          status: "SUCCESS",
          collectedAt: "2026-06-01T14:00:00Z",
        },
      ],
      ptaxRatesByDate: new Map([["2026-06-01", 5.2]]),
    });

    assert.equal(response.normalizationApplied, true);

    const merged = mergeComparativeChartSeriesForDisplay(response, (d) => d);
    const firstWithMaterial = merged.find((r) => r.materialBRL != null);
    const firstWithBrent = merged.find((r) => r.brentUSD != null);
    assert.equal(firstWithMaterial?.materialBRLIndexed, 100);
    assert.equal(firstWithBrent?.brentUSDIndexed, 100);
  });
});
