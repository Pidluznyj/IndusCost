import type express from "express";
import type { RequestHandler } from "express";
import { prisma } from "./prisma.js";
import {
  buildSalesOrderListReportExportPdf,
  buildSalesOrderListReportExportWorkbook,
  salesOrderListReportExportFilename,
  salesOrderListReportWorkbookToBytes,
} from "./salesOrderListReportExport.js";
import { loadSalesOrderListReportExportPayload } from "./salesOrderListReportExport.server.js";
import { loadSalesOrderSellerFilterOptions } from "./salesOrderListQuery.server.js";

type AuthGuards = {
  requireAppAuth: RequestHandler;
  requirePermission: (permission: string) => RequestHandler;
  canViewMarginEconomics: (req: express.Request) => Promise<boolean>;
};

export function registerSalesOrderListReportExportRoutes(
  app: express.Express,
  auth: AuthGuards
) {
  const guard = [auth.requireAppAuth, auth.requirePermission("sales_orders.view")];

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
