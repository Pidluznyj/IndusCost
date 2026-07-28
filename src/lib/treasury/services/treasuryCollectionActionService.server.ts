/**
 * Ações de cobrança — append-only; cancela logicamente; não apaga histórico.
 */

import type { PrismaClient } from "@prisma/client";
import type { AppAuthContext } from "@/src/lib/appAuth.js";
import type {
  TreasuryCollectionActionCancelInput,
  TreasuryCollectionActionCreateInput,
} from "../contracts/treasurySchemas.js";
import type { TreasuryCollectionActionDto } from "../contracts/treasuryDto.js";
import {
  createTreasuryOfficialTitlesAdapter,
  type TreasuryOfficialTitlesAdapter,
} from "../adapters/treasuryOfficialTitlesAdapter.server.js";
import {
  assertCollectionActionCancellable,
  assertReceivableAllowsCollectionAction,
  shouldMirrorCollectionNextActionOnComplement,
} from "../domain/treasuryCollectionActionRules.js";
import { TreasuryDomainError } from "../domain/treasuryErrors.js";
import { toTreasuryCollectionActionDto } from "../mappers/treasuryCollectionActionMappers.js";
import {
  createTreasuryCollectionActionRepository,
  type TreasuryCollectionActionRepository,
} from "../repositories/treasuryCollectionActionRepository.server.js";
import {
  createTreasuryTitleOperationalComplementRepository,
  type TreasuryTitleOperationalComplementRepository,
} from "../repositories/treasuryTitleOperationalComplementRepository.server.js";
import {
  buildTreasuryCreatedAudit,
  buildTreasuryUpdatedAudit,
} from "../treasuryAuditHelpers.js";
import { canTreasuryCapability } from "../treasuryPermissions.js";
import {
  writeTreasuryAuditLog,
  type TreasuryAuditDb,
} from "./treasuryAuditService.server.js";

export type TreasuryCollectionActor = {
  userId: string;
  userName?: string | null;
  role: string;
  sessionId?: string | null;
  requestId?: string | null;
  isSuperAdmin: boolean;
  canViewReceivables: boolean;
  canCollectReceivables: boolean;
};

export function buildTreasuryCollectionActor(
  user: AppAuthContext,
  requestId?: string
): TreasuryCollectionActor {
  return {
    userId: user.id,
    userName: user.name,
    role: user.role,
    sessionId: user.sessionId,
    requestId: requestId ?? null,
    isSuperAdmin: user.role === "SUPER_ADMIN",
    canViewReceivables: canTreasuryCapability(user, "viewReceivables"),
    canCollectReceivables: canTreasuryCapability(user, "collectReceivables"),
  };
}

function actorCtx(actor: TreasuryCollectionActor) {
  return {
    userId: actor.userId,
    userName: actor.userName ?? null,
    sessionId: actor.sessionId ?? null,
    requestId: actor.requestId ?? null,
  };
}

export type TreasuryCollectionActionService = {
  listByReceivable(
    actor: TreasuryCollectionActor,
    titleId: string
  ): Promise<TreasuryCollectionActionDto[]>;
  createForReceivable(
    actor: TreasuryCollectionActor,
    titleId: string,
    input: TreasuryCollectionActionCreateInput
  ): Promise<TreasuryCollectionActionDto>;
  cancel(
    actor: TreasuryCollectionActor,
    actionId: string,
    input: TreasuryCollectionActionCancelInput
  ): Promise<TreasuryCollectionActionDto>;
};

