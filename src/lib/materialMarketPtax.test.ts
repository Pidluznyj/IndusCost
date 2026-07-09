import assert from "node:assert/strict";
import { describe, it, beforeEach, mock } from "node:test";
import {
  buildBcbPtaxDayUrl,
  clearMaterialMarketPtaxCache,
  parseBcbPtaxDayResponse,
  resolvePtaxBcbRates,
  resolvePtaxUsdSellRate,
  toBcbDateParam,
} from "./materialMarketPtax.js";

describe("materialMarketPtax", () => {
  beforeEach(() => {
    clearMaterialMarketPtaxCache();
  });

  it("toBcbDateParam formata data para API Olinda", () => {
    assert.equal(toBcbDateParam("2026-07-08"), "07-08-2026");
  });

  it("parseBcbPtaxDayResponse extrai compra e venda", () => {
    const parsed = parseBcbPtaxDayResponse("2026-07-08", {
      value: [{ cotacaoCompra: 5.41, cotacaoVenda: 5.42 }],
    });
    assert.deepEqual(parsed, {
      quoteDate: "2026-07-08",
      buyRate: 5.41,
      sellRate: 5.42,
    });
  });

  it("buildBcbPtaxDayUrl monta endpoint do BCB", () => {
    const url = buildBcbPtaxDayUrl("2026-07-08");
    assert.match(url, /CotacaoDolarDia/);
    assert.match(url, /07-08-2026/);
  });

  it("resolvePtaxUsdSellRate tenta dias anteriores em fim de semana/feriado", async () => {
    const fetchMock = mock.fn(async (url: string | URL | Request) => {
      const u = String(url);
      if (u.includes("07-05-2026")) {
        return new Response(JSON.stringify({ value: [] }), { status: 200 });
      }
      if (u.includes("07-04-2026")) {
        return new Response(
          JSON.stringify({ value: [{ cotacaoCompra: 5.19, cotacaoVenda: 5.2 }] }),
          { status: 200 }
        );
      }
      return new Response(JSON.stringify({ value: [] }), { status: 200 });
    });

    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchMock as typeof fetch;

    try {
      const rate = await resolvePtaxUsdSellRate("2026-07-05");
      assert.equal(rate, 5.2);
      assert.ok(fetchMock.mock.calls.length >= 2);
    } finally {
      globalThis.fetch = originalFetch;
      clearMaterialMarketPtaxCache();
    }
  });

  it("resolvePtaxBcbRates retorna compra, venda e data efetiva", async () => {
    const fetchMock = mock.fn(async () =>
      new Response(
        JSON.stringify({ value: [{ cotacaoCompra: 5.31, cotacaoVenda: 5.32 }] }),
        { status: 200 }
      )
    );
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchMock as typeof fetch;

    try {
      const rates = await resolvePtaxBcbRates("2026-07-08");
      assert.deepEqual(rates, {
        quoteDate: "2026-07-08",
        buyRate: 5.31,
        sellRate: 5.32,
      });
    } finally {
      globalThis.fetch = originalFetch;
      clearMaterialMarketPtaxCache();
    }
  });
});
