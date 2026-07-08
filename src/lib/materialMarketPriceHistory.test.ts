import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildMaterialMarketPriceHistoryResponse,
  computeMaterialQuotePriceBRL,
  parseMaterialMarketPriceHistoryQuery,
  resolveMaterialMarketPriceHistoryPeriodRange,
} from "./materialMarketPriceHistory.js";

const REF = new Date("2026-07-08T12:00:00Z");

describe("materialMarketPriceHistory", () => {
  it("resolve períodos predefinidos", () => {
    const r30 = resolveMaterialMarketPriceHistoryPeriodRange("30d", undefined, undefined, REF);
    assert.ok(r30);
    assert.equal(r30.dateTo, "2026-07-08");
    assert.equal(r30.dateFrom, "2026-06-08");

    const r6m = resolveMaterialMarketPriceHistoryPeriodRange("6m", undefined, undefined, REF);
    assert.ok(r6m);
    assert.equal(r6m.dateFrom, "2026-01-08");
  });

  it("período personalizado exige intervalo válido", () => {
    assert.equal(
      resolveMaterialMarketPriceHistoryPeriodRange("custom", "2026-01-01", "", REF),
      null
    );
    assert.equal(
      resolveMaterialMarketPriceHistoryPeriodRange("custom", "2026-02-01", "2026-01-01", REF),
      null
    );

    const ok = resolveMaterialMarketPriceHistoryPeriodRange(
      "custom",
      "2026-01-01",
      "2026-06-30",
      REF
    );
    assert.ok(ok);
    assert.equal(ok.dateFrom, "2026-01-01");
    assert.equal(ok.dateTo, "2026-06-30");
  });

  it("parseMaterialMarketPriceHistoryQuery usa 12m como padrão", () => {
    const parsed = parseMaterialMarketPriceHistoryQuery({ period: "invalid" }, REF);
    assert.equal(parsed.ok, true);
    if (parsed.ok) {
      assert.equal(parsed.range.preset, "12m");
      assert.equal(parsed.range.dateTo, "2026-07-08");
    }
  });

  it("parseMaterialMarketPriceHistoryQuery falha em custom incompleto", () => {
    const parsed = parseMaterialMarketPriceHistoryQuery({ period: "custom" }, REF);
    assert.equal(parsed.ok, false);
  });

  it("converte BRL e USD para série do gráfico", () => {
    const brl = computeMaterialQuotePriceBRL({ netPrice: 100, currency: "BRL" });
    assert.equal(brl.priceBRL, 100);
    assert.equal(brl.exchangeRateUsed, null);

    const usd = computeMaterialQuotePriceBRL({
      netPrice: 10,
      currency: "USD",
      exchangeRateUsed: 5.5,
    });
    assert.equal(usd.priceBRL, 55);
    assert.equal(usd.exchangeRateUsed, 5.5);
  });

  it("mapeia DTO da série com filtro de período", () => {
    const range = resolveMaterialMarketPriceHistoryPeriodRange("90d", undefined, undefined, REF)!;
    const response = buildMaterialMarketPriceHistoryResponse({
      range,
      exchangeRatesByDate: new Map([["2026-06-15", 5.2]]),
      rows: [
        {
          id: "q1",
          materialId: "m1",
          quoteDate: "2026-05-10",
          price: 80,
          currency: "BRL",
          unit: "kg",
          netPrice: 85,
          status: "ACTIVE",
          supplierName: "Fornecedor A",
          notes: "Lote piloto",
          createdAt: "2026-05-11T10:00:00Z",
          updatedAt: "2026-05-11T10:00:00Z",
        },
        {
          id: "q2",
          materialId: "m1",
          quoteDate: "2026-06-15",
          price: 12,
          currency: "USD",
          unit: "kg",
          netPrice: 13,
          status: "ACTIVE",
          supplierName: "Fornecedor B",
          createdAt: "2026-06-16T10:00:00Z",
          updatedAt: "2026-06-16T10:00:00Z",
        },
        {
          id: "q3",
          materialId: "m1",
          quoteDate: "2025-01-01",
          price: 50,
          currency: "BRL",
          unit: "kg",
          netPrice: 50,
          status: "ACTIVE",
          createdAt: "2025-01-02T10:00:00Z",
          updatedAt: "2025-01-02T10:00:00Z",
        },
      ],
    });

    assert.equal(response.total, 2);
    assert.deepEqual(
      response.points.map((p) => p.id),
      ["q1", "q2"]
    );
    assert.equal(response.points[0]?.priceBRL, 85);
    assert.equal(response.points[1]?.originalCurrency, "USD");
    assert.equal(response.points[1]?.priceBRL, 67.6);
    assert.equal(response.points[1]?.exchangeRateUsed, 5.2);
    assert.equal(response.points[1]?.supplierName, "Fornecedor B");
  });
});
