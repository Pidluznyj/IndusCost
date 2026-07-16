import type express from "express";
import type { RequestHandler } from "express";
import type { AppAuthContext } from "@/src/lib/appAuth.js";
import {
  applyCostCenterReallocationDefault,
  assertFinanceCostCenterUuid,
  buildCostCenterDetailExportPayloadDefault,
  buildCostCenterDetailExportPayloadForCenters,
  buildCostCenterDetailSummaryDefault,
  FinanceCostCenterDetailError,
  listCostCenterDetailAllocationsDefault,
  listCostCenterDetailAllocationsForCenters,
  parseCostCenterDetailListQuery,
  parseCostCenterIdsParam,
  parseCostCenterReallocationBody,
  previewCostCenterReallocationDefault,
} from "@/src/lib/financeCostCenterDetail.js";
import {
  buildCostCenterDetailExportBuffer,
} from "@/src/lib/financeCostCenterDetailExport.js";
import {
  buildCostCenterDetailAppliedFilterLinesFromQuery,
  buildCostCenterDetailExportFilename,
  buildCostCenterSelectionExportFilename,
} from "@/src/lib/financeCostCenterDetailExportMeta.js";
import { FinanceCostCenterValidationError } from "@/src/lib/financeCostCenters.js";
import {
  FINANCE_MODULE_ACTIONS,
  FINANCE_MODULE_RESOURCE_KEYS,
} from "@/src/lib/financeModulesAccess.js";
import { financeApiErrorJson } from "@/src/lib/financeTabLoadError.js";
import { FinanceApFilterParseError } from "@/src/lib/financeAccountsPayableDashboard.js";

type AuthGuards = {
  requireAppAuth: RequestHandler;
  requireResource: (resourceKey: string, action?: string) => RequestHandler;
  getCurrentAppUser: (req: express.Request) => Promise<AppAuthContext | null>;
};

export const FINANCE_COST_CENTER_REALLOCATION_PERMISSIONS = [
  "finance.cost_centers.manage",
  "finance.ap_allocations.apply_batch",
] as const;

function canReallocate(user: AppAuthContext): boolean {
  if (user.role === "SUPER_ADMIN" || user.role === "ADMIN") return true;
  return FINANCE_COST_CENTER_REALLOCATION_PERMISSIONS.some((permission) =>
    user.effectivePermissions.includes(permission)
  );
}

function handleDetailError(
  res: express.Response,
  error:
    | FinanceCostCenterDetailError
    | FinanceCostCenterValidationError
    | FinanceApFilterParseError
) {
  const status =
    error instanceof FinanceCostCenterValidationError && error.code === "NOT_FOUND"
      ? 404
      : error instanceof FinanceCostCenterDetailError && error.code === "NOT_FOUND"
        ? 404
        : 400;
  return res.status(status).json({
    error: error.message,
    code: "code" in error ? error.code : "INVALID_FILTER",
  });
}

