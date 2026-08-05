/**
 * Rotas da série histórica do VALOR de matéria-prima em estoque.
 *
 * Namespace próprio (não `stock-tablet`, que é explicitamente sem custos):
 * aqui o dado É financeiro, então usa a mesma permissão da listagem de
 * materiais, que já expõe custo (`engineering.materials`, ação `view`).
 */

import type express from "express";
import type { PrismaClient } from "@prisma/client";
import type { RequestHandler } from "express";
import { ENGINEERING_RESOURCE_KEYS } from "./engineeringAccess.js";
import { MATERIAL_STOCK_VALUE_SERIES_PATH } from "./materialStockValueSeries.js";
import {
  listMaterialStockValueSeries,
  parseMaterialStockValueSeriesQuery,
} from "./materialStockValueSnapshot.server.js";

export type MaterialStockValueRoutesDeps = {
  prisma: PrismaClient;
  requireAppAuth: RequestHandler;
  requireResource: (resourceKey: string, action?: string) => RequestHandler;
};

export function registerMaterialStockValueRoutes(
  app: express.Express,
  deps: MaterialStockValueRoutesDeps
) {
  app.get(
    MATERIAL_STOCK_VALUE_SERIES_PATH,
    deps.requireAppAuth,
    // Somente leitura; mesma permissão do catálogo de materiais (que já
    // mostra custo e o card "Valor em estoque (MP)").
    deps.requireResource(ENGINEERING_RESOURCE_KEYS.materials, "view"),
    async (req, res) => {
      try {
        const { weeks } = parseMaterialStockValueSeriesQuery(
          req.query as Record<string, unknown>
        );
        const payload = await listMaterialStockValueSeries(deps.prisma, {
          weeks,
        });
        return res.status(200).json(payload);
      } catch (error) {
        console.error(`GET ${MATERIAL_STOCK_VALUE_SERIES_PATH}`, error);
        return res.status(500).json({
          error:
            error instanceof Error
              ? error.message
              : "Não foi possível carregar o histórico do valor em estoque.",
        });
      }
    }
  );
}
