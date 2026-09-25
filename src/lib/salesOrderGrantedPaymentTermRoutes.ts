/**
 * Rotas do KPI "Prazo médio de recebimento" — Pedidos de Venda.
 *
 * GET /api/sales-orders/payment-term-summary
 *   Card da listagem: população filtrada completa (mesma query da listagem).
 * GET /api/sales-orders/payment-term-monthly
 *   Tela Resultado: 12 meses do ano filtrado × mesmo período do ano anterior
 *   (mesmos filtros da tela, exceto Mês; aceita o filtro de produto do Resultado).
 *
 * Ambas com a autorização da listagem: requireAppAuth + requireResource
 * ("commercial.sales_orders", "view"). NÃO exigem permissão de custo/margem —
 * a métrica é prazo de recebimento (NF-e → vencimento do CR), não informação econômica.
 *
 * Devem ser registradas ANTES de `/api/sales-orders/:id` (rotas estáticas).
 */
import type express from "express";
import type { RequestHandler } from "express";
import {
  COMMERCIAL_ACTIONS,
  COMMERCIAL_RESOURCE_KEYS,
} from "@/src/lib/commercialAccess.js";
import { prisma } from "./prisma.js";
import {
  SALES_ORDER_GRANTED_PAYMENT_TERM_MONTHLY_PATH,
  SALES_ORDER_GRANTED_PAYMENT_TERM_SUMMARY_PATH,
} from "./salesOrderGrantedPaymentTermApi.js";
import {
  loadSalesOrderGrantedPaymentTermMonthlySeries,
  loadSalesOrderGrantedPaymentTermSummary,
} from "./salesOrderGrantedPaymentTermSummary.server.js";

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
        .json({ error: "Erro ao carregar o prazo médio de recebimento dos pedidos." });
    }
  });

  app.get(SALES_ORDER_GRANTED_PAYMENT_TERM_MONTHLY_PATH, ...guard, async (req, res) => {
    try {
      const paymentTermMonthly = await loadSalesOrderGrantedPaymentTermMonthlySeries(
        prisma,
        req.query as Record<string, unknown>
      );
      res.json({ paymentTermMonthly });
    } catch (error) {
      console.error(`GET ${SALES_ORDER_GRANTED_PAYMENT_TERM_MONTHLY_PATH}`, error);
      res
        .status(500)
        .json({ error: "Erro ao carregar o prazo médio de recebimento mês a mês." });
    }
  });
}
