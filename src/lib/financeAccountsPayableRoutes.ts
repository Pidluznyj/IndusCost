import type express from "express";
import type { RequestHandler } from "express";
import type { AppAuthContext } from "@/src/lib/appAuth.js";
import {
  buildOfficialAccountsPayableDashboard,
} from "@/src/lib/financeAccountsPayableRulesAdapter.js";
import {
  buildFinanceApPrismaWhere,
  filterFinanceApRows,
  FinanceApFilterParseError,
  mapPrismaRowToFinanceApDashboardRow,
  parseFinanceApDashboardFilters,
  resolveFinanceApDashboardFiltersForLoad,
  type FinanceApDashboardFilters,
} from "@/src/lib/financeAccountsPayableDashboard.js";
import {
  buildApClassificationFilterOptions,
  buildApCostCenterIntegrationContext,
  buildApTitleClassificationDetailDefault,
  buildFinanceApExportCsvWithClassification,
  computeApClassificationSummary,
  createDefaultApCostCenterIntegrationDeps,
  enrichFinanceApTitlesPayload,
  filterApRowsByClassification,
  parseFinanceApClassificationStatusFilter,
} from "@/src/lib/financeAccountsPayableCostCenterIntegration.js";
import { financeApExportFilename } from "@/src/lib/financeAccountsPayableFormat.js";
import {
  buildFinanceApTitlesPayload,
  FINANCE_AP_TITLE_SELECT,
  mapPrismaRowToFinanceApTitleRow,
  parseFinanceApTitlesQuery,
} from "@/src/lib/financeAccountsPayableTitles.js";
import { resolveNomusApReportSyncCutoffFromPrisma } from "@/src/lib/financeNomusApReportFreshness.js";
import { financeApiErrorJson } from "@/src/lib/financeTabLoadError.js";
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

export const FINANCE_AP_ALLOCATION_VIEW_PERMISSIONS = [
  "finance.ap_allocations.view",
  "finance.view",
] as const;

export const FINANCE_AP_CLASSIFICATION_READ_PERMISSIONS = [
  ...FINANCE_AP_DASHBOARD_VIEW_PERMISSIONS,
  ...FINANCE_AP_ALLOCATION_VIEW_PERMISSIONS,
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
  const classificationGuard = [
    requireAppAuth,
    requireAnyPermission([...FINANCE_AP_CLASSIFICATION_READ_PERMISSIONS]),
  ] as const;
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
      const referenceDate = new Date();
      const payload = buildOfficialAccountsPayableDashboard({
        rows,
        filters,
        referenceDate,
        syncCutoff,
      });
      const integrationDeps = createDefaultApCostCenterIntegrationDeps();
      const ctx = await buildApCostCenterIntegrationContext(
        rows.map((row) => row.externalId),
        integrationDeps
      );
      const filteredForSummary = filterFinanceApRows(rows, filters, new Date(), syncCutoff);
      const [costCenters, suppliers] = await Promise.all([
        integrationDeps.loadCostCenters(),
        integrationDeps.loadSuppliers(),
      ]);
      return res.json({
        ...payload,
        classificationSummary: computeApClassificationSummary(filteredForSummary, ctx),
        classificationFilterOptions: buildApClassificationFilterOptions(costCenters, suppliers),
      });
    } catch (error) {
      console.error("GET /api/finance/accounts-payable/dashboard", error);
      return res.status(500).json(
        financeApiErrorJson("Erro ao montar dashboard de contas a pagar.", error)
      );
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
      const integrationDeps = createDefaultApCostCenterIntegrationDeps();
      const classificationFilters = {
        costCenterId:
          typeof rawQuery.costCenterId === "string" ? rawQuery.costCenterId.trim() : undefined,
        supplierId:
          typeof rawQuery.supplierId === "string" ? rawQuery.supplierId.trim() : undefined,
        classificationStatus: parseFinanceApClassificationStatusFilter(rawQuery.classificationStatus),
      };
      const ctx = await buildApCostCenterIntegrationContext(
        mapped.map((row) => row.externalId),
        integrationDeps
      );
      const rowsForTitles = filterApRowsByClassification(mapped, ctx, classificationFilters);
      const referenceDate = new Date();
      const payload = buildFinanceApTitlesPayload(
        rowsForTitles,
        {
          ...query,
          filters: loadFilters,
        },
        referenceDate,
        syncCutoff
      );
      const rowsById = new Map(rowsForTitles.map((row) => [row.externalId, row]));
      return res.json(enrichFinanceApTitlesPayload(payload, rowsById, ctx, referenceDate));
    } catch (error) {
      console.error("GET /api/finance/accounts-payable/titles", error);
      return res.status(500).json(
        financeApiErrorJson("Erro ao listar títulos de contas a pagar.", error)
      );
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
      const integrationDeps = createDefaultApCostCenterIntegrationDeps();
      const ctx = await buildApCostCenterIntegrationContext(
        rows.map((row) => row.externalId),
        integrationDeps
      );
      const csv = buildFinanceApExportCsvWithClassification(
        rows,
        filters,
        ctx,
        new Date(),
        syncCutoff
      );
      const filename = financeApExportFilename();
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      return res.send(csv);
    } catch (error) {
      console.error("GET /api/finance/accounts-payable/export", error);
      return res.status(500).json({ error: "Erro ao exportar contas a pagar." });
    }
  });

  app.get("/api/finance/accounts-payable/titles/:id/classification", ...classificationGuard, async (req, res) => {
    try {
      const user = await getCurrentAppUser(req);
      if (!user) {
        return res.status(401).json({ error: "Não autenticado." });
      }

      const externalId = Number(req.params.id);
      if (!Number.isFinite(externalId) || externalId <= 0) {
        return res.status(400).json({ error: "ID do título inválido." });
      }

      const row = await prisma.nomusAccountsPayable.findUnique({
        where: { externalId },
        select: FINANCE_AP_TITLE_SELECT,
      });
      if (!row) {
        return res.status(404).json({ error: "Título não encontrado." });
      }

      const mapped = mapPrismaRowToFinanceApTitleRow(row);
      const detail = await buildApTitleClassificationDetailDefault(mapped);
      return res.json(detail);
    } catch (error) {
      console.error("GET /api/finance/accounts-payable/titles/:id/classification", error);
      return res.status(500).json(
        financeApiErrorJson("Erro ao carregar classificação do título.", error)
      );
    }
  });
}
