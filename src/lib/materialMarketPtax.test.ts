import assert from "node:assert/strict";
import { describe, it, beforeEach, mock } from "node:test";
import {
  buildBcbPtaxDayUrl,
  clearMaterialMarketPtaxCache,
  invalidateProvisionalPtaxCache,
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

  it("não congela a cotação quando a coleta da manhã cai antes da publicação do BCB", async () => {
    // O BCB publica a PTAX de fechamento por volta das 13h: na coleta das 09:00
    // a consulta do próprio dia volta vazia e caímos no dia anterior. Essa
    // resposta é provisória e não pode virar permanente — foi o que congelou o
    // indicador em 12/08/2026 por duas semanas.
    const published = new Set(["2026-08-12", "2026-08-13", "2026-08-14"]);
    let today = "";

    const fetchImpl = (async (url: string | URL | Request) => {
      const match = String(url).match(/@dataCotacao='(\d{2})-(\d{2})-(\d{4})'/);
      const iso = match ? `${match[3]}-${match[1]}-${match[2]}` : "";
      const availableNow = published.has(iso) && iso !== today;
      return new Response(
        JSON.stringify({
          value: availableNow ? [{ cotacaoCompra: 5.1, cotacaoVenda: 5.11 }] : [],
        }),
        { status: 200 }
      );
    }) as unknown as typeof fetch;

    const ONE_DAY_MS = 24 * 60 * 60 * 1000;
    mock.timers.enable({ apis: ["Date"], now: new Date("2026-08-13T12:00:00.000Z") });
    try {
      today = "2026-08-13";
      const morningOf13 = await resolvePtaxBcbRates("2026-08-13", fetchImpl);
      assert.equal(morningOf13?.quoteDate, "2026-08-12", "às 09:00 ainda é a véspera");

      mock.timers.tick(ONE_DAY_MS);
      today = "2026-08-14";
      const morningOf14 = await resolvePtaxBcbRates("2026-08-14", fetchImpl);
      assert.equal(
        morningOf14?.quoteDate,
        "2026-08-13",
        "no dia seguinte precisa avançar, não repetir a véspera memorizada"
      );

      mock.timers.tick(3 * ONE_DAY_MS);
      today = "2026-08-17";
      const morningOf17 = await resolvePtaxBcbRates("2026-08-17", fetchImpl);
      assert.equal(morningOf17?.quoteDate, "2026-08-14", "segue avançando conforme o BCB publica");
    } finally {
      mock.timers.reset();
    }
  });

  it("promove a cotação do dia assim que o BCB publica, sem esperar o dia seguinte", async () => {
    let publishedToday = false;
    const fetchImpl = (async (url: string | URL | Request) => {
      const isRequestedDay = String(url).includes("08-13-2026");
      const hasQuote = isRequestedDay ? publishedToday : true;
      return new Response(
        JSON.stringify({
          value: hasQuote ? [{ cotacaoCompra: 5.2, cotacaoVenda: 5.21 }] : [],
        }),
        { status: 200 }
      );
    }) as unknown as typeof fetch;

    mock.timers.enable({ apis: ["Date"], now: new Date("2026-08-13T12:00:00.000Z") });
    try {
      const beforePublication = await resolvePtaxBcbRates("2026-08-13", fetchImpl);
      assert.equal(beforePublication?.quoteDate, "2026-08-12");

      // BCB publica ~13h; passada a janela do provisório, a coleta das 15:30
      // precisa enxergar a cotação do próprio dia.
      publishedToday = true;
      mock.timers.tick(6 * 60 * 60 * 1000);
      const afterPublication = await resolvePtaxBcbRates("2026-08-13", fetchImpl);
      assert.equal(afterPublication?.quoteDate, "2026-08-13");
    } finally {
      mock.timers.reset();
    }
  });

  it("coleta manual descarta o provisório mas preserva o histórico publicado", async () => {
    let publishedToday = false;
    let calls = 0;
    const fetchImpl = (async (url: string | URL | Request) => {
      calls += 1;
      const isRequestedDay = String(url).includes("08-13-2026");
      const hasQuote = isRequestedDay ? publishedToday : true;
      return new Response(
        JSON.stringify({
          value: hasQuote ? [{ cotacaoCompra: 5.3, cotacaoVenda: 5.31 }] : [],
        }),
        { status: 200 }
      );
    }) as unknown as typeof fetch;

    assert.equal((await resolvePtaxBcbRates("2026-08-13", fetchImpl))?.quoteDate, "2026-08-12");

    publishedToday = true;
    invalidateProvisionalPtaxCache();
    assert.equal((await resolvePtaxBcbRates("2026-08-13", fetchImpl))?.quoteDate, "2026-08-13");

    const callsSoFar = calls;
    // 12/08 já é fato publicado: não deve ser consultado de novo.
    assert.equal((await resolvePtaxBcbRates("2026-08-12", fetchImpl))?.quoteDate, "2026-08-12");
    assert.equal(calls, callsSoFar, "histórico publicado continua em cache");
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
