/**
 * Caso de uso — exceções operacionais da Tesouraria.
 * Idempotente por uniqueKey: causa aberta atualiza; recorrência preservada/incrementada.
 */

import type { PrismaClient } from "@prisma/client";
import type { AppAuthContext } from "@/src/lib/appAuth.js";
import type { TreasuryExceptionDto } from "../contracts/treasuryDto.js";
import type {
  TreasuryExceptionAcknowledgeInput,
  TreasuryExceptionAssignInput,
  TreasuryExceptionCancelInput,
  TreasuryExceptionIgnoreInput,
  TreasuryExceptionResolveInput,
  TreasuryExceptionSetDueAtInput,
  TreasuryExceptionSetStatusInput,
  TreasuryExceptionUpsertInput,
  TreasuryExceptionsListQuery,
} from "../contracts/treasurySchemas.js";
import {
  assertTreasuryExceptionCanTransition,
  assertTreasuryExceptionOperationalTarget,
  assertTreasuryExceptionVersionMatch,
  decideTreasuryExceptionUpsert,
} from "../domain/treasuryExceptionRules.js";
import { TreasuryDomainError } from "../domain/treasuryErrors.js";
import {
  toTreasuryExceptionDto,
  type TreasuryExceptionRow,
} from "../mappers/treasuryExceptionMappers.js";
import {
  createTreasuryExceptionRepository,
  type TreasuryExceptionRepository,
} from "../repositories/treasuryExceptionRepository.server.js";
import {
  buildTreasuryCreatedAudit,
  buildTreasuryUpdatedAudit,
} from "../treasuryAuditHelpers.js";
import { canTreasuryCapability } from "../treasuryPermissions.js";
import {
  writeTreasuryAuditLog,
  type TreasuryAuditDb,
} from "./treasuryAuditService.server.js";

export type TreasuryExceptionActor = {
  userId: string;
  userName?: string | null;
  role: string;
  sessionId?: string | null;
  requestId?: string | null;
  isSuperAdmin: boolean;
  canViewExceptions: boolean;
  canManageExceptions: boolean;
};

export function buildTreasuryExceptionActor(
  user: AppAuthContext,
  requestId?: string
): TreasuryExceptionActor {
  return {
    userId: user.id,
    userName: user.name,
    role: user.role,
    sessionId: user.sessionId,
    requestId: requestId ?? null,
    isSuperAdmin: user.role === "SUPER_ADMIN",
    canViewExceptions: canTreasuryCapability(user, "viewExceptions"),
    canManageExceptions: canTreasuryCapability(user, "manageExceptions"),
  };
}

function assertCanView(actor: TreasuryExceptionActor) {
  if (!actor.canViewExceptions && !actor.isSuperAdmin) {
    throw new TreasuryDomainError(
      "FORBIDDEN",
      "Sem permissão para consultar exceções."
    );
  }
}

function assertCanManage(actor: TreasuryExceptionActor) {
  if (!actor.canManageExceptions && !actor.isSuperAdmin) {
    throw new TreasuryDomainError(
      "FORBIDDEN",
      "Sem permissão para gerenciar exceções."
    );
  }
}

function actorCtx(actor: TreasuryExceptionActor) {
  return {
    userId: actor.userId,
    userName: actor.userName ?? null,
    sessionId: actor.sessionId ?? null,
    requestId: actor.requestId ?? null,
  };
}

function parseDetectedAt(value: string | null | undefined): Date {
  if (!value) return new Date();
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    throw new TreasuryDomainError(
      "INVALID_TIMESTAMP",
      "detectedAt inválido.",
      "detectedAt"
    );
  }
  return d;
}

export type TreasuryExceptionUpsertResult = {
  exception: TreasuryExceptionDto;
  created: boolean;
  recurrenceIncremented: boolean;
};

