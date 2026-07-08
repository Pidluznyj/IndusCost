import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildMarketGlobalIndicatorsSourcesLabel,
  formatBrentSourceLabel,
  mapBrentSnapshotToIndicator,
  mapMarketGlobalIndicators,
  mapPtaxSnapshotToIndicator,
  resolveMarketGlobalIndicatorsLastUpdate,
} from "./marketGlobalIndicators.js";

describe("marketGlobalIndicators DTO mapping", () => {
  it("mapeia PTAX venda e compra do snapshot salvo", () => {
    const mapped = mapPtaxSnapshotToIndicator({
      status: "SUCCESS",
      sellRate: 5.4321,
      buyRate: 5.431,
      source: "BCB PTAX",
      collectedAt: "2026-07-08T12:00:00.000Z",
    });

    assert.deepEqual(mapped, {
      sellRate: 5.4321,
      buyRate: 5.431,
      source: "BCB PTAX",
      lastUpdate: "2026-07-08T12:00:00.000Z",
    });
  });

  it("ignora PTAX sem taxas ou com status não SUCCESS", () => {
    assert.equal(
      mapPtaxSnapshotToIndicator({
        status: "FAILED",
        sellRate: 5.4,
        buyRate: 5.3,
        collectedAt: "2026-07-08T12:00:00.000Z",
      }),
      null
    );
    assert.equal(
      mapPtaxSnapshotToIndicator({
        status: "SUCCESS",
        sellRate: null,
        buyRate: 5.3,
        collectedAt: "2026-07-08T12:00:00.000Z",
      }),
      null
    );
  });

  it("mapeia Brent com variationFromPrevious do snapshot", () => {
    const mapped = mapBrentSnapshotToIndicator({
      status: "SUCCESS",
      priceUSD: 82.5,
      source: "yahoo-finance",
      collectedAt: "2026-07-08T15:30:00.000Z",
      variationFromPrevious: -1.25,
    });

    assert.deepEqual(mapped, {
      price: 82.5,
      currency: "USD",
      unit: "barril",
      variationFromPrevious: -1.25,
      source: "Yahoo Finance",
      lastUpdate: "2026-07-08T15:30:00.000Z",
    });
  });

  it("monta DTO consolidado vazio e com dados", () => {
    const empty = mapMarketGlobalIndicators({ ptax: null, brent: null });
    assert.equal(empty.hasData, false);
    assert.equal(empty.lastUpdate, null);
    assert.equal(empty.sourcesLabel, null);

    const filled = mapMarketGlobalIndicators({
      ptax: {
        status: "SUCCESS",
        sellRate: 5.5,
        buyRate: 5.4,
        source: "BCB PTAX",
        collectedAt: "2026-07-08T10:00:00.000Z",
      },
      brent: {
        status: "SUCCESS",
        priceUSD: 80,
        source: "yahoo-finance",
        collectedAt: "2026-07-08T15:00:00.000Z",
        variationFromPrevious: 0.5,
      },
    });

    assert.equal(filled.hasData, true);
    assert.equal(filled.lastUpdate, "2026-07-08T15:00:00.000Z");
    assert.equal(filled.sourcesLabel, "BCB PTAX · Yahoo Finance");
    assert.equal(filled.ptax?.sellRate, 5.5);
    assert.equal(filled.brent?.variationFromPrevious, 0.5);
  });

  it("rótulos de fonte e última atualização mais recente", () => {
    assert.equal(formatBrentSourceLabel("yahoo-finance"), "Yahoo Finance");
    assert.equal(formatBrentSourceLabel("custom-api"), "custom-api");
    assert.equal(
      buildMarketGlobalIndicatorsSourcesLabel({
        ptaxSource: "BCB PTAX",
        brentSource: null,
      }),
      "BCB PTAX"
    );
    assert.equal(
      resolveMarketGlobalIndicatorsLastUpdate(
        {
          sellRate: 1,
          buyRate: 1,
          source: "BCB PTAX",
          lastUpdate: "2026-07-08T09:00:00.000Z",
        },
        {
          price: 1,
          currency: "USD",
          unit: "barril",
          variationFromPrevious: null,
          source: "Yahoo Finance",
          lastUpdate: "2026-07-08T18:00:00.000Z",
        }
      ),
      "2026-07-08T18:00:00.000Z"
    );
  });
});
