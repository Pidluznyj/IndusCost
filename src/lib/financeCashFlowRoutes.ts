import type express from "express";
import type { RequestHandler } from "express";
import type { AppAuthContext } from "@/src/lib/appAuth.js";
import { buildFinanceArPrismaWhere } from "@/src/lib/financeAccountsReceivableDashboard.js";
import { buildFinanceApPrismaWhere } from "@/src/lib/financeAccountsPayableDashboard.js";
import {
  buildFinanceCashFlowDashboard,
  FINANCE_CASH_FLOW_AP_SELECT,
  FINANCE_CASH_FLOW_AR_SELECT,
  FinanceCashFlowFilterParseError,
  mapPrismaRowToFinanceCashFlowApRow,
  mapPrismaRowToFinanceCashFlowArRow,
  parseFinanceCashFlowDashboardFilters,
  toApLoadFilters,
  toArLoadFilters,
} from "@/src/lib/financeCashFlowDashboard.js";
import {
  buildFinanceCashFlowExportCsv,
  financeCashFlowExportFilename,
} from "@/src/lib/financeCashFlowExport.js";
import { prisma } from "@/src/lib/prisma.js";

type AuthGuards = {
  requireAppAuth: RequestHandler;
  requireAnyPermission: (permissions: string[]) => RequestHandler;
  getCurrentAppUser: (req: express.Request) => Promise<AppAuthContext | null>;
};

export const FINANCE_CASH_FLOW_VIEW_PERMISSIONS = [
  "finance.view",
  "finance.accountsReceivable.view",
  "finance.accountsPayable.view",
  "reports.view",
  "settings.nomus.view",
  "settings.view",
] as const;

export const FINANCE_CASH_FLOW_EXPORT_PERMISSIONS = [
  "finance.accountsReceivable.export",
  "finance.accountsPayable.export",
  ...FINANCE_CASH_FLOW_VIEW_PERMISSIONS,
] as const;

function parseFiltersOrRespond(res: express.Response, query: Record<string, unknown>) {
  try {
    return parseFinanceCashFlowDashboardFilters(query);
  } catch (error) {
    if (error instanceof FinanceCashFlowFilterParseError) {
      res.status(400).json({ error: error.message });
      return null;
    }
    throw error;
  }
}

async function loadCashFlowRows(filters: ReturnType<typeof parseFinanceCashFlowDashboardFilters>) {
  const arWhere = buildFinanceArPrismaWhere(toArLoadFilters(filters));
  const apWhere = buildFinanceApPrismaWhere(toApLoadFilters(filters));

  const [arPrisma, apPrisma] = await Promise.all([
    prisma.nomusAccountsReceivable.findMany({
      where: arWhere,
      select: FINANCE_CASH_FLOW_AR_SELECT,
      orderBy: { dueDate: "asc" },
    }),
    prisma.nomusAccountsPayable.findMany({
      where: apWhere,
      select: FINANCE_CASH_FLOW_AP_SELECT,
      orderBy: { dueDate: "asc" },
    }),
  ]);

  return {
    arRows: arPrisma.map(mapPrismaRowToFinanceCashFlowArRow),
    apRows: apPrisma.map(mapPrismaRowToFinanceCashFlowApRow),
  };
}

export function registerFinanceCashFlowRoutes(app: express.Express, auth: AuthGuards) {
  app.get(
    "/api/finance/cash-flow/dashboard",
    auth.requireAppAuth,
    auth.requireAnyPermission([...FINANCE_CASH_FLOW_VIEW_PERMISSIONS]),
    async (req, res) => {
      const filters = parseFiltersOrRespond(res, req.query as Record<string, unknown>);
      if (!filters) return;

      const { arRows, apRows } = await loadCashFlowRows(filters);
      const payload = buildFinanceCashFlowDashboard(arRows, apRows, filters);
      res.json(payload);
    }
  );

  app.get(
    "/api/finance/cash-flow/export",
    auth.requireAppAuth,
    auth.requireAnyPermission([...FINANCE_CASH_FLOW_EXPORT_PERMISSIONS]),
    async (req, res) => {
      const filters = parseFiltersOrRespond(res, req.query as Record<string, unknown>);
      if (!filters) return;

      const { arRows, apRows } = await loadCashFlowRows(filters);
      const payload = buildFinanceCashFlowDashboard(arRows, apRows, filters);
      const csv = buildFinanceCashFlowExportCsv(payload);
      const filename = financeCashFlowExportFilename(filters.year);
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.send(csv);
    }
  );
}
