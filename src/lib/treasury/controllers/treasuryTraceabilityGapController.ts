/**
 * Controllers HTTP finos para lacunas de rastreabilidade (Prompt 63):
 * balance-position, forecast-vs-actual, alerts, audit, health,
 * payment-schedule, reconcile workspace.
 */

import type { Request, Response } from "express";
import type { AppAuthContext } from "@/src/lib/appAuth.js";
import { prisma } from "@/src/lib/prisma.js";
import { parseTreasuryCivilDate } from "../contracts/treasuryCivilDate.js";
import { parseTreasuryPagination } from "../contracts/treasuryPagination.js";
import { parseTreasuryDashboardQuery } from "../contracts/treasurySchemas.js";
import { toTreasuryAuditLogDto } from "../services/treasuryAuditService.server.js";
import {
  buildTreasuryFinancialPositionActor,
  createTreasuryFinancialPositionService,
} from "../services/treasuryFinancialPositionService.server.js";
import {
  buildTreasuryDashboardActor,
  createTreasuryDashboardService,
} from "../services/treasuryDashboardService.server.js";
import { getTreasuryAvailability } from "../services/treasuryAvailabilityService.js";
import { isTreasuryModuleEnabled } from "../treasuryFeatureFlags.js";
import { canTreasuryCapability } from "../treasuryPermissions.js";
import {
  handleTreasuryRouteError,
  resolveTreasuryRequestId,
  sendTreasuryError,
} from "../treasuryHttp.js";
import { TreasuryDomainError } from "../domain/treasuryErrors.js";

export type TreasuryTraceabilityGapControllerDeps = {
  getCurrentAppUser: (req: Request) => Promise<AppAuthContext | null>;
};

async function withAuth(
  deps: TreasuryTraceabilityGapControllerDeps,
  req: Request,
  res: Response,
  fn: (user: AppAuthContext, requestId: string) => Promise<void>
): Promise<void> {
  const requestId = resolveTreasuryRequestId(req);
  res.setHeader("x-request-id", requestId);
  try {
    const user = await deps.getCurrentAppUser(req);
    if (!user) {
      sendTreasuryError(res, {
        requestId,
        error: "Autenticação necessária.",
        code: "UNAUTHORIZED",
      });
      return;
    }
    await fn(user, requestId);
  } catch (err) {
    handleTreasuryRouteError(res, requestId, err);
  }
}

function civilDateOrToday(raw: unknown): string {
  if (raw == null || raw === "") {
    return new Date().toISOString().slice(0, 10);
  }
  return parseTreasuryCivilDate(raw, "date");
}

