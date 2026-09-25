import type express from "express";
import type { RequestHandler, Response } from "express";
import {
  COMMERCIAL_ACTIONS,
  COMMERCIAL_RESOURCE_KEYS,
} from "@/src/lib/commercialAccess.js";
import { prisma } from "./prisma.js";
import {
  buildSalesOrderResultDashboard,
  buildSalesOrderResultProjectionPayload,
  type SalesOrderResultTimings,
} from "./salesOrderResultEngine.server.js";
import {
  computeAndStoreSalesOrderResultChartsCache,
  getSalesOrderResultChartsCache,
} from "./sales/salesOrderResultChartsCache.server.js";
import { SALES_ORDER_PRODUCT_FILTER_OPTIONS_PATH } from "./salesOrderProductFilter.js";
import { searchSalesOrderProductFilterOptions } from "./salesOrderProductFilterOptions.server.js";
import {
  SALES_ORDER_RESULT_API_PATH,
  SALES_ORDER_RESULT_PROJECTION_API_PATH,
} from "./salesOrderResultApi.js";
import {
  buildSalesOrderResultCacheKey,
  createSalesOrderResultResponseCache,
  formatSalesOrderResultCacheDay,
  formatSalesOrderResultServerTiming,
  type SalesOrderResultResponseCache,
} from "./salesOrderResultResponseCache.js";
import type {
  SalesOrderResultDashboardPayload,
  SalesOrderResultProjectionPayload,
} from "./salesOrderResultTypes.js";
import { loadSalesOrdersLastUpdatedAt } from "./salesOrdersLastUpdate.server.js";

type AuthGuards = {
  requireAppAuth: RequestHandler;
  requireResource: (resourceKey: string, action?: string) => RequestHandler;
};

/** Cache curto por processo (ver salesOrderResultResponseCache.ts). */
const SALES_ORDER_RESULT_CACHE_TTL_MS = 5 * 60 * 1000;
const SALES_ORDER_RESULT_CACHE_MAX_ENTRIES = 30;
/** Requisição acima disso registra as fases no log (diagnóstico). */
const SALES_ORDER_RESULT_SLOW_LOG_MS = 3000;

const dashboardResponseCache = createSalesOrderResultResponseCache<SalesOrderResultDashboardPayload>({
  ttlMs: SALES_ORDER_RESULT_CACHE_TTL_MS,
  maxEntries: SALES_ORDER_RESULT_CACHE_MAX_ENTRIES,
});
const projectionResponseCache =
  createSalesOrderResultResponseCache<SalesOrderResultProjectionPayload>({
    ttlMs: SALES_ORDER_RESULT_CACHE_TTL_MS,
    maxEntries: SALES_ORDER_RESULT_CACHE_MAX_ENTRIES,
  });

/**
 * Responde com cache curto + Server-Timing. A resposta depende só da query (o
 * guard de acesso é o mesmo para todos): a chave não inclui o usuário.
 */
async function sendSalesOrderResultResponse<T>(
  res: Response,
  input: {
    kind: "dashboard" | "projection";
    query: Record<string, unknown>;
    cache: SalesOrderResultResponseCache<T>;
    compute: (now: Date, timings: SalesOrderResultTimings) => Promise<T>;
  }
): Promise<void> {
  const startedAt = Date.now();
  const now = new Date();
  const versionStamp = await loadSalesOrdersLastUpdatedAt(prisma).catch((error: unknown) => {
    console.warn("[sales-order-result] carimbo de atualização indisponível; sem cache.", error);
    return null;
  });
  const key = buildSalesOrderResultCacheKey(input.kind, input.query, {
    versionStamp,
    day: formatSalesOrderResultCacheDay(now),
  });
  const timings: SalesOrderResultTimings = { cacheKey: Date.now() - startedAt };
  const { value, status } = await input.cache.getOrCompute(key, () =>
    input.compute(now, timings)
  );
  timings.request = Date.now() - startedAt;
  res.setHeader("Server-Timing", formatSalesOrderResultServerTiming(timings));
  res.setHeader("X-Sales-Order-Result-Cache", status);
  if (timings.request >= SALES_ORDER_RESULT_SLOW_LOG_MS) {
    console.warn(
      `[sales-order-result] ${input.kind} lento: ${timings.request}ms (cache: ${status})`,
      timings
    );
  }
  res.json(value);
}

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
 * Respostas com cache curto (5 min, chave nova a cada sync de pedidos) e
 * Server-Timing por fase.
 */
export function registerSalesOrderResultRoutes(app: express.Express, auth: AuthGuards) {
  app.get(
    SALES_ORDER_RESULT_API_PATH,
    auth.requireAppAuth,
    auth.requireResource(COMMERCIAL_RESOURCE_KEYS.salesOrders, COMMERCIAL_ACTIONS.view),
    async (req, res) => {
      const query = req.query as Record<string, unknown>;
      try {
        await sendSalesOrderResultResponse(res, {
          kind: "dashboard",
          query,
          cache: dashboardResponseCache,
          compute: (now, timings) =>
            buildSalesOrderResultDashboard(prisma, query, now, {
              includeListMarginChartSeries: false,
              timings,
            }),
        });
      } catch (error) {
        console.error("GET /api/sales-orders/results", error);
        res.status(500).json({ error: "Erro ao carregar resultado de pedidos de venda." });
      }
    }
  );

  /**
   * GET /api/sales-orders/results/projection — Realizado vs Projetado (leve).
   * Mesmo guard, mesmo escopo e mesmos números do dashboard, sem o motor de
   * margem e sem o JSON do Nomus: o gráfico de projeção não espera a margem.
   * Rota estática, registrada antes de `/api/sales-orders/:id`.
   */
  app.get(
    SALES_ORDER_RESULT_PROJECTION_API_PATH,
    auth.requireAppAuth,
    auth.requireResource(COMMERCIAL_RESOURCE_KEYS.salesOrders, COMMERCIAL_ACTIONS.view),
    async (req, res) => {
      const query = req.query as Record<string, unknown>;
      try {
        await sendSalesOrderResultResponse(res, {
          kind: "projection",
          query,
          cache: projectionResponseCache,
          compute: (now, timings) =>
            buildSalesOrderResultProjectionPayload(prisma, query, now, { timings }),
        });
      } catch (error) {
        console.error(`GET ${SALES_ORDER_RESULT_PROJECTION_API_PATH}`, error);
        res.status(500).json({ error: "Erro ao carregar a projeção de pedidos de venda." });
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
