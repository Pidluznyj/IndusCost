import type express from "express";
import type { RequestHandler } from "express";
import type { AppAuthContext } from "@/src/lib/appAuth.js";
import {
  createFinancialCostCenterDefault,
  FinanceCostCenterValidationError,
  getFinancialCostCenterByIdDefault,
  listFinancialCostCentersDefault,
  parseFinanceCostCenterCreateBody,
  parseFinanceCostCenterUpdateBody,
  parseFinanceCostCentersListQuery,
  updateFinancialCostCenterDefault,
} from "@/src/lib/financeCostCenters.js";
import {
  buildFinanceCostCenterDashboardDefault,
  FinanceCostCenterDashboardError,
  parseFinanceCostCenterDashboardFilters,
} from "@/src/lib/financeCostCenterDashboard.js";
import {
  buildCostCenterMonthlyChartPayloadDefault,
  parseCostCenterMonthlyChartCostCenterIds,
} from "@/src/lib/financeCostCenterMonthlyChart.js";
import {
  buildCostCenterHhHmSimulationMonthlyPayload,
  parseCostCenterHhHmSimulationAveragePeriod,
} from "@/src/lib/financeCostCenterHhHmSimulation.server.js";
import {
  buildCostCenterSupplierPaymentSummary,
  buildCostCenterSupplierPaymentTitles,
  buildCostCenterSupplierPaymentYears,
  loadCostCenterSupplierPaymentContext,
} from "@/src/lib/financeCostCenterSupplierPaymentDrilldown.js";
import { buildCostCenterSupplierTitles } from "@/src/lib/financeCostCenterSupplierTitlesDrilldown.js";
import {
  listFinanceCostCenterAuditLogs,
  parseFinanceCostCenterAuditListQuery,
} from "@/src/lib/financeCostCenterAudit.js";
import { financeApiErrorJson } from "@/src/lib/financeTabLoadError.js";
import { FinanceApFilterParseError } from "@/src/lib/financeAccountsPayableDashboard.js";
import {
  batchReclassifyAccountsPayableAllocationsDefault,
  FinanceApAllocationError,
  parseBatchReclassificationBody,
} from "@/src/lib/financeAccountsPayableCostCenterAllocation.js";
import {
  FINANCE_AP_ACTIONS,
  FINANCE_AP_RESOURCE_KEY,
} from "@/src/lib/financeAccountsPayableAccess.js";
import {
  FINANCE_MODULE_ACTIONS,
  FINANCE_MODULE_RESOURCE_KEYS,
} from "@/src/lib/financeModulesAccess.js";
import { parsePaidTitleListFilters, createDefaultSupplierTitleListFilters } from "@/src/lib/financePaidTitlesModalFilters.js";

type AuthGuards = {
  requireAppAuth: RequestHandler;
  requireResource: (resourceKey: string, action?: string) => RequestHandler;
  getCurrentAppUser: (req: express.Request) => Promise<AppAuthContext | null>;
};

/** @deprecated Use FINANCE_MODULE_RESOURCE_KEYS.costCenters + requireResource view. */
export const FINANCE_COST_CENTERS_VIEW_PERMISSIONS = [
  "finance.cost_centers.view",
  "finance.view",
] as const;

/** @deprecated Use requireResource manage. */
export const FINANCE_COST_CENTERS_MANAGE_PERMISSIONS = ["finance.cost_centers.manage"] as const;

export { FINANCE_COST_CENTER_HH_HM_SIMULATION_VIEW_PERMISSIONS } from "@/src/lib/financeCostCenterHhHmSimulation.js";

function handleValidationError(res: express.Response, error: FinanceCostCenterValidationError) {
  const status = error.code === "NOT_FOUND" ? 404 : 400;
  return res.status(status).json({ error: error.message, code: error.code });
}

function handleDashboardError(
  res: express.Response,
  error: FinanceCostCenterDashboardError | FinanceApFilterParseError
) {
  return res.status(400).json({ error: error.message, code: "code" in error ? error.code : "INVALID_FILTER" });
}

function handleAllocationError(res: express.Response, error: FinanceApAllocationError) {
  const status =
    error.code === "AP_NOT_FOUND"
      ? 404
      : error.code === "BATCH_VALIDATION_FAILED" || error.code === "CLOSED_PERIOD"
        ? 409
        : 400;
  return res.status(status).json({ error: error.message, code: error.code });
}

function isFinanceCostCenterUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value.trim()
    )
  );
}

