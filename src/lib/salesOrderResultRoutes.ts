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
import { SALES_ORDER_PRODUCT_FILTER_OPTIONS_PATH } from "./salesOrderProductFilter.js";
import { searchSalesOrderProductFilterOptions } from "./salesOrderProductFilterOptions.server.js";

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
 *
 * Performance: a tela Resultado não exibe a série anual de margem comercial do
 * gráfico da listagem (servida pelo charts-cache); a rota pede ao motor para
 * pulá-la (`includeListMarginChartSeries: false`). Nenhum número exibido muda.
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
          req.query as Record<string, unknown>,
          new Date(),
          { includeListMarginChartSeries: false }
        );
        res.json(payload);
      } catch (error) {
        console.error("GET /api/sales-orders/results", error);
        res.status(500).json({ error: "Erro ao carregar resultado de pedidos de venda." });
      }
    }
  );

  /**
   * Opções do filtro de produto da tela Resultado (dropdown com busca por SKU ou
   * nome): produtos que aparecem em itens de pedido de venda. Rota estática,
   * registrada antes de `/api/sales-orders/:id`.
   */
  app.get(
    SALES_ORDER_PRODUCT_FILTER_OPTIONS_PATH,
    auth.requireAppAuth,
    auth.requireResource(COMMERCIAL_RESOURCE_KEYS.salesOrders, COMMERCIAL_ACTIONS.view),
    async (req, res) => {
      try {
        const options = await searchSalesOrderProductFilterOptions(
          prisma,
          req.query as Record<string, unknown>
        );
        res.json({ options });
      } catch (error) {
        console.error(`GET ${SALES_ORDER_PRODUCT_FILTER_OPTIONS_PATH}`, error);
        res.status(500).json({ error: "Erro ao buscar produtos para o filtro." });
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
