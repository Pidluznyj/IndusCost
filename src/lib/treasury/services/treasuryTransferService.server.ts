/**
 * Caso de uso — transferências internas entre contas.
 * Consolidado neutro; recurso em trânsito enquanto SENT; cancelamento auditado.
 */

import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import type { AppAuthContext } from "@/src/lib/appAuth.js";
import type { TreasuryTransferDto } from "../contracts/treasuryDto.js";
import type {
  TreasuryTransferCancelInput,
  TreasuryTransferCreateInput,
  TreasuryTransferTransitionInput,
  TreasuryTransfersListQuery,
} from "../contracts/treasurySchemas.js";
import {
  canTreasuryActorAccessAccount,
  canTreasuryActorManageAccount,
  type TreasuryAccountAccessSnapshot,
  type TreasuryAccountActor,
} from "../domain/treasuryAccountRules.js";
import { TreasuryDomainError } from "../domain/treasuryErrors.js";
import {
  assertTreasuryTransferCreateable,
  assertTreasuryTransferCancellable,
  assertTreasuryTransferTransitionAllowed,
  assertTreasuryTransferVersionMatch,
  nextStatusAfterTransition,
} from "../domain/treasuryTransferRules.js";
import {
  toTreasuryTransferDto,
  type TreasuryTransferRow,
} from "../mappers/treasuryTransferMappers.js";
import {
  createTreasuryAccountRepository,
  type TreasuryAccountRepository,
} from "../repositories/treasuryAccountRepository.server.js";
import {
  createTreasuryTransferRepository,
  type TreasuryTransferRepository,
} from "../repositories/treasuryTransferRepository.server.js";
import {
  buildTreasuryCreatedAudit,
  buildTreasuryUpdatedAudit,
} from "../treasuryAuditHelpers.js";
import { buildTreasuryPaginationMeta } from "../contracts/treasuryPagination.js";
import { canTreasuryCapability } from "../treasuryPermissions.js";
import {
  writeTreasuryAuditLog,
  type TreasuryAuditDb,
} from "./treasuryAuditService.server.js";
import {
  requestTreasuryProjectionRecalc,
  type TreasuryProjectionRecalcResult,
} from "./treasuryProjectionRecalc.server.js";

export type TreasuryTransferActor = {
  userId: string;
  userName?: string | null;
  role: string;
  sessionId?: string | null;
  requestId?: string | null;
  isSuperAdmin: boolean;
  canViewTransfers: boolean;
  canManageTransfers: boolean;
  canViewAccounts: boolean;
  canManageAccounts: boolean;
};

export function buildTreasuryTransferActor(
  user: AppAuthContext,
  requestId?: string
): TreasuryTransferActor {
  return {
    userId: user.id,
    userName: user.name,
    role: user.role,
    sessionId: user.sessionId,
    requestId: requestId ?? null,
    isSuperAdmin: user.role === "SUPER_ADMIN",
    canViewTransfers: canTreasuryCapability(user, "viewTransfers"),
    canManageTransfers: canTreasuryCapability(user, "manageTransfers"),
    canViewAccounts: canTreasuryCapability(user, "viewAccounts"),
    canManageAccounts: canTreasuryCapability(user, "manageAccounts"),
  };
}

function asAccountActor(actor: TreasuryTransferActor): TreasuryAccountActor {
  return {
    userId: actor.userId,
    userName: actor.userName,
    role: actor.role,
    sessionId: actor.sessionId,
    requestId: actor.requestId,
    isSuperAdmin: actor.isSuperAdmin,
    canViewAccounts: actor.canViewAccounts || actor.canViewTransfers,
    canManageAccounts: actor.canManageAccounts || actor.canManageTransfers,
  };
}

function asAccessSnapshot(
  access: Awaited<ReturnType<TreasuryAccountRepository["findAccess"]>>
): TreasuryAccountAccessSnapshot | null {
  if (!access) return null;
  return {
    userId: access.userId,
    accessLevel: access.accessLevel as TreasuryAccountAccessSnapshot["accessLevel"],
    isActive: access.isActive,
    revokedAt: access.revokedAt,
    canViewBalance: access.canViewBalance,
    canMutateBalance: access.canMutateBalance,
  };
}

function assertCanView(actor: TreasuryTransferActor) {
  if (!actor.canViewTransfers && !actor.isSuperAdmin) {
    throw new TreasuryDomainError(
      "FORBIDDEN",
      "Sem permissão para consultar transferências."
    );
  }
}

