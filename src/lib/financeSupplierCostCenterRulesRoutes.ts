import type express from "express";
import type { RequestHandler } from "express";
import type { AppAuthContext } from "@/src/lib/appAuth.js";
import {
  createSupplierCostCenterRulesBatchDefault,
  deactivateSupplierCostCenterRuleDefault,
  FinanceSupplierCostCenterRuleError,
  listSupplierCostCenterRulesDefault,
  parseSupplierCostCenterRuleBatchBody,
  parseSupplierCostCenterRulePreviewBody,
  parseSupplierCostCenterRuleUpdateBody,
  previewSupplierCostCenterRuleImpactDefault,
  searchFinancialSuppliersForRulesDefault,
  updateSupplierCostCenterRuleDefault,
  type SupplierCostCenterRuleListQuery,
} from "@/src/lib/financeSupplierCostCenterRules.js";
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
export const FINANCE_SUPPLIER_COST_CENTER_RULES_VIEW_PERMISSIONS = [
  "finance.cost_center_rules.view",
  "finance.view",
] as const;

/** @deprecated Use costCenters requireResource manage. */
export const FINANCE_SUPPLIER_COST_CENTER_RULES_MANAGE_PERMISSIONS = [
  "finance.cost_center_rules.manage",
] as const;

function handleValidationError(res: express.Response, error: FinanceSupplierCostCenterRuleError) {
  const status = error.code === "NOT_FOUND" ? 404 : 400;
  return res.status(status).json({ error: error.message, code: error.code });
}

function parseListQuery(query: Record<string, unknown>): SupplierCostCenterRuleListQuery {
  const parsed: SupplierCostCenterRuleListQuery = {};
  if (typeof query.supplierId === "string" && query.supplierId.trim()) {
    parsed.supplierId = query.supplierId.trim();
  }
  if (typeof query.company === "string" && query.company.trim()) {
    parsed.company = query.company.trim();
  }
  if (typeof query.costCenterId === "string" && query.costCenterId.trim()) {
    parsed.costCenterId = query.costCenterId.trim();
  }
  if (query.isActive === "true") parsed.isActive = true;
  if (query.isActive === "false") parsed.isActive = false;
  return parsed;
}