export function createTreasuryTraceabilityGapControllers(
  deps: TreasuryTraceabilityGapControllerDeps
) {
  const positionService = createTreasuryFinancialPositionService({ prisma });
  const dashboardService = createTreasuryDashboardService({ prisma });

  return {
    balancePosition: (req: Request, res: Response) =>
      withAuth(deps, req, res, async (user, requestId) => {
        const accountId = String(req.params.id ?? "").trim();
        if (!accountId) {
          sendTreasuryError(res, {
            requestId,
            error: "id da conta é obrigatório.",
            code: "VALIDATION_ERROR",
            field: "id",
          });
          return;
        }
        const date = civilDateOrToday(req.query.date);
        const asOf = new Date(`${date}T23:59:59.999-03:00`);
        const position = await positionService.getCurrentPosition(
          buildTreasuryFinancialPositionActor(user, requestId),
          { accountIds: [accountId], asOf }
        );
        const account =
          position.accounts.find((a) => a.accountId === accountId) ?? null;
        if (!account) {
          throw new TreasuryDomainError(
            "NOT_FOUND",
            "Conta não encontrada ou sem acesso para posição."
          );
        }
        res.status(200).json({
          ok: true,
          date,
          account,
          consolidated: position.consolidated,
          requestId,
        });
      }),

    forecastVsActual: (req: Request, res: Response) =>
      withAuth(deps, req, res, async (user, requestId) => {
        const query = parseTreasuryDashboardQuery(
          req.query as Record<string, unknown>
        );
        const dashboard = await dashboardService.getDailyDashboard(
          buildTreasuryDashboardActor(user, requestId),
          query
        );
        res.status(200).json({
          ok: true,
          date: query.date,
          receivables: {
            planned: dashboard.receipts.plannedAmount,
            realized: dashboard.receipts.realizedAmount,
            pending: dashboard.receipts.pendingAmount,
            plannedCount: dashboard.titleCount.receivablesPlanned,
            realizedCount: dashboard.titleCount.receivablesRealized,
            pendingCount: dashboard.titleCount.receivablesPending,
          },
          payables: {
            planned: dashboard.payments.plannedAmount,
            realized: dashboard.payments.realizedAmount,
            pending: dashboard.payments.pendingAmount,
            plannedCount: dashboard.titleCount.payablesPlanned,
            realizedCount: dashboard.titleCount.payablesRealized,
            pendingCount: dashboard.titleCount.payablesPending,
          },
          doesNotSumForecastAndActual: true as const,
          requestId,
        });
      }),

    alerts: (req: Request, res: Response) =>
      withAuth(deps, req, res, async (user, requestId) => {
        const query = parseTreasuryDashboardQuery(
          req.query as Record<string, unknown>
        );
        const dashboard = await dashboardService.getDailyDashboard(
          buildTreasuryDashboardActor(user, requestId),
          query
        );
        res.status(200).json({
          ok: true,
          date: query.date,
          alerts: dashboard.alerts,
          requestId,
        });
      }),

    auditList: (req: Request, res: Response) =>
      withAuth(deps, req, res, async (user, requestId) => {
        if (
          !canTreasuryCapability(user, "viewAudit") &&
          user.role !== "SUPER_ADMIN"
        ) {
          throw new TreasuryDomainError(
            "FORBIDDEN",
            "Sem permissão para consultar auditoria."
          );
        }
        const q = req.query as Record<string, unknown>;
        const pagination = parseTreasuryPagination(q);
        const where: {
          entityType?: string;
          entityId?: string;
        } = {};
        if (q.entityType) where.entityType = String(q.entityType).trim();
        if (q.entityId) where.entityId = String(q.entityId).trim();
        const [total, rows] = await Promise.all([
          prisma.treasuryAuditLog.count({ where }),
          prisma.treasuryAuditLog.findMany({
            where,
            orderBy: { occurredAt: "desc" },
            skip: (pagination.page - 1) * pagination.pageSize,
            take: pagination.pageSize,
          }),
        ]);
        res.status(200).json({
          ok: true,
          items: rows.map(toTreasuryAuditLogDto),
          pagination: {
            page: pagination.page,
            pageSize: pagination.pageSize,
            totalRows: total,
            totalPages: Math.max(1, Math.ceil(total / pagination.pageSize)),
          },
          requestId,
        });
      }),

    health: (_req: Request, res: Response) => {
      const requestId = resolveTreasuryRequestId(_req);
      res.setHeader("x-request-id", requestId);
      const enabled = isTreasuryModuleEnabled(process.env);
      const availability = getTreasuryAvailability({ serverTime: new Date() });
      const payload = {
        ok: enabled,
        enabled,
        module: "treasury",
        availability,
        checks: {
          moduleFlag: enabled ? "PASS" : "FAIL",
          schemaModelsPresent: "ASSUMED_OK",
        },
        serverTimeIso: availability.serverTimeIso,
        requestId,
      };
      res.status(enabled ? 200 : 503).json(payload);
    },

    paymentSchedule: (req: Request, res: Response) =>
      withAuth(deps, req, res, async (user, requestId) => {
        if (
          !canTreasuryCapability(user, "viewPayables") &&
          user.role !== "SUPER_ADMIN"
        ) {
          throw new TreasuryDomainError(
            "FORBIDDEN",
            "Sem permissão para consultar programação de pagamentos."
          );
        }
        const q = req.query as Record<string, unknown>;
        const pagination = parseTreasuryPagination(q);
        const where = {
          titleType: "PAYABLE" as const,
          cancelledAt: null,
          scheduledDate: { not: null },
        };
        const [total, rows] = await Promise.all([
          prisma.treasuryTitleOperationalComplement.count({ where }),
          prisma.treasuryTitleOperationalComplement.findMany({
            where,
            orderBy: [{ scheduledDate: "asc" }, { updatedAt: "desc" }],
            skip: (pagination.page - 1) * pagination.pageSize,
            take: pagination.pageSize,
          }),
        ]);
        res.status(200).json({
          ok: true,
          items: rows.map((r) => ({
            id: r.id,
            officialTitleId: r.officialTitleId,
            officialExternalId: r.officialExternalId,
            scheduledDate: r.scheduledDate
              ? r.scheduledDate.toISOString().slice(0, 10)
              : null,
            scheduledAmount:
              r.scheduledAmount != null ? r.scheduledAmount.toFixed(2) : null,
            status: r.status,
            priority: r.priority,
            plannedAccountId: r.plannedAccountId,
            responsibleUserId: r.responsibleUserId,
          })),
          pagination: {
            page: pagination.page,
            pageSize: pagination.pageSize,
            totalRows: total,
            totalPages: Math.max(1, Math.ceil(total / pagination.pageSize)),
          },
          requestId,
        });
      }),

    reconcileWorkspace: (req: Request, res: Response) =>
      withAuth(deps, req, res, async (user, requestId) => {
        if (
          !canTreasuryCapability(user, "viewReconciliation") &&
          user.role !== "SUPER_ADMIN"
        ) {
          throw new TreasuryDomainError(
            "FORBIDDEN",
            "Sem permissão para workspace de conciliação."
          );
        }
        const accountId = String(req.query.accountId ?? "").trim() || null;
        const openStatuses = ["PENDING", "UNMATCHED", "PARTIAL"] as const;
        const [unmatchedCount, pendingCount, activeMatches, sampleMovements] =
          await Promise.all([
            prisma.treasuryBankMovement.count({
              where: {
                ...(accountId ? { accountId } : {}),
                reconciliationStatus: "UNMATCHED",
              },
            }),
            prisma.treasuryBankMovement.count({
              where: {
                ...(accountId ? { accountId } : {}),
                reconciliationStatus: "PENDING",
              },
            }),
            prisma.treasuryReconciliationMatch.count({
              where: {
                ...(accountId ? { accountId } : {}),
                status: "MATCHED",
                unmatchedAt: null,
              },
            }),
            prisma.treasuryBankMovement.findMany({
              where: {
                ...(accountId ? { accountId } : {}),
                reconciliationStatus: { in: [...openStatuses] },
              },
              orderBy: { postedCivilDate: "desc" },
              take: 50,
              select: {
                id: true,
                accountId: true,
                postedCivilDate: true,
                amount: true,
                direction: true,
                description: true,
                reconciliationStatus: true,
              },
            }),
          ]);
        res.status(200).json({
          ok: true,
          accountId,
          summary: {
            unmatchedCount,
            pendingCount,
            activeMatches,
          },
          movements: sampleMovements.map((m) => ({
            id: m.id,
            accountId: m.accountId,
            postedCivilDate: m.postedCivilDate.toISOString().slice(0, 10),
            amount: m.amount.toFixed(2),
            direction: m.direction,
            memo: m.description,
            reconciliationStatus: m.reconciliationStatus,
          })),
          requestId,
        });
      }),
  };
}
