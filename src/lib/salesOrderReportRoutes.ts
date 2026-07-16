/**
 * Rotas do Relatório Comercial > Pedidos de Venda (padrão IndusCost).
 *
 * - GET /api/sales-orders/report            → JSON usado pelo PDF (client-side print).
 * - GET /api/sales-orders/report/export.xlsx → XLSX branded.
 *
 * Guards: `requireResource(commercial.sales_orders, view)`.
 */
import type express from "express";
import type { RequestHandler } from "express";
import {
  COMMERCIAL_ACTIONS,
  COMMERCIAL_RESOURCE_KEYS,
} from "@/src/lib/commercialAccess.js";
import { prisma } from "./prisma.js";
import { loadSalesOrderReportPayload } from "./sales/salesOrderReportService.server.js";
import { buildSalesOrderReportExportBuffer } from "./sales/salesOrderReportExport.js";
import { salesOrderReportExportFilename } from "./sales/salesOrderReport.js";

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

export function registerSalesOrderReportRoutes(
  app: express.Express,
  auth: AuthGuards
) {
  const guard = [
    auth.requireAppAuth,
    auth.requireResource(COMMERCIAL_RESOURCE_KEYS.salesOrders, COMMERCIAL_ACTIONS.view),
  ];

  app.get("/api/sales-orders/report", ...guard, async (req, res) => {
    try {
      const emitterName = await resolveEmitterName(req, auth);
      const payload = await loadSalesOrderReportPayload(prisma, {
        query: req.query as Record<string, unknown>,
        emitterName,
      });
      res.setHeader("Cache-Control", "no-store");
      res.json(payload);
    } catch (error) {
      console.error("GET /api/sales-orders/report", error);
      res
        .status(500)
        .json({ error: "Erro ao carregar dados do relatório de pedidos." });
    }
  });

  app.get("/api/sales-orders/report/export.xlsx", ...guard, async (req, res) => {
    try {
      const emitterName = await resolveEmitterName(req, auth);
      const payload = await loadSalesOrderReportPayload(prisma, {
        query: req.query as Record<string, unknown>,
        emitterName,
      });
      const buffer = buildSalesOrderReportExportBuffer(payload);
      const filename = salesOrderReportExportFilename({
        format: "xlsx",
        customerName: payload.filters.customerName ?? null,
      });
      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      );
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.setHeader("Cache-Control", "no-store");
      res.send(buffer);
    } catch (error) {
      console.error("GET /api/sales-orders/report/export.xlsx", error);
      res.status(500).json({ error: "Erro ao exportar XLSX de pedidos de venda." });
    }
  });
}
