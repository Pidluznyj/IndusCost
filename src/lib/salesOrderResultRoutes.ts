import type express from "express";
import type { RequestHandler } from "express";
import { prisma } from "./prisma.js";
import { buildSalesOrderResultDashboard } from "./salesOrderResultEngine.server.js";

type AuthGuards = {
  requireAppAuth: RequestHandler;
  requireAnyPermission: (permissions: string[]) => RequestHandler;
};

export function registerSalesOrderResultRoutes(app: express.Express, auth: AuthGuards) {
  app.get(
    "/api/sales-orders/results",
    auth.requireAppAuth,
    auth.requireAnyPermission(["sales_orders.view"]),
    auth.requireAnyPermission(["products.tab.cost", "costs.view"]),
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
