/**
 * Caso de uso — promessas de pagamento (CR).
 * Não muta vencimento/saldo oficiais Nomus. Preserva histórico.
 */

import type { PrismaClient } from "@prisma/client";
import type { AppAuthContext } from "@/src/lib/appAuth.js";
import { toCivilDateKey } from "@/src/lib/financeCivilDate.js";
import type { TreasuryPaymentPromiseDto } from "../contracts/treasuryDto.js";
import type {
  TreasuryPromiseCancelInput,
  TreasuryPromiseMarkFulfilledInput,
  TreasuryReceivablePromiseCreateInput,
} from "../contracts/treasurySchemas.js";
import {
  createTreasuryOfficialTitlesAdapter,
  type TreasuryOfficialTitlesAdapter,
} from "../adapters/treasuryOfficialTitlesAdapter.server.js";
import {
  assertPromiseAmountAllowed,
  assertPromiseCancellable,
  assertPromiseFulfillable,
  assertPromiseVersionMatch,
  assertReceivableAllowsPromise,
  resolveFulfillmentStatus,
  resolveNextFulfilledAmount,
  shouldExpirePromise,
} from "../domain/treasuryPaymentPromiseRules.js";
import { TreasuryDomainError } from "../domain/treasuryErrors.js";
import {
  toTreasuryPaymentPromiseDto,
  type TreasuryPaymentPromiseRow,
} from "../mappers/treasuryPaymentPromiseMappers.js";
import {
  createTreasuryPaymentPromiseRepository,
  type TreasuryPaymentPromiseRepository,
} from "../repositories/treasuryPaymentPromiseRepository.server.js";
import {
  buildTreasuryCreatedAudit,
  buildTreasuryUpdatedAudit,
} from "../treasuryAuditHelpers.js";
import { canTreasuryCapability } from "../treasuryPermissions.js";
import { normalizeTreasuryMoneyString } from "../treasuryMoney.js";
import {
  writeTreasuryAuditLog,
  type TreasuryAuditDb,
} from "./treasuryAuditService.server.js";
import {
  requestTreasuryProjectionRecalc,
  type TreasuryProjectionRecalcResult,
} from "./treasuryProjectionRecalc.server.js";

export type TreasuryPaymentPromiseActor = {
  userId: string;
  userName?: string | null;
  role: string;
  sessionId?: string | null;
  requestId?: string | null;
  isSuperAdmin: boolean;
  canViewReceivables: boolean;
  canPromiseReceivables: boolean;
};

export function buildTreasuryPaymentPromiseActor(
  user: AppAuthContext,
  requestId?: string
): TreasuryPaymentPromiseActor {
  return {
    userId: user.id,
    userName: user.name,
    role: user.role,
    sessionId: user.sessionId,
    requestId: requestId ?? null,
    isSuperAdmin: user.role === "SUPER_ADMIN",
    canViewReceivables: canTreasuryCapability(user, "viewReceivables"),
    canPromiseReceivables: canTreasuryCapability(user, "promiseReceivables"),
  };
}

function assertCanView(actor: TreasuryPaymentPromiseActor) {
  if (!actor.canViewReceivables && !actor.isSuperAdmin) {
    throw new TreasuryDomainError(
      "FORBIDDEN",
      "Sem permissão para consultar promessas de contas a receber."
    );
  }
}

function assertCanPromise(actor: TreasuryPaymentPromiseActor) {
  if (!actor.canPromiseReceivables && !actor.isSuperAdmin) {
    throw new TreasuryDomainError(
      "FORBIDDEN",
      "Sem permissão para gerenciar promessas de pagamento."
    );
  }
}

function actorCtx(actor: TreasuryPaymentPromiseActor) {
  return {
    userId: actor.userId,
    userName: actor.userName ?? null,
    sessionId: actor.sessionId ?? null,
    requestId: actor.requestId ?? null,
  };
}

function moneyOf(row: TreasuryPaymentPromiseRow, field: "promisedAmount" | "fulfilledAmount") {
  const v = row[field];
  if (typeof v === "string") return normalizeTreasuryMoneyString(v);
  return normalizeTreasuryMoneyString(v.toFixed(2));
}

export type TreasuryPaymentPromiseService = {
  listByReceivable(
    actor: TreasuryPaymentPromiseActor,
    titleId: string,
    referenceDate?: Date
  ): Promise<{ promises: TreasuryPaymentPromiseDto[]; expiredCount: number }>;
  createForReceivable(
    actor: TreasuryPaymentPromiseActor,
    titleId: string,
    input: TreasuryReceivablePromiseCreateInput
  ): Promise<{
    promise: TreasuryPaymentPromiseDto;
    projectionRecalc: TreasuryProjectionRecalcResult;
  }>;
  cancel(
    actor: TreasuryPaymentPromiseActor,
    promiseId: string,
    input: TreasuryPromiseCancelInput
  ): Promise<{
    promise: TreasuryPaymentPromiseDto;
    projectionRecalc: TreasuryProjectionRecalcResult;
  }>;
  markFulfilled(
    actor: TreasuryPaymentPromiseActor,
    promiseId: string,
    input: TreasuryPromiseMarkFulfilledInput
  ): Promise<{
    promise: TreasuryPaymentPromiseDto;
    projectionRecalc: TreasuryProjectionRecalcResult;
  }>;
};

