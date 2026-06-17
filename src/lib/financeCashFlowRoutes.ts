import type express from "express";
import type { RequestHandler } from "express";
import type { AppAuthContext } from "@/src/lib/appAuth.js";
import {
  buildCashFlowArPrismaWhere,
  buildCashFlowApPrismaWhere,
} from "@/src/lib/financeCashFlowRowFilters.js";
import {
  buildFinanceCashFlowDashboard,
  FINANCE_CASH_FLOW_AP_SELECT,
  FINANCE_CASH_FLOW_AR_SELECT,
  FinanceCashFlowFilterParseError,
  mapPrismaRowToFinanceCashFlowApRow,
  mapPrismaRowToFinanceCashFlowArRow,
  parseFinanceCashFlowDashboardFilters,
  resolveFinanceCashFlowFiltersForLoad,
  toApLoadFilters,
  toArLoadFilters,
} from "@/src/lib/financeCashFlowDashboard.js";
import {
  buildFinanceCashFlowAuditPayload,
  buildFinanceCashFlowDataset,
} from "@/src/lib/financeCashFlowDataset.js";
import {
  buildFinanceCashFlowExportCsv,
  financeCashFlowExportFilename,
} from "@/src/lib/financeCashFlowExport.js";
import { prisma } from "@/src/lib/prisma.js";
import { resolveNomusArReportSyncCutoffFromPrisma } from "@/src/lib/financeNomusArReportFreshness.js";
import { resolveNomusApReportSyncCutoffFromPrisma } from "@/src/lib/financeNomusApReportFreshness.js";

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
    const filters = parseFinanceCashFlowDashboardFilters(query);
    return resolveFinanceCashFlowFiltersForLoad(query, filters);
  } catch (error) {
    if (error instanceof FinanceCashFlowFilterParseError) {
      res.status(400).json({ error: error.message });
      return null;
    }
    throw error;
  }
}

async function loadCashFlowRows(filters: ReturnType<typeof parseFinanceCashFlowDashboardFilters>) {
  const [arSyncCutoff, apSyncCutoff] = await Promise.all([
    resolveNomusArReportSyncCutoffFromPrisma(prisma),
    resolveNomusApReportSyncCutoffFromPrisma(prisma),
  ]);
  const arFilters = toArLoadFilters(filters);
  const apFilters = toApLoadFilters(filters);
  const arWhere = buildCashFlowArPrismaWhere(filters, arFilters, new Date(), arSyncCutoff);
  const apWhere = buildCashFlowApPrismaWhere(filters, apFilters, new Date(), apSyncCutoff);

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
    arSyncCutoff,
    apSyncCutoff,
  };
}

export function registerFinanceCashFlowRoutes(app: express.Express, auth: AuthGuards) {
  app.get(
    "/api/finance/cash-flow/audit",
    auth.requireAppAuth,
    auth.requireAnyPermission([...FINANCE_CASH_FLOW_VIEW_PERMISSIONS]),
    async (req, res) => {
      const filters = parseFiltersOrRespond(res, req.query as Record<string, unknown>);
      if (!filters) return;

      const { arRows, apRows, arSyncCutoff, apSyncCutoff } = await loadCashFlowRows(filters);
      const dataset = buildFinanceCashFlowDataset(
        arRows,
        apRows,
        filters,
        toArLoadFilters(filters),
        toApLoadFilters(filters),
        new Date(),
        arSyncCutoff,
        apSyncCutoff
      );
      const audit = buildFinanceCashFlowAuditPayload(dataset, arRows.length, apRows.length, arRows, apRows);
      res.json(audit);
    }
  );

  app.get(
    "/api/finance/cash-flow/dashboard",
    auth.requireAppAuth,
    auth.requireAnyPermission([...FINANCE_CASH_FLOW_VIEW_PERMISSIONS]),
    async (req, res) => {
      const filters = parseFiltersOrRespond(res, req.query as Record<string, unknown>);
      if (!filters) return;

      const { arRows, apRows, arSyncCutoff, apSyncCutoff } = await loadCashFlowRows(filters);
      const auditMode = String(req.query.audit ?? "").trim() === "1";
      if (auditMode) {
        const dataset = buildFinanceCashFlowDataset(
          arRows,
          apRows,
          filters,
          toArLoadFilters(filters),
          toApLoadFilters(filters),
          new Date(),
          arSyncCutoff,
          apSyncCutoff
        );
        return res.json(
          buildFinanceCashFlowAuditPayload(dataset, arRows.length, apRows.length, arRows, apRows)
        );
      }
      const payload = buildFinanceCashFlowDashboard(
        arRows,
        apRows,
        filters,
        new Date(),
        arSyncCutoff,
        apSyncCutoff
      );
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

      const { arRows, apRows, arSyncCutoff, apSyncCutoff } = await loadCashFlowRows(filters);
      const payload = buildFinanceCashFlowDashboard(
        arRows,
        apRows,
        filters,
        new Date(),
        arSyncCutoff,
        apSyncCutoff
      );
      const csv = buildFinanceCashFlowExportCsv(payload);
      const filename = financeCashFlowExportFilename(filters.year);
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.send(csv);
    }
  );
}
