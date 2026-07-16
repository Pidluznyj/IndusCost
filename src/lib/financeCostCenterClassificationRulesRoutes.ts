import type express from "express";
import type { RequestHandler } from "express";
import type { AppAuthContext } from "@/src/lib/appAuth.js";
import {
  applyClassificationRuleWithDefaultDeps,
  createClassificationRuleDefault,
  deactivateClassificationRuleDefault,
  FinanceClassificationRuleError,
  listClassificationRulesDefault,
  parseClassificationRuleBody,
  previewClassificationRuleDefault,
  previewClassificationRuleFromBodyDefault,
  updateClassificationRuleDefault,
  type ClassificationRuleListQuery,
} from "@/src/lib/financeCostCenterClassificationRules.js";
import type { FinancialCostCenterClassificationRuleType } from "@/src/lib/financeCostCenterClassificationRulesShared.js";
import { financeApiErrorJson } from "@/src/lib/financeTabLoadError.js";
import {
  FINANCE_MODULE_ACTIONS,
  FINANCE_MODULE_RESOURCE_KEYS,
} from "@/src/lib/financeModulesAccess.js";

type AuthGuards = {
  requireAppAuth: RequestHandler;
  requireResource: (resourceKey: string, action?: string) => RequestHandler;
  getCurrentAppUser: (req: express.Request) => Promise<AppAuthContext | null>;
};

/** @deprecated Use costCenters requireResource view. */
export const FINANCE_CLASSIFICATION_RULES_VIEW_PERMISSIONS = [
  "finance.cost_center_rules.view",
  "finance.view",
] as const;

/** @deprecated Use costCenters requireResource manage. */
export const FINANCE_CLASSIFICATION_RULES_MANAGE_PERMISSIONS = [
  "finance.cost_center_rules.manage",
] as const;

function handleValidationError(res: express.Response, error: FinanceClassificationRuleError) {
  const status = error.code === "NOT_FOUND" ? 404 : 400;
  return res.status(status).json({ error: error.message, code: error.code });
}

function parseListQuery(query: Record<string, unknown>): ClassificationRuleListQuery {
  const parsed: ClassificationRuleListQuery = {};
  if (typeof query.ruleType === "string" && query.ruleType.trim()) {
    parsed.ruleType = query.ruleType.trim() as FinancialCostCenterClassificationRuleType;
  }
  if (typeof query.costCenterId === "string" && query.costCenterId.trim()) {
    parsed.costCenterId = query.costCenterId.trim();
  }
  if (typeof query.supplierId === "string" && query.supplierId.trim()) {
    parsed.supplierId = query.supplierId.trim();
  }
  if (query.isActive === "true") parsed.isActive = true;
  if (query.isActive === "false") parsed.isActive = false;
  return parsed;
}

