/**
 * Rotas de indicadores executivos SC (OP-26).
 * Feature flag SUPPLY_CHAIN_INDICATORS_ENABLED (default off).
 */
import type express from "express";
import type { RequestHandler } from "express";
import { prisma } from "@/src/lib/prisma.js";
import {
  OPERATIONS_ACTIONS,
  OPERATIONS_RESOURCE_KEYS,
} from "@/src/lib/operationsAccess.js";
import {
  requireEnvFlagEnabled,
  SUPPLY_CHAIN_FEATURE_ENV,
} from "@/src/lib/supply-chain/supplyChainFeatureFlags.js";
import { buildSupplyChainIndicators } from "@/src/lib/purchasing/supplyChainIndicatorsService.server.js";

type AuthGuards = {
  requireAppAuth: RequestHandler;
  requireResource: (resourceKey: string, action: string) => RequestHandler;
};

export function registerSupplyChainIndicatorsRoutes(app: express.Express, auth: AuthGuards) {
  const flag = requireEnvFlagEnabled(SUPPLY_CHAIN_FEATURE_ENV.indicators);
  const view = [
    auth.requireAppAuth,
    flag,
    auth.requireResource(OPERATIONS_RESOURCE_KEYS.purchases, OPERATIONS_ACTIONS.view),
  ] as const;

  app.get("/api/supply-chain/indicators", ...view, async (req, res) => {
    try {
      const result = await buildSupplyChainIndicators(prisma, {
        periodFrom: req.query.periodFrom ? String(req.query.periodFrom) : undefined,
        periodTo: req.query.periodTo ? String(req.query.periodTo) : undefined,
        supplierId: req.query.supplierId ? String(req.query.supplierId) : undefined,
        materialId: req.query.materialId ? String(req.query.materialId) : undefined,
        warehouseId: req.query.warehouseId ? String(req.query.warehouseId) : undefined,
      });
      res.setHeader("Cache-Control", "no-store");
      res.json(result);
    } catch (e) {
      console.error("supply-chain indicators error:", e);
      res.status(500).json({ error: "Erro ao agregar indicadores da cadeia de suprimentos." });
    }
  });
}