export type TreasuryExceptionService = {
  getById(
    actor: TreasuryExceptionActor,
    id: string
  ): Promise<TreasuryExceptionDto>;
  getByUniqueKey(
    actor: TreasuryExceptionActor,
    uniqueKey: string
  ): Promise<TreasuryExceptionDto | null>;
  list(
    actor: TreasuryExceptionActor,
    filter: Partial<TreasuryExceptionsListQuery> & {
      page?: number;
      pageSize?: number;
    }
  ): Promise<{
    items: TreasuryExceptionDto[];
    pagination: {
      page: number;
      pageSize: number;
      totalRows: number;
      totalPages: number;
    };
    sortBy: string;
    sortDirection: "asc" | "desc";
  }>;
  /**
   * Detecta/atualiza causa por uniqueKey (idempotente).
   * - Aberta: atualiza valor/dados e incrementa recorrência.
   * - Fechada: reabre OPEN, incrementa recorrência.
   * - Ausente: cria com recurrenceCount=1.
   */
  upsertByUniqueKey(
    actor: TreasuryExceptionActor,
    input: TreasuryExceptionUpsertInput
  ): Promise<TreasuryExceptionUpsertResult>;
  acknowledge(
    actor: TreasuryExceptionActor,
    id: string,
    input: TreasuryExceptionAcknowledgeInput
  ): Promise<TreasuryExceptionDto>;
  assign(
    actor: TreasuryExceptionActor,
    id: string,
    input: TreasuryExceptionAssignInput
  ): Promise<TreasuryExceptionDto>;
  setDueAt(
    actor: TreasuryExceptionActor,
    id: string,
    input: TreasuryExceptionSetDueAtInput
  ): Promise<TreasuryExceptionDto>;
  setStatus(
    actor: TreasuryExceptionActor,
    id: string,
    input: TreasuryExceptionSetStatusInput
  ): Promise<TreasuryExceptionDto>;
  resolve(
    actor: TreasuryExceptionActor,
    id: string,
    input: TreasuryExceptionResolveInput
  ): Promise<TreasuryExceptionDto>;
  ignore(
    actor: TreasuryExceptionActor,
    id: string,
    input: TreasuryExceptionIgnoreInput
  ): Promise<TreasuryExceptionDto>;
  cancel(
    actor: TreasuryExceptionActor,
    id: string,
    input: TreasuryExceptionCancelInput
  ): Promise<TreasuryExceptionDto>;
};

