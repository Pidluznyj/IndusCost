import type express from "express";
import type { RequestHandler } from "express";
import type { AppAuthContext } from "./appAuth.js";
import {
  filterFinanceArManagementReportRows,
} from "./financeAccountsReceivableManagement.js";
import { loadEnrichedFinanceArManagementRowsFromPrisma } from "./financeAccountsReceivableManagement.server.js";
import {
  buildOfficialApDueRadarPayload,
  filterOfficialApManagementTitles,
} from "./financeAccountsPayableRulesAdapter.js";
import { loadFinanceApManagementRowsFromPrisma } from "./financeAccountsPayableDashboard.js";
import {
  buildFinanceArDueRadar,
  parseDueRadarQuery,
  type DueRadarPayload,
} from "./financeDueRadar.js";
import { parseDueRadarPageFilters } from "./financeDueRadarFilters.js";
import {
  buildDueRadarExportBuffer,
  buildDueRadarExportPayload,
  DueRadarExportError,
  parseDueRadarExportQuery,
} from "./financeDueRadarExport.js";
import { prisma } from "./prisma.js";

const FINANCE_AR_DASHBOARD_VIEW_PERMISSIONS = [
  "finance.accountsReceivable.view",
  "finance.view",
  "reports.view",
  "settings.nomus.view",
  "settings.view",
] as const;

const FINANCE_AR_EXPORT_PERMISSIONS = [
  "finance.accountsReceivable.export",
  ...FINANCE_AR_DASHBOARD_VIEW_PERMISSIONS,
] as const;

const FINANCE_AP_DASHBOARD_VIEW_PERMISSIONS = [
  "finance.accountsPayable.view",
  "finance.view",
  "reports.view",
  "settings.nomus.view",
  "settings.view",
] as const;

const FINANCE_AP_EXPORT_PERMISSIONS = [
  "finance.accountsPayable.export",
  ...FINANCE_AP_DASHBOARD_VIEW_PERMISSIONS,
] as const;

type AuthGuards = {
  requireAppAuth: RequestHandler;
  requireAnyPermission: (permissions: string[]) => RequestHandler;
  getCurrentAppUser: (req: express.Request) => Promise<AppAuthContext | null>;
};

async function loadArDueRadarRows(query: Record<string, unknown>, referenceDate: Date) {
  const filters = parseDueRadarPageFilters(query, "receivable");
  const { rows, syncCutoff } = await loadEnrichedFinanceArManagementRowsFromPrisma(prisma, filters, referenceDate);
  const filtered = filterFinanceArManagementReportRows(rows, filters, referenceDate, syncCutoff);
  return { filtered, filtersApplied: filters as Record<string, unknown> };
}

async function loadApDueRadarRows(query: Record<string, unknown>, referenceDate: Date) {
  const filters = parseDueRadarPageFilters(query, "payable");
  const { rows, syncCutoff } = await loadFinanceApManagementRowsFromPrisma(
    prisma,
    filters,
    referenceDate
  );
  const filtered = filterOfficialApManagementTitles(rows, filters, referenceDate, syncCutoff);
  return { filtered, filtersApplied: filters as Record<string, unknown> };
}

function respondDueRadarError(res: express.Response, error: unknown): boolean {
  if (error instanceof DueRadarExportError) {
    res.status(400).json({ error: error.message });
    return true;
  }
  return false;
}

