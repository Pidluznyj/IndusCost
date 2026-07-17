import type express from "express";
import type { RequestHandler } from "express";
import { ENGINEERING_RESOURCE_KEYS } from "@/src/lib/engineeringAccess.js";
import { collectBrentCommoditySnapshot } from "@/src/lib/brentCommodityCollection.js";
import { loadMarketGlobalIndicators } from "@/src/lib/marketGlobalIndicators.server.js";
import {
  mapCollectionOutcomeToRefreshPart,
  type MarketGlobalIndicatorsRefreshResponse,
} from "@/src/lib/marketGlobalIndicators.js";
import { collectPtaxSnapshot } from "@/src/lib/ptaxSnapshotCollection.js";
import {
  mapMarketGlobalIndicatorsToHeaderTicker,
  MARKET_HEADER_TICKER_API,
} from "@/src/lib/marketHeaderTicker.js";

type AuthGuards = {
  requireAppAuth: RequestHandler;
  requireResource: (resourceKey: string, action?: string) => RequestHandler;
};

export async function refreshMarketGlobalIndicators(): Promise<MarketGlobalIndicatorsRefreshResponse> {
  const [brentOutcome, ptaxOutcome] = await Promise.all([
    collectBrentCommoditySnapshot({ trigger: "MANUAL" }).catch((error) => ({
      error: error instanceof Error ? error.message : "Falha ao coletar Brent.",
    })),
    collectPtaxSnapshot({ trigger: "MANUAL" }).catch((error) => ({
      error: error instanceof Error ? error.message : "Falha ao coletar PTAX.",
    })),
  ]);

  const brent = mapCollectionOutcomeToRefreshPart(brentOutcome);
  const ptax = mapCollectionOutcomeToRefreshPart(ptaxOutcome);

  const indicators = await loadMarketGlobalIndicators();
  return { brent, ptax, indicators };
}

export function registerMarketGlobalIndicatorsRoutes(
  app: express.Application,
  guards: AuthGuards
): void {
  const { requireAppAuth, requireResource } = guards;
  const viewMi = requireResource(
    ENGINEERING_RESOURCE_KEYS.marketIntelligenceHome,
    "view"
  );
  const updateMaterials = requireResource(ENGINEERING_RESOURCE_KEYS.materials, "update");

  app.get(
    MARKET_HEADER_TICKER_API,
    requireAppAuth,
    async (_req, res) => {
      try {
        const indicators = await loadMarketGlobalIndicators();
        return res.json(mapMarketGlobalIndicatorsToHeaderTicker(indicators));
      } catch (error) {
        console.error(`GET ${MARKET_HEADER_TICKER_API}`, error);
        return res.status(500).json({
          error: "MARKET_HEADER_TICKER_FAILED",
          message: "Não foi possível carregar o ticker de mercado.",
        });
      }
    }
  );

  app.get(
    "/api/market-intelligence/global-indicators",
    requireAppAuth,
    viewMi,
    async (_req, res) => {
      try {
        const payload = await loadMarketGlobalIndicators();
        return res.json(payload);
      } catch (error) {
        console.error("GET /api/market-intelligence/global-indicators", error);
        return res.status(500).json({
          error: "GLOBAL_INDICATORS_FAILED",
          message: "Não foi possível carregar os indicadores globais de mercado.",
        });
      }
    }
  );

  app.post(
    "/api/market-intelligence/global-indicators/refresh",
    requireAppAuth,
    updateMaterials,
    async (_req, res) => {
      try {
        const payload = await refreshMarketGlobalIndicators();
        return res.status(200).json(payload);
      } catch (error) {
        console.error("POST /api/market-intelligence/global-indicators/refresh", error);
        return res.status(500).json({
          error: "GLOBAL_INDICATORS_REFRESH_FAILED",
          message: "Não foi possível atualizar os indicadores globais de mercado.",
        });
      }
    }
  );
}
