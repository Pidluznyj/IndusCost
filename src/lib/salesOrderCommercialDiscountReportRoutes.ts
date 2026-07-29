/**
 * Rotas — Relatório de descontos comerciais.
 *
 * GET /api/sales-orders/reports/commercial-discounts
 * GET /api/sales-orders/reports/commercial-discounts/export.csv
 * GET /api/sales-orders/reports/commercial-discounts/export.xlsx
 */
import type express from "express";
import type { RequestHandler } from "express";
import {
  COMMERCIAL_ACTIONS,
  COMMERCIAL_RESOURCE_KEYS,
} from "@/src/lib/commercialAccess.js";
import {
  canExportSalesOrderCommercialDiscountReport,
  canViewSalesOrderCommercialDiscountReport,
  canViewSalesOrderCommercialDiscountReportMargin,
} from "./salesOrderCommercialDiscountReportPermissions.js";
import { prisma } from "./prisma.js";
import {
  buildSalesOrderCommercialDiscountCsv,
  buildSalesOrderCommercialDiscountXlsxBuffer,
  salesOrderCommercialDiscountExportFilename,
} from "./sales/salesOrderCommercialDiscountReportExport.js";
import { loadSalesOrderCommercialDiscountReportPayload } from "./sales/salesOrderCommercialDiscountReportService.server.js";

type AuthGuards = {
  requireAppAuth: RequestHandler;
  requireResource: (resourceKey: string, action?: string) => RequestHandler;
  resolveEmitterName?: (
    req: express.Request
  ) => Promise<string | null> | string | null;
  resolvePermissionBag?: (
    req: express.Request
  ) => Promise<{
    hasPermission: (key: string) => boolean;
    canAccessResource?: (resourceKey: string, action?: string) => boolean;
  } | null>;
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

async function resolveAuthBag(req: express.Request, auth: AuthGuards) {
  if (auth.resolvePermissionBag) {
    const bag = await auth.resolvePermissionBag(req);
    if (bag) return bag;
  }
  // Fallback pós-requireResource(commercial.sales_orders): libera visão do relatório;
  // margem continua dependente de chave específica / flow.values.
  return {
    hasPermission: (key: string) => key === "sales_orders.view",
  };
}

export function registerSalesOrderCommercialDiscountReportRoutes(
  app: express.Express,
  auth: AuthGuards
) {
  const guard = [
    auth.requireAppAuth,
    auth.requireResource(COMMERCIAL_RESOURCE_KEYS.salesOrders, COMMERCIAL_ACTIONS.view),
  ];

  app.get(
    "/api/sales-orders/reports/commercial-discounts",
    ...guard,
    async (req, res) => {
      try {
        const bag = await resolveAuthBag(req, auth);
        if (!canViewSalesOrderCommercialDiscountReport(bag)) {
          res.status(403).json({ error: "Sem permissão para o relatório de descontos." });
          return;
        }
        const includeMargin = canViewSalesOrderCommercialDiscountReportMargin(bag);
        const emitterName = await resolveEmitterName(req, auth);
        const payload = await loadSalesOrderCommercialDiscountReportPayload(prisma, {
          query: req.query as Record<string, unknown>,
          emitterName,
          includeMargin,
        });
        res.setHeader("Cache-Control", "no-store");
        res.json(payload);
      } catch (error) {
        console.error("GET /api/sales-orders/reports/commercial-discounts", error);
        res.status(500).json({
          error: "Erro ao carregar o relatório de descontos comerciais.",
        });
      }
    }
  );

  app.get(
    "/api/sales-orders/reports/commercial-discounts/export.csv",
    ...guard,
    async (req, res) => {
      try {
        const bag = await resolveAuthBag(req, auth);
        if (!canExportSalesOrderCommercialDiscountReport(bag)) {
          res.status(403).json({ error: "Sem permissão para exportar o relatório." });
          return;
        }
        const includeMargin = canViewSalesOrderCommercialDiscountReportMargin(bag);
        const emitterName = await resolveEmitterName(req, auth);
        const payload = await loadSalesOrderCommercialDiscountReportPayload(prisma, {
          query: {
            ...(req.query as Record<string, unknown>),
            includeAllRows: "1",
          },
          emitterName,
          includeMargin,
          includeAllRows: true,
        });
        const csv = buildSalesOrderCommercialDiscountCsv(payload);
        const filename = salesOrderCommercialDiscountExportFilename("csv");
        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
        res.setHeader("Cache-Control", "no-store");
        res.send(csv);
      } catch (error) {
        console.error(
          "GET /api/sales-orders/reports/commercial-discounts/export.csv",
          error
        );
        res.status(500).json({ error: "Erro ao exportar CSV de descontos." });
      }
    }
  );

  app.get(
    "/api/sales-orders/reports/commercial-discounts/export.xlsx",
    ...guard,
    async (req, res) => {
      try {
        const bag = await resolveAuthBag(req, auth);
        if (!canExportSalesOrderCommercialDiscountReport(bag)) {
          res.status(403).json({ error: "Sem permissão para exportar o relatório." });
          return;
        }
        const includeMargin = canViewSalesOrderCommercialDiscountReportMargin(bag);
        const emitterName = await resolveEmitterName(req, auth);
        const payload = await loadSalesOrderCommercialDiscountReportPayload(prisma, {
          query: {
            ...(req.query as Record<string, unknown>),
            includeAllRows: "1",
          },
          emitterName,
          includeMargin,
          includeAllRows: true,
        });
        const buffer = buildSalesOrderCommercialDiscountXlsxBuffer(payload);
        const filename = salesOrderCommercialDiscountExportFilename("xlsx");
        res.setHeader(
          "Content-Type",
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        );
        res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
        res.setHeader("Cache-Control", "no-store");
        res.send(buffer);
      } catch (error) {
        console.error(
          "GET /api/sales-orders/reports/commercial-discounts/export.xlsx",
          error
        );
        res.status(500).json({ error: "Erro ao exportar Excel de descontos." });
      }
    }
  );
}
