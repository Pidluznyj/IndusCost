import type express from "express";
import type { RequestHandler } from "express";
import type { AppAuthContext } from "@/src/lib/appAuth.js";
import {
  FINANCE_MODULE_ACTIONS,
  FINANCE_MODULE_RESOURCE_KEYS,
} from "@/src/lib/financeModulesAccess.js";
import {
  buildCashFlowApPrismaWhere,
} from "@/src/lib/financeCashFlowRowFilters.js";
import {
  buildFinanceCashFlowDashboard,
  FINANCE_CASH_FLOW_AP_SELECT,
  FinanceCashFlowFilterParseError,
  mapPrismaRowToFinanceCashFlowApRow,
  parseFinanceCashFlowDashboardFilters,
  resolveFinanceCashFlowFiltersForLoad,
  toApLoadFilters,
  toArLoadFilters,
  type FinanceCashFlowArRow,
} from "@/src/lib/financeCashFlowDashboard.js";
import { loadRawMaterialCostCenterSpotlight } from "@/src/lib/financeCashFlowRawMaterialSpotlight.server.js";
import {
  buildFinanceCashFlowAuditPayload,
  buildFinanceCashFlowDataset,
} from "@/src/lib/financeCashFlowDataset.js";
import {
  buildFinanceCashFlowExportCsv,
  financeCashFlowExportFilename,
} from "@/src/lib/financeCashFlowExport.js";
import {
  buildFinanceCashFlowDailyRadar,
  createDailyRadarDashboardFilters,
  DAILY_RADAR_CUSTOM_RANGE_KEY,
  DAILY_RADAR_EXPORT_PAGE_SIZE,
  parseDailyRadarQuery,
  filterDailyRadarPortfolioRows,
  validateDailyRadarCustomPeriod,
} from "@/src/lib/financeCashFlowDailyRadar.js";
import {
  buildCashFlowCostCenterSummary,
  extractPayableExternalId,
  filterCashFlowCostCenterTitles,
  type CashFlowCostCenterAllocationInput,
  type CashFlowCostCenterMetaInput,
} from "@/src/lib/financeCashFlowDailyRadarCostCenters.js";
import {
  buildFinanceCashFlowDailyRadarExportPayload,
  FinanceCashFlowDailyRadarExportError,
  parseDailyRadarExportQuery,
} from "@/src/lib/financeCashFlowDailyRadarExport.js";
import {
  buildFinanceCashFlowDailyRadarExportBuffer,
  buildFinanceCashFlowDailyRadarExportFilename,
} from "@/src/lib/financeCashFlowDailyRadarExportXlsx.js";
import {
  FinanceCashFlowAnnualComparisonParseError,
  parseAnnualComparisonYear,
} from "@/src/lib/financeCashFlowAnnualComparison.js";
import { buildFinanceApPrismaWhere } from "@/src/lib/financeAccountsPayableDashboard.js";
import {
  resolveCashFlowArSettlementLoadWindow,
  splitCashFlowArRowsBySettlementOnlyWindow,
  toCashFlowPortfolioApFilters,
  toCashFlowPortfolioArFilters,
} from "@/src/lib/financeCashFlowDashboard.js";
import { loadAnnualComparisonPortfolioRows } from "@/src/lib/financeExecutiveReportAnnualLoad.js";
import { loadFinanceArTitlesSourceBundle } from "@/src/lib/finance/financeArEffectiveTitlesSource.server.js";
import {
  resolveCashFlowProjectionMode,
  type CashFlowProjectionMode,
} from "@/src/lib/finance/cashFlowLightProjectionFlag.js";
import type { FinanceArTitlesSourceBundle } from "@/src/lib/finance/financeArEffectiveTitlesSource.server.js";
import { prisma } from "@/src/lib/prisma.js";
import { resolveNomusApReportSyncCutoffFromPrisma } from "@/src/lib/financeNomusApReportFreshness.js";
import {
  measureDevPerfPhase,
  measureDevPerfPhaseSync,
  noteDevPerfRowCounts,
} from "@/src/lib/devPerfBaseline.server.js";
import {
  timedAssembleDashboardPayload,
  timedBuildAnnual,
  timedBuildDashboard,
  timedBuildRadar,
  timedFilterRadarPortfolio,
} from "@/src/lib/finance/cashFlowPerfTimed.server.js";

