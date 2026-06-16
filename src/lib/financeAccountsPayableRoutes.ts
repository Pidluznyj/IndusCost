import type express from "express";
import type { RequestHandler } from "express";
import type { AppAuthContext } from "@/src/lib/appAuth.js";
import {
  buildFinanceAccountsPayableDashboard,
  buildFinanceApPrismaWhere,
  FinanceApFilterParseError,
  mapPrismaRowToFinanceApDashboardRow,
  parseFinanceApDashboardFilters,
  resolveFinanceApDashboardFiltersForLoad,
  type FinanceApDashboardFilters,
} from "@/src/lib/financeAccountsPayableDashboard.js";
import {
  buildFinanceApExportCsv,
} from "@/src/lib/financeAccountsPayableExport.js";
import { financeApExportFilename } from "@/src/lib/financeAccountsPayableFormat.js";
import {
  buildFinanceApTitlesPayload,
  FINANCE_AP_TITLE_SELECT,
  mapPrismaRowToFinanceApTitleRow,
  parseFinanceApTitlesQuery,
} from "@/src/lib/financeAccountsPayableTitles.js";
import { resolveNomusApReportSyncCutoffFromPrisma } from "@/src/lib/financeNomusApReportFreshness.js";
import { prisma } from "@/src/lib/prisma.js";

type AuthGuards = {
  requireAppAuth: RequestHandler;
  requireAnyPermission: (permissions: string[]) => RequestHandler;
  getCurrentAppUser: (req: express.Request) => Promise<AppAuthContext | null>;
};

/** Permissões do dashboard AR — ver docs/generated/finance-accounts-payable-dashboard-report.md */
export const FINANCE_AP_DASHBOARD_VIEW_PERMISSIONS = [
  "finance.accountsPayable.view",
  "finance.view",
  "reports.view",
  "settings.nomus.view",
  "settings.view",
] as const;

/** Exportação CSV — preferencial; fallback para view documentado. */
export const FINANCE_AP_EXPORT_PERMISSIONS = [
  "finance.accountsPayable.export",
  ...FINANCE_AP_DASHBOARD_VIEW_PERMISSIONS,
] as const;

const FINANCE_AP_DASHBOARD_SELECT = {
  ...FINANCE_AP_TITLE_SELECT,
} as const;

async function loadFinanceApRows(filters: FinanceApDashboardFilters) {
  const syncCutoff = await resolveNomusApReportSyncCutoffFromPrisma(prisma);
  const where = buildFinanceApPrismaWhere(filters, syncCutoff);
  const rows = await prisma.nomusAccountsPayable.findMany({
    where,
    select: FINANCE_AP_DASHBOARD_SELECT,
    orderBy: { dueDate: "asc" },
  });
  return { rows: rows.map(mapPrismaRowToFinanceApDashboardRow), syncCutoff };
}

function resolveFinanceApLoadFilters(
  res: express.Response,
  query: Record<string, unknown>
): FinanceApDashboardFilters | null {
  const filters = parseFinanceApFiltersOrRespond(res, query);
  if (!filters) return null;
  return resolveFinanceApDashboardFiltersForLoad(query, filters);
}

function parseFinanceApFiltersOrRespond(
  res: express.Response,
  query: Record<string, unknown>
) {
  try {
    return parseFinanceApDashboardFilters(query);
  } catch (error) {
    if (error instanceof FinanceApFilterParseError) {
      res.status(400).json({ error: error.message });
      return null;
    }
    throw error;
  }
}

function parseFinanceApTitlesOrRespond(
  res: express.Response,
  query: Record<string, unknown>
) {
  try {
    return parseFinanceApTitlesQuery(query);
  } catch (error) {
    if (error instanceof FinanceApFilterParseError) {
      res.status(400).json({ error: error.message });
      return null;
    }
    throw error;
  }
}

export function registerFinanceAccountsPayableRoutes(app: express.Express, auth: AuthGuards) {
  const { requireAppAuth, requireAnyPermission, getCurrentAppUser } = auth;
  const guard = [requireAppAuth, requireAnyPermission([...FINANCE_AP_DASHBOARD_VIEW_PERMISSIONS])] as const;
  const exportGuard = [requireAppAuth, requireAnyPermission([...FINANCE_AP_EXPORT_PERMISSIONS])] as const;

  app.get("/api/finance/accounts-payable/dashboard", ...guard, async (req, res) => {
    try {
      const user = await getCurrentAppUser(req);
      if (!user) {
        return res.status(401).json({ error: "Não autenticado." });
      }

      const query = req.query as Record<string, unknown>;
      const filters = resolveFinanceApLoadFilters(res, query);
      if (!filters) return;
      const { rows, syncCutoff } = await loadFinanceApRows(filters);
      const payload = buildFinanceAccountsPayableDashboard(rows, filters, new Date(), syncCutoff);
      return res.json(payload);
    } catch (error) {
      console.error("GET /api/finance/accounts-payable/dashboard", error);
      return res.status(500).json({ error: "Erro ao montar dashboard de contas a pagar." });
    }
  });

  app.get("/api/finance/accounts-payable/titles", ...guard, async (req, res) => {
    try {
      const user = await getCurrentAppUser(req);
      if (!user) {
        return res.status(401).json({ error: "Não autenticado." });
      }

      const rawQuery = req.query as Record<string, unknown>;
      const query = parseFinanceApTitlesOrRespond(res, rawQuery);
      if (!query) return;
      const loadFilters = resolveFinanceApDashboardFiltersForLoad(rawQuery, query.filters);
      const syncCutoff = await resolveNomusApReportSyncCutoffFromPrisma(prisma);
      const rows = await prisma.nomusAccountsPayable.findMany({
        where: buildFinanceApPrismaWhere(loadFilters, syncCutoff),
        select: FINANCE_AP_TITLE_SELECT,
        orderBy: { dueDate: "asc" },
      });
      const mapped = rows.map(mapPrismaRowToFinanceApTitleRow);
      const payload = buildFinanceApTitlesPayload(
        mapped,
        {
          ...query,
          filters: loadFilters,
        },
        new Date(),
        syncCutoff
      );
      return res.json(payload);
    } catch (error) {
      console.error("GET /api/finance/accounts-payable/titles", error);
      return res.status(500).json({ error: "Erro ao listar títulos de contas a pagar." });
    }
  });

  app.get("/api/finance/accounts-payable/export", ...exportGuard, async (req, res) => {
    try {
      const user = await getCurrentAppUser(req);
      if (!user) {
        return res.status(401).json({ error: "Não autenticado." });
      }

      const query = req.query as Record<string, unknown>;
      const filters = resolveFinanceApLoadFilters(res, query);
      if (!filters) return;
      const { rows, syncCutoff } = await loadFinanceApRows(filters);
      const csv = buildFinanceApExportCsv(rows, filters, new Date(), syncCutoff);
      const filename = financeApExportFilename();
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      return res.send(csv);
    } catch (error) {
      console.error("GET /api/finance/accounts-payable/export", error);
      return res.status(500).json({ error: "Erro ao exportar contas a pagar." });
    }
  });
}
