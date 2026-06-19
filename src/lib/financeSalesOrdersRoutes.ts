import type express from "express";
import type { RequestHandler } from "express";
import {
  buildFinanceSalesOrdersDashboard,
  parseFinanceSalesOrdersFilters,
} from "./financeSalesOrdersDashboard.js";
import { buildFinanceSalesOrdersExportCsv } from "./financeSalesOrdersExport.js";
import { FINANCE_SALES_ORDERS_VIEW_PERMISSIONS } from "./financeSalesOrdersPermissions.js";
import { financeApiErrorJson } from "./financeTabLoadError.js";

type AuthGuards = {
  requireAppAuth: RequestHandler;
  requireAnyPermission: (permissions: string[]) => RequestHandler;
};

export function registerFinanceSalesOrdersRoutes(app: express.Express, auth: AuthGuards) {
  const guard = [
    auth.requireAppAuth,
    auth.requireAnyPermission([...FINANCE_SALES_ORDERS_VIEW_PERMISSIONS]),
  ];

  app.get("/api/finance/sales-orders/dashboard", ...guard, async (req, res) => {
    try {
      const payload = await buildFinanceSalesOrdersDashboard(
        req.query as Record<string, unknown>
      );
      res.json(payload);
    } catch (error) {
      console.error("GET /api/finance/sales-orders/dashboard", error);
      res.status(500).json(
        financeApiErrorJson("Erro ao carregar dashboard de pedidos de venda.", error)
      );
    }
  });

  app.get("/api/finance/sales-orders/export", ...guard, async (req, res) => {
    try {
      const payload = await buildFinanceSalesOrdersDashboard(
        req.query as Record<string, unknown>
      );
      const csv = buildFinanceSalesOrdersExportCsv(payload);
      const year = parseFinanceSalesOrdersFilters(req.query as Record<string, unknown>).year;
      const stamp = new Date().toISOString().slice(0, 10);
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="financeiro-pedidos-${year}-${stamp}.csv"`
      );
      res.send(csv);
    } catch (error) {
      console.error("GET /api/finance/sales-orders/export", error);
      res.status(500).json({ error: "Erro ao exportar pedidos de venda." });
    }
  });
}
