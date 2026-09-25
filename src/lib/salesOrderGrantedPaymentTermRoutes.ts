/**
 * Rota do KPI "Prazo médio concedido" — listagem de Pedidos de Venda.
 *
 * GET /api/sales-orders/payment-term-summary
 *   Mesma autorização da listagem: requireAppAuth + requireResource
 *   ("commercial.sales_orders", "view"). NÃO exige permissão de custo/margem —
 *   a métrica é condição comercial de pagamento, não informação econômica.
 *
 * Deve ser registrada ANTES de `/api/sales-orders/:id` (rota estática).
 */
import type express from "express";
import type { RequestHandler } from "express";
import {
  COMMERCIAL_ACTIONS,
  COMMERCIAL_RESOURCE_KEYS,
} from "@/src/lib/commercialAccess.js";
import { prisma } from "./prisma.js";
import { SALES_ORDER_GRANTED_PAYMENT_TERM_SUMMARY_PATH } from "./salesOrderGrantedPaymentTermApi.js";
import { loadSalesOrderGrantedPaymentTermSummary } from "./salesOrderGrantedPaymentTermSummary.server.js";

type AuthGuards = {
  requireAppAuth: RequestHandler;
  requireResource: (resourceKey: string, action?: string) => RequestHandler;
};

export function registerSalesOrderGrantedPaymentTermRoutes(
  app: express.Express,
  auth: AuthGuards
) {
  const guard = [
    auth.requireAppAuth,
    auth.requireResource(COMMERCIAL_RESOURCE_KEYS.salesOrders, COMMERCIAL_ACTIONS.view),
  ];

  app.get(SALES_ORDER_GRANTED_PAYMENT_TERM_SUMMARY_PATH, ...guard, async (req, res) => {
    try {
      const paymentTermSummary = await loadSalesOrderGrantedPaymentTermSummary(
        prisma,
        req.query as Record<string, unknown>
      );
      res.json({ paymentTermSummary });
    } catch (error) {
      console.error(`GET ${SALES_ORDER_GRANTED_PAYMENT_TERM_SUMMARY_PATH}`, error);
      res
        .status(500)
        .json({ error: "Erro ao carregar o prazo médio concedido dos pedidos." });
    }
  });
}
