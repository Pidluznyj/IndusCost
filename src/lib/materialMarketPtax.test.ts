import assert from "node:assert/strict";
import { describe, it, beforeEach, mock } from "node:test";
import {
  clearMaterialMarketPtaxCache,
  resolvePtaxUsdSellRate,
} from "./materialMarketPtax.js";

describe("materialMarketPtax", () => {
  beforeEach(() => {
    clearMaterialMarketPtaxCache();
  });

  it("resolvePtaxUsdSellRate tenta dias anteriores em fim de semana/feriado", async () => {
    const fetchMock = mock.fn(async (url: string | URL | Request) => {
      const u = String(url);
      if (u.includes("07-05-2026")) {
        return new Response(JSON.stringify({ value: [] }), { status: 200 });
      }
      if (u.includes("07-04-2026")) {
        return new Response(JSON.stringify({ value: [{ cotacaoVenda: 5.2 }] }), {
          status: 200,
        });
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
});
