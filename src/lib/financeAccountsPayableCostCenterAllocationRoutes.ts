import type express from "express";
import type { RequestHandler } from "express";
import type { AppAuthContext } from "@/src/lib/appAuth.js";
import {
  applyAccountsPayableAllocationDefault,
  applyBatchAccountsPayableAllocationDefault,
  buildClassificationSummaryDefault,
  FinanceApAllocationError,
  listUnclassifiedAccountsPayableDefault,
  parseBatchAllocationApplyBody,
  parseBatchAllocationFiltersBody,
  parseManualAllocationBody,
  parseReclassificationBody,
  previewBatchAccountsPayableAllocationDefault,
  reclassifyAccountsPayableAllocationDefault,
} from "@/src/lib/financeAccountsPayableCostCenterAllocation.js";
import {
  listUnclassifiedGroupTitlesDefault,
  parseUnclassifiedGroupTitlesQuery,
} from "@/src/lib/financeUnclassifiedGroupTitles.js";
import { financeApiErrorJson } from "@/src/lib/financeTabLoadError.js";

type AuthGuards = {
  requireAppAuth: RequestHandler;
  requireAnyPermission: (permissions: string[]) => RequestHandler;
  getCurrentAppUser: (req: express.Request) => Promise<AppAuthContext | null>;
};

export const FINANCE_AP_ALLOCATION_VIEW_PERMISSIONS = [
  "finance.ap_allocations.view",
  "finance.view",
] as const;

export const FINANCE_AP_ALLOCATION_MANAGE_PERMISSIONS = [
  "finance.ap_allocations.manage",
] as const;

export const FINANCE_AP_ALLOCATION_BATCH_APPLY_PERMISSIONS = [
  "finance.ap_allocations.apply_batch",
] as const;

function handleAllocationError(res: express.Response, error: FinanceApAllocationError) {
  const status =
    error.code === "AP_NOT_FOUND"
      ? 404
      : error.code === "MANUAL_LOCKED" || error.code === "CLOSED_PERIOD"
        ? 409
        : 400;
  return res.status(status).json({ error: error.message, code: error.code });
}

function parseExternalIdParam(raw: string): number {
  const id = Number(raw);
  if (!Number.isFinite(id) || id <= 0) {
    throw new FinanceApAllocationError("INVALID_AP_ID", "ID do título AP inválido.");
  }
  return id;
}

