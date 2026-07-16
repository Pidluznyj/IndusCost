import type express from "express";
import type { RequestHandler } from "express";
import { prisma } from "./prisma.js";
import { getProductionOrderDetailById } from "./productionOrdersDetail.server.js";
import { isProductionOrderDetailId } from "./productionOrdersDetail.js";
import { listProductionOrdersForGrid } from "./productionOrdersList.server.js";
import {
  ProductionOrdersListQueryError,
  parseProductionOrdersListQuery,
} from "./productionOrdersListQuery.js";
import {
  OPERATIONS_ACTIONS,
  OPERATIONS_RESOURCE_KEYS,
} from "./operationsAccess.js";

type AuthGuards = {
  requireAppAuth: RequestHandler;
  requireResource: (resourceKey: string, action?: string) => RequestHandler;
};

function handleListError(error: unknown, res: express.Response, context: string): void {
  if (error instanceof ProductionOrdersListQueryError) {
    res.status(400).json({ error: error.code, message: error.message });
    return;
  }
  const message = error instanceof Error ? error.message : "Erro interno.";
  console.error(context, error);
  res.status(500).json({ error: "INTERNAL_ERROR", message });
}

export function registerProductionOrdersRoutes(
  app: express.Express,
  auth: AuthGuards
): void {
  const { requireAppAuth, requireResource } = auth;
  const viewGuard = [
    requireAppAuth,
    requireResource(OPERATIONS_RESOURCE_KEYS.productionOrders, OPERATIONS_ACTIONS.view),
  ] as const;

  app.get("/api/operations/production-orders", ...viewGuard, async (req, res) => {
    try {
      const query = parseProductionOrdersListQuery(req.query as Record<string, unknown>);
      const payload = await listProductionOrdersForGrid(prisma, query);
      res.json(payload);
    } catch (error) {
      handleListError(error, res, "GET /api/operations/production-orders");
    }
  });

  app.get("/api/operations/production-orders/:id", ...viewGuard, async (req, res) => {
    try {
      const { id } = req.params;
      if (!isProductionOrderDetailId(id)) {
        return res.status(400).json({ error: "INVALID_ID", message: "ID inválido." });
      }
      const detail = await getProductionOrderDetailById(prisma, id);
      if (detail == null) {
        return res.status(404).json({ error: "NOT_FOUND", message: "Ordem de produção não encontrada." });
      }
      res.json(detail);
    } catch (error) {
      handleListError(error, res, "GET /api/operations/production-orders/:id");
    }
  });
}