export function registerFinanceClassificationRulesRoutes(app: express.Express, auth: AuthGuards) {
  const { requireAppAuth, requireResource, getCurrentAppUser } = auth;
  const viewGuard = [
    requireAppAuth,
    requireResource(FINANCE_MODULE_RESOURCE_KEYS.costCenters, FINANCE_MODULE_ACTIONS.view),
  ] as const;
  const manageGuard = [
    requireAppAuth,
    requireResource(FINANCE_MODULE_RESOURCE_KEYS.costCenters, FINANCE_MODULE_ACTIONS.manage),
  ] as const;

  app.get("/api/finance/classification-rules", ...viewGuard, async (req, res) => {
    try {
      const user = await getCurrentAppUser(req);
      if (!user) return res.status(401).json({ error: "Não autenticado." });
      const query = parseListQuery(req.query as Record<string, unknown>);
      const payload = await listClassificationRulesDefault(query);
      return res.json(payload);
    } catch (error) {
      console.error("GET /api/finance/classification-rules", error);
      return res.status(500).json(
        financeApiErrorJson("Erro ao listar regras de classificação gerenciais.", error)
      );
    }
  });

  app.post("/api/finance/classification-rules/preview", ...viewGuard, async (req, res) => {
    try {
      const user = await getCurrentAppUser(req);
      if (!user) return res.status(401).json({ error: "Não autenticado." });
      const input = parseClassificationRuleBody(req.body);
      const payload = await previewClassificationRuleFromBodyDefault(input);
      return res.json(payload);
    } catch (error) {
      if (error instanceof FinanceClassificationRuleError) {
        return handleValidationError(res, error);
      }
      console.error("POST /api/finance/classification-rules/preview", error);
      return res.status(500).json(
        financeApiErrorJson("Erro ao gerar preview da regra.", error)
      );
    }
  });

  app.post("/api/finance/classification-rules", ...manageGuard, async (req, res) => {
    try {
      const user = await getCurrentAppUser(req);
      if (!user) return res.status(401).json({ error: "Não autenticado." });
      const input = parseClassificationRuleBody(req.body);
      const item = await createClassificationRuleDefault(input, {
        userId: user.userId,
        userName: user.displayName,
      });
      return res.status(201).json({ item });
    } catch (error) {
      if (error instanceof FinanceClassificationRuleError) {
        return handleValidationError(res, error);
      }
      console.error("POST /api/finance/classification-rules", error);
      return res.status(500).json(
        financeApiErrorJson("Erro ao criar regra de classificação.", error)
      );
    }
  });

  app.get("/api/finance/classification-rules/:id/preview", ...viewGuard, async (req, res) => {
    try {
      const user = await getCurrentAppUser(req);
      if (!user) return res.status(401).json({ error: "Não autenticado." });
      const id = String(req.params.id ?? "").trim();
      const payload = await previewClassificationRuleDefault(id);
      return res.json(payload);
    } catch (error) {
      if (error instanceof FinanceClassificationRuleError) {
        return handleValidationError(res, error);
      }
      console.error("GET /api/finance/classification-rules/:id/preview", error);
      return res.status(500).json(
        financeApiErrorJson("Erro ao gerar preview da regra.", error)
      );
    }
  });

  app.post("/api/finance/classification-rules/:id/apply", ...manageGuard, async (req, res) => {
    try {
      const user = await getCurrentAppUser(req);
      if (!user) return res.status(401).json({ error: "Não autenticado." });
      const id = String(req.params.id ?? "").trim();
      const confirmationText =
        typeof (req.body as Record<string, unknown>)?.confirmationText === "string"
          ? (req.body as Record<string, unknown>).confirmationText
          : "";
      const payload = await applyClassificationRuleWithDefaultDeps(id, confirmationText as string, {
        userId: user.userId,
        userName: user.displayName,
      });
      return res.json(payload);
    } catch (error) {
      if (error instanceof FinanceClassificationRuleError) {
        return handleValidationError(res, error);
      }
      console.error("POST /api/finance/classification-rules/:id/apply", error);
      return res.status(500).json(
        financeApiErrorJson("Erro ao aplicar regra de classificação.", error)
      );
    }
  });

  app.patch("/api/finance/classification-rules/:id", ...manageGuard, async (req, res) => {
    try {
      const user = await getCurrentAppUser(req);
      if (!user) return res.status(401).json({ error: "Não autenticado." });
      const id = String(req.params.id ?? "").trim();
      const input = parseClassificationRuleBody(req.body);
      const item = await updateClassificationRuleDefault(id, input, {
        userId: user.userId,
        userName: user.displayName,
      });
      return res.json({ item });
    } catch (error) {
      if (error instanceof FinanceClassificationRuleError) {
        return handleValidationError(res, error);
      }
      console.error("PATCH /api/finance/classification-rules/:id", error);
      return res.status(500).json(
        financeApiErrorJson("Erro ao atualizar regra de classificação.", error)
      );
    }
  });

  app.delete("/api/finance/classification-rules/:id", ...manageGuard, async (req, res) => {
    try {
      const user = await getCurrentAppUser(req);
      if (!user) return res.status(401).json({ error: "Não autenticado." });
      const id = String(req.params.id ?? "").trim();
      await deactivateClassificationRuleDefault(id, {
        userId: user.userId,
        userName: user.displayName,
      });
      return res.json({ ok: true });
    } catch (error) {
      if (error instanceof FinanceClassificationRuleError) {
        return handleValidationError(res, error);
      }
      console.error("DELETE /api/finance/classification-rules/:id", error);
      return res.status(500).json(
        financeApiErrorJson("Erro ao desativar regra de classificação.", error)
      );
    }
  });
}
