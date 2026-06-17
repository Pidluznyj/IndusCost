import type express from "express";
import type { RequestHandler } from "express";
import type { AppAuthContext } from "@/src/lib/appAuth.js";
import {
  buildFinanceAccountsReceivableDashboard,
  FinanceArFilterParseError,
  parseFinanceArDashboardFilters,
  type FinanceArDashboardFilters,
} from "@/src/lib/financeAccountsReceivableDashboard.js";
import {
  buildFinanceArExportCsv,
} from "@/src/lib/financeAccountsReceivableExport.js";
import { financeArExportFilename } from "@/src/lib/financeAccountsReceivableFormat.js";
import { loadFinanceArManagementRowsFromPrisma } from "@/src/lib/financeAccountsReceivableManagement.js";
import {
  buildFinanceArTitlesPayload,
  parseFinanceArTitlesQuery,
} from "@/src/lib/financeAccountsReceivableTitles.js";
import { prisma } from "@/src/lib/prisma.js";
import { registerFinanceAccountsReceivableOverdueRoutes } from "@/src/lib/financeAccountsReceivableOverdueRoutes.js";

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

/** Exportação CSV — preferencial; fallback para view documentado. */
export const FINANCE_AR_EXPORT_PERMISSIONS = [
  "finance.accountsReceivable.export",
  ...FINANCE_AR_DASHBOARD_VIEW_PERMISSIONS,
] as const;

async function loadFinanceArRows(filters: FinanceArDashboardFilters) {
  return loadFinanceArManagementRowsFromPrisma(prisma, filters);
}

function parseFinanceArFiltersOrRespond(
  res: express.Response,
  query: Record<string, unknown>
) {
  try {
    return parseFinanceArDashboardFilters(query);
  } catch (error) {
    if (error instanceof FinanceArFilterParseError) {
      res.status(400).json({ error: error.message });
      return null;
    }
    throw error;
  }
}

function parseFinanceArTitlesOrRespond(
  res: express.Response,
  query: Record<string, unknown>
) {
  try {
    return parseFinanceArTitlesQuery(query);
  } catch (error) {
    if (error instanceof FinanceArFilterParseError) {
      res.status(400).json({ error: error.message });
      return null;
    }
    throw error;
  }
}

export function registerFinanceAccountsReceivableRoutes(app: express.Express, auth: AuthGuards) {
  const { requireAppAuth, requireAnyPermission, getCurrentAppUser } = auth;
  const guard = [requireAppAuth, requireAnyPermission([...FINANCE_AR_DASHBOARD_VIEW_PERMISSIONS])] as const;
  const exportGuard = [requireAppAuth, requireAnyPermission([...FINANCE_AR_EXPORT_PERMISSIONS])] as const;

  app.get("/api/finance/accounts-receivable/dashboard", ...guard, async (req, res) => {
    try {
      const user = await getCurrentAppUser(req);
      if (!user) {
        return res.status(401).json({ error: "Não autenticado." });
      }

      const filters = parseFinanceArFiltersOrRespond(res, req.query as Record<string, unknown>);
      if (!filters) return;
      const { rows, syncCutoff } = await loadFinanceArRows(filters);
      const payload = buildFinanceAccountsReceivableDashboard(rows, filters, new Date(), syncCutoff);
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

      const query = parseFinanceArTitlesOrRespond(res, req.query as Record<string, unknown>);
      if (!query) return;
      const { rows, syncCutoff } = await loadFinanceArManagementRowsFromPrisma(
        prisma,
        query.filters
      );
      const payload = buildFinanceArTitlesPayload(rows, query, new Date(), syncCutoff);
      return res.json(payload);
    } catch (error) {
      console.error("GET /api/finance/accounts-receivable/titles", error);
      return res.status(500).json({ error: "Erro ao listar títulos de contas a receber." });
    }
  });

  app.get("/api/finance/accounts-receivable/export", ...exportGuard, async (req, res) => {
    try {
      const user = await getCurrentAppUser(req);
      if (!user) {
        return res.status(401).json({ error: "Não autenticado." });
      }

      const filters = parseFinanceArFiltersOrRespond(res, req.query as Record<string, unknown>);
      if (!filters) return;
      const { rows, syncCutoff } = await loadFinanceArRows(filters);
      const csv = buildFinanceArExportCsv(rows, filters, new Date(), syncCutoff);
      const filename = financeArExportFilename();
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      return res.send(csv);
    } catch (error) {
      console.error("GET /api/finance/accounts-receivable/export", error);
      return res.status(500).json({ error: "Erro ao exportar contas a receber." });
    }
  });

  registerFinanceAccountsReceivableOverdueRoutes(app, { requireAppAuth, requireAnyPermission });
}
