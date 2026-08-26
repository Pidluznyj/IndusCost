import type express from "express";
import type { RequestHandler } from "express";
import {
  COMMERCIAL_ACTIONS,
  COMMERCIAL_RESOURCE_KEYS,
} from "@/src/lib/commercialAccess.js";
import { prisma } from "./prisma.js";
import { buildSalesOrderResultDashboard } from "./salesOrderResultEngine.server.js";
import {
  computeAndStoreSalesOrderResultChartsCache,
  getSalesOrderResultChartsCache,
} from "./sales/salesOrderResultChartsCache.server.js";

type AuthGuards = {
  requireAppAuth: RequestHandler;
  requireResource: (resourceKey: string, action?: string) => RequestHandler;
};

/**
 * GET /api/sales-orders/results
 *
 * Guard: o mesmo da listagem de Pedidos (`commercial.sales_orders:view`).
 * Não exige engineering.products.tab.cost — gráficos da listagem e Resultado
 * devem funcionar para quem já acessa Pedidos de Venda.
 */
export function registerSalesOrderResultRoutes(app: express.Express, auth: AuthGuards) {
  app.get(
    "/api/sales-orders/results",
    auth.requireAppAuth,
    auth.requireResource(COMMERCIAL_RESOURCE_KEYS.salesOrders, COMMERCIAL_ACTIONS.view),
    async (req, res) => {
      try {
        const payload = await buildSalesOrderResultDashboard(
          prisma,
          req.query as Record<string, unknown>
        );
        res.json(payload);
      } catch (error) {
        console.error("GET /api/sales-orders/results", error);
        res.status(500).json({ error: "Erro ao carregar resultado de pedidos de venda." });
      }
    }
  );

  /**
   * Gráficos da LISTAGEM (valor vendido YoY + margem % mensal) — leitura do
   * cache materializado por ano. Miss = computa uma única vez e grava; as
   * cargas seguintes são instantâneas. O recalculo automático acontece ao
   * fim do sync de pedidos do Nomus; o manual, no POST /refresh abaixo.
   */
  app.get(
    "/api/sales-orders/results/charts-cache",
    auth.requireAppAuth,
    auth.requireResource(COMMERCIAL_RESOURCE_KEYS.salesOrders, COMMERCIAL_ACTIONS.view),
    async (req, res) => {
      try {
        const year = parseChartsCacheYear(req.query.year);
        if (year == null) {
          res.status(400).json({ error: "Parâmetro year inválido." });
          return;
        }
        const cached = await getSalesOrderResultChartsCache(prisma, year);
        if (cached) {
          res.json({ cache: cached, source: "cache" });
          return;
        }
        const computed = await computeAndStoreSalesOrderResultChartsCache(
          prisma,
          year
        );
        res.json({ cache: computed, source: "computed" });
      } catch (error) {
        console.error("GET /api/sales-orders/results/charts-cache", error);
        res.status(500).json({ error: "Erro ao carregar os gráficos de pedidos de venda." });
      }
    }
  );

  app.post(
    "/api/sales-orders/results/charts-cache/refresh",
    auth.requireAppAuth,
    auth.requireResource(COMMERCIAL_RESOURCE_KEYS.salesOrders, COMMERCIAL_ACTIONS.view),
    async (req, res) => {
      try {
        const year = parseChartsCacheYear(
          (req.body as { year?: unknown } | undefined)?.year
        );
        if (year == null) {
          res.status(400).json({ error: "Parâmetro year inválido." });
          return;
        }
        const cache = await computeAndStoreSalesOrderResultChartsCache(
          prisma,
          year
        );
        res.json({ cache, source: "computed" });
      } catch (error) {
        console.error("POST /api/sales-orders/results/charts-cache/refresh", error);
        res.status(500).json({ error: "Erro ao atualizar os gráficos de pedidos de venda." });
      }
    }
  );
}

function parseChartsCacheYear(value: unknown): number | null {
  const year = Number(String(value ?? "").trim());
  if (!Number.isInteger(year) || year < 2000 || year > 2100) return null;
  return year;
}