function assertCanManage(actor: TreasuryTransferActor) {
  if (!actor.canManageTransfers && !actor.isSuperAdmin) {
    throw new TreasuryDomainError(
      "FORBIDDEN",
      "Sem permissão para gerenciar transferências."
    );
  }
}

function actorCtx(actor: TreasuryTransferActor) {
  return {
    userId: actor.userId,
    userName: actor.userName ?? null,
    sessionId: actor.sessionId ?? null,
    requestId: actor.requestId ?? null,
  };
}

export type TreasuryTransferService = {
  list(
    actor: TreasuryTransferActor,
    query: TreasuryTransfersListQuery
  ): Promise<{
    items: TreasuryTransferDto[];
    pagination: ReturnType<typeof buildTreasuryPaginationMeta>;
  }>;
  getById(
    actor: TreasuryTransferActor,
    id: string
  ): Promise<TreasuryTransferDto>;
  create(
    actor: TreasuryTransferActor,
    input: TreasuryTransferCreateInput
  ): Promise<{
    transfer: TreasuryTransferDto;
    projectionRecalc: TreasuryProjectionRecalcResult;
  }>;
  schedule(
    actor: TreasuryTransferActor,
    id: string,
    input: TreasuryTransferTransitionInput
  ): Promise<{
    transfer: TreasuryTransferDto;
    projectionRecalc: TreasuryProjectionRecalcResult;
  }>;
  send(
    actor: TreasuryTransferActor,
    id: string,
    input: TreasuryTransferTransitionInput
  ): Promise<{
    transfer: TreasuryTransferDto;
    projectionRecalc: TreasuryProjectionRecalcResult;
  }>;
  receive(
    actor: TreasuryTransferActor,
    id: string,
    input: TreasuryTransferTransitionInput
  ): Promise<{
    transfer: TreasuryTransferDto;
    projectionRecalc: TreasuryProjectionRecalcResult;
  }>;
  reconcile(
    actor: TreasuryTransferActor,
    id: string,
    input: TreasuryTransferTransitionInput
  ): Promise<{
    transfer: TreasuryTransferDto;
    projectionRecalc: TreasuryProjectionRecalcResult;
  }>;
  cancel(
    actor: TreasuryTransferActor,
    id: string,
    input: TreasuryTransferCancelInput
  ): Promise<{
    transfer: TreasuryTransferDto;
    projectionRecalc: TreasuryProjectionRecalcResult;
  }>;
};

