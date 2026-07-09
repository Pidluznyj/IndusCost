import type express from "express";
import type { RequestHandler } from "express";
import type { AppAuthContext } from "@/src/lib/appAuth.js";
import {
  COMMISSIONS_APURACAO_VIEW_PERMISSIONS,
  COMMISSIONS_AUDIT_VIEW_PERMISSIONS,
  COMMISSIONS_CONFIRMED_VIEW_PERMISSIONS,
  COMMISSIONS_DASHBOARD_VIEW_PERMISSIONS,
  COMMISSIONS_FORECAST_VIEW_PERMISSIONS,
  COMMISSIONS_EXCEPTIONS_MANAGE_PERMISSIONS,
  COMMISSIONS_EXCEPTIONS_VIEW_PERMISSIONS,
  COMMISSIONS_PAYMENTS_MANAGE_PERMISSIONS,
  COMMISSIONS_PAYMENTS_VIEW_PERMISSIONS,
  COMMISSIONS_PEOPLE_MANAGE_PERMISSIONS,
  COMMISSIONS_PEOPLE_VIEW_PERMISSIONS,
  COMMISSIONS_RECALCULATE_PERMISSIONS,
  COMMISSIONS_RELEASE_VIEW_PERMISSIONS,
  COMMISSIONS_RULES_MANAGE_PERMISSIONS,
  COMMISSIONS_RULES_VIEW_PERMISSIONS,
  COMMISSIONS_SETTINGS_VIEW_PERMISSIONS,
  COMMISSIONS_SETTINGS_MANAGE_PERMISSIONS,
  COMMISSIONS_VIEW_PERMISSIONS,
} from "@/src/lib/commissionsPermissions.js";
import {
  getCommissionSettingsPayload,
  restoreCommissionSettingsDefaults,
  updateCommissionSettings,
  CommissionValidationError,
} from "@/src/lib/commissions/commissionSettings.server.js";
import {
  listCommissionAuditPage,
  reopenCommissionAuditIssue,
  resolveCommissionAuditIssue,
  rerunCommissionAudit,
} from "@/src/lib/commissions/commissionAudit.server.js";
import {
  getCommissionPaymentBatchById,
  listCommissionPaymentsPage,
  listUnpaidReleasedCommissionsDetailed,
} from "@/src/lib/commissions/commissionPayments.server.js";
import {
  createCommissionPerson,
  importCommissionPersonsFromOrders,
  listCommissionPersonsPage,
  toggleCommissionPersonActive,
  updateCommissionPerson,
} from "@/src/lib/commissions/commissionPersons.server.js";
import {
  createCommissionRule,
  duplicateCommissionRule,
  getCommissionRuleUsage,
  listCommissionRulesPage,
  toggleCommissionRuleActive,
  updateCommissionRule,
} from "@/src/lib/commissions/commissionRules.server.js";
import {
  parseCommissionAuditRerunBody,
  parseCommissionExceptionCreateBody,
  parseCommissionExceptionUpdateBody,
  parseCustomerExclusionCreateBody,
  parseCustomerExclusionUpdateBody,
  parseCommissionPersonCreateBody,
  parseCommissionPersonUpdateBody,
  parseCommissionRecalculateBody,
  parseCommissionRuleCreateBody,
  parseCommissionRuleUpdateBody,
  parseCommissionSettingsUpdateBody,
  parseMarkPaidBody,
  parsePaymentBatchCreateBody,
  parseReceiptClosingApplyBody,
  parseReceiptClosingPeriodBody,
  parseReceiptClosingReprocessBody,
} from "@/src/lib/commissions/commissionApiValidation.js";
import { requireCommissionDataScope } from "@/src/lib/commissions/commissionAccessScope.js";
import {
  exportCommissionVisualAuditCsv,
  getCommissionVisualAuditDetail,
  listCommissionVisualAuditPage,
} from "@/src/lib/commissions/commissionVisualAudit.server.js";
import {
  exportCommissionMonthlyClosingCsv,
  getCommissionMonthlyClosingPage,
} from "@/src/lib/commissions/commissionMonthlyPayable.server.js";
import {
  exportCommissionReceivableForecastCsv,
  getCommissionReceivableForecastPage,
} from "@/src/lib/commissions/commissionReceivableForecast.server.js";
import {
  getCommissionAuditTrailDetail,
  getCommissionGeneratedDetail,
  listCommissionFuturePage,
  listCommissionGeneratedPage,
  listCommissionOverduePage,
  listCommissionPayablePage,
} from "@/src/lib/commissions/commissionArViews.server.js";
import {
  createCommissionCustomerException,
  listCommissionExceptionsPage,
  toggleCommissionCustomerExceptionActive,
  updateCommissionCustomerException,
} from "@/src/lib/commissions/commissionExceptions.server.js";
import { loadCustomerExclusionClosingReconciliation } from "@/src/lib/commissions/commissionCustomerExclusionClosingReconciliation.server.js";
import {
  createCustomerExclusionRule,
  inactivateCustomerExclusionRule,
  listCustomerExclusionRules,
  updateCustomerExclusionRule,
} from "@/src/lib/commissions/commissionCustomerExclusionRules.server.js";
import { buildCommissionDashboard } from "@/src/lib/commissions/commissionDashboard.server.js";
import {
  exportCommissionApuracaoCsv,
  listCommissionApuracaoPage,
} from "@/src/lib/commissions/commissionApuracao.server.js";
import {
  getCommissionConfirmedDetail,
  listCommissionConfirmedPage,
} from "@/src/lib/commissions/commissionConfirmed.server.js";
import {
  getCommissionForecastOrderDetail,
  listCommissionForecastPage,
} from "@/src/lib/commissions/commissionForecast.server.js";
import {
  CommissionQueryParseError,
  parseCommissionApuracaoQuery,
  parseCommissionAuditQuery,
  parseCommissionConfirmedQuery,
  parseCommissionDashboardQuery,
  parseCommissionForecastQuery,
  parseCommissionPersonsQuery,
  parseCommissionPaymentsQuery,
  parseCommissionRecordsQuery,
  parseCommissionRulesQuery,
  parseCommissionExceptionsQuery,
  parseCustomerExclusionRulesQuery,
  parseCustomerExclusionClosingReconciliationQuery,
  parseCommissionReleasesQuery,
  parseCommissionVisualAuditQuery,
  parseCommissionMonthlyClosingQuery,
  parseCommissionReceivableForecastQuery,
  parseReceiptClosingPeriodParams,
  parseReceiptClosingQuery,
  parseUnpaidReleasedCommissionsQuery,
} from "@/src/lib/commissions/commissionQuery.js";
import {
  applyReceiptClosingFromApi,
  exportReceiptClosingCsv,
  exportReceiptClosingDetailXlsx,
  getReceiptClosingPage,
  getReceiptClosingPreviewPage,
  reprocessReceiptClosingApplyFromApi,
  reprocessReceiptClosingPreviewFromApi,
} from "@/src/lib/commissions/commissionReceiptClosingApi.server.js";
import {
  ReceiptClosingDuplicateError,
  ReceiptClosingValidationError,
} from "@/src/lib/commissions/commissionReceiptClosing.js";
import {
  getCommissionReleaseDetail,
  listCommissionReleasesPage,
} from "@/src/lib/commissions/commissionReleases.server.js";
import {
  listCommissionRecords,
} from "@/src/lib/commissions/commissionRecords.server.js";
import { calculateCommissions } from "@/src/lib/commissions/commission-calculation-service.server.js";
import {
  approveCommissionPaymentBatch,
  cancelCommissionPaymentBatch,
  createCommissionPaymentBatch,
  markCommissionPaymentBatchPaid,
} from "@/src/lib/commissions/commission-payment-service.server.js";
import { prisma } from "@/src/lib/prisma.js";