type AuthGuards = {
  requireAppAuth: RequestHandler;
  requireResource: (resourceKey: string, action?: string) => RequestHandler;
  getCurrentAppUser: (req: express.Request) => Promise<AppAuthContext | null>;
};

/** @deprecated Use FINANCE_MODULE_RESOURCE_KEYS.cashFlow + requireResource view — lista bag só documentação. */
export const FINANCE_CASH_FLOW_VIEW_PERMISSIONS = [
  "finance.cashFlow.view",
  "finance.view",
  "reports.view",
] as const;

/** @deprecated Contrato finance.cash_flow não tem export — export usa view. */
export const FINANCE_CASH_FLOW_EXPORT_PERMISSIONS = [
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

export async function loadCashFlowRows(
  filters: ReturnType<typeof parseFinanceCashFlowDashboardFilters>,
  projectionMode: CashFlowProjectionMode = "legacy"
) {
  return measureDevPerfPhase(
    "loadRows",
    async () => {
      const referenceDate = new Date();
      const arFilters = toArLoadFilters(filters);
      const apFilters = toApLoadFilters(filters);
      const [arBundle, apSyncCutoff] = await Promise.all([
        loadFinanceArTitlesSourceBundle(
          prisma,
          arFilters,
          referenceDate,
          {
            customerName: filters.customerName,
            personCnpj: filters.personCnpj,
            projectionMode,
          },
          // O realizado da tela é alocado por data de baixa: a carga precisa
          // admitir também os títulos baixados dentro do ano, mesmo vencendo
          // fora dele. Eles ficam separados em `arRealizedOnlyRows` e não
          // entram na carteira aberta nem na projeção por vencimento.
          { settlementWindow: resolveCashFlowArSettlementLoadWindow(filters) }
        ),
        measureDevPerfPhase("apCutoff", () => resolveNomusApReportSyncCutoffFromPrisma(prisma)),
      ]);
      const { periodRows: arPeriodRows, settlementOnlyRows: arRealizedOnlyRows } =
        splitCashFlowArRowsBySettlementOnlyWindow(arBundle.arRows, filters);
      const apWhere = buildCashFlowApPrismaWhere(filters, apFilters, referenceDate, apSyncCutoff);
      const apPrisma = await measureDevPerfPhase("apLoad", () =>
        prisma.nomusAccountsPayable.findMany({
          where: apWhere,
          select: FINANCE_CASH_FLOW_AP_SELECT,
          orderBy: { dueDate: "asc" },
        })
      );

      noteDevPerfRowCounts({
        ar: arPeriodRows.length,
        ap: apPrisma.length,
        orders: arBundle.orderContexts.length,
      });

      return {
        arRows: arPeriodRows,
        arRealizedOnlyRows,
        apRows: measureDevPerfPhaseSync("mapApRows", () =>
          apPrisma.map(mapPrismaRowToFinanceCashFlowApRow)
        ),
        arSyncCutoff: arBundle.syncCutoff,
        apSyncCutoff,
        orderContexts: arBundle.orderContexts,
        nfeOrderLinks: arBundle.nfeOrderLinks,
      };
    },
    { account: true }
  );
}

/** Carrega portfólio AR/AP aberto sem recorte de período — independente dos filtros da página. */
export async function loadDailyRadarPortfolioRows(
  referenceDate = new Date(),
  projectionMode: CashFlowProjectionMode = "legacy"
) {
  return measureDevPerfPhase(
    "loadRows",
    async () => {
      const filters = createDailyRadarDashboardFilters();
      const arFilters = toCashFlowPortfolioArFilters(filters);
      const apFilters = toCashFlowPortfolioApFilters(filters);
      const [arBundle, apSyncCutoff] = await Promise.all([
        loadFinanceArTitlesSourceBundle(prisma, arFilters, referenceDate, {
          projectionMode,
        }),
        measureDevPerfPhase("apCutoff", () => resolveNomusApReportSyncCutoffFromPrisma(prisma)),
      ]);
      const apWhere = buildFinanceApPrismaWhere(apFilters, apSyncCutoff);
      const apPrisma = await measureDevPerfPhase("apLoad", () =>
        prisma.nomusAccountsPayable.findMany({
          where: apWhere,
          select: FINANCE_CASH_FLOW_AP_SELECT,
          orderBy: { dueDate: "asc" },
        })
      );

      noteDevPerfRowCounts({
        ar: arBundle.arRows.length,
        ap: apPrisma.length,
        orders: arBundle.orderContexts.length,
      });

      return {
        arRows: arBundle.arRows,
        // Radar carrega a carteira aberta inteira (sem recorte de período):
        // não existe "linha extra por data de baixa" a separar aqui.
        arRealizedOnlyRows: [] as FinanceCashFlowArRow[],
        apRows: measureDevPerfPhaseSync("mapApRows", () =>
          apPrisma.map(mapPrismaRowToFinanceCashFlowApRow)
        ),
        arSyncCutoff: arBundle.syncCutoff,
        apSyncCutoff,
        orderContexts: arBundle.orderContexts,
        nfeOrderLinks: arBundle.nfeOrderLinks,
      };
    },
    { account: true }
  );
}

function cashFlowArFilterOptions(bundle: Pick<FinanceArTitlesSourceBundle, "orderContexts" | "nfeOrderLinks">) {
  return { orderContexts: bundle.orderContexts, nfeOrderLinks: bundle.nfeOrderLinks };
}

export function registerFinanceCashFlowRoutes(app: express.Express, auth: AuthGuards) {
  const { requireAppAuth, requireResource, getCurrentAppUser } = auth;
  const view = [
    requireAppAuth,
    requireResource(FINANCE_MODULE_RESOURCE_KEYS.cashFlow, FINANCE_MODULE_ACTIONS.view),
  ] as const;

  app.get(
    "/api/finance/cash-flow/audit",
    ...view,
    async (req, res) => {
      const filters = parseFiltersOrRespond(res, req.query as Record<string, unknown>);
      if (!filters) return;

      const load = await loadCashFlowRows(filters);
      const { arRows, apRows, arSyncCutoff, apSyncCutoff } = load;
      const arOptions = cashFlowArFilterOptions(load);
      const dataset = buildFinanceCashFlowDataset(
        arRows,
        apRows,
        filters,
        toArLoadFilters(filters),
        toApLoadFilters(filters),
        new Date(),
        arSyncCutoff,
        apSyncCutoff,
        arOptions
      );
      const audit = buildFinanceCashFlowAuditPayload(dataset, arRows.length, apRows.length, arRows, apRows);
      res.json(audit);
    }
  );

  app.get(
    "/api/finance/cash-flow/dashboard",
    ...view,
    async (req, res) => {
      const filters = parseFiltersOrRespond(res, req.query as Record<string, unknown>);
      if (!filters) return;

      const load = await loadCashFlowRows(
        filters,
        resolveCashFlowProjectionMode()
      );
      const { arRows, apRows, arSyncCutoff, apSyncCutoff, arRealizedOnlyRows } = load;
      const arOptions = {
        ...cashFlowArFilterOptions(load),
        arRealizedOnlyRows,
      };
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
          apSyncCutoff,
          arOptions
        );
        return res.json(
          buildFinanceCashFlowAuditPayload(dataset, arRows.length, apRows.length, arRows, apRows)
        );
      }
      const referenceDate = new Date();
      const payload = timedBuildDashboard(
        arRows,
        apRows,
        filters,
        referenceDate,
        arSyncCutoff,
        apSyncCutoff,
        arOptions
      );
      const rawMaterialCostCenterSpotlight = await loadRawMaterialCostCenterSpotlight({
        ytdYear: referenceDate.getFullYear(),
        companyName: filters.companyName,
        referenceDate,
      });
      res.json(timedAssembleDashboardPayload(payload, rawMaterialCostCenterSpotlight));
    }
  );

  app.get(
    "/api/finance/cash-flow/export",
    ...view,
    async (req, res) => {
      const filters = parseFiltersOrRespond(res, req.query as Record<string, unknown>);
      if (!filters) return;

      const load = await loadCashFlowRows(filters);
      const { arRows, apRows, arSyncCutoff, apSyncCutoff, arRealizedOnlyRows } = load;
      const arOptions = {
        ...cashFlowArFilterOptions(load),
        arRealizedOnlyRows,
      };
      const payload = buildFinanceCashFlowDashboard(
        arRows,
        apRows,
        filters,
        new Date(),
        arSyncCutoff,
        apSyncCutoff,
        arOptions
      );
      const csv = buildFinanceCashFlowExportCsv(payload);
      const filename = financeCashFlowExportFilename(filters.year);
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.send(csv);
    }
  );

  app.get(
    "/api/finance/cash-flow/annual-comparison",
    ...view,
    async (req, res) => {
      try {
        const referenceDate = new Date();
        const year = parseAnnualComparisonYear(req.query.year, referenceDate);
        const load = await loadAnnualComparisonPortfolioRows(
          prisma,
          referenceDate,
          undefined,
          resolveCashFlowProjectionMode()
        );
        const { arRows, apRows, arSyncCutoff, apSyncCutoff, orderContexts, nfeOrderLinks } = load;
        const payload = timedBuildAnnual(
          arRows,
          apRows,
          year,
          referenceDate,
          arSyncCutoff,
          apSyncCutoff,
          { orderContexts, nfeOrderLinks }
        );
        res.json(payload);
      } catch (error) {
        if (error instanceof FinanceCashFlowAnnualComparisonParseError) {
          res.status(400).json({ error: error.message });
          return;
        }
        console.error("GET /api/finance/cash-flow/annual-comparison", error);
        res.status(500).json({ error: "Erro ao carregar comparativo anual de fluxo de caixa." });
      }
    }
  );

  app.get(
    "/api/finance/cash-flow/daily-radar/cost-centers",
    ...view,
    async (req, res) => {
      try {
        const rawQuery = parseDailyRadarQuery(req.query as Record<string, unknown>);
        if (
          rawQuery.customStartDate &&
          rawQuery.customEndDate &&
          rawQuery.rangeKey === DAILY_RADAR_CUSTOM_RANGE_KEY
        ) {
          const validation = validateDailyRadarCustomPeriod(
            rawQuery.customStartDate,
            rawQuery.customEndDate
          );
          if (!validation.ok) {
            return res.status(400).json({ error: validation.error });
          }
        }

        // Sempre trazer todas as linhas em escopo — cards agregam, não paginam.
        const scopedQuery = {
          ...rawQuery,
          page: 1,
          pageSize: DAILY_RADAR_EXPORT_PAGE_SIZE,
          exportAll: true,
        } as typeof rawQuery;

        const referenceDate = new Date();
        const load = await loadDailyRadarPortfolioRows(referenceDate);
        const { arRows, apRows, arSyncCutoff, apSyncCutoff } = load;
        const arOptions = cashFlowArFilterOptions(load);
        const portfolio = filterDailyRadarPortfolioRows(
          arRows,
          apRows,
          referenceDate,
          arSyncCutoff,
          apSyncCutoff,
          undefined,
          arOptions
        );

        const radar = buildFinanceCashFlowDailyRadar(
          portfolio.arRows,
          portfolio.apRows,
          scopedQuery,
          referenceDate
        );
        const detail = radar.selectedDetail;

        // Sem detalhe = sem escopo (usuário ainda não clicou em faixa/dia/período).
        if (!detail) {
          return res.json({
            ok: true,
            items: [],
            totalAmount: 0,
            totalTitles: 0,
            totalTitlesWithAllocation: 0,
            unclassifiedAmount: 0,
            unclassifiedTitles: 0,
            scope: {
              level: null,
              rangeKey: rawQuery.rangeKey ?? null,
              rangeLabel: null,
              dateFrom: null,
              dateTo: null,
              day: null,
              search: rawQuery.search?.trim() || null,
            },
          });
        }

        const payables = detail.payables.rows;
        const externalIds = [
          ...new Set(
            payables
              .map((row) => extractPayableExternalId(row.id))
              .filter((n): n is number => n != null)
          ),
        ];

        const [allocRows, costCenterRows] = await Promise.all([
          externalIds.length > 0
            ? prisma.accountsPayableCostCenterAllocation.findMany({
                where: { accountsPayableId: { in: externalIds } },
                select: {
                  accountsPayableId: true,
                  costCenterId: true,
                  amount: true,
                  percentage: true,
                },
              })
            : Promise.resolve([]),
          prisma.financialCostCenter.findMany({
            select: { id: true, code: true, name: true, status: true },
          }),
        ]);

        const allocations: CashFlowCostCenterAllocationInput[] = allocRows.map((r) => ({
          accountsPayableExternalId: r.accountsPayableId,
          costCenterId: r.costCenterId,
          amount:
            r.amount == null
              ? null
              : Number((r.amount as unknown as { toNumber: () => number }).toNumber()),
          percentage: Number(
            (r.percentage as unknown as { toNumber: () => number }).toNumber()
          ),
        }));
        const costCenters: CashFlowCostCenterMetaInput[] = costCenterRows.map((cc) => ({
          id: cc.id,
          code: cc.code,
          name: cc.name,
          status: cc.status ?? null,
        }));

        const period = radar.customRange?.dateFrom
          ? {
              dateFrom: radar.customRange.dateFrom ?? null,
              dateTo: radar.customRange.dateTo ?? null,
            }
          : { dateFrom: null, dateTo: null };

        const level =
          detail.level === "day"
            ? "day"
            : detail.rangeKey === DAILY_RADAR_CUSTOM_RANGE_KEY
              ? "custom"
              : detail.level === "range"
                ? "range"
                : null;

        const summary = buildCashFlowCostCenterSummary({
          payables,
          allocations,
          costCenters,
          scope: {
            level,
            rangeKey: detail.rangeKey ?? null,
            rangeLabel: detail.rangeLabel ?? null,
            dateFrom: period.dateFrom,
            dateTo: period.dateTo,
            day: detail.date ?? null,
            search: rawQuery.search?.trim() || null,
          },
        });

        return res.json({ ok: true, ...summary });
      } catch (error) {
        console.error("GET /api/finance/cash-flow/daily-radar/cost-centers", error);
        return res
          .status(500)
          .json({ error: "Não foi possível carregar os centros de custo do período." });
      }
    }
  );

  app.get(
    "/api/finance/cash-flow/daily-radar/cost-centers/titles",
    ...view,
    async (req, res) => {
      try {
        const rawQuery = parseDailyRadarQuery(req.query as Record<string, unknown>);
        const costCenterId = typeof req.query.costCenterId === "string"
          ? req.query.costCenterId.trim()
          : "";
        if (!costCenterId) {
          return res.status(400).json({ error: "costCenterId é obrigatório." });
        }

        const scopedQuery = {
          ...rawQuery,
          page: 1,
          pageSize: DAILY_RADAR_EXPORT_PAGE_SIZE,
          exportAll: true,
        } as typeof rawQuery;

        const referenceDate = new Date();
        const load = await loadDailyRadarPortfolioRows(referenceDate);
        const { arRows, apRows, arSyncCutoff, apSyncCutoff } = load;
        const arOptions = cashFlowArFilterOptions(load);
        const portfolio = filterDailyRadarPortfolioRows(
          arRows,
          apRows,
          referenceDate,
          arSyncCutoff,
          apSyncCutoff,
          undefined,
          arOptions
        );
        const radar = buildFinanceCashFlowDailyRadar(
          portfolio.arRows,
          portfolio.apRows,
          scopedQuery,
          referenceDate
        );
        const detail = radar.selectedDetail;
        if (!detail) {
          return res.json({ ok: true, titles: [], costCenterId });
        }

        const externalIds = [
          ...new Set(
            detail.payables.rows
              .map((row) => extractPayableExternalId(row.id))
              .filter((n): n is number => n != null)
          ),
        ];

        const allocRows =
          externalIds.length > 0
            ? await prisma.accountsPayableCostCenterAllocation.findMany({
                where: { accountsPayableId: { in: externalIds } },
                select: {
                  accountsPayableId: true,
                  costCenterId: true,
                  amount: true,
                  percentage: true,
                },
              })
            : [];

        const allocations: CashFlowCostCenterAllocationInput[] = allocRows.map((r) => ({
          accountsPayableExternalId: r.accountsPayableId,
          costCenterId: r.costCenterId,
          amount:
            r.amount == null
              ? null
              : Number((r.amount as unknown as { toNumber: () => number }).toNumber()),
          percentage: Number(
            (r.percentage as unknown as { toNumber: () => number }).toNumber()
          ),
        }));

        const titles = filterCashFlowCostCenterTitles({
          payables: detail.payables.rows,
          allocations,
          costCenterId,
        });

        return res.json({ ok: true, costCenterId, titles });
      } catch (error) {
        console.error(
          "GET /api/finance/cash-flow/daily-radar/cost-centers/titles",
          error
        );
        return res
          .status(500)
          .json({ error: "Não foi possível carregar os títulos do centro de custo." });
      }
    }
  );

  app.get(
    "/api/finance/cash-flow/daily-radar",
    ...view,
    async (req, res) => {
      const query = parseDailyRadarQuery(req.query as Record<string, unknown>);
      if (
        query.customStartDate &&
        query.customEndDate &&
        query.rangeKey === DAILY_RADAR_CUSTOM_RANGE_KEY
      ) {
        const validation = validateDailyRadarCustomPeriod(
          query.customStartDate,
          query.customEndDate
        );
        if (!validation.ok) {
          return res.status(400).json({ error: validation.error });
        }
      }
      const referenceDate = new Date();
      const load = await loadDailyRadarPortfolioRows(
        referenceDate,
        resolveCashFlowProjectionMode()
      );
      const { arRows, apRows, arSyncCutoff, apSyncCutoff } = load;
      const arOptions = cashFlowArFilterOptions(load);
      const portfolio = timedFilterRadarPortfolio(
        arRows,
        apRows,
        referenceDate,
        arSyncCutoff,
        apSyncCutoff,
        undefined,
        arOptions
      );
      const payload = timedBuildRadar(
        portfolio.arRows,
        portfolio.apRows,
        query,
        referenceDate
      );
      res.json(payload);
    }
  );

  const dailyRadarExportGuard = [
    ...view,
  ] as const;

  function parseDailyRadarExportOrRespond(
    res: express.Response,
    query: Record<string, unknown>
  ) {
    try {
      return parseDailyRadarExportQuery(query);
    } catch (error) {
      if (error instanceof FinanceCashFlowDailyRadarExportError) {
        res.status(400).json({ error: error.message });
        return null;
      }
      throw error;
    }
  }

  app.get(
    "/api/finance/cash-flow/daily-radar/export-data",
    ...dailyRadarExportGuard,
    async (req, res) => {
      try {
        const user = await getCurrentAppUser(req);
        if (!user) {
          return res.status(401).json({ error: "Não autenticado." });
        }

        const query = parseDailyRadarExportOrRespond(res, req.query as Record<string, unknown>);
        if (!query) return;

        const referenceDate = new Date();
        const load = await loadDailyRadarPortfolioRows(referenceDate);
        const { arRows, apRows, arSyncCutoff, apSyncCutoff } = load;
        const arOptions = cashFlowArFilterOptions(load);
        const portfolio = filterDailyRadarPortfolioRows(
          arRows,
          apRows,
          referenceDate,
          arSyncCutoff,
          apSyncCutoff,
          undefined,
          arOptions
        );
        const payload = buildFinanceCashFlowDailyRadarExportPayload(
          portfolio.arRows,
          portfolio.apRows,
          query,
          { userName: user.name ?? null },
          referenceDate
        );
        return res.json(payload);
      } catch (error) {
        console.error("GET /api/finance/cash-flow/daily-radar/export-data", error);
        return res.status(500).json({ error: "Erro ao montar dados de exportação do radar diário." });
      }
    }
  );

  app.get(
    "/api/finance/cash-flow/daily-radar/export.xlsx",
    ...dailyRadarExportGuard,
    async (req, res) => {
      try {
        const user = await getCurrentAppUser(req);
        if (!user) {
          return res.status(401).json({ error: "Não autenticado." });
        }

        const query = parseDailyRadarExportOrRespond(res, req.query as Record<string, unknown>);
        if (!query) return;

        const referenceDate = new Date();
        const load = await loadDailyRadarPortfolioRows(referenceDate);
        const { arRows, apRows, arSyncCutoff, apSyncCutoff } = load;
        const arOptions = cashFlowArFilterOptions(load);
        const portfolio = filterDailyRadarPortfolioRows(
          arRows,
          apRows,
          referenceDate,
          arSyncCutoff,
          apSyncCutoff,
          undefined,
          arOptions
        );
        const payload = buildFinanceCashFlowDailyRadarExportPayload(
          portfolio.arRows,
          portfolio.apRows,
          query,
          { userName: user.name ?? null },
          referenceDate
        );
        const buffer = buildFinanceCashFlowDailyRadarExportBuffer(payload);
        const filename = buildFinanceCashFlowDailyRadarExportFilename(payload);
        res.setHeader(
          "Content-Type",
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        );
        res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
        return res.send(buffer);
      } catch (error) {
        console.error("GET /api/finance/cash-flow/daily-radar/export.xlsx", error);
        return res.status(500).json({ error: "Erro ao exportar radar diário em Excel." });
      }
    }
  );
}
