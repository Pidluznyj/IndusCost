/**
 * Rotas do Relatório de Resultado Industrial dos Pedidos.
 * GET /api/sales-orders/industrial-result-report → JSON para PDF (print client-side).
 *
 * Guards: mesmas do relatório comercial de Pedidos (`sales_orders.view`).
 */
import type express from "express";
import type { RequestHandler } from "express";
import {
  COMMERCIAL_ACTIONS,
  COMMERCIAL_RESOURCE_KEYS,
} from "@/src/lib/commercialAccess.js";
import { prisma } from "./prisma.js";
import { loadSalesOrderIndustrialResultReportPayload } from "./sales/salesOrderIndustrialResultReportService.server.js";

type AuthGuards = {
  requireAppAuth: RequestHandler;
  requireResource: (resourceKey: string, action?: string) => RequestHandler;
  resolveEmitterName?: (
    req: express.Request
  ) => Promise<string | null> | string | null;
};

async function resolveEmitterName(
  req: express.Request,
  auth: AuthGuards
): Promise<string | null> {
  if (!auth.resolveEmitterName) return null;
  try {
    const result = await auth.resolveEmitterName(req);
    if (typeof result === "string" && result.trim()) return result.trim();
    return null;
  } catch {
    return null;
  }
}

export function registerSalesOrderIndustrialResultReportRoutes(
  app: express.Express,
  auth: AuthGuards
) {
  const guard = [
    auth.requireAppAuth,
    auth.requireResource(COMMERCIAL_RESOURCE_KEYS.salesOrders, COMMERCIAL_ACTIONS.view),
  ];

  app.get("/api/sales-orders/industrial-result-report", ...guard, async (req, res) => {
    try {
      const emitterName = await resolveEmitterName(req, auth);
      const payload = await loadSalesOrderIndustrialResultReportPayload(prisma, {
        query: req.query as Record<string, unknown>,
        emitterName,
      });
      res.setHeader("Cache-Control", "no-store");
      res.json(payload);
    } catch (error) {
      console.error("GET /api/sales-orders/industrial-result-report", error);
      res.status(500).json({
        error: "Erro ao carregar o relatório de resultado industrial dos pedidos.",
      });
    }
  });
}
