/**
 * Rotas read-only — Cost-to-Cash Trace API.
 */
import type express from "express";
import type { RequestHandler } from "express";
import type { PrismaClient } from "@prisma/client";
import { COMMISSIONS_AUDIT_VIEW_PERMISSIONS } from "../commissionsPermissions.js";
import { PRODUCTION_COST_TABLE_VIEW_PERMISSIONS } from "../productionCostTablesUi.js";
import {
  CostToCashTraceApiValidationError,
  COST_TO_CASH_TRACE_VIEW_PERMISSIONS,
  buildCommissionTraceApiResponse,
  buildCostToCashTraceApiResponse,
  buildProductCostTraceApiResponse,
  buildPublishedPriceTraceApiResponse,
  buildPublishedPriceTraceEmptyApiResponse,
  buildSalesOrderTraceApiResponse,
  costToCashTraceApiError,
  parseCommissionTraceApiQuery,
  parseCostToCashTraceApiQuery,
  parseProductCostTraceApiQuery,
  parsePublishedPriceTraceApiQuery,
  parseSalesOrderTraceApiQuery,
} from "./costToCashTraceApi.js";
import {
  buildCommissionTrace,
  buildCostToCashTrace,
  buildProductCostTrace,
  buildPublishedPriceTrace,
  buildSalesOrderTrace,
} from "./costToCashTrace.server.js";
import { resolvePublishedPriceItemIdForTrace } from "./costToCashTraceResolve.server.js";

type AuthGuards = {
  requireAppAuth: RequestHandler;
  requireAnyPermission: (permissions: string[]) => RequestHandler;
};

function handleApiError(res: express.Response, error: unknown, route: string): void {
  if (error instanceof CostToCashTraceApiValidationError) {
    res.status(400).json(costToCashTraceApiError(error.message, error.code));
    return;
  }
  console.error(route, error);
  res.status(500).json(costToCashTraceApiError("Erro ao consultar rastreabilidade."));
}