export function createTreasuryTransferService(deps: {
  prisma?: PrismaClient;
  transferRepository?: TreasuryTransferRepository;
  accountRepository?: TreasuryAccountRepository;
  runTransaction?: <T>(fn: (tx: TreasuryAuditDb) => Promise<T>) => Promise<T>;
  requestProjectionRecalc?: typeof requestTreasuryProjectionRecalc;
}): TreasuryTransferService {
  const prisma = deps.prisma;
  const transferRepo =
    deps.transferRepository ?? createTreasuryTransferRepository(prisma!);
  const accountRepo =
    deps.accountRepository ?? createTreasuryAccountRepository(prisma!);
  const requestProjection =
    deps.requestProjectionRecalc ?? requestTreasuryProjectionRecalc;

  async function runInTransaction<T>(
    fn: (tx: TreasuryAuditDb) => Promise<T>
  ): Promise<T> {
    if (deps.runTransaction) return deps.runTransaction(fn);
    return prisma!.$transaction(async (tx) => fn(tx));
  }

  async function requireOperateBothAccounts(
    actor: TreasuryTransferActor,
    fromAccountId: string,
    toAccountId: string
  ) {
    const accountActor = asAccountActor(actor);
    const [from, to] = await Promise.all([
      accountRepo.findById(fromAccountId),
      accountRepo.findById(toAccountId),
    ]);
    if (!from || !from.isActive) {
      throw new TreasuryDomainError(
        "NOT_FOUND",
        "Conta de origem não encontrada ou inativa.",
        "fromAccountId"
      );
    }
    if (!to || !to.isActive) {
      throw new TreasuryDomainError(
        "NOT_FOUND",
        "Conta de destino não encontrada ou inativa.",
        "toAccountId"
      );
    }
    if (from.companyCode !== to.companyCode) {
      throw new TreasuryDomainError(
        "VALIDATION_ERROR",
        "Origem e destino devem pertencer à mesma empresa.",
        "toAccountId"
      );
    }
    const [fromAccess, toAccess] = await Promise.all([
      accountRepo.findAccess(fromAccountId, actor.userId),
      accountRepo.findAccess(toAccountId, actor.userId),
    ]);
    if (!canTreasuryActorManageAccount(accountActor, asAccessSnapshot(fromAccess))) {
      throw new TreasuryDomainError(
        "FORBIDDEN",
        "Sem autorização operacional na conta de origem.",
        "fromAccountId"
      );
    }
    if (!canTreasuryActorManageAccount(accountActor, asAccessSnapshot(toAccess))) {
      throw new TreasuryDomainError(
        "FORBIDDEN",
        "Sem autorização operacional na conta de destino.",
        "toAccountId"
      );
    }
    return { from, to };
  }

  async function requireVisibleTransfer(
    actor: TreasuryTransferActor,
    id: string
  ): Promise<TreasuryTransferRow> {
    const row = await transferRepo.findById(id);
    if (!row) {
      throw new TreasuryDomainError(
        "NOT_FOUND",
        "Transferência não encontrada.",
        "id"
      );
    }
    // Visualização exige acesso a pelo menos uma das contas (ou manage-all).
    const accountActor = asAccountActor(actor);
    if (
      !accountActor.canManageAccounts &&
      !actor.isSuperAdmin
    ) {
      const [fromAccess, toAccess] = await Promise.all([
        accountRepo.findAccess(row.fromAccountId, actor.userId),
        accountRepo.findAccess(row.toAccountId, actor.userId),
      ]);
      const fromSnap = asAccessSnapshot(fromAccess);
      const toSnap = asAccessSnapshot(toAccess);
      const canSee =
        canTreasuryActorAccessAccount(accountActor, fromSnap) ||
        canTreasuryActorAccessAccount(accountActor, toSnap);
      if (!canSee) {
        throw new TreasuryDomainError(
          "FORBIDDEN",
          "Sem autorização para visualizar esta transferência."
        );
      }
    }
    return row;
  }

  function enqueueRecalc(
    actor: TreasuryTransferActor,
    row: TreasuryTransferRow,
    reason: string
  ): TreasuryProjectionRecalcResult {
    return requestProjection({
      reason,
      titleId: row.id,
      titleType: "RECEIVABLE",
      expectedDate: toTreasuryTransferDto(row).civilDate,
      requestId: actor.requestId,
      companyCode: row.companyCode,
      projectionLayer: "PROBABLE",
    });
  }

  async function transition(
    actor: TreasuryTransferActor,
    id: string,
    input: TreasuryTransferTransitionInput,
    kind: "schedule" | "send" | "receive" | "reconcile"
  ) {
    assertCanManage(actor);
    const current = await requireVisibleTransfer(actor, id);
    assertTreasuryTransferVersionMatch(current.version, input.expectedVersion);
    assertTreasuryTransferTransitionAllowed(current.status, kind);
    await requireOperateBothAccounts(
      actor,
      current.fromAccountId,
      current.toAccountId
    );

    const nextStatus = nextStatusAfterTransition(kind);
    const civil =
      input.civilDate?.trim() ||
      toTreasuryTransferDto(current).civilDate;
    const now = new Date();

    const updated = await runInTransaction(async (tx) => {
      const patch: Parameters<TreasuryTransferRepository["update"]>[1] = {
        status: nextStatus,
        updatedByUserId: actor.userId,
        expectedVersion: input.expectedVersion,
        memo: input.memo === undefined ? undefined : input.memo,
      };
      if (kind === "schedule") {
        patch.civilDate = civil;
      }
      if (kind === "send") {
        patch.sentCivilDate = civil;
        patch.sentAt = now;
      }
      if (kind === "receive") {
        patch.receivedCivilDate = civil;
        patch.receivedAt = now;
      }
      if (kind === "reconcile") {
        patch.reconciledCivilDate = civil;
        patch.reconciledAt = now;
      }
      const row = await transferRepo.update(id, patch, tx);
      await writeTreasuryAuditLog(
        tx,
        buildTreasuryUpdatedAudit({
          entityType: "TRANSFER",
          entityId: row.id,
          before: toTreasuryTransferDto(current),
          after: toTreasuryTransferDto(row),
          justification: input.justification ?? `Transição ${kind}.`,
          metadata: {
            transition: kind,
            transferGroupId: row.transferGroupId,
            fundsInTransit: row.status === "SENT",
          },
          actor: actorCtx(actor),
        })
      );
      return row;
    });

    return {
      transfer: toTreasuryTransferDto(updated),
      projectionRecalc: enqueueRecalc(
        actor,
        updated,
        `transfer_${kind}`
      ),
    };
  }

  return {
    async list(actor, query) {
      assertCanView(actor);
      const listed = await transferRepo.list({
        companyCode: query.companyCode,
        status: query.status,
        fromAccountId: query.fromAccountId,
        toAccountId: query.toAccountId,
        from: query.from,
        to: query.to,
        page: query.page,
        pageSize: query.pageSize,
      });
      return {
        items: listed.rows.map(toTreasuryTransferDto),
        pagination: buildTreasuryPaginationMeta({
          page: query.page,
          pageSize: query.pageSize,
          totalRows: listed.total,
        }),
      };
    },

    async getById(actor, id) {
      assertCanView(actor);
      const row = await requireVisibleTransfer(actor, id.trim());
      return toTreasuryTransferDto(row);
    },

    async create(actor, input) {
      assertCanManage(actor);
      assertTreasuryTransferCreateable(input);
      const { from } = await requireOperateBothAccounts(
        actor,
        input.fromAccountId,
        input.toAccountId
      );
      const status = input.status ?? "FORECAST";
      if (status !== "FORECAST" && status !== "SCHEDULED") {
        throw new TreasuryDomainError(
          "VALIDATION_ERROR",
          "Status inicial deve ser FORECAST ou SCHEDULED.",
          "status"
        );
      }

      const created = await runInTransaction(async (tx) => {
        const row = await transferRepo.create(
          {
            transferGroupId: randomUUID(),
            companyCode: from.companyCode,
            fromAccountId: input.fromAccountId,
            toAccountId: input.toAccountId,
            amount: input.amount,
            civilDate: input.civilDate,
            status,
            memo: input.memo,
            createdByUserId: actor.userId,
          },
          tx
        );
        await writeTreasuryAuditLog(
          tx,
          buildTreasuryCreatedAudit({
            entityType: "TRANSFER",
            entityId: row.id,
            after: toTreasuryTransferDto(row),
            justification: "Transferência criada.",
            metadata: {
              transferGroupId: row.transferGroupId,
              fromAccountId: row.fromAccountId,
              toAccountId: row.toAccountId,
            },
            actor: actorCtx(actor),
          })
        );
        return row;
      });

      return {
        transfer: toTreasuryTransferDto(created),
        projectionRecalc: enqueueRecalc(actor, created, "transfer_created"),
      };
    },

    schedule: (actor, id, input) => transition(actor, id, input, "schedule"),
    send: (actor, id, input) => transition(actor, id, input, "send"),
    receive: (actor, id, input) => transition(actor, id, input, "receive"),
    reconcile: (actor, id, input) => transition(actor, id, input, "reconcile"),

    async cancel(actor, id, input) {
      assertCanManage(actor);
      const current = await requireVisibleTransfer(actor, id.trim());
      assertTreasuryTransferVersionMatch(current.version, input.expectedVersion);
      assertTreasuryTransferCancellable(current.status);
      await requireOperateBothAccounts(
        actor,
        current.fromAccountId,
        current.toAccountId
      );

      const cancelled = await runInTransaction(async (tx) => {
        const row = await transferRepo.cancel(
          id.trim(),
          {
            cancelledByUserId: actor.userId,
            cancellationReason: input.justification,
            expectedVersion: input.expectedVersion,
          },
          tx
        );
        await writeTreasuryAuditLog(
          tx,
          buildTreasuryUpdatedAudit({
            entityType: "TRANSFER",
            entityId: row.id,
            before: toTreasuryTransferDto(current),
            after: toTreasuryTransferDto(row),
            justification: input.justification,
            metadata: {
              transition: "cancel",
              transferGroupId: row.transferGroupId,
              auditedCancellation: true,
            },
            actor: actorCtx(actor),
          })
        );
        return row;
      });

      return {
        transfer: toTreasuryTransferDto(cancelled),
        projectionRecalc: enqueueRecalc(
          actor,
          cancelled,
          "transfer_cancelled"
        ),
      };
    },
  };
}
