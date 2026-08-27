import type express from "express";
import type { RequestHandler } from "express";
import type { AppAuthContext } from "@/src/lib/appAuth.js";
import {
  applyAccountsPayableCostCenterReclassificationsWithDryRun,
  ensureDefaultFinancialReclassificationRules,
  FinanceCostCenterReclassificationError,
} from "@/src/lib/financeCostCenterReclassificationRules.js";
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
export const FINANCE_CC_RECLASSIFICATION_VIEW_PERMISSIONS = [
  "finance.cost_center_rules.view",
  "finance.cost_centers.view",
  "finance.view",
] as const;

/** @deprecated Use costCenters requireResource manage. */
export const FINANCE_CC_RECLASSIFICATION_MANAGE_PERMISSIONS = [
  "finance.cost_center_rules.manage",
  "finance.cost_centers.manage",
] as const;

function handleError(res: express.Response, error: unknown) {
  if (error instanceof FinanceCostCenterReclassificationError) {
    return res.status(400).json({ error: error.message, code: error.code });
  }
  return null;
}

export function registerFinanceCostCenterReclassificationRoutes(
  app: express.Express,
  auth: AuthGuards
): void {
  const { requireAppAuth, requireResource, getCurrentAppUser } = auth;
  const viewGuard = [
    requireAppAuth,
    requireResource(FINANCE_MODULE_RESOURCE_KEYS.costCenters, FINANCE_MODULE_ACTIONS.view),
  ] as const;
  const manageGuard = [
    requireAppAuth,
    requireResource(FINANCE_MODULE_RESOURCE_KEYS.costCenters, FINANCE_MODULE_ACTIONS.manage),
  ] as const;

  app.post(
    "/api/finance/cost-centers/reclassification-rules/ensure-defaults",
    ...manageGuard,
    async (req, res) => {
      try {
        const user = await getCurrentAppUser(req);
        if (!user) return res.status(401).json({ error: "Não autenticado." });

        const result = await ensureDefaultFinancialReclassificationRules({
          userId: user.id,
          userName: user.name ?? user.email ?? null,
        });
        return res.json(result);
      } catch (error) {
        const handled = handleError(res, error);
        if (handled) return handled;
        console.error(
          "POST /api/finance/cost-centers/reclassification-rules/ensure-defaults",
          error
        );
        return res.status(500).json(
          financeApiErrorJson("Erro ao garantir regras padrão de reclassificação.", error)
        );
      }
    }
  );

  app.post(
    "/api/finance/cost-centers/reclassify-accounts-payable",
    ...manageGuard,
    async (req, res) => {
      try {
        const user = await getCurrentAppUser(req);
        if (!user) return res.status(401).json({ error: "Não autenticado." });

        const dryRun = req.body?.dryRun !== false;
        const result = await applyAccountsPayableCostCenterReclassificationsWithDryRun({
          dryRun,
          user: {
            userId: user.id,
            userName: user.name ?? user.email ?? null,
          },
        });
        if (!dryRun) {
          // Snapshot da DRE: reclassificação em massa muda as séries por CC.
          const { markFinanceDreSnapshotsDirtySafe } = await import(
            "@/src/lib/financeDreSnapshot.server.js"
          );
          const { prisma } = await import("@/src/lib/prisma.js");
          await markFinanceDreSnapshotsDirtySafe(prisma, {
            reason: "cc-reclassification-rules",
          });
        }
        return res.json(result);
      } catch (error) {
        const handled = handleError(res, error);
        if (handled) return handled;
        console.error("POST /api/finance/cost-centers/reclassify-accounts-payable", error);
        return res.status(500).json(
          financeApiErrorJson("Erro ao reclassificar alocações AP.", error)
        );
      }
    }
  );

  app.get(
    "/api/finance/cost-centers/reclassify-accounts-payable/preview",
    ...viewGuard,
    async (_req, res) => {
      try {
        const result = await applyAccountsPayableCostCenterReclassificationsWithDryRun({
          dryRun: true,
          user: { userId: null, userName: "system" },
        });
        return res.json(result);
      } catch (error) {
        const handled = handleError(res, error);
        if (handled) return handled;
        console.error("GET /api/finance/cost-centers/reclassify-accounts-payable/preview", error);
        return res.status(500).json(
          financeApiErrorJson("Erro ao pré-visualizar reclassificações AP.", error)
        );
      }
    }
  );
}
