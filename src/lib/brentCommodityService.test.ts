import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  BRENT_DEFAULT_SOURCE,
  calculateBrentVariationFromPrevious,
  fetchBrentQuoteFromYahoo,
  parseBrentQuoteDateIso,
} from "./brentCommodityService.js";

describe("brentCommodityService", () => {
  it("calcula variação percentual vs snapshot anterior", () => {
    assert.equal(calculateBrentVariationFromPrevious(110, 100), 10);
    assert.equal(calculateBrentVariationFromPrevious(95, 100), -5);
    assert.equal(calculateBrentVariationFromPrevious(100, 0), null);
    assert.equal(calculateBrentVariationFromPrevious(Number.NaN, 100), null);
  });

  it("parseBrentQuoteDateIso normaliza data UTC", () => {
    const d = parseBrentQuoteDateIso("2026-07-08");
    assert.equal(d.toISOString().slice(0, 10), "2026-07-08");
  });

  it("fetchBrentQuoteFromYahoo interpreta resposta Yahoo válida", async () => {
    const mockFetch: typeof fetch = async () =>
      ({
        ok: true,
        json: async () => ({
          chart: {
            result: [
              {
                meta: {
                  regularMarketPrice: 82.456789,
                  regularMarketTime: 1_722_000_000,
                },
              },
            ],
          },
        }),
      }) as Response;

    const quote = await fetchBrentQuoteFromYahoo(mockFetch);
    assert.equal(quote.priceUSD, 82.456789);
    assert.equal(quote.source, BRENT_DEFAULT_SOURCE);
    assert.equal(quote.quoteDate, "2024-07-26");
  });

  it("fetchBrentQuoteFromYahoo falha com HTTP não-ok", async () => {
    const mockFetch: typeof fetch = async () =>
      ({
        ok: false,
        status: 503,
        json: async () => ({}),
      }) as Response;

    await assert.rejects(
      () => fetchBrentQuoteFromYahoo(mockFetch),
      /HTTP 503/
    );
  });

  it("fetchBrentQuoteFromYahoo falha sem preço válido", async () => {
    const mockFetch: typeof fetch = async () =>
      ({
        ok: true,
        json: async () => ({
          chart: { result: [{ meta: { regularMarketPrice: 0 } }] },
        }),
      }) as Response;

    await assert.rejects(
      () => fetchBrentQuoteFromYahoo(mockFetch),
      /preço válido/
    );
  });
});
