import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  buildMarketHeaderBrentTooltip,
  buildMarketHeaderPtaxTooltip,
  isMarketHeaderTickerStale,
  mapMarketGlobalIndicatorsToHeaderTicker,
  MARKET_HEADER_BRENT_STALE_MS,
  MARKET_HEADER_PTAX_STALE_MS,
  MARKET_HEADER_TICKER_API,
  MARKET_HEADER_TICKER_POLL_MS,
} from "./marketHeaderTicker.js";

const ROOT = process.cwd();

function read(path: string): string {
  return readFileSync(join(ROOT, path), "utf8");
}

describe("marketHeaderTicker", () => {
  const now = new Date("2026-07-09T12:00:00.000Z");

  it("mapeia PTAX e Brent a partir dos indicadores globais", () => {
    const payload = mapMarketGlobalIndicatorsToHeaderTicker(
      {
        hasData: true,
        lastUpdate: "2026-07-09T10:00:00.000Z",
        sourcesLabel: "BCB PTAX · Yahoo Finance",
        ptax: {
          sellRate: 5.43,
          buyRate: 5.42,
          quoteDate: "2026-07-08",
          source: "BCB PTAX",
          lastUpdate: "2026-07-09T09:00:00.000Z",
        },
        brent: {
          price: 78.07,
          currency: "USD",
          unit: "barril",
          variationFromPrevious: 1.2,
          source: "Yahoo Finance",
          lastUpdate: "2026-07-09T10:00:00.000Z",
        },
      },
      now
    );

    assert.equal(payload.ptax.available, true);
    assert.equal(payload.ptax.sell, 5.43);
    assert.equal(payload.ptax.buy, 5.42);
    assert.equal(payload.brent.available, true);
    assert.equal(payload.brent.priceUsd, 78.07);
    assert.equal(payload.brent.changePercent, 1.2);
    assert.equal(payload.ptax.stale, false);
    assert.equal(payload.brent.stale, false);
  });

  it("retorna available=false quando não há snapshot", () => {
    const payload = mapMarketGlobalIndicatorsToHeaderTicker(
      {
        hasData: false,
        lastUpdate: null,
        sourcesLabel: null,
        ptax: null,
        brent: null,
      },
      now
    );
    assert.equal(payload.ptax.available, false);
    assert.equal(payload.brent.available, false);
  });

  it("marca cotação antiga como stale", () => {
    const oldPtax = new Date(now.getTime() - MARKET_HEADER_PTAX_STALE_MS - 1).toISOString();
    const oldBrent = new Date(now.getTime() - MARKET_HEADER_BRENT_STALE_MS - 1).toISOString();

    const payload = mapMarketGlobalIndicatorsToHeaderTicker(
      {
        hasData: true,
        lastUpdate: oldBrent,
        sourcesLabel: null,
        ptax: {
          sellRate: 5.4,
          buyRate: 5.39,
          quoteDate: "2026-07-01",
          source: "BCB PTAX",
          lastUpdate: oldPtax,
        },
        brent: {
          price: 75,
          currency: "USD",
          unit: "barril",
          variationFromPrevious: null,
          source: "Yahoo Finance",
          lastUpdate: oldBrent,
        },
      },
      now
    );

    assert.equal(payload.ptax.stale, true);
    assert.equal(payload.brent.stale, true);
  });

  it("tooltips incluem fonte, data e compra/venda", () => {
    const ptaxTooltip = buildMarketHeaderPtaxTooltip({
      available: true,
      sell: 5.43,
      buy: 5.42,
      quoteDate: "2026-07-08",
      collectedAt: "2026-07-09T09:00:00.000Z",
      source: "BCB PTAX",
    });
    assert.match(ptaxTooltip, /PTAX Venda/);
    assert.match(ptaxTooltip, /PTAX Compra/);
    assert.match(ptaxTooltip, /BCB PTAX/);

    const brentTooltip = buildMarketHeaderBrentTooltip({
      available: true,
      priceUsd: 78.07,
      changePercent: -0.5,
      collectedAt: "2026-07-09T10:00:00.000Z",
      source: "Yahoo Finance",
    });
    assert.match(brentTooltip, /US\$ 78\.07/);
    assert.match(brentTooltip, /Variação/);
    assert.match(brentTooltip, /Yahoo Finance/);
  });

  it("tooltips de fallback quando sem cotação", () => {
    assert.match(buildMarketHeaderPtaxTooltip({ available: false }), /Sem cotação PTAX/);
    assert.match(buildMarketHeaderBrentTooltip({ available: false }), /Sem cotação Brent/);
  });

  it("isMarketHeaderTickerStale respeita limite de idade", () => {
    const recent = new Date(now.getTime() - 1_000).toISOString();
    const old = new Date(now.getTime() - MARKET_HEADER_PTAX_STALE_MS - 1).toISOString();
    assert.equal(isMarketHeaderTickerStale(recent, MARKET_HEADER_PTAX_STALE_MS, now.getTime()), false);
    assert.equal(isMarketHeaderTickerStale(old, MARKET_HEADER_PTAX_STALE_MS, now.getTime()), true);
  });
});

