import type express from "express";
import type { RequestHandler } from "express";
import {
  COMMERCIAL_ACTIONS,
  COMMERCIAL_RESOURCE_KEYS,
} from "@/src/lib/commercialAccess.js";
import { prisma } from "./prisma.js";
import {
  buildSalesOrderListReportExportPdf,
  buildSalesOrderListReportExportWorkbook,
  salesOrderListReportExportFilename,
  salesOrderListReportWorkbookToBytes,
} from "./salesOrderListReportExport.js";
import { loadSalesOrderListReportExportPayload } from "./salesOrderListReportExport.server.js";
import { loadSalesOrderSellerFilterOptions } from "./salesOrderListQuery.server.js";
import { loadSalesOrderListMarginSummary } from "./salesOrderListMarginSummary.server.js";
import {
  SALES_ORDER_LIST_MARGIN_SUMMARY_PATH,
  SALES_ORDER_LIST_PAGE_MARGINS_PATH,
} from "./salesOrderListMarginSummaryApi.js";
import { SALES_ORDERS_LAST_UPDATE_PATH } from "./salesOrdersLastUpdate.js";
import { loadSalesOrdersLastUpdatedAt } from "./salesOrdersLastUpdate.server.js";

type AuthGuards = {
  requireAppAuth: RequestHandler;
  requireResource: (resourceKey: string, action?: string) => RequestHandler;
  canViewMarginEconomics: (req: express.Request) => Promise<boolean>;
};

export function registerSalesOrderListReportExportRoutes(
  app: express.Express,
  auth: AuthGuards
) {
  const guard = [
    auth.requireAppAuth,
    auth.requireResource(COMMERCIAL_RESOURCE_KEYS.salesOrders, COMMERCIAL_ACTIONS.view),
  ];

  app.get(SALES_ORDERS_LAST_UPDATE_PATH, ...guard, async (_req, res) => {
    try {
      const lastUpdatedAt = await loadSalesOrdersLastUpdatedAt(prisma);
      res.json({ lastUpdatedAt });
    } catch (error) {
      console.error(`GET ${SALES_ORDERS_LAST_UPDATE_PATH}`, error);
      res.status(500).json({ error: "Erro ao carregar última atualização dos pedidos." });
    }
  });

  app.get("/api/sales-orders/seller-filter-options", ...guard, async (req, res) => {
    try {
      const options = await loadSalesOrderSellerFilterOptions(
        prisma,
        req.query as Record<string, unknown>
      );
      res.json({ options });
    } catch (error) {
      console.error("GET /api/sales-orders/seller-filter-options", error);
      res.status(500).json({ error: "Erro ao carregar vendedores do filtro." });
    }
  });

  app.get(SALES_ORDER_LIST_MARGIN_SUMMARY_PATH, ...guard, async (req, res) => {
    try {
      const canViewMargin = await auth.canViewMarginEconomics(req);
      if (!canViewMargin) {
        return res.status(403).json({
          error: "Sem permissão para margem econômica dos pedidos.",
          code: "MARGIN_ECONOMICS_FORBIDDEN",
        });
      }
      const marginSummary = await loadSalesOrderListMarginSummary(
        prisma,
        req.query as Record<string, unknown>
      );
      return res.json({ marginSummary });
    } catch (error) {
      console.error(`GET ${SALES_ORDER_LIST_MARGIN_SUMMARY_PATH}`, error);
      return res.status(500).json({ error: "Erro ao carregar margem geral dos pedidos." });
    }
  });

  app.get(SALES_ORDER_LIST_PAGE_MARGINS_PATH, ...guard, async (req, res) => {
    try {
      const canViewMargin = await auth.canViewMarginEconomics(req);
      if (!canViewMargin) {
        return res.status(403).json({
          error: "Sem permissão para margem econômica dos pedidos.",
          code: "MARGIN_ECONOMICS_FORBIDDEN",
        });
      }
      const { loadSalesOrderListPageMargins } = await import(
        "./salesOrderListPageMargins.server.js"
      );
      const margins = await loadSalesOrderListPageMargins(
        prisma,
        req.query as Record<string, unknown>
      );
      return res.json({ margins });
    } catch (error) {
      console.error(`GET ${SALES_ORDER_LIST_PAGE_MARGINS_PATH}`, error);
      return res.status(500).json({ error: "Erro ao carregar margens da página de pedidos." });
    }
  });

  app.get("/api/sales-orders/export-report.xlsx", ...guard, async (req, res) => {
    try {
      const showMargin = await auth.canViewMarginEconomics(req);
      const payload = await loadSalesOrderListReportExportPayload(
        prisma,
        req.query as Record<string, unknown>,
        showMargin
      );
      const workbook = buildSalesOrderListReportExportWorkbook(payload);
      const bytes = salesOrderListReportWorkbookToBytes(workbook);
      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      );
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${salesOrderListReportExportFilename("xlsx")}"`
      );
      res.send(Buffer.from(bytes));
    } catch (error) {
      console.error("GET /api/sales-orders/export-report.xlsx", error);
      res.status(500).json({ error: "Erro ao exportar relatório de pedidos." });
    }
  });

  app.get("/api/sales-orders/export-report.pdf", ...guard, async (req, res) => {
    try {
      const showMargin = await auth.canViewMarginEconomics(req);
      const payload = await loadSalesOrderListReportExportPayload(
        prisma,
        req.query as Record<string, unknown>,
        showMargin
      );
      const pdf = buildSalesOrderListReportExportPdf(payload);
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${salesOrderListReportExportFilename("pdf")}"`
      );
      res.send(pdf);
    } catch (error) {
      console.error("GET /api/sales-orders/export-report.pdf", error);
      res.status(500).json({ error: "Erro ao gerar PDF de pedidos." });
    }
  });
}