export function registerFinanceAccountsPayableCostCenterAllocationRoutes(
  app: express.Express,
  auth: AuthGuards
) {
  const { requireAppAuth, requireAnyPermission, getCurrentAppUser } = auth;
  const viewGuard = [
    requireAppAuth,
    requireAnyPermission([...FINANCE_AP_ALLOCATION_VIEW_PERMISSIONS]),
  ] as const;
  const manageGuard = [
    requireAppAuth,
    requireAnyPermission([...FINANCE_AP_ALLOCATION_MANAGE_PERMISSIONS]),
  ] as const;
  const batchApplyGuard = [
    requireAppAuth,
    requireAnyPermission([...FINANCE_AP_ALLOCATION_BATCH_APPLY_PERMISSIONS]),
  ] as const;

  app.get("/api/finance/accounts-payable/classification-summary", ...viewGuard, async (req, res) => {
    try {
      const user = await getCurrentAppUser(req);
      if (!user) return res.status(401).json({ error: "Não autenticado." });

      const payload = await buildClassificationSummaryDefault();
      return res.json(payload);
    } catch (error) {
      console.error("GET /api/finance/accounts-payable/classification-summary", error);
      return res.status(500).json(
        financeApiErrorJson("Erro ao montar resumo de classificação AP.", error)
      );
    }
  });

  app.get("/api/finance/accounts-payable/unclassified", ...viewGuard, async (req, res) => {
    try {
      const user = await getCurrentAppUser(req);
      if (!user) return res.status(401).json({ error: "Não autenticado." });

      const filters = parseBatchAllocationFiltersBody(req.query);
      const payload = await listUnclassifiedAccountsPayableDefault(filters);
      return res.json(payload);
    } catch (error) {
      if (error instanceof FinanceApAllocationError) {
        return handleAllocationError(res, error);
      }
      console.error("GET /api/finance/accounts-payable/unclassified", error);
      return res.status(500).json(
        financeApiErrorJson("Erro ao listar títulos sem classificação.", error)
      );
    }
  });

  app.get(
    "/api/finance/cost-centers/unclassified-groups/:groupKey/titles",
    ...viewGuard,
    async (req, res) => {
      try {
        const user = await getCurrentAppUser(req);
        if (!user) return res.status(401).json({ error: "Não autenticado." });

        const groupKey = decodeURIComponent(String(req.params.groupKey ?? "").trim());
        const query = parseUnclassifiedGroupTitlesQuery({
          ...(req.query as Record<string, unknown>),
          groupKey,
        });
        const payload = await listUnclassifiedGroupTitlesDefault(query);
        return res.json(payload);
      } catch (error) {
        if (error instanceof FinanceApAllocationError) {
          return handleAllocationError(res, error);
        }
        console.error(
          "GET /api/finance/cost-centers/unclassified-groups/:groupKey/titles",
          error
        );
        return res.status(500).json(
          financeApiErrorJson("Erro ao listar títulos do grupo sem classificação.", error)
        );
      }
    }
  );

  app.post("/api/finance/accounts-payable/classify-batch-preview", ...batchApplyGuard, async (req, res) => {
    try {
      const user = await getCurrentAppUser(req);
      if (!user) return res.status(401).json({ error: "Não autenticado." });

      const filters = parseBatchAllocationFiltersBody(req.body);
      const preview = await previewBatchAccountsPayableAllocationDefault(filters);
      return res.json(preview);
    } catch (error) {
      if (error instanceof FinanceApAllocationError) {
        return handleAllocationError(res, error);
      }
      console.error("POST /api/finance/accounts-payable/classify-batch-preview", error);
      return res.status(500).json(
        financeApiErrorJson("Erro ao gerar preview de classificação em lote.", error)
      );
    }
  });

  app.post("/api/finance/accounts-payable/classify-batch-apply", ...batchApplyGuard, async (req, res) => {
    try {
      const user = await getCurrentAppUser(req);
      if (!user) return res.status(401).json({ error: "Não autenticado." });

      const { filters, confirmationText } = parseBatchAllocationApplyBody(req.body);
      const result = await applyBatchAccountsPayableAllocationDefault(filters, confirmationText, {
        userId: user.id,
        userName: user.name ?? user.email ?? null,
      });
      return res.json(result);
    } catch (error) {
      if (error instanceof FinanceApAllocationError) {
        return handleAllocationError(res, error);
      }
      console.error("POST /api/finance/accounts-payable/classify-batch-apply", error);
      return res.status(500).json(
        financeApiErrorJson("Erro ao aplicar classificação em lote.", error)
      );
    }
  });

  app.post(
    "/api/finance/accounts-payable/:id/cost-center-allocation",
    ...manageGuard,
    async (req, res) => {
      try {
        const user = await getCurrentAppUser(req);
        if (!user) return res.status(401).json({ error: "Não autenticado." });

        const externalId = parseExternalIdParam(req.params.id);
        const input = parseManualAllocationBody(req.body);
        const result = await applyAccountsPayableAllocationDefault(externalId, input, {
          userId: user.id,
          userName: user.name ?? user.email ?? null,
        });
        return res.status(201).json(result);
      } catch (error) {
        if (error instanceof FinanceApAllocationError) {
          return handleAllocationError(res, error);
        }
        console.error("POST /api/finance/accounts-payable/:id/cost-center-allocation", error);
        return res.status(500).json(
          financeApiErrorJson("Erro ao classificar título AP manualmente.", error)
        );
      }
    }
  );

  app.post(
    "/api/finance/accounts-payable/:id/cost-center-reclassification",
    ...manageGuard,
    async (req, res) => {
      try {
        const user = await getCurrentAppUser(req);
        if (!user) return res.status(401).json({ error: "Não autenticado." });

        const externalId = parseExternalIdParam(req.params.id);
        const input = parseReclassificationBody(req.body);
        const result = await reclassifyAccountsPayableAllocationDefault(externalId, input, {
          userId: user.id,
          userName: user.name ?? user.email ?? null,
        });
        return res.status(200).json(result);
      } catch (error) {
        if (error instanceof FinanceApAllocationError) {
          return handleAllocationError(res, error);
        }
        console.error(
          "POST /api/finance/accounts-payable/:id/cost-center-reclassification",
          error
        );
        return res.status(500).json(
          financeApiErrorJson("Erro ao reclassificar título manualmente.", error)
        );
      }
    }
  );
}