describe("marketHeaderTicker — integração", () => {
  it("endpoint leve usa snapshots sem coleta externa", () => {
    const routes = read("src/lib/marketGlobalIndicatorsRoutes.ts");
    assert.match(routes, /MARKET_HEADER_TICKER_API/);
    const registerStart = routes.indexOf("export function registerMarketGlobalIndicatorsRoutes");
    assert.ok(registerStart >= 0);
    const headerStart = routes.indexOf("MARKET_HEADER_TICKER_API", registerStart);
    const headerEnd = routes.indexOf("/api/market-intelligence/global-indicators", headerStart);
    const headerBlock = routes.slice(headerStart, headerEnd);
    assert.ok(headerStart >= 0 && headerEnd > headerStart);
    assert.match(headerBlock, /loadMarketGlobalIndicators/);
    assert.match(headerBlock, /mapMarketGlobalIndicatorsToHeaderTicker/);
    assert.doesNotMatch(headerBlock, /collectBrentCommoditySnapshot/);
    assert.doesNotMatch(headerBlock, /collectPtaxSnapshot/);
    assert.match(routes, /requireAppAuth/);
  });

  it("header global renderiza ticker antes do status Nomus", () => {
    const layout = read("src/components/layout/Layout.tsx");
    const bar = read("src/components/layout/AppHeaderBar.tsx");
    const ticker = read("src/components/layout/MarketHeaderTicker.tsx");
    assert.match(layout, /AppHeaderBar/);
    assert.match(bar, /MarketHeaderTicker/);
    assert.match(ticker, /market-header-ticker-ptax/);
    assert.match(ticker, /market-header-ticker-brent/);
    const renderStart = bar.indexOf("return (");
    const tickerIdx = bar.indexOf("<MarketHeaderTicker", renderStart);
    const onlineIdx = bar.indexOf("<OnlineBadge", renderStart);
    const nomusIdx = bar.indexOf('data-header-nomus-sync="full"', renderStart);
    assert.ok(tickerIdx >= 0 && onlineIdx >= 0 && nomusIdx >= 0);
    assert.ok(tickerIdx < onlineIdx);
    assert.ok(onlineIdx < nomusIdx);
    assert.match(bar, /authUser \? \(/);
  });

  it("ticker não chama API externa no frontend", () => {
    const ticker = read("src/components/layout/MarketHeaderTicker.tsx");
    assert.match(ticker, /MARKET_HEADER_TICKER_API/);
    assert.doesNotMatch(ticker, /yahoo|bcb|fetch\(/i);
    assert.equal(MARKET_HEADER_TICKER_POLL_MS, 15 * 60 * 1000);
  });

  it("layout responsivo mantém Nomus e usuário", () => {
    const bar = read("src/components/layout/AppHeaderBar.tsx");
    assert.match(bar, /hidden 2xl:block/);
    assert.match(bar, /hidden xl:block/);
    assert.match(bar, /min-w-0/);
    assert.match(bar, /Última sincronia com o Nomus/);
    assert.match(bar, /formatRoleLabel/);
    assert.match(bar, /AppHeaderStatusMenu/);
    assert.match(bar, /data-header-user-avatar/);
  });

  it("MarketHeaderTicker aceita layout compacto/stack sem quebrar", () => {
    const ticker = read("src/components/layout/MarketHeaderTicker.tsx");
    assert.match(ticker, /layout = "default"/);
    assert.match(ticker, /"compact"/);
    assert.match(ticker, /"stack"/);
    assert.match(ticker, /data-ticker-layout=\{layout\}/);
  });
});
