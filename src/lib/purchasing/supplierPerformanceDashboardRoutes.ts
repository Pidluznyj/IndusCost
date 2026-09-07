/**
 * Compras → Performance — rotas de leitura do dashboard de fornecedores.
 *
 * Guard: `requireAppAuth` + `requireResource(operations.purchases, view)` — a
 * mesma autoridade canônica de Compras usada pela Avaliação Fornecedor e
 * listada em `relatedEndpoints` de `operations.purchases`. Nenhuma permission
 * key nova. Esconder aba no frontend não substitui estes guards.
 *
 * Sem feature flag própria: a seção de avaliação do read model respeita
 * SUPPLY_CHAIN_SUPPLIER_PERFORMANCE_ENABLED (fail closed) e é marcada como
 * indisponível quando a flag está OFF — nunca inventa nota.
 *
 * 100% GET. Sem writeback Nomus.
 */

import type express from "express";
import type { RequestHandler } from "express";
import { prisma } from "@/src/lib/prisma.js";
import { OPERATIONS_ACTIONS, OPERATIONS_RESOURCE_KEYS } from "@/src/lib/operationsAccess.js";
import { mapSupplierEvaluationError } from "./supplierPerformance.server.js";
import { parseDashboardMaterialKey } from "./supplierPerformanceDashboard.js";
import {
  buildSupplierMaterialMatrixResponse,
  buildSupplierPerformanceDashboardResponse,
  buildSupplierPerformanceMaterialDetailResponse,
  buildSupplierPerformanceSupplierDetailResponse,
  searchSupplierPerformanceMaterials,
  type SupplierPerformanceDashboardDb,
  type SupplierPerformanceDashboardDeps,
} from "./supplierPerformanceDashboard.server.js";

type AuthGuards = {
  requireAppAuth: RequestHandler;
  requireResource: (resourceKey: string, action?: string) => RequestHandler;
};

export const SUPPLIER_PERFORMANCE_DASHBOARD_API_PATH = "/api/purchases/performance";

export function registerSupplierPerformanceDashboardRoutes(
  app: express.Express,
  auth: AuthGuards,
  options: { db?: SupplierPerformanceDashboardDb; deps?: SupplierPerformanceDashboardDeps } = {}
): void {
  const db = options.db ?? prisma;
  const deps = options.deps ?? {};
  const view = [
    auth.requireAppAuth,
    auth.requireResource(OPERATIONS_RESOURCE_KEYS.purchases, OPERATIONS_ACTIONS.view),
  ] as const;

  const query = (req: express.Request) => req.query as Record<string, unknown>;

  app.get(SUPPLIER_PERFORMANCE_DASHBOARD_API_PATH, ...view, async (req, res) => {
    try {
      const payload = await buildSupplierPerformanceDashboardResponse(db, query(req), deps);
      res.setHeader("Cache-Control", "no-store");
      return res.json(payload);
    } catch (error) {
      const mapped = mapSupplierEvaluationError(error);
      return res.status(mapped.status).json(mapped.body);
    }
  });

  app.get(`${SUPPLIER_PERFORMANCE_DASHBOARD_API_PATH}/supplier-materials`, ...view, async (req, res) => {
    try {
      const payload = await buildSupplierMaterialMatrixResponse(db, query(req), deps);
      res.setHeader("Cache-Control", "no-store");
      return res.json(payload);
    } catch (error) {
      const mapped = mapSupplierEvaluationError(error);
      return res.status(mapped.status).json(mapped.body);
    }
  });

  app.get(`${SUPPLIER_PERFORMANCE_DASHBOARD_API_PATH}/materials`, ...view, async (req, res) => {
    try {
      const payload = await searchSupplierPerformanceMaterials(db, query(req));
      res.setHeader("Cache-Control", "no-store");
      return res.json(payload);
    } catch (error) {
      const mapped = mapSupplierEvaluationError(error);
      return res.status(mapped.status).json(mapped.body);
    }
  });

  app.get(`${SUPPLIER_PERFORMANCE_DASHBOARD_API_PATH}/materials/:materialKey`, ...view, async (req, res) => {
    try {
      const materialKey = String(req.params.materialKey ?? "").trim();
      if (!parseDashboardMaterialKey(materialKey)) {
        return res.status(400).json({ error: "Matéria-prima inválida.", code: "INVALID_SUPPLIER_PERFORMANCE_FILTER", field: "materialKey" });
      }
      const payload = await buildSupplierPerformanceMaterialDetailResponse(db, query(req), materialKey, deps);
      if (!payload) {
        return res.status(404).json({ error: "Matéria-prima não encontrada na população filtrada.", code: "MATERIAL_NOT_FOUND" });
      }
      res.setHeader("Cache-Control", "no-store");
      return res.json(payload);
    } catch (error) {
      const mapped = mapSupplierEvaluationError(error);
      return res.status(mapped.status).json(mapped.body);
    }
  });

  app.get(`${SUPPLIER_PERFORMANCE_DASHBOARD_API_PATH}/suppliers/:supplierExternalId`, ...view, async (req, res) => {
    try {
      const raw = String(req.params.supplierExternalId ?? "").trim();
      if (!/^\d+$/.test(raw)) {
        return res.status(400).json({ error: "Fornecedor inválido.", code: "INVALID_SUPPLIER_PERFORMANCE_FILTER", field: "supplierExternalId" });
      }
      const payload = await buildSupplierPerformanceSupplierDetailResponse(db, query(req), Number(raw), deps);
      if (!payload) {
        return res.status(404).json({ error: "Fornecedor não encontrado na população filtrada.", code: "SUPPLIER_NOT_FOUND" });
      }
      res.setHeader("Cache-Control", "no-store");
      return res.json(payload);
    } catch (error) {
      const mapped = mapSupplierEvaluationError(error);
      return res.status(mapped.status).json(mapped.body);
    }
  });
}
