import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { describe, it } from "node:test";
import express from "express";
import type { RequestHandler } from "express";
import { buildMarketGlobalIndicatorsHistory } from "./marketGlobalIndicatorsHistory.js";
import {
  registerMarketGlobalIndicatorsRoutes,
  type MarketGlobalIndicatorsRouteDeps,
} from "./marketGlobalIndicatorsRoutes.js";

const SAMPLE = buildMarketGlobalIndicatorsHistory({
  range: "30d",
  now: new Date("2026-10-23T02:30:00.000Z"),
  ptaxRows: [
    {
      id: "p1",
      status: "SUCCESS",
      quoteDate: "2026-10-21",
      buyRate: 5.1,
      sellRate: 5.2,
      source: "BCB PTAX",
      collectedAt: "2026-10-21T18:00:00.000Z",
    },
    {
      id: "p2",
      status: "SUCCESS",
      quoteDate: "2026-10-22",
      buyRate: 5.2,
      sellRate: 5.3,
      source: "BCB PTAX",
      collectedAt: "2026-10-22T18:00:00.000Z",
    },
  ],
  brentRows: [
    {
      id: "b1",
      status: "SUCCESS",
      quoteDate: "2026-10-22",
      priceUSD: 81.25,
      source: "yahoo-finance",
      collectedAt: "2026-10-22T18:00:00.000Z",
    },
  ],
});

function guards(mode: "anon" | "forbidden" | "ok"): {
  requireAppAuth: RequestHandler;
  requireResource: () => RequestHandler;
} {
  return {
    requireAppAuth: (_req, res, next) => {
      if (mode === "anon") {
        res.status(401).json({ error: "UNAUTHORIZED" });
        return;
      }
      next();
    },
    requireResource: () => (_req, res, next) => {
      if (mode === "forbidden") {
        res.status(403).json({ error: "FORBIDDEN" });
        return;
      }
      next();
    },
  };
}

async function withServer(
  mode: "anon" | "forbidden" | "ok",
  deps: MarketGlobalIndicatorsRouteDeps,
  run: (baseUrl: string) => Promise<void>
) {
  const app = express();
  registerMarketGlobalIndicatorsRoutes(app, guards(mode), deps);
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const port = (server.address() as AddressInfo).port;
  try {
    await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

describe("GET histórico de indicadores globais", () => {
  it("exige autenticação e a permissão de visualização", async () => {
    let calls = 0;
    await withServer("anon", { loadHistory: async () => { calls += 1; return SAMPLE; } }, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/market-intelligence/global-indicators/history?range=30d`);
      assert.equal(response.status, 401);
    });
    await withServer("forbidden", { loadHistory: async () => { calls += 1; return SAMPLE; } }, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/market-intelligence/global-indicators/history`);
      assert.equal(response.status, 403);
    });
    assert.equal(calls, 0);
  });

  it("recusa período inválido sem ler o banco e devolve a série consolidada no período válido", async () => {
    const seen: string[] = [];
    await withServer("ok", {
      loadHistory: async (input) => {
        seen.push(input.range);
        if (input.range === "30d") return SAMPLE;
        return buildMarketGlobalIndicatorsHistory({
          range: input.range,
          now: new Date("2026-10-23T02:30:00.000Z"),
          ptaxRows: [],
          brentRows: [],
        });
      },
    }, async (baseUrl) => {
      const invalid = await fetch(`${baseUrl}/api/market-intelligence/global-indicators/history?range=365d`);
      assert.equal(invalid.status, 400);
      const invalidBody = await invalid.json() as { error: string };
      assert.equal(invalidBody.error, "INVALID_RANGE");

      const empty = await fetch(`${baseUrl}/api/market-intelligence/global-indicators/history?range=7d`);
      assert.equal(empty.status, 200);
      const emptyBody = await empty.json() as { ptax: { points: unknown[] } };
      assert.equal(emptyBody.ptax.points.length, 0);

      const ok = await fetch(`${baseUrl}/api/market-intelligence/global-indicators/history?range=30d`);
      assert.equal(ok.status, 200);
      const body = await ok.json() as {
        range: string;
        ptax: { points: Array<{ sellRate: number }>; sell: { observationCount: number } };
        brent: { points: Array<{ priceUsd: number }> };
      };
      assert.equal(body.range, "30d");
      assert.equal(body.ptax.sell.observationCount, 2);
      assert.equal(body.ptax.points[1]?.sellRate, 5.3);
      assert.equal(body.brent.points[0]?.priceUsd, 81.25);
      assert.equal(JSON.stringify(body).includes("variationFromPrevious"), false);
    });
    assert.deepEqual(seen, ["7d", "30d"]);
  });

  it("erro de leitura vira falha padronizada e a rota não dispara coleta", async () => {
    await withServer("ok", {
      loadHistory: async () => {
        throw new Error("db down");
      },
    }, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/market-intelligence/global-indicators/history`);
      assert.equal(response.status, 500);
      const body = await response.json() as { error: string };
      assert.equal(body.error, "GLOBAL_INDICATORS_HISTORY_FAILED");
    });

    const routes = readFileSync(join(process.cwd(), "src/lib/marketGlobalIndicatorsRoutes.ts"), "utf8");
    const start = routes.indexOf("const parsed = parseMarketHistoryRange");
    const end = routes.indexOf("app.post(", start);
    const block = routes.slice(start, end);
    assert.ok(start >= 0 && end > start);
    assert.match(block, /loadHistory/);
    assert.doesNotMatch(block, /collectPtaxSnapshot|collectBrentCommoditySnapshot/);
  });
});
