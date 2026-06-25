import type express from "express";
import type { RequestHandler } from "express";
import { prisma } from "./prisma.js";
import {
  buildSalesOrderInternalMarginExportWorkbook,
  salesOrderInternalMarginExportFilename,
  salesOrderInternalMarginWorkbookToBytes,
} from "./salesOrderInternalMarginExport.js";
import {
  loadSalesOrderInternalMarginExportPayload,
  type SalesOrderInternalMarginExportScope,
} from "./salesOrderInternalMarginExport.server.js";

type AuthGuards = {
  requireAppAuth: RequestHandler;
  requireAnyPermission: (permissions: string[]) => RequestHandler;
};

const SCOPES: Record<string, SalesOrderInternalMarginExportScope> = {
  list: "list",
  management: "management",
  indicators: "indicators",
};

function resolveScope(raw: unknown): SalesOrderInternalMarginExportScope {
  const token = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  return SCOPES[token] ?? "list";
}

async function handleInternalMarginExport(
  req: express.Request,
  res: express.Response,
  scope: SalesOrderInternalMarginExportScope
) {
  const payload = await loadSalesOrderInternalMarginExportPayload(
    prisma,
    scope,
    req.query as Record<string, unknown>
  );
  const workbook = buildSalesOrderInternalMarginExportWorkbook(payload);
  const bytes = salesOrderInternalMarginWorkbookToBytes(workbook);
  const filename = salesOrderInternalMarginExportFilename(scope);
  res.setHeader(
    "Content-Type",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  );
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(Buffer.from(bytes));
}

export function registerSalesOrderInternalMarginExportRoutes(
  app: express.Express,
  auth: AuthGuards
) {
  const guard = [auth.requireAppAuth, auth.requireAnyPermission(["sales_orders.view"])];

  app.get("/api/sales-orders/export-internal.xlsx", ...guard, async (req, res) => {
    try {
      await handleInternalMarginExport(req, res, resolveScope(req.query.scope));
    } catch (error) {
      console.error("GET /api/sales-orders/export-internal.xlsx", error);
      res.status(500).json({ error: "Erro ao exportar relatório interno de margem." });
    }
  });

  app.get("/api/sales-orders/management/export-internal.xlsx", ...guard, async (req, res) => {
    try {
      await handleInternalMarginExport(req, res, "management");
    } catch (error) {
      console.error("GET /api/sales-orders/management/export-internal.xlsx", error);
      res.status(500).json({ error: "Erro ao exportar relatório interno de margem." });
    }
  });

  app.get("/api/sales-orders/margin-indicators/export-internal.xlsx", ...guard, async (req, res) => {
    try {
      await handleInternalMarginExport(req, res, "indicators");
    } catch (error) {
      console.error("GET /api/sales-orders/margin-indicators/export-internal.xlsx", error);
      res.status(500).json({ error: "Erro ao exportar relatório interno de margem." });
    }
  });
}