type AuthGuards = {
  requireAppAuth: RequestHandler;
  requireAnyPermission: (permissions: string[]) => RequestHandler;
  getCurrentAppUser: (req: express.Request) => Promise<AppAuthContext | null>;
};

function handleQueryError(res: express.Response, error: unknown) {
  if (error instanceof CommissionQueryParseError) {
    return res.status(400).json({ error: error.message });
  }
  throw error;
}

function handleValidationError(res: express.Response, error: CommissionValidationError) {
  const status =
    error.code === "NOT_FOUND" ? 404 : error.code === "CONFLICT" ? 409 : 400;
  return res.status(status).json({ error: error.message, code: error.code });
}

function handleReceiptClosingError(res: express.Response, error: unknown) {
  if (error instanceof ReceiptClosingValidationError) {
    return res.status(400).json({ error: error.message, code: error.code });
  }
  if (error instanceof ReceiptClosingDuplicateError) {
    return res.status(409).json({
      error: error.message,
      code: error.code,
      existingClosingId: error.existingClosingId,
    });
  }
  throw error;
}

async function resolveScopeOrRespond(
  req: express.Request,
  res: express.Response,
  getCurrentAppUser: AuthGuards["getCurrentAppUser"]
) {
  const user = await getCurrentAppUser(req);
  if (!user) {
    res.status(401).json({ error: "Não autenticado." });
    return null;
  }
  const scopeResult = requireCommissionDataScope(user);
  if (!scopeResult.ok) {
    res.status(scopeResult.status).json(scopeResult.body);
    return null;
  }
  return { user, scope: scopeResult.scope };
}

