/**
 * OP-26 — Rotas da avaliação do pedido de compra e do desempenho de fornecedores.
 *
 * Fail closed em duas camadas independentes:
 *   1. feature flag SUPPLY_CHAIN_SUPPLIER_PERFORMANCE_ENABLED -> 404;
 *   2. permissão canônica no backend -> 403.
 * Esconder botão no frontend NÃO substitui nenhuma das duas.
 *
 * O desempenho NÃO vive sob `/api/finance/suppliers` de propósito: esse prefixo
 * é do motor oficial de fornecedores (mutação proibida a partir da cadeia).
 */

import type express from "express";
import type { RequestHandler } from "express";
import { prisma } from "@/src/lib/prisma.js";
import {
  OPERATIONS_ACTIONS,
  OPERATIONS_RESOURCE_KEYS,
} from "@/src/lib/operationsAccess.js";
import {
  FINANCE_MODULE_ACTIONS,
  FINANCE_MODULE_RESOURCE_KEYS,
} from "@/src/lib/financeModulesAccess.js";
import {
  SUPPLY_CHAIN_FEATURE_ENV,
  requireEnvFlagEnabled,
} from "@/src/lib/supply-chain/supplyChainFeatureFlags.js";
import {
  SUPPLIER_EVALUATION_METHODOLOGY_VERSION,
  normalizeSupplierPerformancePage,
  normalizeSupplierPerformancePageSize,
  parseSupplierPerformanceCivilDateParam,
  parseSupplierPerformanceEvaluationStatusFilter,
  parseSupplierPerformanceReportSort,
  SUPPLIER_PERFORMANCE_METHODOLOGY_TEXT,
  type SupplierPerformancePeriod,
} from "./supplierPerformance.js";
import {
  buildSupplierPerformanceDetail,
  buildSupplierPerformanceDetailCsvRows,
  buildSupplierPerformanceReport,
  getPurchaseOrderSupplierEvaluation,
  mapSupplierEvaluationError,
  savePurchaseOrderSupplierEvaluation,
} from "./supplierPerformance.server.js";
import {
  buildSupplierPerformanceCsvFilename,
  buildSupplierPerformanceDetailCsv,
  buildSupplierPerformanceSummaryCsv,
} from "./supplierPerformanceCsv.js";