export function createTreasuryCollectionActionService(deps: {
  prisma?: PrismaClient;
  officialAdapter?: TreasuryOfficialTitlesAdapter;
  repository?: TreasuryCollectionActionRepository;
  complementRepository?: TreasuryTitleOperationalComplementRepository;
  runTransaction?: <T>(fn: (tx: TreasuryAuditDb) => Promise<T>) => Promise<T>;
}): TreasuryCollectionActionService {
  const prisma = deps.prisma;
  const officialAdapter =
    deps.officialAdapter ?? createTreasuryOfficialTitlesAdapter(prisma!);
  const repo =
    deps.repository ?? createTreasuryCollectionActionRepository(prisma!);
  const complementRepo =
    deps.complementRepository ??
    createTreasuryTitleOperationalComplementRepository(prisma!);

  async function runInTransaction<T>(
    fn: (tx: TreasuryAuditDb) => Promise<T>
  ): Promise<T> {
    if (deps.runTransaction) return deps.runTransaction(fn);
    return prisma!.$transaction(async (tx) => fn(tx));
  }

  return {
    async listByReceivable(actor, titleId) {
      if (!actor.canViewReceivables && !actor.isSuperAdmin) {
        throw new TreasuryDomainError(
          "FORBIDDEN",
          "Sem permissão para consultar ações de cobrança."
        );
      }
      const official = await officialAdapter.findReceivableById(titleId.trim());
      if (!official) {
        throw new TreasuryDomainError(
          "NOT_FOUND",
          "Título a receber não encontrado.",
          "titleId"
        );
      }
      const rows = await repo.listByOfficialTitle("RECEIVABLE", official.id);
      return rows.map(toTreasuryCollectionActionDto);
    },

    async createForReceivable(actor, titleId, input) {
      if (!actor.canCollectReceivables && !actor.isSuperAdmin) {
        throw new TreasuryDomainError(
          "FORBIDDEN",
          "Sem permissão para registrar ações de cobrança."
        );
      }
      const official = await officialAdapter.findReceivableById(titleId.trim());
      if (!official) {
        throw new TreasuryDomainError(
          "NOT_FOUND",
          "Título a receber não encontrado.",
          "titleId"
        );
      }
      assertReceivableAllowsCollectionAction(official);

      const created = await runInTransaction(async (tx) => {
        const row = await repo.create(
          {
            titleType: "RECEIVABLE",
            officialTitleId: official.id,
            officialExternalId: official.externalId,
            actionType: input.actionType,
            performedAt: new Date(input.performedAt),
            contactPerson: input.contactPerson,
            result: input.result,
            notes: input.notes,
            nextAction: input.nextAction,
            responsibleUserId: input.responsibleUserId,
            createdByUserId: actor.userId,
          },
          tx
        );

        // Espelha próxima ação no complemento (filtro da listagem) sem apagar histórico.
        if (shouldMirrorCollectionNextActionOnComplement(input.nextAction)) {
          const existing = await complementRepo.findByOfficialTitle(
            "RECEIVABLE",
            official.id,
            tx
          );
          if (existing && !existing.cancelledAt) {
            await complementRepo.update(
              existing.id,
              {
                nextAction: input.nextAction,
                updatedByUserId: actor.userId,
                expectedVersion: existing.version,
              },
              tx
            );
          } else if (!existing) {
            await complementRepo.create(
              {
                titleType: "RECEIVABLE",
                officialTitleId: official.id,
                officialExternalId: official.externalId,
                nextAction: input.nextAction,
                createdByUserId: actor.userId,
              },
              tx
            );
          }
        }

        await writeTreasuryAuditLog(
          tx,
          buildTreasuryCreatedAudit({
            entityType: "COLLECTION_ACTION",
            entityId: row.id,
            after: toTreasuryCollectionActionDto(row),
            justification: input.notes,
            metadata: {
              titleId: official.id,
              actionType: input.actionType,
              officialDueDate: official.dueDate,
            },
            actor: actorCtx(actor),
          })
        );
        return row;
      });

      return toTreasuryCollectionActionDto(created);
    },

    async cancel(actor, actionId, input) {
      if (!actor.canCollectReceivables && !actor.isSuperAdmin) {
        throw new TreasuryDomainError(
          "FORBIDDEN",
          "Sem permissão para cancelar ações de cobrança."
        );
      }
      const current = await repo.findById(actionId.trim());
      if (!current) {
        throw new TreasuryDomainError(
          "NOT_FOUND",
          "Ação de cobrança não encontrada.",
          "actionId"
        );
      }
      assertCollectionActionCancellable({
        cancelledAt: current.cancelledAt,
        version: current.version,
        expectedVersion: input.expectedVersion,
      });
      const before = toTreasuryCollectionActionDto(current);
      const cancelled = await runInTransaction(async (tx) => {
        const row = await repo.cancel(
          current.id,
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
            entityType: "COLLECTION_ACTION",
            entityId: row.id,
            before,
            after: toTreasuryCollectionActionDto(row),
            justification: input.reason,
            metadata: { action: "cancel_logical" },
            actor: actorCtx(actor),
          })
        );
        return row;
      });
      return toTreasuryCollectionActionDto(cancelled);
    },
  };
}
