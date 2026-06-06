import type express from "express";
import type { RequestHandler } from "express";
import type { AppAuthContext } from "@/src/lib/appAuth.js";
import {
  buildFinanceAccountsReceivableDashboard,
  mapPrismaRowToFinanceArDashboardRow,
  parseFinanceArDashboardFilters,
} from "@/src/lib/financeAccountsReceivableDashboard.js";
import {
  buildFinanceArTitlesPayload,
  FINANCE_AR_TITLE_SELECT,
  mapPrismaRowToFinanceArTitleRow,
  parseFinanceArTitlesQuery,
} from "@/src/lib/financeAccountsReceivableTitles.js";
import { prisma } from "@/src/lib/prisma.js";

type AuthGuards = {
  requireAppAuth: RequestHandler;
  requireAnyPermission: (permissions: string[]) => RequestHandler;
  getCurrentAppUser: (req: express.Request) => Promise<AppAuthContext | null>;
};

/** Permissões do dashboard AR — ver docs/generated/finance-accounts-receivable-dashboard-report.md */
export const FINANCE_AR_DASHBOARD_VIEW_PERMISSIONS = [
  "finance.accountsReceivable.view",
  "finance.view",
  "reports.view",
  "settings.nomus.view",
  "settings.view",
] as const;

const FINANCE_AR_DASHBOARD_SELECT = {
  ...FINANCE_AR_TITLE_SELECT,
} as const;

async function loadFinanceArRows() {
  const rows = await prisma.nomusAccountsReceivable.findMany({
    select: FINANCE_AR_DASHBOARD_SELECT,
  });
  return rows.map(mapPrismaRowToFinanceArDashboardRow);
}

export function registerFinanceAccountsReceivableRoutes(app: express.Express, auth: AuthGuards) {
  const { requireAppAuth, requireAnyPermission, getCurrentAppUser } = auth;
  const guard = [requireAppAuth, requireAnyPermission([...FINANCE_AR_DASHBOARD_VIEW_PERMISSIONS])] as const;

  app.get("/api/finance/accounts-receivable/dashboard", ...guard, async (req, res) => {
    try {
      const user = await getCurrentAppUser(req);
      if (!user) {
        return res.status(401).json({ error: "Não autenticado." });
      }

      const filters = parseFinanceArDashboardFilters(req.query as Record<string, unknown>);
      const rows = await loadFinanceArRows();
      const payload = buildFinanceAccountsReceivableDashboard(
        rows,
        filters
      );
      return res.json(payload);
    } catch (error) {
      console.error("GET /api/finance/accounts-receivable/dashboard", error);
      return res.status(500).json({ error: "Erro ao montar dashboard de contas a receber." });
    }
  });

  app.get("/api/finance/accounts-receivable/titles", ...guard, async (req, res) => {
    try {
      const user = await getCurrentAppUser(req);
      if (!user) {
        return res.status(401).json({ error: "Não autenticado." });
      }

      const query = parseFinanceArTitlesQuery(req.query as Record<string, unknown>);
      const rows = await prisma.nomusAccountsReceivable.findMany({
        select: FINANCE_AR_TITLE_SELECT,
      });
      const mapped = rows.map(mapPrismaRowToFinanceArTitleRow);
      const payload = buildFinanceArTitlesPayload(mapped, query);
      return res.json(payload);
    } catch (error) {
      console.error("GET /api/finance/accounts-receivable/titles", error);
      return res.status(500).json({ error: "Erro ao listar títulos de contas a receber." });
    }
  });
}
