/**
 * Rotas read-only — Funil Pedido → Caixa.
 * GET /api/sales/order-to-cash-funnel
 * GET /api/sales/order-to-cash-funnel/orders/:salesOrderId
 */

import type express from "express";
import type { RequestHandler } from "express";
import { financeApiErrorJson } from "./financeTabLoadError.js";
import {
  ORDER_TO_CASH_FUNNEL_VIEW_PERMISSIONS,
  OrderToCashFunnelApiParseError,
} from "./sales/salesOrderToCashFunnelApi.js";
import {
  loadOrderToCashFunnelList,
  loadOrderToCashFunnelOrderDetail,
} from "./sales/salesOrderToCashFunnelApi.server.js";

type AuthGuards = {
  requireAppAuth: RequestHandler;
  requireAnyPermission: (permissions: string[]) => RequestHandler;
};

export { ORDER_TO_CASH_FUNNEL_VIEW_PERMISSIONS };

export function registerSalesOrderToCashFunnelRoutes(
  app: express.Express,
  auth: AuthGuards
) {
  const guard = [
    auth.requireAppAuth,
    auth.requireAnyPermission([...ORDER_TO_CASH_FUNNEL_VIEW_PERMISSIONS]),
  ];

  app.get("/api/sales/order-to-cash-funnel", ...guard, async (req, res) => {
    try {
      const payload = await loadOrderToCashFunnelList(
        req.query as Record<string, unknown>
      );
      res.json(payload);
    } catch (error) {
      if (error instanceof OrderToCashFunnelApiParseError) {
        res.status(400).json({ error: error.message, message: error.message });
        return;
      }
      console.error("GET /api/sales/order-to-cash-funnel", error);
      res.status(500).json(
        financeApiErrorJson(
          "Erro ao carregar o Funil Pedido → Caixa.",
          new Error("Falha interna ao montar o funil. Tente novamente.")
        )
      );
    }
  });

  app.get(
    "/api/sales/order-to-cash-funnel/orders/:salesOrderId",
    ...guard,
    async (req, res) => {
      try {
        const salesOrderId = String(req.params.salesOrderId ?? "").trim();
        if (!salesOrderId) {
          res.status(400).json({
            error: "salesOrderId obrigatório.",
            message: "salesOrderId obrigatório.",
          });
          return;
        }
        const payload = await loadOrderToCashFunnelOrderDetail(
          salesOrderId,
          req.query as Record<string, unknown>
        );
        if (!payload.ok) {
          res.status(404).json(payload);
          return;
        }
        res.json(payload);
      } catch (error) {
        if (error instanceof OrderToCashFunnelApiParseError) {
          res.status(400).json({ error: error.message, message: error.message });
          return;
        }
        console.error(
          "GET /api/sales/order-to-cash-funnel/orders/:salesOrderId",
          error
        );
        res.status(500).json(
          financeApiErrorJson(
            "Erro ao carregar detalhe do pedido no Funil Pedido → Caixa.",
            new Error("Falha interna ao montar o detalhe. Tente novamente.")
          )
        );
      }
    }
  );
}
