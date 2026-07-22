/**
 * Rotas — Recebíveis mensais por Pedido de Venda (OP-08).
 * GET /api/sales-orders/reports/monthly-receivables
 * GET /api/sales-orders/reports/monthly-receivables/detail
 * GET /api/sales-orders/reports/monthly-receivables/export.xlsx
 * GET /api/sales-orders/reports/monthly-receivables/export.pdf (JSON print payload)
 */
import type express from "express";
import type { RequestHandler } from "express";
import {
  COMMERCIAL_ACTIONS,
  COMMERCIAL_RESOURCE_KEYS,
} from "@/src/lib/commercialAccess.js";
import { prisma } from "./prisma.js";
import { buildSalesOrderMonthlyReceivablesXlsxBuffer } from "./sales/salesOrderMonthlyReceivablesReportExport.js";
import {
  loadSalesOrderMonthlyReceivablesDetail,
  loadSalesOrderMonthlyReceivablesReportPayload,
} from "./sales/salesOrderMonthlyReceivablesReportService.server.js";

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

export function registerSalesOrderMonthlyReceivablesReportRoutes(
  app: express.Express,
  auth: AuthGuards
) {
  const guard = [
    auth.requireAppAuth,
    auth.requireResource(COMMERCIAL_RESOURCE_KEYS.salesOrders, COMMERCIAL_ACTIONS.view),
  ];

  app.get(
    "/api/sales-orders/reports/monthly-receivables",
    ...guard,
    async (req, res) => {
      try {
        const emitterName = await resolveEmitterName(req, auth);
        const payload = await loadSalesOrderMonthlyReceivablesReportPayload(prisma, {
          query: req.query as Record<string, unknown>,
          emitterName,
        });
        res.setHeader("Cache-Control", "no-store");
        res.json(payload);
      } catch (error) {
        console.error("GET /api/sales-orders/reports/monthly-receivables", error);
        res.status(500).json({
          error: "Erro ao carregar o relatório de recebíveis mensais.",
        });
      }
    }
  );

  app.get(
    "/api/sales-orders/reports/monthly-receivables/detail",
    ...guard,
    async (req, res) => {
      try {
        const salesOrderId = String(req.query.salesOrderId ?? "").trim();
        if (!salesOrderId) {
          res.status(400).json({ error: "salesOrderId é obrigatório." });
          return;
        }
        const monthKey = String(req.query.monthKey ?? "").trim() || null;
        const detail = await loadSalesOrderMonthlyReceivablesDetail(prisma, {
          salesOrderId,
          monthKey,
        });
        if (!detail) {
          res.status(404).json({ error: "Pedido ou agenda não encontrados." });
          return;
        }
        res.setHeader("Cache-Control", "no-store");
        res.json(detail);
      } catch (error) {
        console.error(
          "GET /api/sales-orders/reports/monthly-receivables/detail",
          error
        );
        res.status(500).json({ error: "Erro ao carregar o detalhe do mês." });
      }
    }
  );

  app.get(
    "/api/sales-orders/reports/monthly-receivables/export.xlsx",
    ...guard,
    async (req, res) => {
      try {
        const emitterName = await resolveEmitterName(req, auth);
        const payload = await loadSalesOrderMonthlyReceivablesReportPayload(prisma, {
          query: {
            ...(req.query as Record<string, unknown>),
            includeAllRows: "1",
          },
          emitterName,
        });
        const buffer = buildSalesOrderMonthlyReceivablesXlsxBuffer(payload);
        const stamp = new Date().toISOString().slice(0, 10);
        res.setHeader(
          "Content-Type",
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        );
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="recebiveis-mensais-pedidos-${stamp}.xlsx"`
        );
        res.setHeader("Cache-Control", "no-store");
        res.send(buffer);
      } catch (error) {
        console.error(
          "GET /api/sales-orders/reports/monthly-receivables/export.xlsx",
          error
        );
        res.status(500).json({ error: "Erro ao exportar Excel." });
      }
    }
  );

  app.get(
    "/api/sales-orders/reports/monthly-receivables/export.pdf",
    ...guard,
    async (req, res) => {
      try {
        const emitterName = await resolveEmitterName(req, auth);
        const payload = await loadSalesOrderMonthlyReceivablesReportPayload(prisma, {
          query: {
            ...(req.query as Record<string, unknown>),
            includeAllRows: "1",
          },
          emitterName,
        });
        res.setHeader("Cache-Control", "no-store");
        res.json(payload);
      } catch (error) {
        console.error(
          "GET /api/sales-orders/reports/monthly-receivables/export.pdf",
          error
        );
        res.status(500).json({ error: "Erro ao preparar PDF." });
      }
    }
  );
}