type AuthGuards = {
  requireAppAuth: RequestHandler;
  requireResource: (resourceKey: string, action?: string) => RequestHandler;
  getCurrentAppUser: (req: express.Request) => Promise<{
    id: string;
    name?: string | null;
    email?: string | null;
  } | null>;
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

/** Status do cadastro de fornecedor aceitos no filtro do relatório. */
const SUPPLIER_STATUS_VALUES = ["ACTIVE", "NEEDS_REVIEW", "MERGED", "INACTIVE"] as const;

function parseSupplierStatusParam(raw: unknown): string | null {
  const value = String(Array.isArray(raw) ? raw[0] : (raw ?? "")).trim().toUpperCase();
  return (SUPPLIER_STATUS_VALUES as readonly string[]).includes(value) ? value : null;
}

function readPeriod(req: express.Request): SupplierPerformancePeriod {
  return {
    from: parseSupplierPerformanceCivilDateParam(req.query.from),
    to: parseSupplierPerformanceCivilDateParam(req.query.to),
  };
}

function sendCsv(res: express.Response, filename: string, csv: string): void {
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(csv);
}

export function registerSupplierPerformanceRoutes(
  app: express.Express,
  auth: AuthGuards
): void {
  const flag = requireEnvFlagEnabled(SUPPLY_CHAIN_FEATURE_ENV.supplierPerformance);

  /** Leitura da avaliação pelo pedido de compra. */
  const orderView = [
    auth.requireAppAuth,
    flag,
    auth.requireResource(OPERATIONS_RESOURCE_KEYS.purchases, OPERATIONS_ACTIONS.view),
  ] as const;

  /** Criação/revisão da avaliação. */
  const orderUpdate = [
    auth.requireAppAuth,
    flag,
    auth.requireResource(OPERATIONS_RESOURCE_KEYS.purchases, OPERATIONS_ACTIONS.update),
  ] as const;

  /**
   * Desempenho consolidado: exige AMBOS os recursos (cadastro do fornecedor E
   * pedidos de compra). Os middlewares encadeados dão semântica de AND.
   */
  const performanceView = [
    auth.requireAppAuth,
    flag,
    auth.requireResource(FINANCE_MODULE_RESOURCE_KEYS.suppliers, FINANCE_MODULE_ACTIONS.view),
    auth.requireResource(OPERATIONS_RESOURCE_KEYS.purchases, OPERATIONS_ACTIONS.view),
  ] as const;

  app.get("/api/purchase-orders/:id/supplier-evaluation", ...orderView, async (req, res) => {
    try {
      const { id } = req.params;
      if (!isUuid(id)) return res.status(400).json({ error: "ID inválido." });
      const payload = await getPurchaseOrderSupplierEvaluation(prisma, id);
      res.setHeader("Cache-Control", "no-store");
      return res.json(payload);
    } catch (error) {
      const mapped = mapSupplierEvaluationError(error);
      return res.status(mapped.status).json(mapped.body);
    }
  });

  app.put("/api/purchase-orders/:id/supplier-evaluation", ...orderUpdate, async (req, res) => {
    try {
      const { id } = req.params;
      if (!isUuid(id)) return res.status(400).json({ error: "ID inválido." });
      const user = await auth.getCurrentAppUser(req);
      if (!user) return res.status(401).json({ error: "Autenticação necessária." });

      // Nada de identidade/nota/metodologia/fornecedor vindos do browser.
      const body = (req.body ?? {}) as Record<string, unknown>;
      const payload = await savePurchaseOrderSupplierEvaluation(
        prisma,
        id,
        { userId: user.id, userName: user.name ?? user.email ?? null },
        {
          qualityScore: body.qualityScore,
          deliveryScore: body.deliveryScore,
          conformityScore: body.conformityScore,
          serviceScore: body.serviceScore,
          notes: body.notes,
          expectedRevision: body.expectedRevision,
          revisionReason: body.revisionReason,
        }
      );
      res.setHeader("Cache-Control", "no-store");
      return res.json(payload);
    } catch (error) {
      const mapped = mapSupplierEvaluationError(error);
      return res.status(mapped.status).json(mapped.body);
    }
  });

  app.get(
    "/api/supplier-performance/suppliers/:supplierId",
    ...performanceView,
    async (req, res) => {
      try {
        const { supplierId } = req.params;
        if (!isUuid(supplierId)) {
          return res.status(400).json({ error: "supplierId inválido." });
        }
        const payload = await buildSupplierPerformanceDetail(prisma, supplierId, {
          period: readPeriod(req),
          evaluationStatus: parseSupplierPerformanceEvaluationStatusFilter(
            req.query.evaluationStatus
          ),
          page: normalizeSupplierPerformancePage(req.query.page),
          pageSize: normalizeSupplierPerformancePageSize(req.query.pageSize),
        });
        res.setHeader("Cache-Control", "no-store");
        return res.json(payload);
      } catch (error) {
        const mapped = mapSupplierEvaluationError(error);
        return res.status(mapped.status).json(mapped.body);
      }
    }
  );

  app.get("/api/supplier-performance/report", ...performanceView, async (req, res) => {
    try {
      const supplierIdParam = req.query.supplierId
        ? String(req.query.supplierId)
        : null;
      if (supplierIdParam && !isUuid(supplierIdParam)) {
        return res.status(400).json({ error: "supplierId inválido." });
      }
      const period = readPeriod(req);
      const supplierStatus = parseSupplierStatusParam(req.query.supplierStatus);
      const payload = await buildSupplierPerformanceReport(prisma, {
        period,
        supplierId: supplierIdParam,
        supplierStatus,
        sort: parseSupplierPerformanceReportSort(req.query.sort),
      });

      // Detalhe de pedidos só quando a tela pede (impressão com detalhamento).
      // Mesma função que alimenta o CSV — paridade garantida por construção.
      const includeOrders = String(req.query.includeOrders ?? "") === "1";
      const orders = includeOrders
        ? await buildSupplierPerformanceDetailCsvRows(prisma, {
            period,
            supplierId: supplierIdParam,
            supplierStatus,
          })
        : null;

      res.setHeader("Cache-Control", "no-store");
      return res.json({
        ...payload,
        ...(orders ? { orders } : {}),
        methodology: {
          version: SUPPLIER_EVALUATION_METHODOLOGY_VERSION,
          text: SUPPLIER_PERFORMANCE_METHODOLOGY_TEXT,
        },
      });
    } catch (error) {
      const mapped = mapSupplierEvaluationError(error);
      return res.status(mapped.status).json(mapped.body);
    }
  });

  /** CSV consolidado por fornecedor — mesma engine/período da tela. */
  app.get("/api/supplier-performance/report.csv", ...performanceView, async (req, res) => {
    try {
      const supplierIdParam = req.query.supplierId ? String(req.query.supplierId) : null;
      if (supplierIdParam && !isUuid(supplierIdParam)) {
        return res.status(400).json({ error: "supplierId inválido." });
      }
      const period = readPeriod(req);
      const report = await buildSupplierPerformanceReport(prisma, {
        period,
        supplierId: supplierIdParam,
        supplierStatus: parseSupplierStatusParam(req.query.supplierStatus),
        sort: parseSupplierPerformanceReportSort(req.query.sort),
      });
      return sendCsv(
        res,
        buildSupplierPerformanceCsvFilename("consolidado", period),
        buildSupplierPerformanceSummaryCsv(report.rows)
      );
    } catch (error) {
      const mapped = mapSupplierEvaluationError(error);
      return res.status(mapped.status).json(mapped.body);
    }
  });

  /** CSV detalhado (uma linha por pedido elegível) — gerado no backend. */
  app.get("/api/supplier-performance/orders.csv", ...performanceView, async (req, res) => {
    try {
      const supplierIdParam = req.query.supplierId ? String(req.query.supplierId) : null;
      if (supplierIdParam && !isUuid(supplierIdParam)) {
        return res.status(400).json({ error: "supplierId inválido." });
      }
      const period = readPeriod(req);
      const rows = await buildSupplierPerformanceDetailCsvRows(prisma, {
        period,
        supplierId: supplierIdParam,
        supplierStatus: parseSupplierStatusParam(req.query.supplierStatus),
      });
      return sendCsv(
        res,
        buildSupplierPerformanceCsvFilename("detalhado", period),
        buildSupplierPerformanceDetailCsv(rows)
      );
    } catch (error) {
      const mapped = mapSupplierEvaluationError(error);
      return res.status(mapped.status).json(mapped.body);
    }
  });
}
