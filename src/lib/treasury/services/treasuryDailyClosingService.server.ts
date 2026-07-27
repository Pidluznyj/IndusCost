/**
 * Serviço — fechamento / reabertura / consulta do fechamento diário.
 */

import type { PrismaClient } from "@prisma/client";
import type { AppAuthContext } from "@/src/lib/appAuth.js";
import { DEFAULT_TREASURY_ALERT_SETTINGS } from "../contracts/treasuryAlertConfig.js";
import type {
  TreasuryDailyClosingDto,
  TreasuryDailyClosingPreviewDto,
} from "../contracts/treasuryDto.js";
import type {
  TreasuryDailyClosingCloseInput,
  TreasuryDailyClosingListQuery,
  TreasuryDailyClosingReopenInput,
} from "../contracts/treasurySchemas.js";
import { buildTreasuryPaginationMeta } from "../contracts/treasuryPagination.js";
import {
  assertTreasuryDailyClosingPreviewHashMatch,
  assertTreasuryDailyClosingReadyToClose,
  planTreasuryDailyClosingReopen,
} from "../domain/treasuryDailyClosingRules.js";
import {
  buildTreasuryDailyClosingPreview,
  buildTreasuryDailyClosingSourceHash,
} from "../domain/treasuryDailyClosingPreviewRules.js";
import { TreasuryDomainError } from "../domain/treasuryErrors.js";
import {
  createTreasuryDailyClosingRepository,
  toTreasuryDailyClosingDto,
  type TreasuryDailyClosingCreateClosedInput,
  type TreasuryDailyClosingRepository,
} from "../repositories/treasuryDailyClosingRepository.server.js";
import {
  createTreasuryDailyClosingPreviewFactsRepository,
  type TreasuryDailyClosingPreviewFactsRepository,
} from "../repositories/treasuryDailyClosingPreviewFactsRepository.server.js";
import {
  createTreasuryAlertSettingsService,
  type TreasuryAlertSettingsService,
} from "./treasuryAlertSettingsService.server.js";
import { buildTreasuryUpdatedAudit } from "../treasuryAuditHelpers.js";
import { canTreasuryCapability } from "../treasuryPermissions.js";
import {
  writeTreasuryAuditLog,
  type TreasuryAuditDb,
} from "./treasuryAuditService.server.js";
import {
  requestTreasuryProjectionRecalc,
  type TreasuryProjectionRecalcResult,
} from "./treasuryProjectionRecalc.server.js";
import {
  enqueueTreasuryProjectionRecalcForDefaultScenarios,
} from "./treasuryProjectionRecalcQueueService.server.js";
import {
  createTreasuryProjectionRecalcJobRepository,
  type TreasuryProjectionRecalcJobRepository,
} from "../repositories/treasuryProjectionRecalcJobRepository.server.js";

export type TreasuryDailyClosingActor = {
  userId: string;
  userName?: string | null;
  role: string;
  sessionId?: string | null;
  requestId?: string | null;
  isSuperAdmin: boolean;
  canViewClosing: boolean;
  canCloseDay: boolean;
  canReopenDay: boolean;
};

export function buildTreasuryDailyClosingActor(
  user: AppAuthContext,
  requestId?: string
): TreasuryDailyClosingActor {
  return {
    userId: user.id,
    userName: user.name,
    role: user.role,
    sessionId: user.sessionId,
    requestId: requestId ?? null,
    isSuperAdmin: user.role === "SUPER_ADMIN",
    canViewClosing: canTreasuryCapability(user, "viewClosing"),
    canCloseDay: canTreasuryCapability(user, "closeDay"),
    canReopenDay: canTreasuryCapability(user, "reopenDay"),
  };
}