export function createTreasuryExceptionService(deps: {
  prisma?: PrismaClient;
  repository?: TreasuryExceptionRepository;
  runTransaction?: <T>(fn: (tx: TreasuryAuditDb) => Promise<T>) => Promise<T>;
}): TreasuryExceptionService {
  const prisma = deps.prisma;
  const repo =
    deps.repository ?? createTreasuryExceptionRepository(prisma!);

  async function runInTransaction<T>(
    fn: (tx: TreasuryAuditDb) => Promise<T>
  ): Promise<T> {
    if (deps.runTransaction) return deps.runTransaction(fn);
    return prisma!.$transaction(async (tx) => fn(tx));
  }

  async function requireException(id: string): Promise<TreasuryExceptionRow> {
    const row = await repo.findById(id.trim());
    if (!row) {
      throw new TreasuryDomainError(
        "NOT_FOUND",
        "Exceção não encontrada.",
        "id"
      );
    }
    return row;
  }

  return {
    async getById(actor, id) {
      assertCanView(actor);
      return toTreasuryExceptionDto(await requireException(id));
    },

    async getByUniqueKey(actor, uniqueKey) {
      assertCanView(actor);
      const row = await repo.findByUniqueKey(uniqueKey.trim());
      return row ? toTreasuryExceptionDto(row) : null;
    },

    async list(actor, filter) {
      assertCanView(actor);
      const page = filter.page ?? 1;
      const pageSize = filter.pageSize ?? 50;
      const sortBy = filter.sortBy ?? "detectedAt";
      const sortDirection = filter.sortDirection ?? "desc";
      const listed = await repo.list({
        companyCode: filter.companyCode ?? null,
        status: filter.status ?? null,
        type: filter.type ?? null,
        severity: filter.severity ?? null,
        responsibleUserId: filter.responsibleUserId ?? null,
        search: filter.search ?? null,
        sortBy,
        sortDirection,
        page,
        pageSize,
      });
      const totalPages = Math.max(1, Math.ceil(listed.total / pageSize) || 1);
      return {
        items: listed.rows.map((row) => toTreasuryExceptionDto(row)),
        pagination: {
          page,
          pageSize,
          totalRows: listed.total,
          totalPages,
        },
        sortBy,
        sortDirection,
      };
    },

    async upsertByUniqueKey(actor, input) {
      assertCanManage(actor);
      const existing = await repo.findByUniqueKey(input.uniqueKey.trim());
      const decision = decideTreasuryExceptionUpsert(
        existing ? (existing.status as TreasuryExceptionDto["status"]) : null,
        existing?.recurrenceCount ?? null
      );
      const detectedAt = parseDetectedAt(input.detectedAt);

      if (decision.kind === "create") {
        const created = await runInTransaction(async (tx) => {
          const row = await repo.create(
            {
              companyCode: input.companyCode,
              uniqueKey: input.uniqueKey.trim(),
              type: input.type,
              severity: input.severity,
              status: "OPEN",
              entityKind: input.entityKind,
              entityId: input.entityId,
              accountId: input.accountId,
              nomusExternalId: input.nomusExternalId,
              title: input.title,
              description: input.description,
              amount: input.amount,
              detectedAt,
              dueAt: input.dueAt,
              responsibleUserId: input.responsibleUserId,
              recurrenceCount: 1,
              metadataJson: input.metadata,
              createdByUserId: actor.userId,
            },
            tx
          );
          // Race: create pode devolver existente (P2002).
          if (existing == null && row.recurrenceCount === 1 && row.version === 1) {
            await writeTreasuryAuditLog(
              tx,
              buildTreasuryCreatedAudit({
                entityType: "EXCEPTION",
                entityId: row.id,
                after: toTreasuryExceptionDto(row),
                justification: "Exceção detectada.",
                metadata: {
                  uniqueKey: row.uniqueKey,
                  created: true,
                },
                actor: actorCtx(actor),
              })
            );
          }
          return row;
        });
        const createdFresh =
          !existing &&
          created.version === 1 &&
          created.recurrenceCount === 1;
        return {
          exception: toTreasuryExceptionDto(created),
          created: createdFresh,
          recurrenceIncremented: false,
        };
      }

      const before = toTreasuryExceptionDto(existing!);
      const updated = await runInTransaction(async (tx) => {
        const patch =
          decision.kind === "update_open"
            ? {
                type: input.type,
                severity: input.severity,
                status: decision.keepStatus,
                entityKind: input.entityKind,
                entityId: input.entityId,
                accountId: input.accountId,
                nomusExternalId: input.nomusExternalId,
                title: input.title,
                description: input.description,
                amount: input.amount,
                detectedAt,
                dueAt: input.dueAt,
                responsibleUserId: input.responsibleUserId,
                recurrenceCount: decision.nextRecurrence,
                metadataJson: input.metadata,
                updatedByUserId: actor.userId,
                expectedVersion: existing!.version,
              }
            : {
                type: input.type,
                severity: input.severity,
                status: "OPEN" as const,
                entityKind: input.entityKind,
                entityId: input.entityId,
                accountId: input.accountId,
                nomusExternalId: input.nomusExternalId,
                title: input.title,
                description: input.description,
                amount: input.amount,
                detectedAt,
                dueAt: input.dueAt,
                responsibleUserId: input.responsibleUserId,
                resolution: null,
                ignoreJustification: null,
                recurrenceCount: decision.nextRecurrence,
                metadataJson: input.metadata,
                acknowledgedAt: null,
                resolvedAt: null,
                cancelledAt: null,
                cancelledByUserId: null,
                updatedByUserId: actor.userId,
                expectedVersion: existing!.version,
              };

        const row = await repo.update(existing!.id, patch, tx);
        await writeTreasuryAuditLog(
          tx,
          buildTreasuryUpdatedAudit({
            entityType: "EXCEPTION",
            entityId: row.id,
            before,
            after: toTreasuryExceptionDto(row),
            justification:
              decision.kind === "reopen"
                ? "Exceção reaberta por nova detecção."
                : "Exceção atualizada (mesma causa aberta).",
            metadata: {
              uniqueKey: row.uniqueKey,
              upsertKind: decision.kind,
              recurrenceCount: row.recurrenceCount,
            },
            actor: actorCtx(actor),
          })
        );
        return row;
      });

      return {
        exception: toTreasuryExceptionDto(updated),
        created: false,
        recurrenceIncremented: true,
      };
    },

    async acknowledge(actor, id, input) {
      assertCanManage(actor);
      const current = await requireException(id);
      assertTreasuryExceptionVersionMatch(current.version, input.expectedVersion);
      assertTreasuryExceptionCanTransition(
        current.status as TreasuryExceptionDto["status"],
        "acknowledge"
      );
      const before = toTreasuryExceptionDto(current);
      const updated = await runInTransaction(async (tx) => {
        const row = await repo.update(
          current.id,
          {
            status: "IN_ANALYSIS",
            acknowledgedAt: new Date(),
            updatedByUserId: actor.userId,
            expectedVersion: input.expectedVersion,
          },
          tx
        );
        await writeTreasuryAuditLog(
          tx,
          buildTreasuryUpdatedAudit({
            entityType: "EXCEPTION",
            entityId: row.id,
            before,
            after: toTreasuryExceptionDto(row),
            justification: input.justification ?? "Exceção em análise.",
            metadata: { action: "acknowledge", status: "IN_ANALYSIS" },
            actor: actorCtx(actor),
          })
        );
        return row;
      });
      return toTreasuryExceptionDto(updated);
    },

    async assign(actor, id, input) {
      assertCanManage(actor);
      const current = await requireException(id);
      assertTreasuryExceptionVersionMatch(current.version, input.expectedVersion);
      assertTreasuryExceptionCanTransition(
        current.status as TreasuryExceptionDto["status"],
        "assign"
      );
      const before = toTreasuryExceptionDto(current);
      const updated = await runInTransaction(async (tx) => {
        const row = await repo.update(
          current.id,
          {
            responsibleUserId: input.responsibleUserId,
            updatedByUserId: actor.userId,
            expectedVersion: input.expectedVersion,
          },
          tx
        );
        await writeTreasuryAuditLog(
          tx,
          buildTreasuryUpdatedAudit({
            entityType: "EXCEPTION",
            entityId: row.id,
            before,
            after: toTreasuryExceptionDto(row),
            justification: input.justification ?? "Responsável atualizado.",
            metadata: { action: "assign" },
            actor: actorCtx(actor),
          })
        );
        return row;
      });
      return toTreasuryExceptionDto(updated);
    },

    async setDueAt(actor, id, input) {
      assertCanManage(actor);
      const current = await requireException(id);
      assertTreasuryExceptionVersionMatch(current.version, input.expectedVersion);
      assertTreasuryExceptionCanTransition(
        current.status as TreasuryExceptionDto["status"],
        "setDueAt"
      );
      const before = toTreasuryExceptionDto(current);
      const updated = await runInTransaction(async (tx) => {
        const row = await repo.update(
          current.id,
          {
            dueAt: input.dueAt,
            updatedByUserId: actor.userId,
            expectedVersion: input.expectedVersion,
          },
          tx
        );
        await writeTreasuryAuditLog(
          tx,
          buildTreasuryUpdatedAudit({
            entityType: "EXCEPTION",
            entityId: row.id,
            before,
            after: toTreasuryExceptionDto(row),
            justification: input.justification ?? "Prazo atualizado.",
            metadata: { action: "setDueAt" },
            actor: actorCtx(actor),
          })
        );
        return row;
      });
      return toTreasuryExceptionDto(updated);
    },

    async setStatus(actor, id, input) {
      assertCanManage(actor);
      assertTreasuryExceptionOperationalTarget(input.status);
      const current = await requireException(id);
      assertTreasuryExceptionVersionMatch(current.version, input.expectedVersion);
      assertTreasuryExceptionCanTransition(
        current.status as TreasuryExceptionDto["status"],
        "setStatus"
      );
      const before = toTreasuryExceptionDto(current);
      const updated = await runInTransaction(async (tx) => {
        const row = await repo.update(
          current.id,
          {
            status: input.status,
            acknowledgedAt:
              input.status === "IN_ANALYSIS" && !current.acknowledgedAt
                ? new Date()
                : undefined,
            updatedByUserId: actor.userId,
            expectedVersion: input.expectedVersion,
          },
          tx
        );
        await writeTreasuryAuditLog(
          tx,
          buildTreasuryUpdatedAudit({
            entityType: "EXCEPTION",
            entityId: row.id,
            before,
            after: toTreasuryExceptionDto(row),
            justification: input.justification ?? `Status → ${input.status}.`,
            metadata: { action: "setStatus", status: input.status },
            actor: actorCtx(actor),
          })
        );
        return row;
      });
      return toTreasuryExceptionDto(updated);
    },

    async resolve(actor, id, input) {
      assertCanManage(actor);
      const current = await requireException(id);
      assertTreasuryExceptionVersionMatch(current.version, input.expectedVersion);
      assertTreasuryExceptionCanTransition(
        current.status as TreasuryExceptionDto["status"],
        "resolve"
      );
      if (!input.resolution.trim()) {
        throw new TreasuryDomainError(
          "REQUIRED_FIELD",
          "resolution é obrigatória.",
          "resolution"
        );
      }
      const before = toTreasuryExceptionDto(current);
      const updated = await runInTransaction(async (tx) => {
        const row = await repo.update(
          current.id,
          {
            status: "RESOLVED",
            resolution: input.resolution,
            resolvedAt: new Date(),
            updatedByUserId: actor.userId,
            expectedVersion: input.expectedVersion,
          },
          tx
        );
        await writeTreasuryAuditLog(
          tx,
          buildTreasuryUpdatedAudit({
            entityType: "EXCEPTION",
            entityId: row.id,
            before,
            after: toTreasuryExceptionDto(row),
            justification: input.resolution,
            metadata: { action: "resolve" },
            actor: actorCtx(actor),
          })
        );
        return row;
      });
      return toTreasuryExceptionDto(updated);
    },

    async ignore(actor, id, input) {
      assertCanManage(actor);
      const current = await requireException(id);
      assertTreasuryExceptionVersionMatch(current.version, input.expectedVersion);
      assertTreasuryExceptionCanTransition(
        current.status as TreasuryExceptionDto["status"],
        "ignore"
      );
      if (!input.ignoreJustification.trim()) {
        throw new TreasuryDomainError(
          "REQUIRED_FIELD",
          "ignoreJustification é obrigatória.",
          "ignoreJustification"
        );
      }
      const before = toTreasuryExceptionDto(current);
      const updated = await runInTransaction(async (tx) => {
        const row = await repo.update(
          current.id,
          {
            status: "IGNORED",
            ignoreJustification: input.ignoreJustification,
            cancelledAt: new Date(),
            cancelledByUserId: actor.userId,
            updatedByUserId: actor.userId,
            expectedVersion: input.expectedVersion,
          },
          tx
        );
        await writeTreasuryAuditLog(
          tx,
          buildTreasuryUpdatedAudit({
            entityType: "EXCEPTION",
            entityId: row.id,
            before,
            after: toTreasuryExceptionDto(row),
            justification: input.ignoreJustification,
            metadata: { action: "ignore", ignored: true },
            actor: actorCtx(actor),
          })
        );
        return row;
      });
      return toTreasuryExceptionDto(updated);
    },

    async cancel(actor, id, input) {
      assertCanManage(actor);
      const current = await requireException(id);
      assertTreasuryExceptionVersionMatch(current.version, input.expectedVersion);
      assertTreasuryExceptionCanTransition(
        current.status as TreasuryExceptionDto["status"],
        "cancel"
      );
      if (!input.justification.trim()) {
        throw new TreasuryDomainError(
          "REQUIRED_FIELD",
          "justification é obrigatória.",
          "justification"
        );
      }
      const before = toTreasuryExceptionDto(current);
      const updated = await runInTransaction(async (tx) => {
        const row = await repo.update(
          current.id,
          {
            status: "CANCELLED",
            ignoreJustification: input.justification,
            cancelledAt: new Date(),
            cancelledByUserId: actor.userId,
            updatedByUserId: actor.userId,
            expectedVersion: input.expectedVersion,
          },
          tx
        );
        await writeTreasuryAuditLog(
          tx,
          buildTreasuryUpdatedAudit({
            entityType: "EXCEPTION",
            entityId: row.id,
            before,
            after: toTreasuryExceptionDto(row),
            justification: input.justification,
            metadata: { action: "cancel" },
            actor: actorCtx(actor),
          })
        );
        return row;
      });
      return toTreasuryExceptionDto(updated);
    },
  };
}
