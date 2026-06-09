import type express from "express";
import type { RequestHandler } from "express";
import type { AppAuthContext } from "@/src/lib/appAuth.js";
import { buildFinanceBillingDashboard } from "@/src/lib/financeBillingDashboard.js";
import { buildFinanceBillingNfeComparison } from "@/src/lib/financeBillingNfeComparison.js";
import { buildFinanceBillingNfeList } from "@/src/lib/financeBillingNfeList.js";
import { FINANCE_BILLING_VIEW_PERMISSIONS } from "@/src/lib/financeBillingPermissions.js";
import {
  getNomusNfesSyncStatus,
  NomusNfesSyncConflictError,
  startNomusNfesSyncApply,
} from "@/src/lib/nomusNfesSyncRunner.js";

type AuthGuards = {
  requireAppAuth: RequestHandler;
  requireAnyPermission: (permissions: string[]) => RequestHandler;
  getCurrentAppUser: (req: express.Request) => Promise<AppAuthContext | null>;
};

export function registerFinanceBillingRoutes(app: express.Express, auth: AuthGuards) {
  const { requireAppAuth, requireAnyPermission, getCurrentAppUser } = auth;
  const guard = [requireAppAuth, requireAnyPermission([...FINANCE_BILLING_VIEW_PERMISSIONS])] as const;

  app.get("/api/finance/billing/dashboard", ...guard, async (req, res) => {
    try {
      const user = await getCurrentAppUser(req);
      if (!user) {
        return res.status(401).json({ error: "Não autenticado." });
      }

      const payload = await buildFinanceBillingDashboard(req.query.year);
      return res.json(payload);
    } catch (error) {
      console.error("GET /api/finance/billing/dashboard", error);
      return res.status(500).json({ error: "Não foi possível carregar o faturamento. Tente novamente." });
    }
  });

  app.get("/api/finance/billing/nfes", ...guard, async (req, res) => {
    try {
      const user = await getCurrentAppUser(req);
      if (!user) {
        return res.status(401).json({ error: "Não autenticado." });
      }
      const payload = await buildFinanceBillingNfeList(req.query as Record<string, unknown>);
      return res.json(payload);
    } catch (error) {
      console.error("GET /api/finance/billing/nfes", error);
      return res.status(500).json({ error: "Não foi possível listar NF-e sincronizadas." });
    }
  });

  app.get("/api/finance/billing/comparison", ...guard, async (req, res) => {
    try {
      const user = await getCurrentAppUser(req);
      if (!user) {
        return res.status(401).json({ error: "Não autenticado." });
      }
      const payload = await buildFinanceBillingNfeComparison(req.query.year);
      return res.json(payload);
    } catch (error) {
      console.error("GET /api/finance/billing/comparison", error);
      return res.status(500).json({ error: "Não foi possível gerar comparativo de faturamento." });
    }
  });

  const billingSyncViewGuard = [
    requireAppAuth,
    requireAnyPermission(["settings.nomus.view", "settings.view", ...FINANCE_BILLING_VIEW_PERMISSIONS]),
  ] as const;

  const billingSyncRunGuard = [
    requireAppAuth,
    requireAnyPermission(["settings.nomus.sync", "settings.view"]),
  ] as const;

  app.get("/api/finance/billing/sync-status", ...billingSyncViewGuard, async (_req, res) => {
    try {
      const status = await getNomusNfesSyncStatus();
      return res.json(status);
    } catch (error) {
      console.error("GET /api/finance/billing/sync-status", error);
      return res.status(500).json({ error: "Erro ao consultar status da sincronização de NF-e." });
    }
  });

  app.post("/api/finance/billing/sync", ...billingSyncRunGuard, async (_req, res) => {
    try {
      const projectRoot = process.env.INDUSCOST_APP_DIR || process.cwd();
      const result = await startNomusNfesSyncApply(projectRoot);
      return res.status(202).json(result);
    } catch (error) {
      if (error instanceof NomusNfesSyncConflictError) {
        return res.status(409).json({
          error: error.message,
          message: "Já existe uma sincronização de NF-e em andamento. Aguarde finalizar.",
        });
      }
      console.error("POST /api/finance/billing/sync", error);
      return res.status(500).json({
        error: "Não foi possível iniciar a sincronização de NF-e. Verifique logs do servidor.",
      });
    }
  });
}
