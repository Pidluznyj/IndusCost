import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  BRENT_DEFAULT_SOURCE,
  BRENT_YAHOO_HOSTS,
  BRENT_YAHOO_USER_AGENT,
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

    await assert.rejects(() => fetchBrentQuoteFromYahoo(mockFetch), /HTTP 503/);
  });

  it("envia User-Agent de navegador — sem ele o Yahoo responde 429", async () => {
    const sentHeaders: Array<Record<string, string>> = [];
    const mockFetch: typeof fetch = async (_url, init) => {
      sentHeaders.push((init?.headers ?? {}) as Record<string, string>);
      return {
        ok: true,
        json: async () => ({
          chart: { result: [{ meta: { regularMarketPrice: 87.37 } }] },
        }),
      } as Response;
    };

    await fetchBrentQuoteFromYahoo(mockFetch);
    assert.equal(sentHeaders.length, 1);
    assert.equal(sentHeaders[0]["User-Agent"], BRENT_YAHOO_USER_AGENT);
    assert.match(sentHeaders[0]["User-Agent"], /Mozilla\/5\.0/);
  });

  it("cai para o host alternativo quando o primeiro recusa a requisição", async () => {
    const requestedUrls: string[] = [];
    const mockFetch: typeof fetch = async (url) => {
      const raw = String(url);
      requestedUrls.push(raw);
      if (raw.startsWith(BRENT_YAHOO_HOSTS[0])) {
        return { ok: false, status: 429, json: async () => ({}) } as Response;
      }
      return {
        ok: true,
        json: async () => ({
          chart: { result: [{ meta: { regularMarketPrice: 87.37 } }] },
        }),
      } as Response;
    };

    const quote = await fetchBrentQuoteFromYahoo(mockFetch);
    assert.equal(quote.priceUSD, 87.37);
    assert.equal(requestedUrls.length, 2);
    assert.ok(requestedUrls[1].startsWith(BRENT_YAHOO_HOSTS[1]));
  });

  it("propaga o último erro quando todos os hosts recusam", async () => {
    const mockFetch: typeof fetch = async () =>
      ({ ok: false, status: 429, json: async () => ({}) }) as Response;

    await assert.rejects(() => fetchBrentQuoteFromYahoo(mockFetch), /HTTP 429/);
  });

  it("fetchBrentQuoteFromYahoo falha sem preço válido", async () => {
    const mockFetch: typeof fetch = async () =>
      ({
        ok: true,
        json: async () => ({
          chart: { result: [{ meta: { regularMarketPrice: 0 } }] },
        }),
      }) as Response;

    await assert.rejects(() => fetchBrentQuoteFromYahoo(mockFetch), /preço válido/);
  });
});
