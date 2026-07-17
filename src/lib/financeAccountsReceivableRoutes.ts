import type express from "express";
import type { RequestHandler } from "express";
import type { AppAuthContext } from "@/src/lib/appAuth.js";
import {
  buildOfficialAccountsReceivableDashboard,
} from "@/src/lib/financeAccountsReceivableRulesAdapter.js";
import {
  FinanceArFilterParseError,
  parseFinanceArDashboardFilters,
  type FinanceArDashboardFilters,
} from "@/src/lib/financeAccountsReceivableDashboard.js";
import {
  buildFinanceArExportCsv,
} from "@/src/lib/financeAccountsReceivableExport.js";
import { financeArExportFilename } from "@/src/lib/financeAccountsReceivableFormat.js";
import {
  buildFinanceArTitlesExportBuffer,
  financeArTitlesExportFilename,
} from "@/src/lib/financeAccountsReceivableTitlesExport.js";
import { loadFinanceArManagementRowsFromPrisma } from "@/src/lib/financeAccountsReceivableManagement.js";
import { loadFinanceArOpenHorizonRowsFromPrisma } from "@/src/lib/financeAccountsReceivableHorizon.js";
import { listFinanceArHorizonBucketCustomers } from "@/src/lib/financeArHorizonBucketCustomers.js";
import { parseFinanceAgingBucketParam } from "@/src/lib/financeDashboardAgingBuckets.js";
import {
  buildFinanceArHorizonExportPayloadDefault,
  FinanceArHorizonExportError,
  parseFinanceArHorizonExportQuery,
} from "@/src/lib/financeAccountsReceivableHorizonExport.js";
import {
  buildFinanceArHorizonExportBuffer,
  buildFinanceArHorizonExportFilename,
} from "@/src/lib/financeAccountsReceivableHorizonExportXlsx.js";
import {
  buildFinanceArTitlesPayload,
  financeArTitlesPrismaFilters,
  isFinanceArHorizonTitlesQuery,
  parseFinanceArTitlesQuery,
} from "@/src/lib/financeAccountsReceivableTitles.js";
import { loadFinanceArEffectiveOrderContexts } from "@/src/lib/finance/financeAccountsReceivableEffectiveTitles.server.js";
import { prisma } from "@/src/lib/prisma.js";
import { registerFinanceAccountsReceivableOverdueRoutes } from "@/src/lib/financeAccountsReceivableOverdueRoutes.js";
import {
  FINANCE_MODULE_ACTIONS,
  FINANCE_MODULE_RESOURCE_KEYS,
} from "@/src/lib/financeModulesAccess.js";

type AuthGuards = {
  requireAppAuth: RequestHandler;
  requireResource: (resourceKey: string, action?: string) => RequestHandler;
  getCurrentAppUser: (req: express.Request) => Promise<AppAuthContext | null>;
};

/** @deprecated Use FINANCE_MODULE_RESOURCE_KEYS.accountsReceivable + requireResource view. */
export const FINANCE_AR_DASHBOARD_VIEW_PERMISSIONS = [
  "finance.accountsReceivable.view",
  "finance.view",
] as const;

