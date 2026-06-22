import type express from "express";
import type { RequestHandler } from "express";
import type { AppAuthContext } from "@/src/lib/appAuth.js";
import {
  createFinancialCostCenterDefault,
  FinanceCostCenterValidationError,
  getFinancialCostCenterByIdDefault,
  listFinancialCostCentersDefault,
  parseFinanceCostCenterCreateBody,
  parseFinanceCostCenterUpdateBody,
  parseFinanceCostCentersListQuery,
  updateFinancialCostCenterDefault,
} from "@/src/lib/financeCostCenters.js";
import {
  buildFinanceCostCenterDashboardDefault,
  FinanceCostCenterDashboardError,
  parseFinanceCostCenterDashboardFilters,
} from "@/src/lib/financeCostCenterDashboard.js";
import {
  FINANCE_COST_CENTER_AUDIT_VIEW_PERMISSIONS,
  listFinanceCostCenterAuditLogs,
  parseFinanceCostCenterAuditListQuery,
} from "@/src/lib/financeCostCenterAudit.js";
import { financeApiErrorJson } from "@/src/lib/financeTabLoadError.js";
import { FinanceApFilterParseError } from "@/src/lib/financeAccountsPayableDashboard.js";

type AuthGuards = {
  requireAppAuth: RequestHandler;
  requireAnyPermission: (permissions: string[]) => RequestHandler;
  getCurrentAppUser: (req: express.Request) => Promise<AppAuthContext | null>;
};

export const FINANCE_COST_CENTERS_VIEW_PERMISSIONS = [
  "finance.cost_centers.view",
  "finance.view",
] as const;

export const FINANCE_COST_CENTERS_MANAGE_PERMISSIONS = ["finance.cost_centers.manage"] as const;

function handleValidationError(res: express.Response, error: FinanceCostCenterValidationError) {
  const status = error.code === "NOT_FOUND" ? 404 : 400;
  return res.status(status).json({ error: error.message, code: error.code });
}

function handleDashboardError(
  res: express.Response,
  error: FinanceCostCenterDashboardError | FinanceApFilterParseError
) {
  return res.status(400).json({ error: error.message, code: "code" in error ? error.code : "INVALID_FILTER" });
}

export function registerFinanceCostCentersRoutes(app: express.Express, auth: AuthGuards) {
  const { requireAppAuth, requireAnyPermission, getCurrentAppUser } = auth;
  const viewGuard = [
    requireAppAuth,
    requireAnyPermission([...FINANCE_COST_CENTERS_VIEW_PERMISSIONS]),
  ] as const;
  const manageGuard = [
    requireAppAuth,
    requireAnyPermission([...FINANCE_COST_CENTERS_MANAGE_PERMISSIONS]),
  ] as const;
  const auditGuard = [
    requireAppAuth,
    requireAnyPermission([...FINANCE_COST_CENTER_AUDIT_VIEW_PERMISSIONS]),
  ] as const;

  app.get("/api/finance/cost-center-audit", ...auditGuard, async (req, res) => {
    try {
      const user = await getCurrentAppUser(req);
      if (!user) return res.status(401).json({ error: "Não autenticado." });

      const query = parseFinanceCostCenterAuditListQuery(req.query as Record<string, unknown>);
      const payload = await listFinanceCostCenterAuditLogs(query);
      return res.json(payload);
    } catch (error) {
      console.error("GET /api/finance/cost-center-audit", error);
      return res.status(500).json(
        financeApiErrorJson("Erro ao listar auditoria de classificação.", error)
      );
    }
  });

  app.get("/api/finance/cost-centers", ...viewGuard, async (req, res) => {
    try {
      const user = await getCurrentAppUser(req);
      if (!user) return res.status(401).json({ error: "Não autenticado." });

      const query = parseFinanceCostCentersListQuery(req.query as Record<string, unknown>);
      const payload = await listFinancialCostCentersDefault(query);
      return res.json(payload);
    } catch (error) {
      if (error instanceof FinanceCostCenterValidationError) {
        return handleValidationError(res, error);
      }
      console.error("GET /api/finance/cost-centers", error);
      return res.status(500).json(
        financeApiErrorJson("Erro ao listar centros de custo financeiros.", error)
      );
    }
  });

  app.get("/api/finance/cost-centers/dashboard", ...viewGuard, async (req, res) => {
    try {
      const user = await getCurrentAppUser(req);
      if (!user) return res.status(401).json({ error: "Não autenticado." });

      const filters = parseFinanceCostCenterDashboardFilters(req.query as Record<string, unknown>);
      const payload = await buildFinanceCostCenterDashboardDefault(filters);
      return res.json(payload);
    } catch (error) {
      if (
        error instanceof FinanceCostCenterDashboardError ||
        error instanceof FinanceApFilterParseError
      ) {
        return handleDashboardError(res, error);
      }
      console.error("GET /api/finance/cost-centers/dashboard", error);
      return res.status(500).json(
        financeApiErrorJson("Erro ao montar dashboard de centros de custo.", error)
      );
    }
  });

  app.get("/api/finance/cost-centers/:id", ...viewGuard, async (req, res) => {
    try {
      const user = await getCurrentAppUser(req);
      if (!user) return res.status(401).json({ error: "Não autenticado." });

      const id = String(req.params.id ?? "").trim();
      if (!id) {
        return res.status(400).json({ error: "ID inválido." });
      }

      const item = await getFinancialCostCenterByIdDefault(id);
      if (!item) {
        return res.status(404).json({ error: "Centro de custo não encontrado." });
      }
      return res.json({ item });
    } catch (error) {
      console.error("GET /api/finance/cost-centers/:id", error);
      return res.status(500).json(
        financeApiErrorJson("Erro ao carregar centro de custo financeiro.", error)
      );
    }
  });

  app.post("/api/finance/cost-centers", ...manageGuard, async (req, res) => {
    try {
      const user = await getCurrentAppUser(req);
      if (!user) return res.status(401).json({ error: "Não autenticado." });

      const input = parseFinanceCostCenterCreateBody(req.body);
      const item = await createFinancialCostCenterDefault(input);
      return res.status(201).json({ item });
    } catch (error) {
      if (error instanceof FinanceCostCenterValidationError) {
        return handleValidationError(res, error);
      }
      console.error("POST /api/finance/cost-centers", error);
      return res.status(500).json(
        financeApiErrorJson("Erro ao criar centro de custo financeiro.", error)
      );
    }
  });

  app.patch("/api/finance/cost-centers/:id", ...manageGuard, async (req, res) => {
    try {
      const user = await getCurrentAppUser(req);
      if (!user) return res.status(401).json({ error: "Não autenticado." });

      const id = String(req.params.id ?? "").trim();
      if (!id) {
        return res.status(400).json({ error: "ID inválido." });
      }

      const input = parseFinanceCostCenterUpdateBody(req.body);
      const item = await updateFinancialCostCenterDefault(id, input);
      return res.json({ item });
    } catch (error) {
      if (error instanceof FinanceCostCenterValidationError) {
        return handleValidationError(res, error);
      }
      console.error("PATCH /api/finance/cost-centers/:id", error);
      return res.status(500).json(
        financeApiErrorJson("Erro ao atualizar centro de custo financeiro.", error)
      );
    }
  });
}