export function registerFinanceSupplierCostCenterRulesRoutes(
  app: express.Express,
  auth: AuthGuards
) {
  const { requireAppAuth, requireResource, getCurrentAppUser } = auth;
  const viewGuard = [
    requireAppAuth,
    requireResource(FINANCE_MODULE_RESOURCE_KEYS.costCenters, FINANCE_MODULE_ACTIONS.view),
  ] as const;
  const manageGuard = [
    requireAppAuth,
    requireResource(FINANCE_MODULE_RESOURCE_KEYS.costCenters, FINANCE_MODULE_ACTIONS.manage),
  ] as const;

  app.get("/api/finance/supplier-cost-center-rules", ...viewGuard, async (req, res) => {
    try {
      const user = await getCurrentAppUser(req);
      if (!user) return res.status(401).json({ error: "Não autenticado." });

      const query = parseListQuery(req.query as Record<string, unknown>);
      const payload = await listSupplierCostCenterRulesDefault(query);
      return res.json(payload);
    } catch (error) {
      console.error("GET /api/finance/supplier-cost-center-rules", error);
      return res.status(500).json(
        financeApiErrorJson("Erro ao listar regras de classificação.", error)
      );
    }
  });

  app.get(
    "/api/finance/supplier-cost-center-rules/suppliers/search",
    ...viewGuard,
    async (req, res) => {
      try {
        const user = await getCurrentAppUser(req);
        if (!user) return res.status(401).json({ error: "Não autenticado." });

        const search = typeof req.query.search === "string" ? req.query.search : "";
        const limitRaw =
          typeof req.query.limit === "string" ? Number.parseInt(req.query.limit, 10) : undefined;
        const payload = await searchFinancialSuppliersForRulesDefault({
          search,
          limit: limitRaw,
        });
        return res.json(payload);
      } catch (error) {
        if (error instanceof FinanceSupplierCostCenterRuleError) {
          return handleValidationError(res, error);
        }
        console.error(
          "GET /api/finance/supplier-cost-center-rules/suppliers/search",
          error
        );
        return res.status(500).json(
          financeApiErrorJson("Erro ao buscar fornecedores.", error)
        );
      }
    }
  );

  app.post("/api/finance/supplier-cost-center-rules/preview", ...viewGuard, async (req, res) => {
    try {
      const user = await getCurrentAppUser(req);
      if (!user) return res.status(401).json({ error: "Não autenticado." });

      const input = parseSupplierCostCenterRulePreviewBody(req.body);
      const preview = await previewSupplierCostCenterRuleImpactDefault(input);
      return res.json(preview);
    } catch (error) {
      if (error instanceof FinanceSupplierCostCenterRuleError) {
        return handleValidationError(res, error);
      }
      console.error("POST /api/finance/supplier-cost-center-rules/preview", error);
      return res.status(500).json(
        financeApiErrorJson("Erro ao gerar preview de impacto da regra.", error)
      );
    }
  });

  app.post("/api/finance/supplier-cost-center-rules", ...manageGuard, async (req, res) => {
    try {
      const user = await getCurrentAppUser(req);
      if (!user) return res.status(401).json({ error: "Não autenticado." });

      const input = parseSupplierCostCenterRuleBatchBody(req.body);
      const result = await createSupplierCostCenterRulesBatchDefault(input, {
        userId: user.id,
        userName: user.name ?? user.email ?? null,
      });
      return res.status(201).json(result);
    } catch (error) {
      if (error instanceof FinanceSupplierCostCenterRuleError) {
        return handleValidationError(res, error);
      }
      console.error("POST /api/finance/supplier-cost-center-rules", error);
      return res.status(500).json(
        financeApiErrorJson("Erro ao criar regras de classificação.", error)
      );
    }
  });

  app.patch("/api/finance/supplier-cost-center-rules/:id", ...manageGuard, async (req, res) => {
    try {
      const user = await getCurrentAppUser(req);
      if (!user) return res.status(401).json({ error: "Não autenticado." });

      const id = String(req.params.id ?? "").trim();
      if (!id) return res.status(400).json({ error: "ID inválido." });

      const input = parseSupplierCostCenterRuleUpdateBody(req.body);
      const item = await updateSupplierCostCenterRuleDefault(id, input, {
        userId: user.id,
        userName: user.name ?? user.email ?? null,
      });
      return res.json({ item });
    } catch (error) {
      if (error instanceof FinanceSupplierCostCenterRuleError) {
        return handleValidationError(res, error);
      }
      console.error("PATCH /api/finance/supplier-cost-center-rules/:id", error);
      return res.status(500).json(
        financeApiErrorJson("Erro ao atualizar regra de classificação.", error)
      );
    }
  });

  app.delete("/api/finance/supplier-cost-center-rules/:id", ...manageGuard, async (req, res) => {
    try {
      const user = await getCurrentAppUser(req);
      if (!user) return res.status(401).json({ error: "Não autenticado." });

      const id = String(req.params.id ?? "").trim();
      if (!id) return res.status(400).json({ error: "ID inválido." });

      const item = await deactivateSupplierCostCenterRuleDefault(id, {
        userId: user.id,
        userName: user.name ?? user.email ?? null,
      });
      return res.json({ item, deactivated: true });
    } catch (error) {
      if (error instanceof FinanceSupplierCostCenterRuleError) {
        return handleValidationError(res, error);
      }
      console.error("DELETE /api/finance/supplier-cost-center-rules/:id", error);
      return res.status(500).json(
        financeApiErrorJson("Erro ao desativar regra de classificação.", error)
      );
    }
  });
}