export function registerFinanceArDueRadarRoutes(app: express.Express, auth: AuthGuards) {
  const { requireAppAuth, requireAnyPermission, getCurrentAppUser } = auth;
  const guard = [requireAppAuth, requireAnyPermission([...FINANCE_AR_DASHBOARD_VIEW_PERMISSIONS])] as const;
  const exportGuard = [requireAppAuth, requireAnyPermission([...FINANCE_AR_EXPORT_PERMISSIONS])] as const;

  app.get("/api/finance/accounts-receivable/due-radar", ...guard, async (req, res) => {
    try {
      const referenceDate = new Date();
      const { filtered } = await loadArDueRadarRows(req.query as Record<string, unknown>, referenceDate);
      const payload = buildFinanceArDueRadar(
        filtered,
        parseDueRadarQuery(req.query as Record<string, unknown>),
        referenceDate
      );
      return res.json(payload);
    } catch (error) {
      console.error("GET /api/finance/accounts-receivable/due-radar", error);
      return res.status(500).json({ error: "Erro ao montar radar de recebimentos." });
    }
  });

  app.get("/api/finance/accounts-receivable/due-radar/export-data", ...exportGuard, async (req, res) => {
    try {
      const user = await getCurrentAppUser(req);
      const referenceDate = new Date();
      const { filtered, filtersApplied } = await loadArDueRadarRows(req.query as Record<string, unknown>, referenceDate);
      const payload = buildFinanceArDueRadar(
        filtered,
        parseDueRadarExportQuery(req.query as Record<string, unknown>),
        referenceDate
      );
      return res.json(
        buildDueRadarExportPayload(payload, {
          userName: user?.displayName ?? user?.email ?? null,
          filtersApplied,
        })
      );
    } catch (error) {
      if (respondDueRadarError(res, error)) return;
      console.error("GET /api/finance/accounts-receivable/due-radar/export-data", error);
      return res.status(500).json({ error: "Erro ao exportar radar de recebimentos." });
    }
  });

  app.get("/api/finance/accounts-receivable/due-radar/export.xlsx", ...exportGuard, async (req, res) => {
    try {
      const user = await getCurrentAppUser(req);
      const referenceDate = new Date();
      const { filtered, filtersApplied } = await loadArDueRadarRows(req.query as Record<string, unknown>, referenceDate);
      const payload = buildFinanceArDueRadar(
        filtered,
        parseDueRadarExportQuery(req.query as Record<string, unknown>),
        referenceDate
      );
      const exportPayload = buildDueRadarExportPayload(payload, {
        userName: user?.displayName ?? user?.email ?? null,
        filtersApplied,
      });
      const buffer = buildDueRadarExportBuffer(exportPayload);
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="${exportPayload.filename}"`);
      return res.send(buffer);
    } catch (error) {
      if (respondDueRadarError(res, error)) return;
      console.error("GET /api/finance/accounts-receivable/due-radar/export.xlsx", error);
      return res.status(500).json({ error: "Erro ao exportar Excel do radar de recebimentos." });
    }
  });
}

export function registerFinanceApDueRadarRoutes(app: express.Express, auth: AuthGuards) {
  const { requireAppAuth, requireAnyPermission, getCurrentAppUser } = auth;
  const guard = [requireAppAuth, requireAnyPermission([...FINANCE_AP_DASHBOARD_VIEW_PERMISSIONS])] as const;
  const exportGuard = [requireAppAuth, requireAnyPermission([...FINANCE_AP_EXPORT_PERMISSIONS])] as const;

  app.get("/api/finance/accounts-payable/due-radar", ...guard, async (req, res) => {
    try {
      const referenceDate = new Date();
      const { filtered } = await loadApDueRadarRows(req.query as Record<string, unknown>, referenceDate);
      const payload = buildOfficialApDueRadarPayload(
        filtered,
        parseDueRadarQuery(req.query as Record<string, unknown>),
        referenceDate
      );
      return res.json(payload);
    } catch (error) {
      console.error("GET /api/finance/accounts-payable/due-radar", error);
      return res.status(500).json({ error: "Erro ao montar radar de pagamentos." });
    }
  });

  app.get("/api/finance/accounts-payable/due-radar/export-data", ...exportGuard, async (req, res) => {
    try {
      const user = await getCurrentAppUser(req);
      const referenceDate = new Date();
      const { filtered, filtersApplied } = await loadApDueRadarRows(req.query as Record<string, unknown>, referenceDate);
      const payload = buildOfficialApDueRadarPayload(
        filtered,
        parseDueRadarExportQuery(req.query as Record<string, unknown>),
        referenceDate
      );
      return res.json(
        buildDueRadarExportPayload(payload, {
          userName: user?.displayName ?? user?.email ?? null,
          filtersApplied,
        })
      );
    } catch (error) {
      if (respondDueRadarError(res, error)) return;
      console.error("GET /api/finance/accounts-payable/due-radar/export-data", error);
      return res.status(500).json({ error: "Erro ao exportar radar de pagamentos." });
    }
  });

  app.get("/api/finance/accounts-payable/due-radar/export.xlsx", ...exportGuard, async (req, res) => {
    try {
      const user = await getCurrentAppUser(req);
      const referenceDate = new Date();
      const { filtered, filtersApplied } = await loadApDueRadarRows(req.query as Record<string, unknown>, referenceDate);
      const payload = buildOfficialApDueRadarPayload(
        filtered,
        parseDueRadarExportQuery(req.query as Record<string, unknown>),
        referenceDate
      );
      const exportPayload = buildDueRadarExportPayload(payload, {
        userName: user?.displayName ?? user?.email ?? null,
        filtersApplied,
      });
      const buffer = buildDueRadarExportBuffer(exportPayload);
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="${exportPayload.filename}"`);
      return res.send(buffer);
    } catch (error) {
      if (respondDueRadarError(res, error)) return;
      console.error("GET /api/finance/accounts-payable/due-radar/export.xlsx", error);
      return res.status(500).json({ error: "Erro ao exportar Excel do radar de pagamentos." });
    }
  });
}

export type { DueRadarPayload };
