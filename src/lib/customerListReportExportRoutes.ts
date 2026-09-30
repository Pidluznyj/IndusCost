import type express from "express";
import type { RequestHandler } from "express";
import {
  COMMERCIAL_ACTIONS,
  COMMERCIAL_RESOURCE_KEYS,
} from "@/src/lib/commercialAccess.js";
import type { AppAuthContext } from "@/src/lib/auth/appAuth.shared.js";
import { prisma } from "./prisma.js";
import { canExposeCustomerSalesBlockFinancialDetails } from "./commercial/customerSalesBlock.server.js";
import {
  buildCustomerListReportExportPdf,
  buildCustomerListReportExportWorkbook,
  customerListReportExportFilename,
  customerListReportWorkbookToBytes,
} from "./customerListReportExport.js";
import { loadCustomerListReportExportPayload } from "./customerListReportExport.server.js";

type AuthGuards = {
  requireAppAuth: RequestHandler;
  requireResource: (resourceKey: string, action?: string) => RequestHandler;
};

function readRequestAuth(req: express.Request): AppAuthContext | null {
  return (req as { appAuth?: AppAuthContext }).appAuth ?? null;
}

export function registerCustomerListReportExportRoutes(
  app: express.Express,
  auth: AuthGuards
) {
  const guard = [
    auth.requireAppAuth,
    auth.requireResource(COMMERCIAL_RESOURCE_KEYS.customers, COMMERCIAL_ACTIONS.view),
  ];

  app.get("/api/customers/export-report.xlsx", ...guard, async (req, res) => {
    try {
      const payload = await loadCustomerListReportExportPayload(
        prisma,
        req.query as Record<string, unknown>,
        { includeFinancialDetails: canExposeCustomerSalesBlockFinancialDetails(readRequestAuth(req)) }
      );
      const workbook = buildCustomerListReportExportWorkbook(payload);
      const bytes = customerListReportWorkbookToBytes(workbook);
      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      );
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${customerListReportExportFilename("xlsx")}"`
      );
      res.send(Buffer.from(bytes));
    } catch (error) {
      console.error("GET /api/customers/export-report.xlsx", error);
      res.status(500).json({ error: "Erro ao exportar Excel de clientes." });
    }
  });

  app.get("/api/customers/export-report.pdf", ...guard, async (req, res) => {
    try {
      const payload = await loadCustomerListReportExportPayload(
        prisma,
        req.query as Record<string, unknown>,
        { includeFinancialDetails: canExposeCustomerSalesBlockFinancialDetails(readRequestAuth(req)) }
      );
      const pdf = buildCustomerListReportExportPdf(payload);
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${customerListReportExportFilename("pdf")}"`
      );
      res.send(pdf);
    } catch (error) {
      console.error("GET /api/customers/export-report.pdf", error);
      res.status(500).json({ error: "Erro ao gerar PDF de clientes." });
    }
  });
}
