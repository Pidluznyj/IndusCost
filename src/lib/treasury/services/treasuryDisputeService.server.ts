/**
 * Contestações — não zeram saldo/vencimento oficiais; histórico preservado.
 */

import type { PrismaClient } from "@prisma/client";
import type { AppAuthContext } from "@/src/lib/appAuth.js";
import type { TreasuryDisputeDto } from "../contracts/treasuryDto.js";
import type {
  TreasuryDisputeCreateInput,
  TreasuryDisputeUpdateStatusInput,
} from "../contracts/treasurySchemas.js";
import {
  createTreasuryOfficialTitlesAdapter,
  type TreasuryOfficialTitlesAdapter,
} from "../adapters/treasuryOfficialTitlesAdapter.server.js";
import { TreasuryDomainError } from "../domain/treasuryErrors.js";
import { toTreasuryDisputeDto } from "../mappers/treasuryDisputeMappers.js";
import {
  createTreasuryDisputeRepository,
  type TreasuryDisputeRepository,
} from "../repositories/treasuryDisputeRepository.server.js";
import {
  buildTreasuryCreatedAudit,
  buildTreasuryUpdatedAudit,
} from "../treasuryAuditHelpers.js";
import { canTreasuryCapability } from "../treasuryPermissions.js";
import {
  writeTreasuryAuditLog,
  type TreasuryAuditDb,
} from "./treasuryAuditService.server.js";

export type TreasuryDisputeActor = {
  userId: string;
  userName?: string | null;
  role: string;
  sessionId?: string | null;
  requestId?: string | null;
  isSuperAdmin: boolean;
  canViewReceivables: boolean;
  canManageReceivables: boolean;
};

export function buildTreasuryDisputeActor(
  user: AppAuthContext,
  requestId?: string
): TreasuryDisputeActor {
  return {
    userId: user.id,
    userName: user.name,
    role: user.role,
    sessionId: user.sessionId,
    requestId: requestId ?? null,
    isSuperAdmin: user.role === "SUPER_ADMIN",
    canViewReceivables: canTreasuryCapability(user, "viewReceivables"),
    canManageReceivables: canTreasuryCapability(user, "manageReceivables"),
  };
}

function actorCtx(actor: TreasuryDisputeActor) {
  return {
    userId: actor.userId,
    userName: actor.userName ?? null,
    sessionId: actor.sessionId ?? null,
    requestId: actor.requestId ?? null,
  };
}

export type TreasuryDisputeService = {
  listByReceivable(
    actor: TreasuryDisputeActor,
    titleId: string
  ): Promise<TreasuryDisputeDto[]>;
  createForReceivable(
    actor: TreasuryDisputeActor,
    titleId: string,
    input: TreasuryDisputeCreateInput
  ): Promise<TreasuryDisputeDto>;
  updateStatus(
    actor: TreasuryDisputeActor,
    disputeId: string,
    input: TreasuryDisputeUpdateStatusInput
  ): Promise<TreasuryDisputeDto>;
};

export function createTreasuryDisputeService(deps: {
  prisma?: PrismaClient;
  officialAdapter?: TreasuryOfficialTitlesAdapter;
  repository?: TreasuryDisputeRepository;
  runTransaction?: <T>(fn: (tx: TreasuryAuditDb) => Promise<T>) => Promise<T>;
}): TreasuryDisputeService {
  const prisma = deps.prisma;
  const officialAdapter =
    deps.officialAdapter ?? createTreasuryOfficialTitlesAdapter(prisma!);
  const repo = deps.repository ?? createTreasuryDisputeRepository(prisma!);

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
          "Sem permissão para consultar contestações."
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
      return rows.map(toTreasuryDisputeDto);
    },

    async createForReceivable(actor, titleId, input) {
      if (!actor.canManageReceivables && !actor.isSuperAdmin) {
        throw new TreasuryDomainError(
          "FORBIDDEN",
          "Sem permissão para abrir contestações."
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
      // Não altera openBalance / dueDate oficiais.
      const openBefore = official.openBalance;
      const dueBefore = official.dueDate;

      const created = await runInTransaction(async (tx) => {
        const row = await repo.create(
          {
            titleType: "RECEIVABLE",
            officialTitleId: official.id,
            officialExternalId: official.externalId,
            reason: input.reason,
            amountDisputed: input.amountDisputed,
            responsibleUserId: input.responsibleUserId,
            involvedArea: input.involvedArea,
            dueDate: input.dueDate,
            notes: input.notes,
            createdByUserId: actor.userId,
          },
          tx
        );
        await writeTreasuryAuditLog(
          tx,
          buildTreasuryCreatedAudit({
            entityType: "DISPUTE",
            entityId: row.id,
            after: toTreasuryDisputeDto(row),
            justification: input.reason,
            metadata: {
              titleId: official.id,
              officialOpenBalance: openBefore,
              officialDueDate: dueBefore,
              doesNotMutateOfficialBalance: true,
            },
            actor: actorCtx(actor),
          })
        );
        return row;
      });

      return toTreasuryDisputeDto(created);
    },

    async updateStatus(actor, disputeId, input) {
      if (!actor.canManageReceivables && !actor.isSuperAdmin) {
        throw new TreasuryDomainError(
          "FORBIDDEN",
          "Sem permissão para atualizar contestações."
        );
      }
      const current = await repo.findById(disputeId.trim());
      if (!current) {
        throw new TreasuryDomainError(
          "NOT_FOUND",
          "Contestação não encontrada.",
          "disputeId"
        );
      }
      const before = toTreasuryDisputeDto(current);
      const updated = await runInTransaction(async (tx) => {
        const row = await repo.updateStatus(
          current.id,
          {
            status: input.status,
            resolutionNote: input.resolutionNote,
            notes: input.notes,
            updatedByUserId: actor.userId,
            expectedVersion: input.expectedVersion,
          },
          tx
        );
        await writeTreasuryAuditLog(
          tx,
          buildTreasuryUpdatedAudit({
            entityType: "DISPUTE",
            entityId: row.id,
            before,
            after: toTreasuryDisputeDto(row),
            justification: input.resolutionNote ?? input.notes,
            metadata: { action: "status_transition", status: input.status },
            actor: actorCtx(actor),
          })
        );
        return row;
      });
      return toTreasuryDisputeDto(updated);
    },
  };
}
