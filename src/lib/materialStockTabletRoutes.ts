/**
 * Rotas aditivas — Conferência de Estoque (tablet).
 * Não altera GET/POST/PUT /api/materials.
 */
import type express from "express";
import type { PrismaClient } from "@prisma/client";
import type { RequestHandler } from "express";
import { ENGINEERING_RESOURCE_KEYS } from "./engineeringAccess.js";
import { searchMaterialStockTablet } from "./materialStockTablet.server.js";
import { parseMaterialStockTabletSearchQuery } from "./materialStockTabletQuery.js";
import { MATERIAL_STOCK_TABLET_SEARCH_PATH } from "./materialStockTabletTypes.js";

type AuthGuards = {
  requireAppAuth: RequestHandler;
  requireResource: (resourceKey: string, action?: string) => RequestHandler;
};

type RouteDeps = {
  prisma: PrismaClient;
};

export function registerMaterialStockTabletRoutes(
  app: express.Application,
  guards: AuthGuards,
  deps: RouteDeps
): void {
  const { requireAppAuth, requireResource } = guards;
  const guard = [
    requireAppAuth,
    requireResource(ENGINEERING_RESOURCE_KEYS.materials, "view"),
  ] as const;

  app.get(MATERIAL_STOCK_TABLET_SEARCH_PATH, ...guard, async (req, res) => {
    try {
      const query = parseMaterialStockTabletSearchQuery(
        req.query as Record<string, unknown>
      );
      const payload = await searchMaterialStockTablet(deps.prisma, query);
      return res.status(200).json(payload);
    } catch (error) {
      console.error(`GET ${MATERIAL_STOCK_TABLET_SEARCH_PATH}`, error);
      return res.status(500).json({
        error:
          error instanceof Error
            ? error.message
            : "Não foi possível listar matérias-primas para conferência.",
      });
    }
  });
}