export function createTreasuryPaymentPromiseService(deps: {
  prisma?: PrismaClient;
  officialAdapter?: TreasuryOfficialTitlesAdapter;
  promiseRepository?: TreasuryPaymentPromiseRepository;
  runTransaction?: <T>(fn: (tx: TreasuryAuditDb) => Promise<T>) => Promise<T>;
  requestProjectionRecalc?: typeof requestTreasuryProjectionRecalc;
}): TreasuryPaymentPromiseService {
  const prisma = deps.prisma;
  const officialAdapter =
    deps.officialAdapter ?? createTreasuryOfficialTitlesAdapter(prisma!);
  const repo =
    deps.promiseRepository ??
    createTreasuryPaymentPromiseRepository(prisma!);
  const requestProjection =
    deps.requestProjectionRecalc ?? requestTreasuryProjectionRecalc;

  async function runInTransaction<T>(
    fn: (tx: TreasuryAuditDb) => Promise<T>
  ): Promise<T> {
    if (deps.runTransaction) return deps.runTransaction(fn);
    return prisma!.$transaction(async (tx) => fn(tx));
  }

  async function expireStale(
    rows: TreasuryPaymentPromiseRow[],
    actor: TreasuryPaymentPromiseActor,
    referenceDate?: Date
  ): Promise<{ rows: TreasuryPaymentPromiseRow[]; expiredCount: number }> {
    const today = toCivilDateKey(referenceDate ?? new Date());
    if (!today) return { rows, expiredCount: 0 };
    const toExpire = rows.filter((r) => {
      const promisedDate = toCivilDateKey(r.promisedDate);
      if (!promisedDate) return false;
      return shouldExpirePromise({
        status: r.status,
        promisedDate,
        fulfilledAmount: moneyOf(r, "fulfilledAmount"),
        promisedAmount: moneyOf(r, "promisedAmount"),
        todayCivilDate: today,
      });
    });
    if (!toExpire.length) return { rows, expiredCount: 0 };

    await runInTransaction(async (tx) => {
      for (const row of toExpire) {
        const before = toTreasuryPaymentPromiseDto(row);
        const updated = await repo.update(
          row.id,
          {
            status: "EXPIRED",
            updatedByUserId: actor.userId,
            expectedVersion: row.version,
          },
          tx
        );
        await writeTreasuryAuditLog(
          tx,
          buildTreasuryUpdatedAudit({
            entityType: "PAYMENT_PROMISE",
            entityId: updated.id,
            before,
            after: toTreasuryPaymentPromiseDto(updated),
            justification: "Promessa expirada automaticamente (não cumprida).",
            metadata: { autoExpired: true },
            actor: actorCtx(actor),
          })
        );
      }
    });

    const refreshed = await Promise.all(
      rows.map(async (r) => {
        if (!toExpire.some((e) => e.id === r.id)) return r;
        return (await repo.findById(r.id)) ?? r;
      })
    );
    return { rows: refreshed, expiredCount: toExpire.length };
  }

  return {
    async listByReceivable(actor, titleId, referenceDate) {
      assertCanView(actor);
      const id = titleId.trim();
      if (!id) {
        throw new TreasuryDomainError(
          "REQUIRED_FIELD",
          "titleId é obrigatório.",
          "titleId"
        );
      }
      const official = await officialAdapter.findReceivableById(id);
      if (!official) {
        throw new TreasuryDomainError(
          "NOT_FOUND",
          "Título a receber não encontrado.",
          "titleId"
        );
      }
      const listed = await repo.listByOfficialTitle("RECEIVABLE", official.id);
      const { rows, expiredCount } = await expireStale(
        listed,
        actor,
        referenceDate
      );
      return {
        promises: rows.map(toTreasuryPaymentPromiseDto),
        expiredCount,
      };
    },

    async createForReceivable(actor, titleId, input) {
      assertCanPromise(actor);
      const id = titleId.trim();
      if (!id) {
        throw new TreasuryDomainError(
          "REQUIRED_FIELD",
          "titleId é obrigatório.",
          "titleId"
        );
      }
      const official = await officialAdapter.findReceivableById(id);
      if (!official) {
        throw new TreasuryDomainError(
          "NOT_FOUND",
          "Título a receber não encontrado.",
          "titleId"
        );
      }
      assertReceivableAllowsPromise(official);
      assertPromiseAmountAllowed({
        promisedAmount: input.promisedAmount,
        openBalance: official.openBalance,
        confirmAboveBalance: input.confirmAboveBalance,
        justification: input.justification,
      });

      // Expira stale antes de criar (histórico preservado).
      const existing = await repo.listByOfficialTitle("RECEIVABLE", official.id);
      await expireStale(existing, actor);

      const created = await runInTransaction(async (tx) => {
        const row = await repo.create(
          {
            titleType: "RECEIVABLE",
            officialTitleId: official.id,
            officialExternalId: official.externalId,
            promisedDate: input.promisedDate,
            promisedAmount: input.promisedAmount,
            contactNote: input.contactNote,
            channel: input.channel,
            notes: input.notes,
            responsibleUserId: input.responsibleUserId,
            createdByUserId: actor.userId,
          },
          tx
        );
        await writeTreasuryAuditLog(
          tx,
          buildTreasuryCreatedAudit({
            entityType: "PAYMENT_PROMISE",
            entityId: row.id,
            after: toTreasuryPaymentPromiseDto(row),
            justification: input.justification ?? input.notes ?? null,
            metadata: {
              titleId: official.id,
              officialDueDate: official.dueDate,
              confirmAboveBalance: input.confirmAboveBalance,
              projectionLayer: "PROBABLE",
            },
            actor: actorCtx(actor),
          })
        );
        return row;
      });

      const promise = toTreasuryPaymentPromiseDto(created);
      const projectionRecalc = requestProjection({
        reason: "receivable_promise_created",
        titleId: official.id,
        titleType: "RECEIVABLE",
        expectedDate: null,
        promisedDate: promise.promisedDate,
        projectionLayer: "PROBABLE",
        requestId: actor.requestId ?? null,
      });
      return { promise, projectionRecalc };
    },

    async cancel(actor, promiseId, input) {
      assertCanPromise(actor);
      const row = await repo.findById(promiseId.trim());
      if (!row) {
        throw new TreasuryDomainError(
          "NOT_FOUND",
          "Promessa não encontrada.",
          "promiseId"
        );
      }
      assertPromiseCancellable(row);
      assertPromiseVersionMatch({
        expectedVersion: input.expectedVersion,
        actualVersion: row.version,
      });

      const before = toTreasuryPaymentPromiseDto(row);
      const cancelled = await runInTransaction(async (tx) => {
        const updated = await repo.cancel(
          row.id,
          {
            cancelledByUserId: actor.userId,
            cancellationReason: input.reason,
            expectedVersion: input.expectedVersion,
          },
          tx
        );
        await writeTreasuryAuditLog(
          tx,
          buildTreasuryUpdatedAudit({
            entityType: "PAYMENT_PROMISE",
            entityId: updated.id,
            before,
            after: toTreasuryPaymentPromiseDto(updated),
            justification: input.reason,
            metadata: { action: "cancel", projectionLayer: "PROBABLE" },
            actor: actorCtx(actor),
          })
        );
        return updated;
      });

      const promise = toTreasuryPaymentPromiseDto(cancelled);
      const projectionRecalc = requestProjection({
        reason: "receivable_promise_cancelled",
        titleId: cancelled.officialTitleId,
        titleType: cancelled.titleType,
        expectedDate: null,
        promisedDate: promise.promisedDate,
        projectionLayer: "PROBABLE",
        requestId: actor.requestId ?? null,
      });
      return { promise, projectionRecalc };
    },

    async markFulfilled(actor, promiseId, input) {
      assertCanPromise(actor);
      const row = await repo.findById(promiseId.trim());
      if (!row) {
        throw new TreasuryDomainError(
          "NOT_FOUND",
          "Promessa não encontrada.",
          "promiseId"
        );
      }
      assertPromiseFulfillable(row);
      assertPromiseVersionMatch({
        expectedVersion: input.expectedVersion,
        actualVersion: row.version,
      });

      const promisedAmount = moneyOf(row, "promisedAmount");
      const nextFulfilled = resolveNextFulfilledAmount({
        currentFulfilled: moneyOf(row, "fulfilledAmount"),
        incrementOrTotal: input.fulfilledAmount,
        promisedAmount,
        mode: "set",
      });
      const status = resolveFulfillmentStatus({
        promisedAmount,
        nextFulfilledAmount: nextFulfilled,
      });

      const before = toTreasuryPaymentPromiseDto(row);
      const updated = await runInTransaction(async (tx) => {
        const next = await repo.update(
          row.id,
          {
            fulfilledAmount: nextFulfilled,
            status,
            fulfilledAt: status === "FULFILLED" ? new Date() : row.fulfilledAt,
            notes: input.notes != null ? input.notes : undefined,
            updatedByUserId: actor.userId,
            expectedVersion: input.expectedVersion,
          },
          tx
        );
        await writeTreasuryAuditLog(
          tx,
          buildTreasuryUpdatedAudit({
            entityType: "PAYMENT_PROMISE",
            entityId: next.id,
            before,
            after: toTreasuryPaymentPromiseDto(next),
            justification: input.notes,
            metadata: {
              action: "mark_fulfilled",
              projectionLayer: "PROBABLE",
              partial: status === "PARTIALLY_FULFILLED",
            },
            actor: actorCtx(actor),
          })
        );
        return next;
      });

      const promise = toTreasuryPaymentPromiseDto(updated);
      const projectionRecalc = requestProjection({
        reason: "receivable_promise_fulfilled",
        titleId: updated.officialTitleId,
        titleType: updated.titleType,
        expectedDate: null,
        promisedDate: promise.promisedDate,
        projectionLayer: "PROBABLE",
        requestId: actor.requestId ?? null,
      });
      return { promise, projectionRecalc };
    },
  };
}