export type TreasuryDailyClosingDetailDto = TreasuryDailyClosingDto & {
  accountPositions: Awaited<
    ReturnType<TreasuryDailyClosingRepository["listAccountPositions"]>
  >;
  caveats: Awaited<ReturnType<TreasuryDailyClosingRepository["listCaveats"]>>;
  reopening: null | {
    id: string;
    fromClosingId: string;
    toClosingId: string;
    reason: string;
  };
};

export type TreasuryDailyClosingService = {
  list(
    actor: TreasuryDailyClosingActor,
    query: TreasuryDailyClosingListQuery
  ): Promise<{
    items: TreasuryDailyClosingDto[];
    pagination: ReturnType<typeof buildTreasuryPaginationMeta>;
  }>;
  getById(
    actor: TreasuryDailyClosingActor,
    id: string
  ): Promise<TreasuryDailyClosingDetailDto>;
  close(
    actor: TreasuryDailyClosingActor,
    input: TreasuryDailyClosingCloseInput
  ): Promise<{
    closing: TreasuryDailyClosingDto;
    projectionRecalc: TreasuryProjectionRecalcResult;
  }>;
  reopen(
    actor: TreasuryDailyClosingActor,
    id: string,
    input: TreasuryDailyClosingReopenInput
  ): Promise<{
    previous: TreasuryDailyClosingDto;
    next: TreasuryDailyClosingDto;
    projectionRecalc: TreasuryProjectionRecalcResult;
  }>;
};

function moneyOrZero(value: string | null | undefined): string {
  return value == null || value === "" ? "0.00" : value;
}

