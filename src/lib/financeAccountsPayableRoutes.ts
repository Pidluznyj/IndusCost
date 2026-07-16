import type express from "express";
import type { RequestHandler } from "express";
import type { AppAuthContext } from "@/src/lib/appAuth.js";
import {
  buildOfficialAccountsPayableDashboard,
  filterOfficialApTitlesForCostCenter,
} from "@/src/lib/financeAccountsPayableRulesAdapter.js";
import {
  buildFinanceApPrismaWhere,
  FinanceApFilterParseError,
  loadFinanceApManagementRowsFromPrisma,
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
import {
  FINANCE_AP_ACTIONS,
  FINANCE_AP_RESOURCE_KEY,
} from "@/src/lib/financeAccountsPayableAccess.js";

type AuthGuards = {
  requireAppAuth: RequestHandler;
  /** P18: preferir requireResource; legado ainda aceito em testes dual. */
  requireResource: (resourceKey: string, action?: string) => RequestHandler;
  getCurrentAppUser: (req: express.Request) => Promise<AppAuthContext | null>;
};

/** @deprecated Use FINANCE_AP_RESOURCE_KEY + requireResource view — listas bag só documentação. */
export const FINANCE_AP_DASHBOARD_VIEW_PERMISSIONS = [
  "finance.accountsPayable.view",
] as const;

/** @deprecated Use requireResource export. */
export const FINANCE_AP_EXPORT_PERMISSIONS = [
  "finance.accountsPayable.export",
] as const;

export const FINANCE_AP_ALLOCATION_VIEW_PERMISSIONS = [
  "finance.ap_allocations.view",
  "finance.view",
] as const;

export const FINANCE_AP_CLASSIFICATION_READ_PERMISSIONS = [
  ...FINANCE_AP_DASHBOARD_VIEW_PERMISSIONS,
  ...FINANCE_AP_ALLOCATION_VIEW_PERMISSIONS,
] as const;

async function loadFinanceApRows(filters: FinanceApDashboardFilters) {
  return loadFinanceApManagementRowsFromPrisma(prisma, filters);
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
  const { requireAppAuth, requireResource, getCurrentAppUser } = auth;
  const viewGuard = [
    requireAppAuth,
    requireResource(FINANCE_AP_RESOURCE_KEY, FINANCE_AP_ACTIONS.view),
  ] as const;
  const exportGuard = [
    requireAppAuth,
    requireResource(FINANCE_AP_RESOURCE_KEY, FINANCE_AP_ACTIONS.export),
  ] as const;

  app.get("/api/finance/accounts-payable/dashboard", ...viewGuard, async (req, res) => {
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
      const filteredForSummary = filterOfficialApTitlesForCostCenter(
        rows,
        filters,
        new Date(),
        syncCutoff
      );
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

  app.get("/api/finance/accounts-payable/titles", ...viewGuard, async (req, res) => {
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

  app.get("/api/finance/accounts-payable/titles/:id/classification", ...viewGuard, async (req, res) => {
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
