import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MarketGlobalIndicatorsTrendsPanel } from "./MarketGlobalIndicatorsTrendsPanel.js";
import {
  buildMarketGlobalIndicatorsHistory,
  MARKET_TRENDS_EMPTY_MESSAGE,
  MARKET_TRENDS_ERROR_MESSAGE,
  MARKET_TRENDS_SINGLE_POINT_MESSAGE,
} from "../../lib/marketGlobalIndicatorsHistory.js";

const NOW = new Date("2026-10-23T02:30:00.000Z");

const populated = buildMarketGlobalIndicatorsHistory({
  range: "30d",
  now: NOW,
  ptaxRows: [
    {
      id: "p1",
      status: "SUCCESS",
      quoteDate: "2026-10-21",
      buyRate: 5.1012,
      sellRate: 5.2013,
      source: "BCB PTAX",
      collectedAt: "2026-10-21T18:00:00.000Z",
    },
    {
      id: "p2",
      status: "SUCCESS",
      quoteDate: "2026-10-22",
      buyRate: 5.11,
      sellRate: 5.25,
      source: "BCB PTAX",
      collectedAt: "2026-10-22T18:00:00.000Z",
    },
  ],
  brentRows: [
    {
      id: "b1",
      status: "SUCCESS",
      quoteDate: "2026-10-21",
      priceUSD: 80,
      source: "yahoo-finance",
      collectedAt: "2026-10-21T18:00:00.000Z",
    },
    {
      id: "b2",
      status: "SUCCESS",
      quoteDate: "2026-10-22",
      priceUSD: 82.5,
      source: "yahoo-finance",
      collectedAt: "2026-10-22T18:00:00.000Z",
    },
  ],
});

const single = buildMarketGlobalIndicatorsHistory({
  range: "30d",
  now: NOW,
  ptaxRows: [
    {
      id: "only",
      status: "SUCCESS",
      quoteDate: "2026-10-22",
      buyRate: 5.4,
      sellRate: 5.5,
      source: "BCB PTAX",
      collectedAt: "2026-10-22T18:00:00.000Z",
    },
  ],
  brentRows: [],
});

const empty = buildMarketGlobalIndicatorsHistory({
  range: "30d",
  now: NOW,
  ptaxRows: [],
  brentRows: [],
});

function render(node: React.ReactElement): string {
  return renderToStaticMarkup(node);
}

describe("painel Tendências de Mercado", () => {
  it("fica entre os indicadores globais e as oportunidades", () => {
    const page = readFileSync(
      join(process.cwd(), "src/components/materials/MaterialsMarketIntelligencePage.tsx"),
      "utf8"
    );
    const indicators = page.indexOf("<MaterialsMarketGlobalIndicatorsSection");
    const trends = page.indexOf("<MarketGlobalIndicatorsTrendsSection");
    const opportunities = page.indexOf("Oportunidades");
    assert.ok(indicators >= 0 && trends > indicators && opportunities > trends);
    const section = readFileSync(
      join(process.cwd(), "src/components/materials/MaterialsMarketGlobalIndicatorsSection.tsx"),
      "utf8"
    );
    const trendsSection = readFileSync(
      join(process.cwd(), "src/components/materials/MarketGlobalIndicatorsTrendsSection.tsx"),
      "utf8"
    );
    assert.match(section, /notifyPersistedRefresh/);
    assert.match(section, /MARKET_GLOBAL_INDICATORS_REFRESH_API/);
    assert.match(trendsSection, /MARKET_GLOBAL_INDICATORS_HISTORY_API/);
    assert.match(trendsSection, /visibilitychange/);
    assert.doesNotMatch(trendsSection, /global-indicators\/refresh|collectPtaxSnapshot|collectBrent/);
  });

  it("mostra carregamento, erro com nova tentativa e histórico vazio", () => {
    const loading = render(
      <MarketGlobalIndicatorsTrendsPanel
        range="30d"
        onRangeChange={() => undefined}
        loading
        error={null}
        onRetry={() => undefined}
        data={null}
      />
    );
    assert.match(loading, /market-trends-loading/);
    assert.match(loading, /Tendências de Mercado/);
    assert.match(loading, /aria-pressed="true"/);
    assert.match(loading, /30 dias/);

    const failed = render(
      <MarketGlobalIndicatorsTrendsPanel
        range="30d"
        onRangeChange={() => undefined}
        loading={false}
        error={MARKET_TRENDS_ERROR_MESSAGE}
        onRetry={() => undefined}
        data={null}
      />
    );
    assert.match(failed, /market-trends-error/);
    assert.match(failed, /Tentar novamente/);

    const blank = render(
      <MarketGlobalIndicatorsTrendsPanel
        range="7d"
        onRangeChange={() => undefined}
        loading={false}
        error={null}
        onRetry={() => undefined}
        data={empty}
      />
    );
    assert.equal(blank.split(MARKET_TRENDS_EMPTY_MESSAGE).length - 1, 2);
    assert.match(blank, /xl:grid-cols-2/);
    assert.match(blank, /aria-pressed="true"/);
  });

  it("mostra PTAX, Brent, unidades, variação e o aviso de ponto único", () => {
    const html = render(
      <MarketGlobalIndicatorsTrendsPanel
        range="30d"
        onRangeChange={() => undefined}
        loading={false}
        error={null}
        onRetry={() => undefined}
        data={populated}
      />
    );
    assert.match(html, /Dólar PTAX — evolução diária/);
    assert.match(html, /Petróleo Brent — evolução diária/);
    assert.match(html, /R\$ 5,2500/);
    assert.match(html, /US\$ 82,50/);
    assert.match(html, /US\$ por barril/);
    assert.match(html, /recharts-responsive-container/);
    const panelSource = readFileSync(
      join(process.cwd(), "src/components/materials/MarketGlobalIndicatorsTrendsPanel.tsx"),
      "utf8"
    );
    assert.match(panelSource, /name="PTAX venda"/);
    assert.match(panelSource, /name="PTAX compra"/);
    assert.match(panelSource, /name="USD\/barril"/);
    assert.match(panelSource, /type="linear"/);
    assert.match(html, /Última cotação registrada no dia/);
    assert.match(html, /market-trends-ptax/);
    assert.match(html, /market-trends-brent/);
    assert.match(html, /Máximo/);
    assert.match(html, /Mínimo/);
    assert.doesNotMatch(html, /fechamento oficial/);

    const one = render(
      <MarketGlobalIndicatorsTrendsPanel
        range="30d"
        onRangeChange={() => undefined}
        loading={false}
        error={null}
        onRetry={() => undefined}
        data={single}
      />
    );
    assert.match(one, new RegExp(MARKET_TRENDS_SINGLE_POINT_MESSAGE.replace(/[.]/g, "\\.")));
    assert.match(one, /R\$ 5,5000/);
    assert.match(one, new RegExp(MARKET_TRENDS_EMPTY_MESSAGE.replace(/[.]/g, "\\.")));
  });
});