export function createTreasuryDailyClosingService(deps: {
  prisma?: PrismaClient;
  repository?: TreasuryDailyClosingRepository;
  factsRepository?: TreasuryDailyClosingPreviewFactsRepository;
  alertSettingsService?: TreasuryAlertSettingsService;
  runTransaction?: <T>(fn: (tx: TreasuryAuditDb) => Promise<T>) => Promise<T>;
  requestProjectionRecalc?: typeof requestTreasuryProjectionRecalc;
  recalcJobRepository?: TreasuryProjectionRecalcJobRepository | null;
  loadPreview?: (input: {
    date: string;
    companyCode: string | null;
    accountIds: string[] | null;
  }) => Promise<TreasuryDailyClosingPreviewDto>;
}): TreasuryDailyClosingService {
  const prisma = deps.prisma;
  const repository =
    deps.repository ?? createTreasuryDailyClosingRepository(prisma!);
  const factsRepository =
    deps.factsRepository ??
    (prisma
      ? createTreasuryDailyClosingPreviewFactsRepository(prisma)
      : null);
  const alertSettingsService =
    deps.alertSettingsService ??
    (prisma
      ? createTreasuryAlertSettingsService({ prisma })
      : null);
  const requestProjection =
    deps.requestProjectionRecalc ?? requestTreasuryProjectionRecalc;
  const recalcJobRepository =
    deps.recalcJobRepository === undefined
      ? prisma
        ? createTreasuryProjectionRecalcJobRepository(prisma)
        : null
      : deps.recalcJobRepository;

  async function runInTransaction<T>(
    fn: (tx: TreasuryAuditDb) => Promise<T>
  ): Promise<T> {
    if (deps.runTransaction) return deps.runTransaction(fn);
    if (!prisma) return fn({} as TreasuryAuditDb);
    return prisma.$transaction(async (tx) => fn(tx));
  }

  async function resolvePreview(input: {
    date: string;
    companyCode: string | null;
    accountIds: string[] | null;
  }): Promise<TreasuryDailyClosingPreviewDto> {
    if (deps.loadPreview) return deps.loadPreview(input);
    if (!factsRepository || !alertSettingsService) {
      throw new TreasuryDomainError(
        "VALIDATION_ERROR",
        "Preview de fechamento indisponível."
      );
    }
    const settings = await alertSettingsService.getFields().catch(() => ({
      ...DEFAULT_TREASURY_ALERT_SETTINGS,
    }));
    const facts = await factsRepository.loadPreviewFacts({
      civilDate: input.date,
      companyCode: input.companyCode,
      accountIds: input.accountIds,
      staleBalanceHours: settings.staleBalanceHours,
      syncMaxAgeHours: settings.syncMaxAgeHours,
    });
    return buildTreasuryDailyClosingPreview(facts);
  }

  async function fireRecalc(
    reason: "daily_closing" | "daily_reopening",
    companyCode: string,
    closingId: string,
    civilDate: string,
    requestId: string | null
  ): Promise<TreasuryProjectionRecalcResult> {
    const stub = requestProjection({
      reason,
      titleId: closingId,
      titleType: "RECEIVABLE",
      expectedDate: civilDate,
      companyCode,
      requestId,
    });
    if (recalcJobRepository) {
      await enqueueTreasuryProjectionRecalcForDefaultScenarios(
        {
          companyCode,
          eventType: reason === "daily_closing" ? "CLOSING" : "REOPENING",
          subjectId: closingId,
          payload: { civilDate, closingId, reason },
          requestId,
        },
        { repository: recalcJobRepository }
      );
    }
    return stub;
  }

  function buildFrozenPayload(
    preview: TreasuryDailyClosingPreviewDto,
    caveats: TreasuryDailyClosingCloseInput["caveats"],
    notes: string | null,
    actor: TreasuryDailyClosingActor,
    previousClosingId: string | null
  ): Omit<
    TreasuryDailyClosingCreateClosedInput,
    "companyCode" | "civilDate" | "version" | "createdByUserId"
  > & { createdByUserId?: string } {
    const now = new Date();
    const contentHash = buildTreasuryDailyClosingSourceHash({
      sourceHash: preview.sourceHash,
      summary: preview.summary,
      accounts: preview.accounts.map((a) => a.accountId),
      caveats: caveats.map((c) => c.code),
    });
    return {
      previousClosingId,
      sourceHash: preview.sourceHash,
      contentHash,
      openingBalance: preview.summary.openingBalance,
      realizedInflows: preview.summary.realizedInflows,
      realizedOutflows: preview.summary.realizedOutflows,
      pendenciesAmount: preview.summary.pendenciesAmount,
      closingBalance: preview.summary.closingBalance,
      observedBalance: preview.summary.observedBalance,
      reconciledBalance: moneyOrZero(preview.summary.reconciledBalance),
      differenceAmount: moneyOrZero(preview.summary.differenceAmount),
      exceptionsCount: preview.absoluteBlocks.length + preview.warnings.length,
      exceptionsAmount: "0.00",
      caveatsCount: caveats.length,
      notes,
      closedByUserId: actor.userId,
      closedAt: now,
      positions: preview.accounts.map((a, i) => ({
        accountId: a.accountId,
        openingBalance: a.openingBalance,
        realizedInflows: a.realizedInflows,
        realizedOutflows: a.realizedOutflows,
        pendenciesAmount: a.pendenciesAmount,
        closingBalance: a.closingBalance,
        observedBalance: moneyOrZero(a.observedBalance),
        reconciledBalance: moneyOrZero(a.reconciledBalance ?? a.observedBalance),
        differenceAmount: moneyOrZero(a.differenceAmount),
        sortOrder: i,
      })),
      pendencies: [
        ...preview.pendingReceivables.map((p, i) => ({
          titleKind: "RECEIVABLE" as const,
          officialTitleId: p.officialTitleId,
          nomusExternalId: p.nomusExternalId,
          dueDate: p.dueDate,
          expectedDate: p.expectedDate,
          openAmount: p.openAmount,
          counterpartyName: p.counterpartyName,
          accountId: p.accountId,
          sortOrder: i,
        })),
        ...preview.pendingPayables.map((p, i) => ({
          titleKind: "PAYABLE" as const,
          officialTitleId: p.officialTitleId,
          nomusExternalId: p.nomusExternalId,
          dueDate: p.dueDate,
          expectedDate: p.expectedDate,
          openAmount: p.openAmount,
          counterpartyName: p.counterpartyName,
          accountId: p.accountId,
          sortOrder: preview.pendingReceivables.length + i,
        })),
      ],
      caveats: caveats.map((c, i) => ({
        code: c.code,
        severity: c.severity ?? "WARNING",
        message: c.message,
        sortOrder: i,
      })),
    };
  }

  return {
    async list(actor, query) {
      if (!actor.canViewClosing && !actor.isSuperAdmin) {
        throw new TreasuryDomainError(
          "FORBIDDEN",
          "Sem permissão para listar fechamentos."
        );
      }
      const { rows, total } = await repository.list(query);
      return {
        items: rows.map(toTreasuryDailyClosingDto),
        pagination: buildTreasuryPaginationMeta({
          page: query.page,
          pageSize: query.pageSize,
          totalRows: total,
        }),
      };
    },

    async getById(actor, id) {
      if (!actor.canViewClosing && !actor.isSuperAdmin) {
        throw new TreasuryDomainError(
          "FORBIDDEN",
          "Sem permissão para consultar fechamento."
        );
      }
      const row = await repository.findById(id.trim());
      if (!row) {
        throw new TreasuryDomainError("NOT_FOUND", "Fechamento não encontrado.");
      }
      const [accountPositions, caveats] = await Promise.all([
        repository.listAccountPositions(row.id),
        repository.listCaveats(row.id),
      ]);
      return {
        ...toTreasuryDailyClosingDto(row),
        accountPositions,
        caveats,
        reopening: null,
      };
    },

    async close(actor, input) {
      if (!actor.canCloseDay && !actor.isSuperAdmin) {
        throw new TreasuryDomainError(
          "FORBIDDEN",
          "Sem permissão para fechar o dia."
        );
      }

      const locked = await repository.tryAcquireLock(
        input.companyCode,
        input.date
      );
      if (!locked) {
        throw new TreasuryDomainError(
          "CONFLICT",
          "Fechamento em andamento para esta empresa/data. Tente novamente.",
          "lock"
        );
      }

      try {
        const preview = await resolvePreview({
          date: input.date,
          companyCode: input.companyCode,
          accountIds: input.accountIds,
        });

        assertTreasuryDailyClosingPreviewHashMatch(
          preview.sourceHash,
          input.sourceHash
        );
        assertTreasuryDailyClosingReadyToClose({
          canCloseWithCaveats: preview.canCloseWithCaveats,
          canCloseWithoutCaveats: preview.canCloseWithoutCaveats,
          absoluteBlockCodes: preview.absoluteBlocks.map((b) => b.code),
          requiredCaveatCodes: preview.requiredCaveatCodes,
          caveats: input.caveats,
        });

        const current = await repository.findCurrent(
          input.companyCode,
          input.date
        );
        if (current?.status === "CLOSED") {
          throw new TreasuryDomainError(
            "DAY_CLOSED",
            "Dia já fechado. Reabra para criar nova versão.",
            "status"
          );
        }

        const frozen = buildFrozenPayload(
          preview,
          input.caveats,
          input.notes,
          actor,
          current?.previousClosingId ?? null
        );

        let closedRow;
        if (current?.status === "OPEN") {
          closedRow = await repository.finalizeOpenToClosed(current.id, frozen);
        } else {
          closedRow = await repository.createClosed({
            companyCode: input.companyCode,
            civilDate: input.date,
            version: 1,
            createdByUserId: actor.userId,
            previousClosingId: null,
            ...frozen,
          });
        }

        await runInTransaction(async (tx) => {
          await writeTreasuryAuditLog(tx, {
            entityType: "DAILY_CLOSING",
            entityId: closedRow.id,
            action: "CLOSE",
            before: null,
            after: toTreasuryDailyClosingDto(closedRow),
            metadata: {
              sourceHash: closedRow.sourceHash,
              caveatsCount: closedRow.caveatsCount,
              civilDate: closedRow.civilDate,
              version: closedRow.version,
            },
            justification: input.notes,
            userId: actor.userId,
            userName: actor.userName ?? null,
            sessionId: actor.sessionId ?? null,
            requestId: actor.requestId ?? null,
          });
        });

        const projectionRecalc = await fireRecalc(
          "daily_closing",
          input.companyCode,
          closedRow.id,
          input.date,
          actor.requestId ?? null
        );

        return {
          closing: toTreasuryDailyClosingDto(closedRow),
          projectionRecalc,
        };
      } finally {
        await repository.releaseLock(input.companyCode, input.date);
      }
    },

    async reopen(actor, id, input) {
      if (!actor.canReopenDay && !actor.isSuperAdmin) {
        throw new TreasuryDomainError(
          "FORBIDDEN",
          "Sem permissão para reabrir fechamento."
        );
      }

      const existing = await repository.findById(id.trim());
      if (!existing) {
        throw new TreasuryDomainError("NOT_FOUND", "Fechamento não encontrado.");
      }

      const plan = planTreasuryDailyClosingReopen({
        current: {
          id: existing.id,
          companyCode: existing.companyCode,
          civilDate: existing.civilDate,
          version: existing.version,
          status: existing.status,
          sourceHash: existing.sourceHash,
        },
        reason: input.reason,
      });

      const locked = await repository.tryAcquireLock(
        existing.companyCode,
        existing.civilDate
      );
      if (!locked) {
        throw new TreasuryDomainError(
          "CONFLICT",
          "Reabertura em andamento para esta empresa/data. Tente novamente.",
          "lock"
        );
      }

      try {
        const result = await repository.reopen({
          fromClosingId: existing.id,
          reason: plan.reason,
          reopenedByUserId: actor.userId,
          requestId: actor.requestId ?? null,
          newVersion: plan.nextVersion,
          companyCode: plan.companyCode,
          civilDate: plan.civilDate,
          sourceHash: plan.inheritSourceHash,
        });

        await runInTransaction(async (tx) => {
          await writeTreasuryAuditLog(
            tx,
            buildTreasuryUpdatedAudit({
              entityType: "DAILY_CLOSING",
              entityId: result.previous.id,
              before: toTreasuryDailyClosingDto(existing),
              after: toTreasuryDailyClosingDto(result.previous),
              justification: plan.reason,
              metadata: {
                action: "REOPEN",
                nextClosingId: result.next.id,
                nextVersion: result.next.version,
              },
              actor: {
                userId: actor.userId,
                userName: actor.userName ?? null,
                sessionId: actor.sessionId ?? null,
                requestId: actor.requestId ?? null,
              },
            })
          );
          await writeTreasuryAuditLog(tx, {
            entityType: "DAILY_CLOSING",
            entityId: result.next.id,
            action: "REOPEN",
            before: toTreasuryDailyClosingDto(result.previous),
            after: toTreasuryDailyClosingDto(result.next),
            justification: plan.reason,
            metadata: {
              fromClosingId: result.previous.id,
              reopeningId: result.reopening.id,
            },
            userId: actor.userId,
            userName: actor.userName ?? null,
            sessionId: actor.sessionId ?? null,
            requestId: actor.requestId ?? null,
          });
        });

        const projectionRecalc = await fireRecalc(
          "daily_reopening",
          existing.companyCode,
          result.next.id,
          existing.civilDate,
          actor.requestId ?? null
        );

        return {
          previous: toTreasuryDailyClosingDto(result.previous),
          next: toTreasuryDailyClosingDto(result.next),
          projectionRecalc,
        };
      } finally {
        await repository.releaseLock(
          existing.companyCode,
          existing.civilDate
        );
      }
    },
  };
}
