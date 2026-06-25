import type express from "express";
import type { RequestHandler } from "express";
import { prisma } from "./prisma.js";
import {
  buildSalesOrderMarginIndicatorsPayload,
  parseSalesOrderMarginIndicatorFilters,
} from "./salesOrderMarginIndicators.server.js";

type AuthGuards = {
  requireAppAuth: RequestHandler;
  requireAnyPermission: (permissions: string[]) => RequestHandler;
};

export function registerSalesOrderMarginIndicatorsRoutes(
  app: express.Express,
  auth: AuthGuards
) {
  app.get(
    "/api/sales-orders/margin-indicators",
    auth.requireAppAuth,
    auth.requireAnyPermission(["sales_orders.view"]),
    async (req, res) => {
      try {
        const filters = parseSalesOrderMarginIndicatorFilters(req.query as Record<string, unknown>);
        const payload = await buildSalesOrderMarginIndicatorsPayload(prisma, filters);
        res.json(payload);
      } catch (error) {
        console.error("GET /api/sales-orders/margin-indicators", error);
        res.status(500).json({ error: "Erro ao carregar indicadores de margem." });
      }
    }
  );
}