export function registerFinanceCostCenterDetailRoutes(app: express.Express, auth: AuthGuards) {
  const { requireAppAuth, requireResource, getCurrentAppUser } = auth;
  const viewGuard = [
    requireAppAuth,
    requireResource(FINANCE_MODULE_RESOURCE_KEYS.costCenters, FINANCE_MODULE_ACTIONS.view),
  ] as const;

  app.post("/api/finance/cost-centers/reallocation/preview", ...viewGuard, async (req, res) => {
    try {
      const user = await getCurrentAppUser(req);
      if (!user) return res.status(401).json({ error: "Não autenticado." });
      if (!canReallocate(user)) {
        return res.status(403).json({ error: "Sem permissão para realocar alocações." });
      }

      const input = parseCostCenterReallocationBody(req.body);
      const preview = await previewCostCenterReallocationDefault(input);
      return res.json(preview);
    } catch (error) {
      if (
        error instanceof FinanceCostCenterDetailError ||
        error instanceof FinanceCostCenterValidationError
      ) {
        return handleDetailError(res, error);
      }
      console.error("POST /api/finance/cost-centers/reallocation/preview", error);
      return res.status(500).json(
        financeApiErrorJson("Erro ao gerar preview de realocação.", error)
      );
    }
  });

  app.post("/api/finance/cost-centers/reallocation/apply", ...viewGuard, async (req, res) => {
    try {
      const user = await getCurrentAppUser(req);
      if (!user) return res.status(401).json({ error: "Não autenticado." });
      if (!canReallocate(user)) {
        return res.status(403).json({ error: "Sem permissão para realocar alocações." });
      }

      const input = parseCostCenterReallocationBody(req.body);
      const result = await applyCostCenterReallocationDefault(input, {
        userId: user.id,
        userName: user.name,
      });
      return res.json(result);
    } catch (error) {
      if (
        error instanceof FinanceCostCenterDetailError ||
        error instanceof FinanceCostCenterValidationError
      ) {
        return handleDetailError(res, error);
      }
      console.error("POST /api/finance/cost-centers/reallocation/apply", error);
      return res.status(500).json(
        financeApiErrorJson("Erro ao aplicar realocação.", error)
      );
    }
  });

  app.get("/api/finance/cost-centers/allocations", ...viewGuard, async (req, res) => {
    try {
      const user = await getCurrentAppUser(req);
      if (!user) return res.status(401).json({ error: "Não autenticado." });

      const costCenterIds = parseCostCenterIdsParam(req.query.costCenterIds);
      if (costCenterIds.length < 2) {
        return res.status(400).json({
          error: "Informe ao menos dois centros de custo em costCenterIds.",
          code: "INVALID_FILTER",
        });
      }

      const query = parseCostCenterDetailListQuery(req.query as Record<string, unknown>);
      const payload = await listCostCenterDetailAllocationsForCenters(costCenterIds, query);
      return res.json(payload);
    } catch (error) {
      if (
        error instanceof FinanceCostCenterDetailError ||
        error instanceof FinanceCostCenterValidationError ||
        error instanceof FinanceApFilterParseError
      ) {
        return handleDetailError(res, error);
      }
      console.error("GET /api/finance/cost-centers/allocations", error);
      return res.status(500).json(
        financeApiErrorJson("Erro ao listar alocações consolidadas dos centros de custo.", error)
      );
    }
  });

  app.get("/api/finance/cost-centers/detail/export-data", ...viewGuard, async (req, res) => {
    try {
      const user = await getCurrentAppUser(req);
      if (!user) return res.status(401).json({ error: "Não autenticado." });

      const costCenterIds = parseCostCenterIdsParam(req.query.costCenterIds);
      if (costCenterIds.length < 2) {
        return res.status(400).json({
          error: "Informe ao menos dois centros de custo em costCenterIds.",
          code: "INVALID_FILTER",
        });
      }

      const rawQuery = req.query as Record<string, unknown>;
      const query = parseCostCenterDetailListQuery(rawQuery);
      const appliedFilters = buildCostCenterDetailAppliedFilterLinesFromQuery(rawQuery);
      const payload = await buildCostCenterDetailExportPayloadForCenters(
        costCenterIds,
        query,
        { userId: user.id, userName: user.name },
        new Date(),
        appliedFilters
      );
      return res.json(payload);
    } catch (error) {
      if (
        error instanceof FinanceCostCenterDetailError ||
        error instanceof FinanceCostCenterValidationError ||
        error instanceof FinanceApFilterParseError
      ) {
        return handleDetailError(res, error);
      }
      console.error("GET /api/finance/cost-centers/detail/export-data", error);
      return res.status(500).json(
        financeApiErrorJson("Erro ao montar exportação consolidada dos centros de custo.", error)
      );
    }
  });

  app.get("/api/finance/cost-centers/detail/export.xlsx", ...viewGuard, async (req, res) => {
    try {
      const user = await getCurrentAppUser(req);
      if (!user) return res.status(401).json({ error: "Não autenticado." });

      const costCenterIds = parseCostCenterIdsParam(req.query.costCenterIds);
      if (costCenterIds.length < 2) {
        return res.status(400).json({
          error: "Informe ao menos dois centros de custo em costCenterIds.",
          code: "INVALID_FILTER",
        });
      }

      const rawQuery = req.query as Record<string, unknown>;
      const query = parseCostCenterDetailListQuery(rawQuery);
      const appliedFilters = buildCostCenterDetailAppliedFilterLinesFromQuery(rawQuery);
      const payload = await buildCostCenterDetailExportPayloadForCenters(
        costCenterIds,
        query,
        { userId: user.id, userName: user.name },
        new Date(),
        appliedFilters
      );
      const buffer = buildCostCenterDetailExportBuffer(payload);
      const filename = buildCostCenterSelectionExportFilename(costCenterIds.length);
      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      );
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      return res.send(buffer);
    } catch (error) {
      if (
        error instanceof FinanceCostCenterDetailError ||
        error instanceof FinanceCostCenterValidationError ||
        error instanceof FinanceApFilterParseError
      ) {
        return handleDetailError(res, error);
      }
      console.error("GET /api/finance/cost-centers/detail/export.xlsx", error);
      return res.status(500).json(
        financeApiErrorJson("Erro ao exportar detalhe consolidado dos centros de custo.", error)
      );
    }
  });

  app.get("/api/finance/cost-centers/:id/summary", ...viewGuard, async (req, res) => {
    try {
      const user = await getCurrentAppUser(req);
      if (!user) return res.status(401).json({ error: "Não autenticado." });

      const id = assertFinanceCostCenterUuid(String(req.params.id ?? ""));
      const filters = parseCostCenterDetailListQuery(req.query as Record<string, unknown>);
      const { page: _p, limit: _l, sortBy: _s, sortDirection: _d, ...summaryFilters } = filters;
      void _p;
      void _l;
      void _s;
      void _d;
      const summary = await buildCostCenterDetailSummaryDefault(id, summaryFilters);
      return res.json({ summary });
    } catch (error) {
      if (
        error instanceof FinanceCostCenterDetailError ||
        error instanceof FinanceCostCenterValidationError ||
        error instanceof FinanceApFilterParseError
      ) {
        return handleDetailError(res, error);
      }
      console.error("GET /api/finance/cost-centers/:id/summary", error);
      return res.status(500).json(
        financeApiErrorJson("Erro ao montar resumo do centro de custo.", error)
      );
    }
  });

  app.get("/api/finance/cost-centers/:id/allocations", ...viewGuard, async (req, res) => {
    try {
      const user = await getCurrentAppUser(req);
      if (!user) return res.status(401).json({ error: "Não autenticado." });

      const id = assertFinanceCostCenterUuid(String(req.params.id ?? ""));
      const query = parseCostCenterDetailListQuery(req.query as Record<string, unknown>);
      const payload = await listCostCenterDetailAllocationsDefault(id, query);
      return res.json(payload);
    } catch (error) {
      if (
        error instanceof FinanceCostCenterDetailError ||
        error instanceof FinanceCostCenterValidationError ||
        error instanceof FinanceApFilterParseError
      ) {
        return handleDetailError(res, error);
      }
      console.error("GET /api/finance/cost-centers/:id/allocations", error);
      return res.status(500).json(
        financeApiErrorJson("Erro ao listar alocações do centro de custo.", error)
      );
    }
  });

  app.get("/api/finance/cost-centers/:id/detail/export-data", ...viewGuard, async (req, res) => {
    try {
      const user = await getCurrentAppUser(req);
      if (!user) return res.status(401).json({ error: "Não autenticado." });

      const id = assertFinanceCostCenterUuid(String(req.params.id ?? ""));
      const rawQuery = req.query as Record<string, unknown>;
      const query = parseCostCenterDetailListQuery(rawQuery);
      const appliedFilters = buildCostCenterDetailAppliedFilterLinesFromQuery(rawQuery);
      const payload = await buildCostCenterDetailExportPayloadDefault(
        id,
        query,
        { userId: user.id, userName: user.name },
        new Date(),
        appliedFilters
      );
      return res.json(payload);
    } catch (error) {
      if (
        error instanceof FinanceCostCenterDetailError ||
        error instanceof FinanceCostCenterValidationError ||
        error instanceof FinanceApFilterParseError
      ) {
        return handleDetailError(res, error);
      }
      console.error("GET /api/finance/cost-centers/:id/detail/export-data", error);
      return res.status(500).json(
        financeApiErrorJson("Erro ao montar dados de exportação do centro de custo.", error)
      );
    }
  });

  app.get("/api/finance/cost-centers/:id/detail/export.xlsx", ...viewGuard, async (req, res) => {
    try {
      const user = await getCurrentAppUser(req);
      if (!user) return res.status(401).json({ error: "Não autenticado." });

      const id = assertFinanceCostCenterUuid(String(req.params.id ?? ""));
      const rawQuery = req.query as Record<string, unknown>;
      const query = parseCostCenterDetailListQuery(rawQuery);
      const appliedFilters = buildCostCenterDetailAppliedFilterLinesFromQuery(rawQuery);
      const payload = await buildCostCenterDetailExportPayloadDefault(
        id,
        query,
        { userId: user.id, userName: user.name },
        new Date(),
        appliedFilters
      );
      const buffer = buildCostCenterDetailExportBuffer(payload);
      const filename = buildCostCenterDetailExportFilename(payload.center.name);
      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      );
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      return res.send(buffer);
    } catch (error) {
      if (
        error instanceof FinanceCostCenterDetailError ||
        error instanceof FinanceCostCenterValidationError ||
        error instanceof FinanceApFilterParseError
      ) {
        return handleDetailError(res, error);
      }
      console.error("GET /api/finance/cost-centers/:id/detail/export.xlsx", error);
      return res.status(500).json(
        financeApiErrorJson("Erro ao exportar detalhe do centro de custo.", error)
      );
    }
  });
}
