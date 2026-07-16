/**
 * Rota HTTP oficial do Detalhe do Pedido de Venda.
 *
 * GET /api/sales-orders/:salesOrderId/detail
 *
 * Guardas: `requireAppAuth` + `requireResource(commercial.sales_orders.detail, view)`.
 *
 * Deve ser registrada **antes** do handler inline `/api/sales-orders/:id` no
 * `server.ts` para que a rota mais específica tenha prioridade.
 */
import type express from "express";
import type { RequestHandler } from "express";
import {
  COMMERCIAL_ACTIONS,
  COMMERCIAL_RESOURCE_KEYS,
} from "@/src/lib/commercialAccess.js";
import { getSalesOrderDetail } from "./sales-orders/salesOrderDetailService.server.js";

type AuthGuards = {
  requireAppAuth: RequestHandler;
  requireResource: (resourceKey: string, action?: string) => RequestHandler;
};

/** @deprecated Prefer COMMERCIAL_RESOURCE_KEYS.salesOrdersDetail. */
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
    auth.requireResource(
      COMMERCIAL_RESOURCE_KEYS.salesOrdersDetail,
      COMMERCIAL_ACTIONS.view
    ),
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
        const appAuth = (
          req as { appAuth?: { userId?: string; permissions?: string[] } }
        ).appAuth;
        const payload = await getSalesOrderDetail({
          salesOrderId,
          orderCode,
          userContext: appAuth
            ? {
                userId: appAuth.userId ?? null,
                permissions: appAuth.permissions ?? [],
              }
            : null,
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

export { SALES_ORDER_DETAIL_PERMISSIONS };
