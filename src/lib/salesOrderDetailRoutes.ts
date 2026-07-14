/**
 * Rota HTTP oficial do Detalhe do Pedido de Venda.
 *
 * GET /api/sales-orders/:salesOrderId/detail
 *
 * Guardas: `requireAppAuth` + permissão em `SALES_ORDER_DETAIL_PERMISSIONS`
 * (`sales_orders.detail.view` OR `sales_orders.view`) — mesma política do
 * endpoint legado `GET /api/sales-orders/:id`.
 *
 * Deve ser registrada **antes** do handler inline `/api/sales-orders/:id` no
 * `server.ts` para que a rota mais específica tenha prioridade.
 */
import type express from "express";
import type { RequestHandler } from "express";
import { getSalesOrderDetail } from "./sales-orders/salesOrderDetailService.server.js";

type AuthGuards = {
  requireAppAuth: RequestHandler;
  requireAnyPermission: (permissions: string[]) => RequestHandler;
};

const SALES_ORDER_DETAIL_PERMISSIONS = [
  "sales_orders.detail.view",
  "sales_orders.view",
];

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function registerSalesOrderDetailRoutes(
  app: express.Express,
  auth: AuthGuards
): void {
  const guard = [
    auth.requireAppAuth,
    auth.requireAnyPermission(SALES_ORDER_DETAIL_PERMISSIONS),
  ];

  app.get(
    "/api/sales-orders/:salesOrderId/detail",
    ...guard,
    async (req, res) => {
      const { salesOrderId } = req.params;
      if (!UUID_REGEX.test(salesOrderId)) {
        res.status(400).json({ error: "ID de pedido inválido." });
        return;
      }
      try {
        const orderCode =
          typeof req.query.orderCode === "string"
            ? req.query.orderCode.trim() || null
            : null;
        const payload = await getSalesOrderDetail({
          salesOrderId,
          orderCode,
        });
        if (!("ok" in payload) || payload.ok !== true) {
          res
            .status(payload.status ?? 500)
            .json({ error: payload.error ?? "Erro ao carregar detalhe." });
          return;
        }
        res.setHeader("Cache-Control", "no-store");
        res.json(payload);
      } catch (error) {
        console.error("GET /api/sales-orders/:salesOrderId/detail", error);
        res
          .status(500)
          .json({ error: "Erro ao carregar detalhe do pedido de venda." });
      }
    }
  );
}
