import type express from "express";
import type { RequestHandler } from "express";
import {
  COMMERCIAL_ACTIONS,
  COMMERCIAL_RESOURCE_KEYS,
} from "@/src/lib/commercialAccess.js";
import { prisma } from "./prisma.js";
import { buildSalesOrderResultDashboard } from "./salesOrderResultEngine.server.js";

type AuthGuards = {
  requireAppAuth: RequestHandler;
  requireResource: (resourceKey: string, action?: string) => RequestHandler;
};

export function registerSalesOrderResultRoutes(app: express.Express, auth: AuthGuards) {
  app.get(
    "/api/sales-orders/results",
    auth.requireAppAuth,
    auth.requireResource(COMMERCIAL_RESOURCE_KEYS.salesOrders, COMMERCIAL_ACTIONS.view),
    auth.requireResource("engineering.products.tab.cost", "view"),
    async (req, res) => {
      try {
        const payload = await buildSalesOrderResultDashboard(
          prisma,
          req.query as Record<string, unknown>
        );
        res.json(payload);
      } catch (error) {
        console.error("GET /api/sales-orders/results", error);
        res.status(500).json({ error: "Erro ao carregar resultado de pedidos de venda." });
      }
    }
  );
}