/** @deprecated Use requireResource export — sem soft view. */
export const FINANCE_AR_EXPORT_PERMISSIONS = [
  "finance.accountsReceivable.export",
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

function parseFinanceArHorizonExportOrRespond(
  res: express.Response,
  query: Record<string, unknown>
) {
  try {
    return parseFinanceArHorizonExportQuery(query);
  } catch (error) {
    if (error instanceof FinanceArFilterParseError || error instanceof FinanceArHorizonExportError) {
      res.status(400).json({ error: error.message });
      return null;
    }
    throw error;
  }
}

export function registerFinanceAccountsReceivableRoutes(app: express.Express, auth: AuthGuards) {
  const { requireAppAuth, requireResource, getCurrentAppUser } = auth;
  const guard = [
    requireAppAuth,
    requireResource(FINANCE_MODULE_RESOURCE_KEYS.accountsReceivable, FINANCE_MODULE_ACTIONS.view),
  ] as const;
  const exportGuard = [
    requireAppAuth,
    requireResource(FINANCE_MODULE_RESOURCE_KEYS.accountsReceivable, FINANCE_MODULE_ACTIONS.export),
  ] as const;

  app.get("/api/finance/accounts-receivable/dashboard", ...guard, async (req, res) => {
    try {
      const user = await getCurrentAppUser(req);
      if (!user) {
        return res.status(401).json({ error: "Não autenticado." });
      }

      const filters = parseFinanceArFiltersOrRespond(res, req.query as Record<string, unknown>);
      if (!filters) return;
      const referenceDate = new Date();
      const { rows, syncCutoff } = await loadFinanceArRows(filters);
      const { rows: horizonSourceRows } = await loadFinanceArOpenHorizonRowsFromPrisma(
        prisma,
        referenceDate
      );
      const payload = buildOfficialAccountsReceivableDashboard({
        rows,
        filters,
        referenceDate,
        syncCutoff,
        horizonSourceRows,
      });
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
      const referenceDate = new Date();
      const { rows, syncCutoff } = isFinanceArHorizonTitlesQuery(query)
        ? await loadFinanceArOpenHorizonRowsFromPrisma(prisma, referenceDate)
        : await loadFinanceArManagementRowsFromPrisma(prisma, financeArTitlesPrismaFilters(query));
      const orderContexts = await loadFinanceArEffectiveOrderContexts(prisma, {
        search: query.search,
        document: query.extended?.document,
        customerPersonId: query.extended?.customerId,
        customerName: query.extended?.customerName,
      }, referenceDate);
      const payload = buildFinanceArTitlesPayload(
        rows,
        query,
        referenceDate,
        syncCutoff,
        { orderContexts }
      );
      return res.json(payload);
    } catch (error) {
      console.error("GET /api/finance/accounts-receivable/titles", error);
      return res.status(500).json({ error: "Erro ao listar títulos de contas a receber." });
    }
  });

  app.get("/api/finance/accounts-receivable/horizon/bucket-customers", ...guard, async (req, res) => {
    try {
      const user = await getCurrentAppUser(req);
      if (!user) {
        return res.status(401).json({ error: "Não autenticado." });
      }

      const agingBucket = parseFinanceAgingBucketParam(req.query.agingBucket);
      if (!agingBucket || !isFinanceArHorizonTitlesQuery({ agingBucket })) {
        return res.status(400).json({ error: "Faixa do horizonte é obrigatória." });
      }

      const referenceDate = new Date();
      const { rows, syncCutoff } = await loadFinanceArOpenHorizonRowsFromPrisma(prisma, referenceDate);
      const items = listFinanceArHorizonBucketCustomers(rows, agingBucket, referenceDate, syncCutoff);
      return res.json({ items });
    } catch (error) {
      console.error("GET /api/finance/accounts-receivable/horizon/bucket-customers", error);
      return res.status(500).json({ error: "Erro ao listar clientes da faixa do horizonte." });
    }
  });

  app.get("/api/finance/accounts-receivable/titles/export.xlsx", ...exportGuard, async (req, res) => {
    try {
      const user = await getCurrentAppUser(req);
      if (!user) {
        return res.status(401).json({ error: "Não autenticado." });
      }

      const rawQuery = { ...(req.query as Record<string, unknown>), page: "1", pageSize: "50000" };
      const query = parseFinanceArTitlesOrRespond(res, rawQuery);
      if (!query) return;
      const referenceDate = new Date();
      const { rows, syncCutoff } = await loadFinanceArManagementRowsFromPrisma(
        prisma,
        financeArTitlesPrismaFilters(query)
      );
      const orderContexts = await loadFinanceArEffectiveOrderContexts(prisma, {
        search: query.search,
        document: query.extended?.document,
        customerPersonId: query.extended?.customerId,
        customerName: query.extended?.customerName,
      }, referenceDate);
      const exportQuery = { ...query, page: 1, limit: 50_000 };
      const payload = buildFinanceArTitlesPayload(
        rows,
        exportQuery,
        referenceDate,
        syncCutoff,
        { orderContexts }
      );
      const allPayload = buildFinanceArTitlesPayload(
        rows,
        { ...exportQuery, limit: Math.max(payload.total, 1) },
        referenceDate,
        syncCutoff,
        { orderContexts }
      );
      const generatedAt = new Date().toISOString();
      const buffer = buildFinanceArTitlesExportBuffer(allPayload, allPayload.items, generatedAt);
      const filename = financeArTitlesExportFilename(referenceDate);
      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      );
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      return res.send(buffer);
    } catch (error) {
      console.error("GET /api/finance/accounts-receivable/titles/export.xlsx", error);
      return res.status(500).json({ error: "Erro ao exportar títulos em Excel." });
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

  app.get("/api/finance/accounts-receivable/horizon/export-data", ...exportGuard, async (req, res) => {
    try {
      const user = await getCurrentAppUser(req);
      if (!user) {
        return res.status(401).json({ error: "Não autenticado." });
      }

      const query = parseFinanceArHorizonExportOrRespond(res, req.query as Record<string, unknown>);
      if (!query) return;
      const referenceDate = new Date();
      const payload = await buildFinanceArHorizonExportPayloadDefault(
        prisma,
        query,
        { userName: user.name ?? null },
        referenceDate
      );
      return res.json(payload);
    } catch (error) {
      console.error("GET /api/finance/accounts-receivable/horizon/export-data", error);
      return res.status(500).json({ error: "Erro ao montar dados de exportação do horizonte." });
    }
  });

  app.get("/api/finance/accounts-receivable/horizon/export.xlsx", ...exportGuard, async (req, res) => {
    try {
      const user = await getCurrentAppUser(req);
      if (!user) {
        return res.status(401).json({ error: "Não autenticado." });
      }

      const query = parseFinanceArHorizonExportOrRespond(res, req.query as Record<string, unknown>);
      if (!query) return;
      const referenceDate = new Date();
      const payload = await buildFinanceArHorizonExportPayloadDefault(
        prisma,
        query,
        { userName: user.name ?? null },
        referenceDate
      );
      const buffer = buildFinanceArHorizonExportBuffer(payload);
      const bucketLabel =
        query.scope === "full" ? "Todas as faixas" : (payload.bucket?.label ?? "faixa");
      const filename = buildFinanceArHorizonExportFilename(bucketLabel, referenceDate);
      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      );
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      return res.send(buffer);
    } catch (error) {
      console.error("GET /api/finance/accounts-receivable/horizon/export.xlsx", error);
      return res.status(500).json({ error: "Erro ao exportar horizonte em Excel." });
    }
  });

  registerFinanceAccountsReceivableOverdueRoutes(app, { requireAppAuth, requireResource });
}
