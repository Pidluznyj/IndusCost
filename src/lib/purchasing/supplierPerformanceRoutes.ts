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
  parseSupplierPerformanceApiEvaluationStatus,
  parseSupplierPerformanceApiPeriod,
  parseSupplierPerformanceApiSort,
  parseSupplierPerformanceApiSupplierStatus,
  SUPPLIER_PERFORMANCE_METHODOLOGY_TEXT,
  SupplierEvaluationError,
  type SupplierPerformancePeriod,
} from "./supplierPerformance.js";
import {
  buildSupplierPerformanceDetail,
  buildSupplierPerformanceDetailCsvRows,
  buildSupplierPerformanceReport,
  getPurchaseOrderSupplierEvaluation,
  loadSupplierEvaluationListSummaries,
  mapSupplierEvaluationError,
  savePurchaseOrderSupplierEvaluation,
} from "./supplierPerformance.server.js";
import {
  buildNomusSupplierEvaluationWorklist,
  saveNomusPurchaseOrderSupplierEvaluation,
  saveNomusPurchaseOrderSupplierEvaluationsBatch,
  searchNomusEvaluationSuppliers,
} from "./nomusPurchaseOrderEvaluation.server.js";
import {
  NOMUS_SUPPLIER_EVALUATION_BATCH_MAX_ITEMS,
} from "./nomusPurchaseOrderEvaluation.js";
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

/**
 * Período do boundary HTTP: ausente = sem recorte; explicitamente inválido ou
 * `from > to` = 400 (nunca consulta mais ampla nem dataset vazio silencioso).
 */
function readPeriod(req: express.Request): SupplierPerformancePeriod {
  return parseSupplierPerformanceApiPeriod({
    from: req.query.from,
    to: req.query.to,
  });
}

/** `supplierId` é filtro semântico: enviado e não-UUID vira 400 de domínio. */
function readSupplierIdFilter(req: express.Request): string | null {
  const raw = req.query.supplierId;
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value == null) return null;
  const text = String(value).trim();
  if (!text) return null;
  if (!isUuid(text)) {
    throw new SupplierEvaluationError(
      "INVALID_SUPPLIER_PERFORMANCE_FILTER",
      "Fornecedor inválido.",
      "supplierId"
    );
  }
  return text;
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

  app.get("/api/supplier-performance/suppliers/summaries", ...performanceView, async (req, res) => {
    try {
      const raw = req.query.ids ?? req.query.supplierIds;
      const text = Array.isArray(raw) ? raw.join(",") : String(raw ?? "");
      const ids = text
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);
      for (const id of ids) {
        if (!isUuid(id)) {
          throw new SupplierEvaluationError(
            "INVALID_SUPPLIER_PERFORMANCE_FILTER",
            "Fornecedor inválido.",
            "ids"
          );
        }
      }
      const payload = await loadSupplierEvaluationListSummaries(prisma, ids);
      res.setHeader("Cache-Control", "no-store");
      return res.json({ items: payload.items });
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
          evaluationStatus: parseSupplierPerformanceApiEvaluationStatus(
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
      const supplierIdParam = readSupplierIdFilter(req);
      const period = readPeriod(req);
      const supplierStatus = parseSupplierPerformanceApiSupplierStatus(
        req.query.supplierStatus
      );
      const payload = await buildSupplierPerformanceReport(prisma, {
        period,
        supplierId: supplierIdParam,
        supplierStatus,
        sort: parseSupplierPerformanceApiSort(req.query.sort),
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
      const supplierIdParam = readSupplierIdFilter(req);
      const period = readPeriod(req);
      const report = await buildSupplierPerformanceReport(prisma, {
        period,
        supplierId: supplierIdParam,
        supplierStatus: parseSupplierPerformanceApiSupplierStatus(
          req.query.supplierStatus
        ),
        sort: parseSupplierPerformanceApiSort(req.query.sort),
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
      const supplierIdParam = readSupplierIdFilter(req);
      const period = readPeriod(req);
      const rows = await buildSupplierPerformanceDetailCsvRows(prisma, {
        period,
        supplierId: supplierIdParam,
        supplierStatus: parseSupplierPerformanceApiSupplierStatus(
          req.query.supplierStatus
        ),
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

  app.get("/api/supplier-performance/nomus-orders/worklist", ...orderView, async (req, res) => {
    try {
      const payload = await buildNomusSupplierEvaluationWorklist(
        prisma,
        req.query as Record<string, unknown>
      );
      res.setHeader("Cache-Control", "no-store");
      return res.json(payload);
    } catch (error) {
      const mapped = mapSupplierEvaluationError(error);
      return res.status(mapped.status).json(mapped.body);
    }
  });

  app.get("/api/supplier-performance/nomus-orders/suppliers", ...orderView, async (req, res) => {
    try {
      const payload = await searchNomusEvaluationSuppliers(
        prisma,
        req.query.q ?? req.query.search,
        req.query.limit
      );
      res.setHeader("Cache-Control", "no-store");
      return res.json(payload);
    } catch (error) {
      const mapped = mapSupplierEvaluationError(error);
      return res.status(mapped.status).json(mapped.body);
    }
  });

  app.put(
    "/api/supplier-performance/nomus-orders/:id",
    ...orderUpdate,
    async (req, res) => {
      try {
        const { id } = req.params;
        if (!isUuid(id)) {
          return res.status(400).json({ error: "ID inválido." });
        }
        const user = await auth.getCurrentAppUser(req);
        if (!user) return res.status(401).json({ error: "Autenticação necessária." });
        const body = (req.body ?? {}) as Record<string, unknown>;
        const payload = await saveNomusPurchaseOrderSupplierEvaluation(
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
    }
  );

  app.post(
    "/api/supplier-performance/nomus-orders/batch",
    ...orderUpdate,
    async (req, res) => {
      try {
        const user = await auth.getCurrentAppUser(req);
        if (!user) return res.status(401).json({ error: "Autenticação necessária." });
        const body = (req.body ?? {}) as Record<string, unknown>;
        const items = Array.isArray(body.items) ? body.items : [];
        if (items.length > NOMUS_SUPPLIER_EVALUATION_BATCH_MAX_ITEMS) {
          return res.status(400).json({
            error: `No máximo ${NOMUS_SUPPLIER_EVALUATION_BATCH_MAX_ITEMS} pedidos por lote.`,
            code: "INVALID_SUPPLIER_EVALUATION_PAYLOAD",
            field: "items",
          });
        }
        const payload = await saveNomusPurchaseOrderSupplierEvaluationsBatch(
          prisma,
          { userId: user.id, userName: user.name ?? user.email ?? null },
          items as Array<{
            nomusPurchaseOrderId: unknown;
            qualityScore: unknown;
            deliveryScore: unknown;
            conformityScore: unknown;
            serviceScore: unknown;
            notes?: unknown;
            expectedRevision?: unknown;
            revisionReason?: unknown;
          }>
        );
        res.setHeader("Cache-Control", "no-store");
        return res.json(payload);
      } catch (error) {
        const mapped = mapSupplierEvaluationError(error);
        return res.status(mapped.status).json(mapped.body);
      }
    }
  );
}