export function registerCostToCashTraceRoutes(
  app: express.Express,
  deps: AuthGuards & { prisma: PrismaClient }
): void {
  const { requireAppAuth, requireAnyPermission, prisma } = deps;

  const productGuard = [
    requireAppAuth,
    requireAnyPermission([...PRODUCTION_COST_TABLE_VIEW_PERMISSIONS]),
  ] as const;

  const priceGuard = [
    requireAppAuth,
    requireAnyPermission(["pricing.view", "settings.price_tables.view"]),
  ] as const;

  const salesGuard = [
    requireAppAuth,
    requireAnyPermission(["sales_orders.view", "sales_orders.detail.view"]),
  ] as const;

  const commissionGuard = [
    requireAppAuth,
    requireAnyPermission([...COMMISSIONS_AUDIT_VIEW_PERMISSIONS]),
  ] as const;

  const fullGuard = [
    requireAppAuth,
    requireAnyPermission([...COST_TO_CASH_TRACE_VIEW_PERMISSIONS]),
  ] as const;

  app.get("/api/audit/product-cost-trace", ...productGuard, async (req, res) => {
    try {
      const query = parseProductCostTraceApiQuery(req.query as Record<string, unknown>);
      const trace = await buildProductCostTrace(prisma, {
        sku: query.sku ?? null,
        productId: query.productId ?? null,
        referenceDate: query.referenceDate ?? new Date(),
        includeBom: true,
        includeProcess: true,
        includeMaterials: true,
      });
      res.status(200).json(buildProductCostTraceApiResponse(trace));
    } catch (error) {
      handleApiError(res, error, "GET /api/audit/product-cost-trace");
    }
  });

  app.get("/api/audit/published-price-trace", ...priceGuard, async (req, res) => {
    try {
      const query = parsePublishedPriceTraceApiQuery(req.query as Record<string, unknown>);
      const resolved = await resolvePublishedPriceItemIdForTrace(prisma, {
        priceItemId: query.priceItemId,
        sku: query.sku,
        productId: query.productId,
        tableCode: query.tableCode,
        tableId: query.tableId,
        referenceDate: query.referenceDate,
      });

      if (!resolved.priceItemId) {
        res.status(200).json(buildPublishedPriceTraceEmptyApiResponse(resolved.errorMessage ?? "Preço não encontrado."));
        return;
      }

      const trace = await buildPublishedPriceTrace(prisma, {
        priceItemId: resolved.priceItemId,
        productId: query.productId ?? null,
        tableId: query.tableId ?? null,
      });
      res.status(200).json(buildPublishedPriceTraceApiResponse(trace));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erro ao consultar preço publicado.";
      if (
        error instanceof CostToCashTraceApiValidationError ||
        message.includes("obrigatório") ||
        message.includes("não corresponde")
      ) {
        res.status(400).json(costToCashTraceApiError(message, "VALIDATION_ERROR"));
        return;
      }
      if (message.includes("não encontrado")) {
        res.status(200).json(buildPublishedPriceTraceEmptyApiResponse(message));
        return;
      }
      handleApiError(res, error, "GET /api/audit/published-price-trace");
    }
  });

  app.get("/api/audit/sales-order-trace", ...salesGuard, async (req, res) => {
    try {
      const query = parseSalesOrderTraceApiQuery(req.query as Record<string, unknown>);
      const trace = await buildSalesOrderTrace(prisma, {
        salesOrderId: query.salesOrderId ?? null,
        orderNumber: query.orderNumber ?? null,
        nfeNumber: query.nfeNumber ?? null,
        customer: query.customer ?? null,
        year: query.year ?? null,
        month: query.month ?? null,
        includeItems: true,
      });
      res.status(200).json(buildSalesOrderTraceApiResponse(trace));
    } catch (error) {
      handleApiError(res, error, "GET /api/audit/sales-order-trace");
    }
  });

  app.get("/api/audit/commission-trace", ...commissionGuard, async (req, res) => {
    try {
      const query = parseCommissionTraceApiQuery(req.query as Record<string, unknown>);
      const trace = await buildCommissionTrace(prisma, {
        year: query.year ?? null,
        month: query.month ?? null,
        seller: query.seller ?? null,
        salesOrderId: query.salesOrderId ?? null,
        orderNumber: query.orderNumber ?? null,
        nfeNumber: query.nfeNumber ?? null,
        receivableCode: query.receivableCode ?? null,
        customer: query.customer ?? null,
        sku: query.sku ?? null,
        includeLines: true,
      });
      res.status(200).json(buildCommissionTraceApiResponse(trace));
    } catch (error) {
      handleApiError(res, error, "GET /api/audit/commission-trace");
    }
  });

  app.get("/api/audit/cost-to-cash-trace", ...fullGuard, async (req, res) => {
    try {
      const query = parseCostToCashTraceApiQuery(req.query as Record<string, unknown>);

      let priceItemId = query.priceItemId ?? null;
      if (!priceItemId && query.sku?.trim()) {
        const resolved = await resolvePublishedPriceItemIdForTrace(prisma, {
          sku: query.sku,
          productId: query.productId,
          tableCode: query.tableCode,
          tableId: query.tableId,
          referenceDate: query.referenceDate,
        });
        priceItemId = resolved.priceItemId;
      }

      const trace = await buildCostToCashTrace(prisma, {
        sku: query.sku ?? null,
        productId: query.productId ?? null,
        priceItemId,
        referenceDate: query.referenceDate,
        salesOrderId: query.salesOrderId ?? null,
        orderNumber: query.orderNumber ?? null,
        nfeNumber: query.nfeNumber ?? null,
        receivableCode: query.receivableCode ?? null,
        customer: query.customer ?? null,
        year: query.year ?? null,
        month: query.month ?? null,
        seller: query.seller ?? null,
      });
      res.status(200).json(buildCostToCashTraceApiResponse(trace));
    } catch (error) {
      handleApiError(res, error, "GET /api/audit/cost-to-cash-trace");
    }
  });
}
