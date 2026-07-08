import type express from "express";
import type { RequestHandler } from "express";
import { loadMarketGlobalIndicators } from "@/src/lib/marketGlobalIndicators.server.js";

type AuthGuards = {
  requireAppAuth: RequestHandler;
  requirePermission: (permission: string) => RequestHandler;
};

const VIEW_PERMISSION = "materials.view";

export function registerMarketGlobalIndicatorsRoutes(
  app: express.Application,
  guards: AuthGuards
): void {
  const { requireAppAuth, requirePermission } = guards;

  app.get(
    "/api/market-intelligence/global-indicators",
    requireAppAuth,
    requirePermission(VIEW_PERMISSION),
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
}