export function registerFinanceCostCentersRoutes(app: express.Express, auth: AuthGuards) {
  const { requireAppAuth, requireResource, getCurrentAppUser } = auth;
  const viewGuard = [
    requireAppAuth,
    requireResource(FINANCE_MODULE_RESOURCE_KEYS.costCenters, FINANCE_MODULE_ACTIONS.view),
  ] as const;
  const manageGuard = [
    requireAppAuth,
    requireResource(FINANCE_MODULE_RESOURCE_KEYS.costCenters, FINANCE_MODULE_ACTIONS.manage),
  ] as const;
  const allocationManageGuard = [
    requireAppAuth,
    requireResource(FINANCE_AP_RESOURCE_KEY, FINANCE_AP_ACTIONS.manage),
  ] as const;
  const auditGuard = [
    requireAppAuth,
    requireResource(FINANCE_MODULE_RESOURCE_KEYS.costCenters, FINANCE_MODULE_ACTIONS.view),
  ] as const;
  const hhHmSimulationGuard = [
    requireAppAuth,
    requireResource(FINANCE_MODULE_RESOURCE_KEYS.costCenters, FINANCE_MODULE_ACTIONS.view),
  ] as const;

  app.get("/api/finance/cost-center-audit", ...auditGuard, async (req, res) => {
    try {
      const user = await getCurrentAppUser(req);
      if (!user) return res.status(401).json({ error: "Não autenticado." });

      const query = parseFinanceCostCenterAuditListQuery(req.query as Record<string, unknown>);
      const payload = await listFinanceCostCenterAuditLogs(query);
      return res.json(payload);
    } catch (error) {
      console.error("GET /api/finance/cost-center-audit", error);
      return res.status(500).json(
        financeApiErrorJson("Erro ao listar auditoria de classificação.", error)
      );
    }
  });

  app.get("/api/finance/cost-centers", ...viewGuard, async (req, res) => {
    try {
      const user = await getCurrentAppUser(req);
      if (!user) return res.status(401).json({ error: "Não autenticado." });

      const query = parseFinanceCostCentersListQuery(req.query as Record<string, unknown>);
      const payload = await listFinancialCostCentersDefault(query);
      return res.json(payload);
    } catch (error) {
      if (error instanceof FinanceCostCenterValidationError) {
        return handleValidationError(res, error);
      }
      console.error("GET /api/finance/cost-centers", error);
      return res.status(500).json(
        financeApiErrorJson("Erro ao listar centros de custo financeiros.", error)
      );
    }
  });

  app.get("/api/finance/cost-centers/dashboard", ...viewGuard, async (req, res) => {
    try {
      const user = await getCurrentAppUser(req);
      if (!user) return res.status(401).json({ error: "Não autenticado." });

      const filters = parseFinanceCostCenterDashboardFilters(req.query as Record<string, unknown>);
      const payload = await buildFinanceCostCenterDashboardDefault(filters);
      return res.json(payload);
    } catch (error) {
      if (
        error instanceof FinanceCostCenterDashboardError ||
        error instanceof FinanceApFilterParseError
      ) {
        return handleDashboardError(res, error);
      }
      console.error("GET /api/finance/cost-centers/dashboard", error);
      return res.status(500).json(
        financeApiErrorJson("Erro ao montar dashboard de centros de custo.", error)
      );
    }
  });

  app.get("/api/finance/cost-centers/monthly-chart", ...viewGuard, async (req, res) => {
    try {
      const user = await getCurrentAppUser(req);
      if (!user) return res.status(401).json({ error: "Não autenticado." });

      const query = req.query as Record<string, unknown>;
      const filters = parseFinanceCostCenterDashboardFilters(query);
      const costCenterIds = parseCostCenterMonthlyChartCostCenterIds(query);
      if (costCenterIds.length === 0) {
        return res.status(400).json({
          error: "Informe costCenterIds (ou costCenterId) para o gráfico mensal.",
          code: "MISSING_COST_CENTER_IDS",
        });
      }

      const payload = await buildCostCenterMonthlyChartPayloadDefault(filters, costCenterIds);
      return res.json(payload);
    } catch (error) {
      if (
        error instanceof FinanceCostCenterDashboardError ||
        error instanceof FinanceApFilterParseError
      ) {
        return handleDashboardError(res, error);
      }
      console.error("GET /api/finance/cost-centers/monthly-chart", error);
      return res.status(500).json(
        financeApiErrorJson("Erro ao montar gráfico mensal do centro de custo.", error)
      );
    }
  });

  app.get("/api/finance/cost-centers/hh-hm-simulation/cost-centers", ...hhHmSimulationGuard, async (req, res) => {
    try {
      const user = await getCurrentAppUser(req);
      if (!user) return res.status(401).json({ error: "Não autenticado." });

      const query = parseFinanceCostCentersListQuery(req.query as Record<string, unknown>);
      const payload = await listFinancialCostCentersDefault(query);
      return res.json(payload);
    } catch (error) {
      if (error instanceof FinanceCostCenterValidationError) {
        return handleValidationError(res, error);
      }
      console.error("GET /api/finance/cost-centers/hh-hm-simulation/cost-centers", error);
      return res.status(500).json(
        financeApiErrorJson("Erro ao listar centros de custo para simulação HH/HM.", error)
      );
    }
  });

  app.get("/api/finance/cost-centers/hh-hm-simulation/monthly-data", ...hhHmSimulationGuard, async (req, res) => {
    try {
      const user = await getCurrentAppUser(req);
      if (!user) return res.status(401).json({ error: "Não autenticado." });

      const query = req.query as Record<string, unknown>;
      const costCenterIds = parseCostCenterMonthlyChartCostCenterIds(query);
      if (costCenterIds.length === 0) {
        return res.status(400).json({
          error: "Informe costCenterIds (ou costCenterId) para a simulação HH/HM.",
          code: "MISSING_COST_CENTER_IDS",
        });
      }

      const averagePeriod = parseCostCenterHhHmSimulationAveragePeriod(query.averagePeriod);
      const payload = await buildCostCenterHhHmSimulationMonthlyPayload({
        costCenterIds,
        averagePeriod,
        query,
      });
      return res.json(payload);
    } catch (error) {
      if (
        error instanceof FinanceCostCenterDashboardError ||
        error instanceof FinanceApFilterParseError
      ) {
        return handleDashboardError(res, error);
      }
      console.error("GET /api/finance/cost-centers/hh-hm-simulation/monthly-data", error);
      return res.status(500).json(
        financeApiErrorJson("Erro ao carregar dados mensais para simulação HH/HM.", error)
      );
    }
  });

  app.get(
    "/api/finance/cost-centers/annual-spending-by-cost-center",
    ...viewGuard,
    async (req, res) => {
      try {
        const user = await getCurrentAppUser(req);
        if (!user) return res.status(401).json({ error: "Não autenticado." });

        const filters = parseFinanceCostCenterDashboardFilters(req.query as Record<string, unknown>);
        const payload = await buildFinanceCostCenterDashboardDefault(filters);
        return res.json({
          chart: payload.annualSpendingChart,
          byCostCenter: payload.byCostCenter,
          summary: {
            classifiedAmount: payload.summary.classifiedAmount,
            totalAmount: payload.summary.totalAmount,
          },
          audit: {
            filtersApplied: payload.audit.filtersApplied,
            dataSources: payload.audit.dataSources,
          },
        });
      } catch (error) {
        if (
          error instanceof FinanceCostCenterDashboardError ||
          error instanceof FinanceApFilterParseError
        ) {
          return handleDashboardError(res, error);
        }
        console.error("GET /api/finance/cost-centers/annual-spending-by-cost-center", error);
        return res.status(500).json(
          financeApiErrorJson("Erro ao montar gastos por centro de custo.", error)
        );
      }
    }
  );

  app.get(
    "/api/finance/cost-centers/supplier-payment-summary",
    ...viewGuard,
    async (req, res) => {
      try {
        const user = await getCurrentAppUser(req);
        if (!user) return res.status(401).json({ error: "Não autenticado." });

        const filters = parseFinanceCostCenterDashboardFilters(req.query as Record<string, unknown>);
        const asOfRaw = typeof req.query.asOfDate === "string" ? req.query.asOfDate.trim() : "";
        const referenceDate = asOfRaw ? new Date(`${asOfRaw}T12:00:00.000Z`) : new Date();
        const ctx = await loadCostCenterSupplierPaymentContext(filters, referenceDate);
        const payload = buildCostCenterSupplierPaymentSummary(ctx);
        return res.json(payload);
      } catch (error) {
        if (
          error instanceof FinanceCostCenterDashboardError ||
          error instanceof FinanceApFilterParseError
        ) {
          return handleDashboardError(res, error);
        }
        console.error("GET /api/finance/cost-centers/supplier-payment-summary", error);
        return res.status(500).json(
          financeApiErrorJson("Erro ao montar pagamentos por fornecedor.", error)
        );
      }
    }
  );

  app.get(
    "/api/finance/cost-centers/supplier-payment-years",
    ...viewGuard,
    async (req, res) => {
      try {
        const user = await getCurrentAppUser(req);
        if (!user) return res.status(401).json({ error: "Não autenticado." });

        const supplierKey = String(req.query.supplierKey ?? "").trim();
        if (!supplierKey) {
          return res.status(400).json({ error: "supplierKey é obrigatório." });
        }
        const supplierDisplayName =
          typeof req.query.supplierDisplayName === "string"
            ? req.query.supplierDisplayName.trim()
            : supplierKey;

        const filters = parseFinanceCostCenterDashboardFilters(req.query as Record<string, unknown>);
        const asOfRaw = typeof req.query.asOfDate === "string" ? req.query.asOfDate.trim() : "";
        const referenceDate = asOfRaw ? new Date(`${asOfRaw}T12:00:00.000Z`) : new Date();
        const ctx = await loadCostCenterSupplierPaymentContext(filters, referenceDate);
        const payload = buildCostCenterSupplierPaymentYears(ctx, supplierKey, supplierDisplayName);
        return res.json(payload);
      } catch (error) {
        if (
          error instanceof FinanceCostCenterDashboardError ||
          error instanceof FinanceApFilterParseError
        ) {
          return handleDashboardError(res, error);
        }
        console.error("GET /api/finance/cost-centers/supplier-payment-years", error);
        return res.status(500).json(
          financeApiErrorJson("Erro ao montar histórico anual de pagamentos.", error)
        );
      }
    }
  );

  app.get(
    "/api/finance/cost-centers/supplier-titles",
    ...viewGuard,
    async (req, res) => {
      try {
        const user = await getCurrentAppUser(req);
        if (!user) return res.status(401).json({ error: "Não autenticado." });

        const supplierKey = String(req.query.supplierKey ?? "").trim();
        if (!supplierKey) {
          return res.status(400).json({ error: "supplierKey é obrigatório." });
        }
        const filters = parseFinanceCostCenterDashboardFilters(req.query as Record<string, unknown>);
        const asOfRaw = typeof req.query.asOfDate === "string" ? req.query.asOfDate.trim() : "";
        const referenceDate = asOfRaw ? new Date(`${asOfRaw}T12:00:00.000Z`) : new Date();
        const supplierDisplayName =
          typeof req.query.supplierDisplayName === "string"
            ? req.query.supplierDisplayName.trim()
            : supplierKey;
        const page = Number(req.query.page ?? 1);
        const pageSize = Number(req.query.pageSize ?? 50);
        const listFilters = parsePaidTitleListFilters(
          req.query as Record<string, unknown>,
          createDefaultSupplierTitleListFilters()
        );

        const ctx = await loadCostCenterSupplierPaymentContext(filters, referenceDate);
        const payload = buildCostCenterSupplierTitles(
          ctx,
          supplierKey,
          supplierDisplayName,
          page,
          pageSize,
          listFilters
        );
        return res.json(payload);
      } catch (error) {
        if (
          error instanceof FinanceCostCenterDashboardError ||
          error instanceof FinanceApFilterParseError
        ) {
          return handleDashboardError(res, error);
        }
        console.error("GET /api/finance/cost-centers/supplier-titles", error);
        return res.status(500).json(
          financeApiErrorJson("Erro ao listar títulos do fornecedor.", error)
        );
      }
    }
  );

  app.get(
    "/api/finance/cost-centers/supplier-payment-titles",
    ...viewGuard,
    async (req, res) => {
      try {
        const user = await getCurrentAppUser(req);
        if (!user) return res.status(401).json({ error: "Não autenticado." });

        const supplierKey = String(req.query.supplierKey ?? "").trim();
        if (!supplierKey) {
          return res.status(400).json({ error: "supplierKey é obrigatório." });
        }
        const filters = parseFinanceCostCenterDashboardFilters(req.query as Record<string, unknown>);
        const asOfRaw = typeof req.query.asOfDate === "string" ? req.query.asOfDate.trim() : "";
        const referenceDate = asOfRaw ? new Date(`${asOfRaw}T12:00:00.000Z`) : new Date();
        const yearRaw = Number(req.query.year);
        const year = Number.isFinite(yearRaw)
          ? yearRaw
          : filters.year ?? referenceDate.getFullYear();
        const supplierDisplayName =
          typeof req.query.supplierDisplayName === "string"
            ? req.query.supplierDisplayName.trim()
            : supplierKey;
        const page = Number(req.query.page ?? 1);
        const pageSize = Number(req.query.pageSize ?? 50);
        const listFilters = parsePaidTitleListFilters(req.query as Record<string, unknown>);

        const ctx = await loadCostCenterSupplierPaymentContext(filters, referenceDate);
        const payload = buildCostCenterSupplierPaymentTitles(
          ctx,
          supplierKey,
          supplierDisplayName,
          year,
          page,
          pageSize,
          listFilters
        );
        return res.json(payload);
      } catch (error) {
        if (
          error instanceof FinanceCostCenterDashboardError ||
          error instanceof FinanceApFilterParseError
        ) {
          return handleDashboardError(res, error);
        }
        console.error("GET /api/finance/cost-centers/supplier-payment-titles", error);
        return res.status(500).json(
          financeApiErrorJson("Erro ao listar títulos pagos do fornecedor.", error)
        );
      }
    }
  );

  app.post(
    "/api/finance/cost-centers/payables/reclassify-batch",
    ...allocationManageGuard,
    async (req, res) => {
      try {
        const user = await getCurrentAppUser(req);
        if (!user) return res.status(401).json({ error: "Não autenticado." });

        const input = parseBatchReclassificationBody(req.body);
        const result = await batchReclassifyAccountsPayableAllocationsDefault(input, {
          userId: user.id,
          userName: user.name ?? user.email ?? null,
        });
        return res.status(200).json(result);
      } catch (error) {
        if (error instanceof FinanceApAllocationError) {
          return handleAllocationError(res, error);
        }
        console.error("POST /api/finance/cost-centers/payables/reclassify-batch", error);
        return res.status(500).json(
          financeApiErrorJson("Erro ao reclassificar títulos em lote.", error)
        );
      }
    }
  );

  app.get("/api/finance/cost-centers/:id", ...viewGuard, async (req, res) => {
    try {
      const user = await getCurrentAppUser(req);
      if (!user) return res.status(401).json({ error: "Não autenticado." });

      const id = String(req.params.id ?? "").trim();
      if (!isFinanceCostCenterUuid(id)) {
        return res.status(400).json({
          error: "Identificador do centro de custo inválido.",
          code: "INVALID_ID",
        });
      }

      const item = await getFinancialCostCenterByIdDefault(id);
      if (!item) {
        return res.status(404).json({ error: "Centro de custo não encontrado." });
      }
      return res.json({ item });
    } catch (error) {
      console.error("GET /api/finance/cost-centers/:id", error);
      return res.status(500).json(
        financeApiErrorJson("Erro ao carregar centro de custo financeiro.", error)
      );
    }
  });

  app.post("/api/finance/cost-centers", ...manageGuard, async (req, res) => {
    try {
      const user = await getCurrentAppUser(req);
      if (!user) return res.status(401).json({ error: "Não autenticado." });

      const input = parseFinanceCostCenterCreateBody(req.body);
      const item = await createFinancialCostCenterDefault(input);
      return res.status(201).json({ item });
    } catch (error) {
      if (error instanceof FinanceCostCenterValidationError) {
        return handleValidationError(res, error);
      }
      console.error("POST /api/finance/cost-centers", error);
      return res.status(500).json(
        financeApiErrorJson("Erro ao criar centro de custo financeiro.", error)
      );
    }
  });

  app.patch("/api/finance/cost-centers/:id", ...manageGuard, async (req, res) => {
    try {
      const user = await getCurrentAppUser(req);
      if (!user) return res.status(401).json({ error: "Não autenticado." });

      const id = String(req.params.id ?? "").trim();
      if (!isFinanceCostCenterUuid(id)) {
        return res.status(400).json({
          error: "Identificador do centro de custo inválido.",
          code: "INVALID_ID",
        });
      }

      const input = parseFinanceCostCenterUpdateBody(req.body);
      const item = await updateFinancialCostCenterDefault(id, input);
      return res.json({ item });
    } catch (error) {
      if (error instanceof FinanceCostCenterValidationError) {
        return handleValidationError(res, error);
      }
      console.error("PATCH /api/finance/cost-centers/:id", error);
      return res.status(500).json(
        financeApiErrorJson("Erro ao atualizar centro de custo financeiro.", error)
      );
    }
  });
}