export function registerCommissionsRoutes(app: express.Express, auth: AuthGuards) {
  const { requireAppAuth, requireAnyPermission, getCurrentAppUser } = auth;

  const viewAnyGuard = [
    requireAppAuth,
    requireAnyPermission([...COMMISSIONS_VIEW_PERMISSIONS]),
  ] as const;

  const dashboardGuard = [
    requireAppAuth,
    requireAnyPermission([...COMMISSIONS_DASHBOARD_VIEW_PERMISSIONS]),
  ] as const;

  const forecastGuard = [
    requireAppAuth,
    requireAnyPermission([...COMMISSIONS_FORECAST_VIEW_PERMISSIONS]),
  ] as const;

  const confirmedGuard = [
    requireAppAuth,
    requireAnyPermission([...COMMISSIONS_CONFIRMED_VIEW_PERMISSIONS]),
  ] as const;

  const apuracaoGuard = [
    requireAppAuth,
    requireAnyPermission([...COMMISSIONS_APURACAO_VIEW_PERMISSIONS]),
  ] as const;

  const releaseGuard = [
    requireAppAuth,
    requireAnyPermission([...COMMISSIONS_RELEASE_VIEW_PERMISSIONS]),
  ] as const;

  const paymentsViewGuard = [
    requireAppAuth,
    requireAnyPermission([...COMMISSIONS_PAYMENTS_VIEW_PERMISSIONS]),
  ] as const;

  const paymentsManageGuard = [
    requireAppAuth,
    requireAnyPermission([...COMMISSIONS_PAYMENTS_MANAGE_PERMISSIONS]),
  ] as const;

  const peopleViewGuard = [
    requireAppAuth,
    requireAnyPermission([...COMMISSIONS_PEOPLE_VIEW_PERMISSIONS]),
  ] as const;

  const peopleManageGuard = [
    requireAppAuth,
    requireAnyPermission([...COMMISSIONS_PEOPLE_MANAGE_PERMISSIONS]),
  ] as const;

  const rulesViewGuard = [
    requireAppAuth,
    requireAnyPermission([...COMMISSIONS_RULES_VIEW_PERMISSIONS]),
  ] as const;

  const rulesManageGuard = [
    requireAppAuth,
    requireAnyPermission([...COMMISSIONS_RULES_MANAGE_PERMISSIONS]),
  ] as const;

  const auditGuard = [
    requireAppAuth,
    requireAnyPermission([...COMMISSIONS_AUDIT_VIEW_PERMISSIONS]),
  ] as const;

  const settingsViewGuard = [
    requireAppAuth,
    requireAnyPermission([...COMMISSIONS_SETTINGS_VIEW_PERMISSIONS]),
  ] as const;

  const settingsManageGuard = [
    requireAppAuth,
    requireAnyPermission([...COMMISSIONS_SETTINGS_MANAGE_PERMISSIONS]),
  ] as const;

  const exceptionsViewGuard = [
    requireAppAuth,
    requireAnyPermission([...COMMISSIONS_EXCEPTIONS_VIEW_PERMISSIONS]),
  ] as const;

  const exceptionsManageGuard = [
    requireAppAuth,
    requireAnyPermission([...COMMISSIONS_EXCEPTIONS_MANAGE_PERMISSIONS]),
  ] as const;

  const recalcGuard = [
    requireAppAuth,
    requireAnyPermission([...COMMISSIONS_RECALCULATE_PERMISSIONS]),
  ] as const;

  app.get("/api/commissions/dashboard", ...dashboardGuard, async (req, res) => {
    try {
      const ctx = await resolveScopeOrRespond(req, res, getCurrentAppUser);
      if (!ctx) return;
      const query = parseCommissionDashboardQuery(req.query as Record<string, unknown>);
      const payload = await buildCommissionDashboard(query, ctx.scope);
      return res.json(payload);
    } catch (error) {
      try {
        return handleQueryError(res, error);
      } catch {
        console.error("GET /api/commissions/dashboard", error);
        return res.status(500).json({ error: "Erro ao montar dashboard de comissões." });
      }
    }
  });

  app.get("/api/commissions/visual-audit", ...viewAnyGuard, async (req, res) => {
    try {
      const ctx = await resolveScopeOrRespond(req, res, getCurrentAppUser);
      if (!ctx) return;
      const query = parseCommissionVisualAuditQuery(req.query as Record<string, unknown>);
      const payload = await listCommissionVisualAuditPage(query, ctx.scope);
      return res.json(payload);
    } catch (error) {
      try {
        return handleQueryError(res, error);
      } catch {
        console.error("GET /api/commissions/visual-audit", error);
        return res.status(500).json({ error: "Erro ao carregar auditoria visual de comissões." });
      }
    }
  });

  app.get("/api/commissions/visual-audit/export", ...viewAnyGuard, async (req, res) => {
    try {
      const ctx = await resolveScopeOrRespond(req, res, getCurrentAppUser);
      if (!ctx) return;
      const query = parseCommissionVisualAuditQuery(req.query as Record<string, unknown>);
      const csv = await exportCommissionVisualAuditCsv(query, ctx.scope);
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", 'attachment; filename="auditoria-comissao.csv"');
      return res.send(csv);
    } catch (error) {
      try {
        return handleQueryError(res, error);
      } catch {
        console.error("GET /api/commissions/visual-audit/export", error);
        return res.status(500).json({ error: "Erro ao exportar auditoria visual." });
      }
    }
  });

  app.get("/api/commissions/visual-audit/detail", ...viewAnyGuard, async (req, res) => {
    try {
      const ctx = await resolveScopeOrRespond(req, res, getCurrentAppUser);
      if (!ctx) return;
      const lineId = typeof req.query.lineId === "string" ? req.query.lineId.trim() : "";
      if (!lineId) {
        return res.status(400).json({ error: "lineId é obrigatório." });
      }
      const yearRaw = typeof req.query.year === "string" ? Number.parseInt(req.query.year, 10) : null;
      const monthRaw = typeof req.query.month === "string" ? Number.parseInt(req.query.month, 10) : null;
      const appraisalMode =
        typeof req.query.appraisalMode === "string" ? req.query.appraisalMode : null;
      const payload = await getCommissionVisualAuditDetail({
        lineId,
        scope: ctx.scope,
        year: Number.isFinite(yearRaw) ? yearRaw : null,
        month: Number.isFinite(monthRaw) ? monthRaw : null,
        appraisalMode,
      });
      if (!payload) return res.status(404).json({ error: "Linha não encontrada." });
      return res.json(payload);
    } catch (error) {
      console.error("GET /api/commissions/visual-audit/detail", error);
      return res.status(500).json({ error: "Erro ao carregar detalhe da auditoria visual." });
    }
  });

  app.get("/api/commissions/monthly-closing", ...viewAnyGuard, async (req, res) => {
    try {
      const ctx = await resolveScopeOrRespond(req, res, getCurrentAppUser);
      if (!ctx) return;
      const query = parseCommissionMonthlyClosingQuery(req.query as Record<string, unknown>);
      const payload = await getCommissionMonthlyClosingPage(query, ctx.scope);
      return res.json(payload);
    } catch (error) {
      try {
        return handleQueryError(res, error);
      } catch {
        console.error("GET /api/commissions/monthly-closing", error);
        return res.status(500).json({ error: "Erro ao carregar fechamento mensal de comissões." });
      }
    }
  });

  app.get("/api/commissions/monthly-closing/export", ...viewAnyGuard, async (req, res) => {
    try {
      const ctx = await resolveScopeOrRespond(req, res, getCurrentAppUser);
      if (!ctx) return;
      const query = parseCommissionMonthlyClosingQuery(req.query as Record<string, unknown>);
      const formatRaw = typeof req.query.format === "string" ? req.query.format : "full";
      const format =
        formatRaw === "summary" ||
        formatRaw === "detail" ||
        formatRaw === "full" ||
        formatRaw === "official"
          ? formatRaw
          : "full";
      const csv = await exportCommissionMonthlyClosingCsv(query, ctx.scope, format);
      const filename =
        format === "summary"
          ? `fechamento-comissao-${query.year}-${String(query.month).padStart(2, "0")}-resumo.csv`
          : format === "detail"
            ? `fechamento-comissao-${query.year}-${String(query.month).padStart(2, "0")}-detalhe.csv`
            : format === "official"
              ? `fechamento-comissao-${query.year}-${String(query.month).padStart(2, "0")}-oficial.csv`
            : `fechamento-comissao-${query.year}-${String(query.month).padStart(2, "0")}.csv`;
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      return res.send(csv);
    } catch (error) {
      try {
        return handleQueryError(res, error);
      } catch {
        console.error("GET /api/commissions/monthly-closing/export", error);
        return res.status(500).json({ error: "Erro ao exportar fechamento mensal." });
      }
    }
  });

  app.get("/api/commissions/receipt-closing/preview", ...viewAnyGuard, async (req, res) => {
    try {
      const ctx = await resolveScopeOrRespond(req, res, getCurrentAppUser);
      if (!ctx) return;
      const filters = parseReceiptClosingQuery(req.query as Record<string, unknown>);
      const payload = await getReceiptClosingPreviewPage(filters);
      return res.json(payload);
    } catch (error) {
      try {
        return handleQueryError(res, error);
      } catch {
        console.error("GET /api/commissions/receipt-closing/preview", error);
        const auditMessage =
          error instanceof Error ? error.message.trim() : "Erro ao gerar prévia do fechamento por recebimento.";
        return res.status(500).json({
          error: auditMessage.includes("Unknown field")
            ? "Erro de consulta ao materializar fechamento por recebimento. Contate o suporte com o período informado."
            : auditMessage,
        });
      }
    }
  });

  app.post("/api/commissions/receipt-closing/apply", ...paymentsManageGuard, async (req, res) => {
    try {
      const ctx = await resolveScopeOrRespond(req, res, getCurrentAppUser);
      if (!ctx) return;
      const body = parseReceiptClosingApplyBody(req.body);
      const result = await applyReceiptClosingFromApi({
        year: body.year,
        month: body.month,
        userId: ctx.user.id,
        notes: body.notes,
        acknowledgeCriticalDivergence: body.acknowledgeCriticalDivergence,
      });
      const payload = await getReceiptClosingPage(body.year, body.month);
      return res.status(201).json({ result, payload });
    } catch (error) {
      if (error instanceof CommissionValidationError) return handleValidationError(res, error);
      try {
        return handleReceiptClosingError(res, error);
      } catch {
        console.error("POST /api/commissions/receipt-closing/apply", error);
        const message =
          error instanceof Error && error.message.trim()
            ? error.message
            : "Erro ao aplicar fechamento por recebimento.";
        return res.status(500).json({
          error: message,
          code: "RECEIPT_CLOSING_APPLY_FAILED",
        });
      }
    }
  });

  app.get("/api/commissions/receipt-closing/:year/:month", ...viewAnyGuard, async (req, res) => {
    try {
      const ctx = await resolveScopeOrRespond(req, res, getCurrentAppUser);
      if (!ctx) return;
      const { year, month } = parseReceiptClosingPeriodParams(req.params);
      const nomusQuery = parseReceiptClosingQuery({
        year,
        month,
        ...req.query,
      });
      const payload = await getReceiptClosingPage(year, month, {
        nomusBase: nomusQuery.nomusBase,
        nomusCommission: nomusQuery.nomusCommission,
      });
      return res.json(payload);
    } catch (error) {
      try {
        return handleQueryError(res, error);
      } catch {
        console.error("GET /api/commissions/receipt-closing/:year/:month", error);
        return res.status(500).json({ error: "Erro ao carregar fechamento por recebimento." });
      }
    }
  });

  app.get(
    "/api/commissions/receipt-closing/:year/:month/export.csv",
    ...viewAnyGuard,
    async (req, res) => {
      try {
        const ctx = await resolveScopeOrRespond(req, res, getCurrentAppUser);
        if (!ctx) return;
        const { year, month } = parseReceiptClosingPeriodParams(req.params);
        const nomusQuery = parseReceiptClosingQuery({
          year,
          month,
          ...req.query,
        });
        const { csv, filename } = await exportReceiptClosingCsv({
          year,
          month,
          nomusBase: nomusQuery.nomusBase,
          nomusCommission: nomusQuery.nomusCommission,
        });
        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
        return res.send(csv);
      } catch (error) {
        try {
          return handleQueryError(res, error);
        } catch {
          console.error("GET /api/commissions/receipt-closing/:year/:month/export.csv", error);
          return res.status(500).json({ error: "Erro ao exportar fechamento por recebimento." });
        }
      }
    }
  );

  app.get(
    "/api/commissions/receipt-closing/:year/:month/export-detail.xlsx",
    ...viewAnyGuard,
    async (req, res) => {
      try {
        const ctx = await resolveScopeOrRespond(req, res, getCurrentAppUser);
        if (!ctx) return;
        const { year, month } = parseReceiptClosingPeriodParams(req.params);
        const nomusQuery = parseReceiptClosingQuery({
          year,
          month,
          ...req.query,
        });
        const { buffer, filename } = await exportReceiptClosingDetailXlsx({
          year,
          month,
          nomusBase: nomusQuery.nomusBase,
          nomusCommission: nomusQuery.nomusCommission,
        });
        res.setHeader(
          "Content-Type",
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        );
        res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
        return res.send(buffer);
      } catch (error) {
        try {
          return handleQueryError(res, error);
        } catch {
          console.error(
            "GET /api/commissions/receipt-closing/:year/:month/export-detail.xlsx",
            error
          );
          return res.status(500).json({ error: "Erro ao exportar detalhamento da prévia." });
        }
      }
    }
  );

  app.post(
    "/api/commissions/receipt-closing/reprocess-preview",
    ...paymentsManageGuard,
    async (req, res) => {
      try {
        const ctx = await resolveScopeOrRespond(req, res, getCurrentAppUser);
        if (!ctx) return;
        const body = parseReceiptClosingPeriodBody(req.body);
        const preview = await reprocessReceiptClosingPreviewFromApi({
          year: body.year,
          month: body.month,
        });
        return res.json(preview);
      } catch (error) {
        if (error instanceof CommissionValidationError) return handleValidationError(res, error);
        try {
          return handleReceiptClosingError(res, error);
        } catch {
          console.error("POST /api/commissions/receipt-closing/reprocess-preview", error);
          return res.status(500).json({ error: "Erro ao pré-visualizar reprocessamento." });
        }
      }
    }
  );

  app.post(
    "/api/commissions/receipt-closing/reprocess-apply",
    ...paymentsManageGuard,
    async (req, res) => {
      try {
        const ctx = await resolveScopeOrRespond(req, res, getCurrentAppUser);
        if (!ctx) return;
        const body = parseReceiptClosingReprocessBody(req.body);
        const result = await reprocessReceiptClosingApplyFromApi({
          year: body.year,
          month: body.month,
          userId: ctx.user.id,
          reason: body.reason,
        });
        const payload = await getReceiptClosingPage(body.year, body.month);
        return res.json({ result, payload });
      } catch (error) {
        if (error instanceof CommissionValidationError) return handleValidationError(res, error);
        try {
          return handleReceiptClosingError(res, error);
        } catch {
          console.error("POST /api/commissions/receipt-closing/reprocess-apply", error);
          return res.status(500).json({ error: "Erro ao reprocessar fechamento por recebimento." });
        }
      }
    }
  );

  app.get("/api/commissions/receivable-forecast", ...viewAnyGuard, async (req, res) => {
    try {
      const ctx = await resolveScopeOrRespond(req, res, getCurrentAppUser);
      if (!ctx) return;
      const query = parseCommissionReceivableForecastQuery(req.query as Record<string, unknown>);
      const payload = await getCommissionReceivableForecastPage(query, ctx.scope);
      return res.json(payload);
    } catch (error) {
      try {
        return handleQueryError(res, error);
      } catch {
        console.error("GET /api/commissions/receivable-forecast", error);
        return res.status(500).json({ error: "Erro ao carregar previsão de comissões." });
      }
    }
  });

  app.get("/api/commissions/receivable-forecast/export", ...viewAnyGuard, async (req, res) => {
    try {
      const ctx = await resolveScopeOrRespond(req, res, getCurrentAppUser);
      if (!ctx) return;
      const query = parseCommissionReceivableForecastQuery(req.query as Record<string, unknown>);
      const formatRaw = typeof req.query.format === "string" ? req.query.format : "full";
      const format =
        formatRaw === "monthly" || formatRaw === "detail" || formatRaw === "full"
          ? formatRaw
          : "full";
      const csv = await exportCommissionReceivableForecastCsv(query, ctx.scope, format);
      const filename =
        format === "monthly"
          ? "previsao-comissao-mensal.csv"
          : format === "detail"
            ? "previsao-comissao-detalhe.csv"
            : "previsao-comissao.csv";
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      return res.send(csv);
    } catch (error) {
      try {
        return handleQueryError(res, error);
      } catch {
        console.error("GET /api/commissions/receivable-forecast/export", error);
        return res.status(500).json({ error: "Erro ao exportar previsão de comissões." });
      }
    }
  });

  app.get("/api/commissions/payable", ...releaseGuard, async (req, res) => {
    try {
      const ctx = await resolveScopeOrRespond(req, res, getCurrentAppUser);
      if (!ctx) return;
      const query = parseCommissionReleasesQuery(req.query as Record<string, unknown>);
      const payload = await listCommissionPayablePage(query, ctx.scope);
      return res.json(payload);
    } catch (error) {
      try {
        return handleQueryError(res, error);
      } catch {
        console.error("GET /api/commissions/payable", error);
        return res.status(500).json({ error: "Erro ao listar comissão a pagar." });
      }
    }
  });

  app.get("/api/commissions/generated", ...confirmedGuard, async (req, res) => {
    try {
      const ctx = await resolveScopeOrRespond(req, res, getCurrentAppUser);
      if (!ctx) return;
      const query = parseCommissionConfirmedQuery(req.query as Record<string, unknown>);
      const payload = await listCommissionGeneratedPage(query, ctx.scope);
      return res.json(payload);
    } catch (error) {
      try {
        return handleQueryError(res, error);
      } catch {
        console.error("GET /api/commissions/generated", error);
        return res.status(500).json({ error: "Erro ao listar comissão gerada." });
      }
    }
  });

  app.get("/api/commissions/generated/detail", ...confirmedGuard, async (req, res) => {
    try {
      const ctx = await resolveScopeOrRespond(req, res, getCurrentAppUser);
      if (!ctx) return;
      const confirmKey =
        typeof req.query.confirmKey === "string" ? req.query.confirmKey.trim() : "";
      if (!confirmKey) {
        return res.status(400).json({ error: "confirmKey é obrigatório." });
      }
      const payload = await getCommissionGeneratedDetail(confirmKey, ctx.scope);
      if (!payload) return res.status(404).json({ error: "Documento não encontrado." });
      return res.json(payload);
    } catch (error) {
      console.error("GET /api/commissions/generated/detail", error);
      return res.status(500).json({ error: "Erro ao carregar detalhe da comissão gerada." });
    }
  });

  app.get("/api/commissions/future", ...forecastGuard, async (req, res) => {
    try {
      const ctx = await resolveScopeOrRespond(req, res, getCurrentAppUser);
      if (!ctx) return;
      const query = parseCommissionReleasesQuery(req.query as Record<string, unknown>);
      const payload = await listCommissionFuturePage(query, ctx.scope);
      return res.json(payload);
    } catch (error) {
      try {
        return handleQueryError(res, error);
      } catch {
        console.error("GET /api/commissions/future", error);
        return res.status(500).json({ error: "Erro ao listar comissões futuras." });
      }
    }
  });

  app.get("/api/commissions/overdue", ...releaseGuard, async (req, res) => {
    try {
      const ctx = await resolveScopeOrRespond(req, res, getCurrentAppUser);
      if (!ctx) return;
      const query = parseCommissionReleasesQuery(req.query as Record<string, unknown>);
      const payload = await listCommissionOverduePage(query, ctx.scope);
      return res.json(payload);
    } catch (error) {
      try {
        return handleQueryError(res, error);
      } catch {
        console.error("GET /api/commissions/overdue", error);
        return res.status(500).json({ error: "Erro ao listar comissões atrasadas." });
      }
    }
  });

  app.get("/api/commissions/audit-trail/detail", ...viewAnyGuard, async (req, res) => {
    try {
      const ctx = await resolveScopeOrRespond(req, res, getCurrentAppUser);
      if (!ctx) return;
      const scheduleId =
        typeof req.query.scheduleId === "string" ? req.query.scheduleId.trim() : null;
      const confirmKey =
        typeof req.query.confirmKey === "string" ? req.query.confirmKey.trim() : null;
      const payload = await getCommissionAuditTrailDetail({
        scheduleId,
        confirmKey,
        scope: ctx.scope,
      });
      return res.json(payload);
    } catch (error) {
      console.error("GET /api/commissions/audit-trail/detail", error);
      return res.status(500).json({ error: "Erro ao carregar trilha de auditoria." });
    }
  });

  app.get("/api/commissions/exceptions", ...exceptionsViewGuard, async (req, res) => {
    try {
      const query = parseCommissionExceptionsQuery(req.query as Record<string, unknown>);
      const payload = await listCommissionExceptionsPage(query);
      return res.json(payload);
    } catch (error) {
      try {
        return handleQueryError(res, error);
      } catch {
        console.error("GET /api/commissions/exceptions", error);
        return res.status(500).json({ error: "Erro ao listar exceções de comissão." });
      }
    }
  });

  app.post("/api/commissions/exceptions", ...exceptionsManageGuard, async (req, res) => {
    try {
      const user = await getCurrentAppUser(req);
      const body = parseCommissionExceptionCreateBody(req.body);
      const row = await createCommissionCustomerException({
        ...body,
        createdByUserId: user?.userId ?? null,
      });
      return res.status(201).json(row);
    } catch (error) {
      try {
        return handleValidationError(res, error as CommissionValidationError);
      } catch {
        console.error("POST /api/commissions/exceptions", error);
        return res.status(500).json({ error: "Erro ao criar exceção de comissão." });
      }
    }
  });

  app.put("/api/commissions/exceptions/:id", ...exceptionsManageGuard, async (req, res) => {
    try {
      const user = await getCurrentAppUser(req);
      const body = parseCommissionExceptionUpdateBody(req.body);
      const row = await updateCommissionCustomerException(req.params.id, {
        ...body,
        updatedByUserId: user?.userId ?? null,
      });
      if (!row) return res.status(404).json({ error: "Exceção não encontrada." });
      return res.json(row);
    } catch (error) {
      try {
        return handleValidationError(res, error as CommissionValidationError);
      } catch {
        console.error("PUT /api/commissions/exceptions/:id", error);
        return res.status(500).json({ error: "Erro ao atualizar exceção." });
      }
    }
  });

  app.patch("/api/commissions/exceptions/:id/toggle-active", ...exceptionsManageGuard, async (req, res) => {
    try {
      const user = await getCurrentAppUser(req);
      const row = await toggleCommissionCustomerExceptionActive(
        req.params.id,
        user?.userId ?? null
      );
      if (!row) return res.status(404).json({ error: "Exceção não encontrada." });
      return res.json(row);
    } catch (error) {
      console.error("PATCH /api/commissions/exceptions/:id/toggle-active", error);
      return res.status(500).json({ error: "Erro ao alterar status da exceção." });
    }
  });

  app.get("/api/commissions/customer-exclusions", ...exceptionsViewGuard, async (req, res) => {
    try {
      const query = parseCustomerExclusionRulesQuery(req.query as Record<string, unknown>);
      const payload = await listCustomerExclusionRules(query);
      return res.json(payload);
    } catch (error) {
      try {
        return handleQueryError(res, error);
      } catch {
        console.error("GET /api/commissions/customer-exclusions", error);
        return res.status(500).json({ error: "Erro ao listar exclusões de cliente." });
      }
    }
  });

  app.get(
    "/api/commissions/customer-exclusions/closing-reconciliation",
    ...exceptionsViewGuard,
    async (req, res) => {
      try {
        const query = parseCustomerExclusionClosingReconciliationQuery(
          req.query as Record<string, unknown>
        );
        const payload = await loadCustomerExclusionClosingReconciliation(
          query.year,
          query.month
        );
        return res.json(payload);
      } catch (error) {
        try {
          return handleQueryError(res, error);
        } catch {
          console.error(
            "GET /api/commissions/customer-exclusions/closing-reconciliation",
            error
          );
          return res.status(500).json({
            error: "Erro ao reconciliar exclusões com o fechamento do mês.",
          });
        }
      }
    }
  );

  app.post("/api/commissions/customer-exclusions", ...exceptionsManageGuard, async (req, res) => {
    try {
      const user = await getCurrentAppUser(req);
      const body = parseCustomerExclusionCreateBody(req.body);
      const row = await createCustomerExclusionRule({
        ...body,
        createdByUserId: user?.userId ?? null,
      });
      return res.status(201).json(row);
    } catch (error) {
      try {
        return handleValidationError(res, error as CommissionValidationError);
      } catch {
        console.error("POST /api/commissions/customer-exclusions", error);
        return res.status(500).json({ error: "Erro ao criar exclusão de cliente." });
      }
    }
  });

  app.patch("/api/commissions/customer-exclusions/:id", ...exceptionsManageGuard, async (req, res) => {
    try {
      const body = parseCustomerExclusionUpdateBody(req.body);
      const row = await updateCustomerExclusionRule(req.params.id, body);
      if (!row) return res.status(404).json({ error: "Regra de exclusão não encontrada." });
      return res.json(row);
    } catch (error) {
      try {
        return handleValidationError(res, error as CommissionValidationError);
      } catch {
        console.error("PATCH /api/commissions/customer-exclusions/:id", error);
        return res.status(500).json({ error: "Erro ao atualizar exclusão de cliente." });
      }
    }
  });

  app.post(
    "/api/commissions/customer-exclusions/:id/inactivate",
    ...exceptionsManageGuard,
    async (req, res) => {
      try {
        const user = await getCurrentAppUser(req);
        const row = await inactivateCustomerExclusionRule(
          req.params.id,
          user?.userId ?? null
        );
        if (!row) return res.status(404).json({ error: "Regra de exclusão não encontrada." });
        return res.json(row);
      } catch (error) {
        console.error("POST /api/commissions/customer-exclusions/:id/inactivate", error);
        return res.status(500).json({ error: "Erro ao inativar exclusão de cliente." });
      }
    }
  );

  app.get("/api/commissions/records", ...viewAnyGuard, async (req, res) => {
    try {
      const ctx = await resolveScopeOrRespond(req, res, getCurrentAppUser);
      if (!ctx) return;
      const query = parseCommissionRecordsQuery(req.query as Record<string, unknown>);
      const payload = await listCommissionRecords(query, ctx.scope);
      return res.json(payload);
    } catch (error) {
      try {
        return handleQueryError(res, error);
      } catch {
        console.error("GET /api/commissions/records", error);
        return res.status(500).json({ error: "Erro ao listar registros de comissão." });
      }
    }
  });

  app.get("/api/commissions/forecast", ...forecastGuard, async (req, res) => {
    try {
      const ctx = await resolveScopeOrRespond(req, res, getCurrentAppUser);
      if (!ctx) return;
      const query = parseCommissionForecastQuery(req.query as Record<string, unknown>);
      const payload = await listCommissionForecastPage(query, ctx.scope);
      return res.json(payload);
    } catch (error) {
      try {
        return handleQueryError(res, error);
      } catch {
        console.error("GET /api/commissions/forecast", error);
        return res.status(500).json({ error: "Erro ao listar comissões previstas." });
      }
    }
  });

  app.get("/api/commissions/forecast/detail", ...forecastGuard, async (req, res) => {
    try {
      const ctx = await resolveScopeOrRespond(req, res, getCurrentAppUser);
      if (!ctx) return;
      const orderKey =
        typeof req.query.orderKey === "string" && req.query.orderKey.trim()
          ? req.query.orderKey.trim()
          : null;
      if (!orderKey) {
        return res.status(400).json({ error: "orderKey é obrigatório." });
      }
      const query = parseCommissionForecastQuery(req.query as Record<string, unknown>);
      const payload = await getCommissionForecastOrderDetail(orderKey, query, ctx.scope);
      if (!payload) {
        return res.status(404).json({ error: "Previsão não encontrada para o pedido informado." });
      }
      return res.json(payload);
    } catch (error) {
      try {
        return handleQueryError(res, error);
      } catch {
        console.error("GET /api/commissions/forecast/detail", error);
        return res.status(500).json({ error: "Erro ao carregar detalhe da previsão." });
      }
    }
  });

  app.get("/api/commissions/confirmed", ...confirmedGuard, async (req, res) => {
    try {
      const ctx = await resolveScopeOrRespond(req, res, getCurrentAppUser);
      if (!ctx) return;
      const query = parseCommissionConfirmedQuery(req.query as Record<string, unknown>);
      const payload = await listCommissionConfirmedPage(query, ctx.scope);
      return res.json(payload);
    } catch (error) {
      try {
        return handleQueryError(res, error);
      } catch {
        console.error("GET /api/commissions/confirmed", error);
        return res.status(500).json({ error: "Erro ao listar comissões confirmadas." });
      }
    }
  });

  app.get("/api/commissions/confirmed/detail", ...confirmedGuard, async (req, res) => {
    try {
      const ctx = await resolveScopeOrRespond(req, res, getCurrentAppUser);
      if (!ctx) return;
      const confirmKey =
        typeof req.query.confirmKey === "string" && req.query.confirmKey.trim()
          ? req.query.confirmKey.trim()
          : null;
      if (!confirmKey) {
        return res.status(400).json({ error: "confirmKey é obrigatório." });
      }
      const query = parseCommissionConfirmedQuery(req.query as Record<string, unknown>);
      const payload = await getCommissionConfirmedDetail(confirmKey, query, ctx.scope);
      if (!payload) {
        return res.status(404).json({ error: "Comissão confirmada não encontrada." });
      }
      return res.json(payload);
    } catch (error) {
      try {
        return handleQueryError(res, error);
      } catch {
        console.error("GET /api/commissions/confirmed/detail", error);
        return res.status(500).json({ error: "Erro ao carregar detalhe da comissão confirmada." });
      }
    }
  });

  app.get("/api/commissions/apuracao", ...apuracaoGuard, async (req, res) => {
    try {
      const ctx = await resolveScopeOrRespond(req, res, getCurrentAppUser);
      if (!ctx) return;
      const query = parseCommissionApuracaoQuery(req.query as Record<string, unknown>);
      const payload = await listCommissionApuracaoPage(query, ctx.scope);
      return res.json(payload);
    } catch (error) {
      try {
        return handleQueryError(res, error);
      } catch {
        console.error("GET /api/commissions/apuracao", error);
        return res.status(500).json({ error: "Erro ao carregar apuração de comissões." });
      }
    }
  });

  app.get("/api/commissions/apuracao/export", ...apuracaoGuard, async (req, res) => {
    try {
      const ctx = await resolveScopeOrRespond(req, res, getCurrentAppUser);
      if (!ctx) return;
      const query = parseCommissionApuracaoQuery(req.query as Record<string, unknown>);
      const csv = await exportCommissionApuracaoCsv(query, ctx.scope);
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="apuracao-comissao-${query.year ?? "periodo"}.csv"`
      );
      return res.send(csv);
    } catch (error) {
      try {
        return handleQueryError(res, error);
      } catch {
        console.error("GET /api/commissions/apuracao/export", error);
        return res.status(500).json({ error: "Erro ao exportar apuração." });
      }
    }
  });

  app.get("/api/commissions/releases", ...releaseGuard, async (req, res) => {
    try {
      const ctx = await resolveScopeOrRespond(req, res, getCurrentAppUser);
      if (!ctx) return;
      const query = parseCommissionReleasesQuery(req.query as Record<string, unknown>);
      const payload = await listCommissionReleasesPage(query, ctx.scope);
      return res.json(payload);
    } catch (error) {
      try {
        return handleQueryError(res, error);
      } catch {
        console.error("GET /api/commissions/releases", error);
        return res.status(500).json({ error: "Erro ao listar liberações por recebimento." });
      }
    }
  });

  app.get("/api/commissions/releases/detail", ...releaseGuard, async (req, res) => {
    try {
      const ctx = await resolveScopeOrRespond(req, res, getCurrentAppUser);
      if (!ctx) return;
      const scheduleId =
        typeof req.query.scheduleId === "string" && req.query.scheduleId.trim()
          ? req.query.scheduleId.trim()
          : null;
      if (!scheduleId) {
        return res.status(400).json({ error: "scheduleId é obrigatório." });
      }
      const query = parseCommissionReleasesQuery(req.query as Record<string, unknown>);
      const payload = await getCommissionReleaseDetail(scheduleId, query, ctx.scope);
      if (!payload) {
        return res.status(404).json({ error: "Parcela de liberação não encontrada." });
      }
      return res.json(payload);
    } catch (error) {
      try {
        return handleQueryError(res, error);
      } catch {
        console.error("GET /api/commissions/releases/detail", error);
        return res.status(500).json({ error: "Erro ao carregar detalhe da liberação." });
      }
    }
  });

  app.get("/api/commissions/persons", ...peopleViewGuard, async (req, res) => {
    try {
      const user = await getCurrentAppUser(req);
      if (!user) return res.status(401).json({ error: "Não autenticado." });
      const query = parseCommissionPersonsQuery(req.query as Record<string, unknown>);
      const payload = await listCommissionPersonsPage(query);
      return res.json(payload);
    } catch (error) {
      if (error instanceof CommissionQueryParseError) return handleQueryError(res, error);
      if (error instanceof CommissionValidationError) return handleValidationError(res, error);
      console.error("GET /api/commissions/persons", error);
      return res.status(500).json({ error: "Erro ao listar pessoas comissionadas." });
    }
  });

  app.post("/api/commissions/persons/import-from-orders", ...peopleManageGuard, async (req, res) => {
    try {
      const user = await getCurrentAppUser(req);
      if (!user) return res.status(401).json({ error: "Não autenticado." });
      const payload = await importCommissionPersonsFromOrders();
      return res.json(payload);
    } catch (error) {
      if (error instanceof CommissionValidationError) return handleValidationError(res, error);
      console.error("POST /api/commissions/persons/import-from-orders", error);
      return res.status(500).json({ error: "Erro ao importar pessoas comissionadas dos pedidos." });
    }
  });

  app.post("/api/commissions/persons", ...peopleManageGuard, async (req, res) => {
    try {
      const user = await getCurrentAppUser(req);
      if (!user) return res.status(401).json({ error: "Não autenticado." });
      const body = parseCommissionPersonCreateBody(req.body);
      const payload = await createCommissionPerson(body);
      return res.status(201).json(payload);
    } catch (error) {
      if (error instanceof CommissionValidationError) return handleValidationError(res, error);
      console.error("POST /api/commissions/persons", error);
      return res.status(500).json({ error: "Erro ao criar pessoa comissionada." });
    }
  });

  app.put("/api/commissions/persons/:id", ...peopleManageGuard, async (req, res) => {
    try {
      const user = await getCurrentAppUser(req);
      if (!user) return res.status(401).json({ error: "Não autenticado." });
      const body = parseCommissionPersonUpdateBody(req.body);
      const payload = await updateCommissionPerson(req.params.id, body);
      return res.json(payload);
    } catch (error) {
      if (error instanceof CommissionValidationError) return handleValidationError(res, error);
      console.error("PUT /api/commissions/persons/:id", error);
      return res.status(500).json({ error: "Erro ao atualizar pessoa comissionada." });
    }
  });

  app.patch("/api/commissions/persons/:id/toggle-active", ...peopleManageGuard, async (req, res) => {
    try {
      const user = await getCurrentAppUser(req);
      if (!user) return res.status(401).json({ error: "Não autenticado." });
      const payload = await toggleCommissionPersonActive(req.params.id);
      return res.json(payload);
    } catch (error) {
      if (error instanceof CommissionValidationError) return handleValidationError(res, error);
      console.error("PATCH /api/commissions/persons/:id/toggle-active", error);
      return res.status(500).json({ error: "Erro ao alterar status da pessoa comissionada." });
    }
  });

  app.get("/api/commissions/rules", ...rulesViewGuard, async (req, res) => {
    try {
      const user = await getCurrentAppUser(req);
      if (!user) return res.status(401).json({ error: "Não autenticado." });
      const query = parseCommissionRulesQuery(req.query as Record<string, unknown>);
      const payload = await listCommissionRulesPage(query);
      return res.json(payload);
    } catch (error) {
      if (error instanceof CommissionQueryParseError) return handleQueryError(res, error);
      if (error instanceof CommissionValidationError) return handleValidationError(res, error);
      console.error("GET /api/commissions/rules", error);
      return res.status(500).json({ error: "Erro ao listar regras de comissão." });
    }
  });

  app.get("/api/commissions/rules/:id/usage", ...rulesViewGuard, async (req, res) => {
    try {
      const user = await getCurrentAppUser(req);
      if (!user) return res.status(401).json({ error: "Não autenticado." });
      const payload = await getCommissionRuleUsage(req.params.id);
      return res.json(payload);
    } catch (error) {
      if (error instanceof CommissionValidationError) return handleValidationError(res, error);
      console.error("GET /api/commissions/rules/:id/usage", error);
      return res.status(500).json({ error: "Erro ao carregar uso da regra." });
    }
  });

  app.post("/api/commissions/rules/:id/duplicate", ...rulesManageGuard, async (req, res) => {
    try {
      const user = await getCurrentAppUser(req);
      if (!user) return res.status(401).json({ error: "Não autenticado." });
      const payload = await duplicateCommissionRule(req.params.id);
      return res.status(201).json(payload);
    } catch (error) {
      if (error instanceof CommissionValidationError) return handleValidationError(res, error);
      console.error("POST /api/commissions/rules/:id/duplicate", error);
      return res.status(500).json({ error: "Erro ao duplicar regra de comissão." });
    }
  });

  app.post("/api/commissions/rules", ...rulesManageGuard, async (req, res) => {
    try {
      const user = await getCurrentAppUser(req);
      if (!user) return res.status(401).json({ error: "Não autenticado." });
      const body = parseCommissionRuleCreateBody(req.body);
      const payload = await createCommissionRule(body);
      return res.status(201).json(payload);
    } catch (error) {
      if (error instanceof CommissionValidationError) return handleValidationError(res, error);
      console.error("POST /api/commissions/rules", error);
      return res.status(500).json({ error: "Erro ao criar regra de comissão." });
    }
  });

  app.put("/api/commissions/rules/:id", ...rulesManageGuard, async (req, res) => {
    try {
      const user = await getCurrentAppUser(req);
      if (!user) return res.status(401).json({ error: "Não autenticado." });
      const body = parseCommissionRuleUpdateBody(req.body);
      const payload = await updateCommissionRule(req.params.id, body);
      return res.json(payload);
    } catch (error) {
      if (error instanceof CommissionValidationError) return handleValidationError(res, error);
      console.error("PUT /api/commissions/rules/:id", error);
      return res.status(500).json({ error: "Erro ao atualizar regra de comissão." });
    }
  });

  app.patch("/api/commissions/rules/:id/toggle-active", ...rulesManageGuard, async (req, res) => {
    try {
      const user = await getCurrentAppUser(req);
      if (!user) return res.status(401).json({ error: "Não autenticado." });
      const payload = await toggleCommissionRuleActive(req.params.id);
      return res.json(payload);
    } catch (error) {
      if (error instanceof CommissionValidationError) return handleValidationError(res, error);
      console.error("PATCH /api/commissions/rules/:id/toggle-active", error);
      return res.status(500).json({ error: "Erro ao alterar status da regra." });
    }
  });

  app.post("/api/commissions/recalculate", ...recalcGuard, async (req, res) => {
    try {
      const user = await getCurrentAppUser(req);
      if (!user) return res.status(401).json({ error: "Não autenticado." });
      const body = parseCommissionRecalculateBody(req.body);
      const { runId, summary } = await calculateCommissions(prisma, {
        from: body.from,
        to: body.to,
        mode: body.mode,
      });
      return res.status(202).json({ runId, summary });
    } catch (error) {
      if (error instanceof CommissionValidationError) return handleValidationError(res, error);
      console.error("POST /api/commissions/recalculate", error);
      return res.status(500).json({ error: "Erro ao recalcular comissões." });
    }
  });

  app.get("/api/commissions/audit", ...auditGuard, async (req, res) => {
    try {
      const user = await getCurrentAppUser(req);
      if (!user) return res.status(401).json({ error: "Não autenticado." });
      const query = parseCommissionAuditQuery(req.query as Record<string, unknown>);
      const payload = await listCommissionAuditPage(query);
      return res.json(payload);
    } catch (error) {
      if (error instanceof CommissionQueryParseError) return handleQueryError(res, error);
      if (error instanceof CommissionValidationError) return handleValidationError(res, error);
      console.error("GET /api/commissions/audit", error);
      return res.status(500).json({ error: "Erro ao listar auditoria de comissões." });
    }
  });

  app.post("/api/commissions/audit/rerun", ...recalcGuard, async (req, res) => {
    try {
      const user = await getCurrentAppUser(req);
      if (!user) return res.status(401).json({ error: "Não autenticado." });
      const body = parseCommissionAuditRerunBody(req.body);
      const payload = await rerunCommissionAudit(body);
      return res.status(202).json(payload);
    } catch (error) {
      if (error instanceof CommissionValidationError) return handleValidationError(res, error);
      console.error("POST /api/commissions/audit/rerun", error);
      return res.status(500).json({ error: "Erro ao reexecutar auditoria de comissões." });
    }
  });

  app.patch("/api/commissions/audit/:id/resolve", ...auditGuard, async (req, res) => {
    try {
      const user = await getCurrentAppUser(req);
      if (!user) return res.status(401).json({ error: "Não autenticado." });
      const payload = await resolveCommissionAuditIssue(req.params.id);
      return res.json(payload);
    } catch (error) {
      if (error instanceof CommissionValidationError) return handleValidationError(res, error);
      console.error("PATCH /api/commissions/audit/:id/resolve", error);
      return res.status(500).json({ error: "Erro ao resolver issue de auditoria." });
    }
  });

  app.patch("/api/commissions/audit/:id/reopen", ...auditGuard, async (req, res) => {
    try {
      const user = await getCurrentAppUser(req);
      if (!user) return res.status(401).json({ error: "Não autenticado." });
      const payload = await reopenCommissionAuditIssue(req.params.id);
      return res.json(payload);
    } catch (error) {
      if (error instanceof CommissionValidationError) return handleValidationError(res, error);
      console.error("PATCH /api/commissions/audit/:id/reopen", error);
      return res.status(500).json({ error: "Erro ao reabrir issue de auditoria." });
    }
  });

  app.get("/api/commissions/settings", ...settingsViewGuard, async (req, res) => {
    try {
      const user = await getCurrentAppUser(req);
      if (!user) return res.status(401).json({ error: "Não autenticado." });
      const payload = await getCommissionSettingsPayload();
      return res.json(payload);
    } catch (error) {
      console.error("GET /api/commissions/settings", error);
      return res.status(500).json({ error: "Erro ao carregar configurações de comissões." });
    }
  });

  app.put("/api/commissions/settings", ...settingsManageGuard, async (req, res) => {
    try {
      const user = await getCurrentAppUser(req);
      if (!user) return res.status(401).json({ error: "Não autenticado." });
      const body = parseCommissionSettingsUpdateBody(req.body);
      const payload = await updateCommissionSettings(body);
      return res.json(payload);
    } catch (error) {
      if (error instanceof CommissionValidationError) return handleValidationError(res, error);
      console.error("PUT /api/commissions/settings", error);
      return res.status(500).json({ error: "Erro ao salvar configurações de comissões." });
    }
  });

  app.post("/api/commissions/settings/restore", ...settingsManageGuard, async (req, res) => {
    try {
      const user = await getCurrentAppUser(req);
      if (!user) return res.status(401).json({ error: "Não autenticado." });
      const payload = await restoreCommissionSettingsDefaults();
      return res.json(payload);
    } catch (error) {
      if (error instanceof CommissionValidationError) return handleValidationError(res, error);
      console.error("POST /api/commissions/settings/restore", error);
      return res.status(500).json({ error: "Erro ao restaurar configurações padrão." });
    }
  });

  app.get("/api/commissions/payment-batches", ...paymentsViewGuard, async (req, res) => {
    try {
      const ctx = await resolveScopeOrRespond(req, res, getCurrentAppUser);
      if (!ctx) return;
      const query = parseCommissionPaymentsQuery(req.query as Record<string, unknown>);
      const payload = await listCommissionPaymentsPage(query, ctx.scope);
      return res.json(payload);
    } catch (error) {
      if (error instanceof CommissionQueryParseError) return handleQueryError(res, error);
      if (error instanceof CommissionValidationError) return handleValidationError(res, error);
      console.error("GET /api/commissions/payment-batches", error);
      return res.status(500).json({ error: "Erro ao listar lotes de pagamento." });
    }
  });

  app.get(
    "/api/commissions/payment-batches/unpaid-released",
    ...paymentsViewGuard,
    async (req, res) => {
      try {
        const ctx = await resolveScopeOrRespond(req, res, getCurrentAppUser);
        if (!ctx) return;
        const query = parseUnpaidReleasedCommissionsQuery(req.query as Record<string, unknown>);
        const items = await listUnpaidReleasedCommissionsDetailed(query, ctx.scope);
        return res.json({ items });
      } catch (error) {
        if (error instanceof CommissionQueryParseError) return handleQueryError(res, error);
        console.error("GET /api/commissions/payment-batches/unpaid-released", error);
        return res.status(500).json({ error: "Erro ao listar comissões liberadas não pagas." });
      }
    }
  );

  app.get("/api/commissions/payment-batches/:id", ...paymentsViewGuard, async (req, res) => {
    try {
      const ctx = await resolveScopeOrRespond(req, res, getCurrentAppUser);
      if (!ctx) return;
      const payload = await getCommissionPaymentBatchById(req.params.id, ctx.scope);
      return res.json(payload);
    } catch (error) {
      if (error instanceof CommissionValidationError) return handleValidationError(res, error);
      console.error("GET /api/commissions/payment-batches/:id", error);
      return res.status(500).json({ error: "Erro ao carregar lote de pagamento." });
    }
  });

  app.post("/api/commissions/payment-batches", ...paymentsManageGuard, async (req, res) => {
    try {
      const ctx = await resolveScopeOrRespond(req, res, getCurrentAppUser);
      if (!ctx) return;
      const body = parsePaymentBatchCreateBody(req.body);
      const result = await createCommissionPaymentBatch(prisma, {
        ...body,
        createdBy: ctx.user.id,
      });
      const payload = await getCommissionPaymentBatchById(result.batchId, ctx.scope);
      return res.status(201).json(payload);
    } catch (error) {
      if (error instanceof CommissionValidationError) return handleValidationError(res, error);
      const message = error instanceof Error ? error.message : "Erro ao criar lote de pagamento.";
      console.error("POST /api/commissions/payment-batches", error);
      return res.status(400).json({ error: message });
    }
  });

  app.post("/api/commissions/payment-batches/:id/approve", ...paymentsManageGuard, async (req, res) => {
    try {
      const ctx = await resolveScopeOrRespond(req, res, getCurrentAppUser);
      if (!ctx) return;
      await approveCommissionPaymentBatch(prisma, req.params.id, ctx.user.id);
      const payload = await getCommissionPaymentBatchById(req.params.id, ctx.scope);
      return res.json(payload);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erro ao aprovar lote.";
      console.error("POST /api/commissions/payment-batches/:id/approve", error);
      return res.status(400).json({ error: message });
    }
  });

  app.post("/api/commissions/payment-batches/:id/mark-paid", ...paymentsManageGuard, async (req, res) => {
    try {
      const ctx = await resolveScopeOrRespond(req, res, getCurrentAppUser);
      if (!ctx) return;
      const body = parseMarkPaidBody(req.body);
      await markCommissionPaymentBatchPaid(prisma, {
        batchId: req.params.id,
        paymentDate: body.paymentDate,
        paidBy: ctx.user.id,
      });
      const payload = await getCommissionPaymentBatchById(req.params.id, ctx.scope);
      return res.json(payload);
    } catch (error) {
      if (error instanceof CommissionValidationError) return handleValidationError(res, error);
      const message = error instanceof Error ? error.message : "Erro ao marcar lote como pago.";
      console.error("POST /api/commissions/payment-batches/:id/mark-paid", error);
      return res.status(400).json({ error: message });
    }
  });

  app.post("/api/commissions/payment-batches/:id/cancel", ...paymentsManageGuard, async (req, res) => {
    try {
      const user = await getCurrentAppUser(req);
      if (!user) return res.status(401).json({ error: "Não autenticado." });
      await cancelCommissionPaymentBatch(prisma, req.params.id);
      const payload = await getCommissionPaymentBatchById(req.params.id);
      return res.json(payload);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erro ao cancelar lote.";
      console.error("POST /api/commissions/payment-batches/:id/cancel", error);
      return res.status(400).json({ error: message });
    }
  });
}
