/**
 * Caso de uso — conciliação bancária (accept / unmatch / reverse).
 * Transacional; audita; solicita recálculo; NÃO muta Nomus / NÃO duplica baixa.
 * Reverse: soft (não exclui), restaura movimentos, exceção se dia fechado.
 */

import type { PrismaClient } from "@prisma/client";
import type { AppAuthContext } from "@/src/lib/appAuth.js";
import { formatTreasuryTimestampIso } from "../contracts/treasuryTimestamp.js";
import type { TreasuryReconciliationMatchDto } from "../contracts/treasuryDto.js";
import type {
  TreasuryReconciliationAcceptInput,
  TreasuryReconciliationReverseInput,
  TreasuryReconciliationUnmatchInput,
} from "../contracts/treasurySchemas.js";
import {
  canTreasuryActorManageAccount,
  type TreasuryAccountAccessSnapshot,
  type TreasuryAccountActor,
} from "../domain/treasuryAccountRules.js";
import { TreasuryDomainError } from "../domain/treasuryErrors.js";
import {
  assertTreasuryReconciliationMatchActive,
  assertTreasuryReconciliationMatchBalanced,
  assertTreasuryReconciliationMatchVersion,
  assertTreasuryReconciliationMovementCapacity,
  assertTreasuryReconciliationReverseConfirmPhrase,
  assertTreasuryReconciliationTitleOpenBalances,
  deriveTreasuryBankMovementReconciliationStatus,
  TREASURY_RECONCILIATION_DOES_NOT_REALIZE_OFFICIAL,
} from "../domain/treasuryReconciliationMatchRules.js";
import { toTreasuryReconciliationMatchDto } from "../mappers/treasuryReconciliationMatchMappers.js";
import type { TreasuryReconciliationMatchRow } from "../mappers/treasuryReconciliationMatchMappers.js";
import {
  createTreasuryAccountRepository,
  type TreasuryAccountRepository,
} from "../repositories/treasuryAccountRepository.server.js";
import {
  createTreasuryReconciliationMatchRepository,
  type TreasuryReconciliationMatchRepository,
} from "../repositories/treasuryReconciliationMatchRepository.server.js";
import {
  buildTreasuryCreatedAudit,
  buildTreasuryReversedAudit,
  buildTreasuryUpdatedAudit,
} from "../treasuryAuditHelpers.js";
import { canTreasuryCapability } from "../treasuryPermissions.js";
import {
  addTreasuryMoney,
  normalizeTreasuryMoneyString,
} from "../treasuryMoney.js";
import {
  writeTreasuryAuditLog,
  type TreasuryAuditDb,
} from "./treasuryAuditService.server.js";
import {
  notifyTreasuryPostClosingFinancialChange,
  type TreasuryPostClosingRecordResult,
} from "./treasuryPostClosingChangeService.server.js";
import {
  requestTreasuryProjectionRecalc,
  type TreasuryProjectionRecalcResult,
} from "./treasuryProjectionRecalc.server.js";

export type TreasuryReconciliationMatchActor = {
  userId: string;
  userName?: string | null;
  role: string;
  sessionId?: string | null;
  requestId?: string | null;
  isSuperAdmin: boolean;
  canViewReconciliation: boolean;
  canManageReconciliation: boolean;
  canReverseReconciliation: boolean;
  canViewAccounts: boolean;
  canManageAccounts: boolean;
};

export function buildTreasuryReconciliationMatchActor(
  user: AppAuthContext,
  requestId?: string
): TreasuryReconciliationMatchActor {
  return {
    userId: user.id,
    userName: user.name,
    role: user.role,
    sessionId: user.sessionId,
    requestId: requestId ?? null,
    isSuperAdmin: user.role === "SUPER_ADMIN",
    canViewReconciliation: canTreasuryCapability(user, "viewReconciliation"),
    canManageReconciliation: canTreasuryCapability(
      user,
      "manageReconciliation"
    ),
    canReverseReconciliation: canTreasuryCapability(
      user,
      "reverseReconciliation"
    ),
    canViewAccounts: canTreasuryCapability(user, "viewAccounts"),
    canManageAccounts: canTreasuryCapability(user, "manageAccounts"),
  };
}

function asAccountActor(
  actor: TreasuryReconciliationMatchActor
): TreasuryAccountActor {
  return {
    userId: actor.userId,
    userName: actor.userName,
    role: actor.role,
    sessionId: actor.sessionId,
    requestId: actor.requestId,
    isSuperAdmin: actor.isSuperAdmin,
    canViewAccounts:
      actor.canViewAccounts || actor.canViewReconciliation,
    canManageAccounts:
      actor.canManageAccounts ||
      actor.canManageReconciliation ||
      actor.canReverseReconciliation,
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

function assertCanView(actor: TreasuryReconciliationMatchActor) {
  if (!actor.canViewReconciliation && !actor.isSuperAdmin) {
    throw new TreasuryDomainError(
      "FORBIDDEN",
      "Sem permissão para consultar conciliação bancária."
    );
  }
}

function assertCanManage(actor: TreasuryReconciliationMatchActor) {
  if (!actor.canManageReconciliation && !actor.isSuperAdmin) {
    throw new TreasuryDomainError(
      "FORBIDDEN",
      "Sem permissão para gerenciar conciliação bancária."
    );
  }
}

function assertCanReverse(actor: TreasuryReconciliationMatchActor) {
  if (
    !actor.canReverseReconciliation &&
    !actor.canManageReconciliation &&
    !actor.isSuperAdmin
  ) {
    throw new TreasuryDomainError(
      "FORBIDDEN",
      "Sem permissão específica para reverter conciliação bancária."
    );
  }
}

function actorCtx(actor: TreasuryReconciliationMatchActor) {
  return {
    userId: actor.userId,
    userName: actor.userName ?? null,
    sessionId: actor.sessionId ?? null,
    requestId: actor.requestId ?? null,
  };
}

export type TreasuryReconciliationMatchService = {
  getById(
    actor: TreasuryReconciliationMatchActor,
    id: string
  ): Promise<TreasuryReconciliationMatchDto>;
  listActiveByBankMovement(
    actor: TreasuryReconciliationMatchActor,
    bankMovementId: string
  ): Promise<TreasuryReconciliationMatchDto[]>;
  accept(
    actor: TreasuryReconciliationMatchActor,
    input: TreasuryReconciliationAcceptInput
  ): Promise<{
    match: TreasuryReconciliationMatchDto;
    projectionRecalc: TreasuryProjectionRecalcResult;
  }>;
  unmatch(
    actor: TreasuryReconciliationMatchActor,
    id: string,
    input: TreasuryReconciliationUnmatchInput
  ): Promise<{
    match: TreasuryReconciliationMatchDto;
    projectionRecalc: TreasuryProjectionRecalcResult;
  }>;
  reverse(
    actor: TreasuryReconciliationMatchActor,
    id: string,
    input: TreasuryReconciliationReverseInput
  ): Promise<{
    match: TreasuryReconciliationMatchDto;
    projectionRecalc: TreasuryProjectionRecalcResult;
    postClosing: TreasuryPostClosingRecordResult | null;
  }>;
};

export function createTreasuryReconciliationMatchService(deps: {
  prisma?: PrismaClient;
  matchRepository?: TreasuryReconciliationMatchRepository;
  accountRepository?: TreasuryAccountRepository;
  runTransaction?: <T>(fn: (tx: TreasuryAuditDb) => Promise<T>) => Promise<T>;
  requestProjectionRecalc?: typeof requestTreasuryProjectionRecalc;
  notifyPostClosing?: typeof notifyTreasuryPostClosingFinancialChange;
}): TreasuryReconciliationMatchService {
  const prisma = deps.prisma;
  const matchRepo =
    deps.matchRepository ??
    createTreasuryReconciliationMatchRepository(prisma!);
  const accountRepo =
    deps.accountRepository ?? createTreasuryAccountRepository(prisma!);
  const requestProjection =
    deps.requestProjectionRecalc ?? requestTreasuryProjectionRecalc;
  const notifyPostClosing =
    deps.notifyPostClosing ?? notifyTreasuryPostClosingFinancialChange;

  async function runInTransaction<T>(
    fn: (tx: TreasuryAuditDb) => Promise<T>
  ): Promise<T> {
    if (deps.runTransaction) return deps.runTransaction(fn);
    return prisma!.$transaction(async (tx) => fn(tx));
  }

  async function requireOperateAccount(
    actor: TreasuryReconciliationMatchActor,
    accountId: string
  ) {
    const account = await accountRepo.findById(accountId);
    if (!account || !account.isActive) {
      throw new TreasuryDomainError(
        "NOT_FOUND",
        "Conta financeira não encontrada.",
        "accountId"
      );
    }
    const access = asAccessSnapshot(
      await accountRepo.findAccess(accountId, actor.userId)
    );
    if (!canTreasuryActorManageAccount(asAccountActor(actor), access)) {
      throw new TreasuryDomainError(
        "FORBIDDEN",
        "Sem autorização operacional na conta financeira.",
        "accountId"
      );
    }
    return account;
  }

  function enqueueRecalc(
    actor: TreasuryReconciliationMatchActor,
    match: TreasuryReconciliationMatchDto,
    reason: string
  ): TreasuryProjectionRecalcResult {
    const titleAlloc = match.allocations.find((a) => a.kind === "TITLE");
    return requestProjection({
      reason,
      titleId: titleAlloc?.officialTitleId ?? match.id,
      titleType:
        titleAlloc?.nomusSide === "AP" ? "PAYABLE" : "RECEIVABLE",
      expectedDate: match.matchedCivilDate,
      companyCode: match.companyCode,
      requestId: actor.requestId ?? null,
    });
  }

  async function restoreMovementsAfterDeactivate(
    current: TreasuryReconciliationMatchRow,
    tx: TreasuryAuditDb
  ): Promise<void> {
    for (const mov of current.movements) {
      const snap = await matchRepo.findMovementSnapshot(
        mov.bankMovementId,
        tx as never
      );
      if (!snap) continue;
      const activeMap = await matchRepo.sumActiveAllocatedByMovementIds(
        [mov.bankMovementId],
        tx as never
      );
      const nextReconciled = activeMap.get(mov.bankMovementId) ?? "0.00";
      const status = deriveTreasuryBankMovementReconciliationStatus({
        amount: snap.amount,
        reconciledAmount: nextReconciled,
        currentStatus:
          snap.reconciliationStatus === "IGNORED" ? "IGNORED" : null,
      });
      await matchRepo.updateMovementReconciliation(
        mov.bankMovementId,
        {
          reconciledAmount: normalizeTreasuryMoneyString(nextReconciled),
          reconciliationStatus: status,
        },
        tx as never
      );
    }
  }

  return {
    async getById(actor, id) {
      assertCanView(actor);
      const row = await matchRepo.findById(id.trim());
      if (!row) {
        throw new TreasuryDomainError(
          "NOT_FOUND",
          "Match de conciliação não encontrado.",
          "id"
        );
      }
      await requireOperateAccount(actor, row.accountId);
      return toTreasuryReconciliationMatchDto(row);
    },

    async listActiveByBankMovement(actor, bankMovementId) {
      assertCanView(actor);
      const snap = await matchRepo.findMovementSnapshot(bankMovementId.trim());
      if (!snap) {
        throw new TreasuryDomainError(
          "NOT_FOUND",
          "Movimento bancário não encontrado.",
          "bankMovementId"
        );
      }
      await requireOperateAccount(actor, snap.accountId);
      const rows = await matchRepo.listActiveByBankMovementId(
        bankMovementId.trim()
      );
      return rows.map(toTreasuryReconciliationMatchDto);
    },

    async accept(actor, input) {
      assertCanManage(actor);
      if (!TREASURY_RECONCILIATION_DOES_NOT_REALIZE_OFFICIAL) {
        throw new TreasuryDomainError(
          "VALIDATION_ERROR",
          "Conciliação bancária não pode realizar baixa oficial."
        );
      }

      const account = await requireOperateAccount(actor, input.accountId.trim());
      if (account.companyCode !== input.companyCode.trim()) {
        throw new TreasuryDomainError(
          "VALIDATION_ERROR",
          "companyCode não confere com a conta.",
          "companyCode"
        );
      }

      const balanced = assertTreasuryReconciliationMatchBalanced({
        movements: input.movements,
        allocations: input.allocations,
      });
      assertTreasuryReconciliationTitleOpenBalances(input.allocations);

      const movementIds = input.movements.map((m) => m.bankMovementId.trim());
      const already =
        await matchRepo.sumActiveAllocatedByMovementIds(movementIds);

      for (const mov of input.movements) {
        const snap = await matchRepo.findMovementSnapshot(
          mov.bankMovementId.trim()
        );
        if (!snap) {
          throw new TreasuryDomainError(
            "NOT_FOUND",
            "Movimento bancário não encontrado.",
            "movements"
          );
        }
        if (snap.accountId !== account.id) {
          throw new TreasuryDomainError(
            "VALIDATION_ERROR",
            "Movimento não pertence à conta do match.",
            "movements"
          );
        }
        if (snap.companyCode !== input.companyCode.trim()) {
          throw new TreasuryDomainError(
            "VALIDATION_ERROR",
            "Movimento de outra empresa.",
            "movements"
          );
        }
        if (snap.reconciliationStatus === "IGNORED") {
          throw new TreasuryDomainError(
            "VALIDATION_ERROR",
            "Movimento ignorado não pode ser conciliado.",
            "movements"
          );
        }
        if (snap.reconciliationStatus === "MATCHED") {
          const used = already.get(snap.id) ?? "0.00";
          if (
            normalizeTreasuryMoneyString(used) ===
            normalizeTreasuryMoneyString(snap.amount)
          ) {
            throw new TreasuryDomainError(
              "VALIDATION_ERROR",
              "Movimento já integralmente conciliado.",
              "movements"
            );
          }
        }
        assertTreasuryReconciliationMovementCapacity({
          movementAmount: snap.amount,
          alreadyReconciledActive: already.get(snap.id) ?? "0.00",
          allocateAmount: mov.amount,
          field: "movements.amount",
        });
      }

      const created = await runInTransaction(async (tx) => {
        const row = await matchRepo.create(
          {
            companyCode: input.companyCode.trim(),
            accountId: account.id,
            status: "MATCHED",
            matchedAmount: balanced.matchedAmount,
            matchedCivilDate: input.matchedCivilDate,
            justification: input.justification,
            suggestionKey: input.suggestionKey,
            algorithmVersion: input.algorithmVersion,
            suggestionScore: input.suggestionScore,
            suggestionConfidence: input.suggestionConfidence,
            suggestionReasonsJson: input.suggestionReasons,
            createdByUserId: actor.userId,
            movements: input.movements.map((m, i) => ({
              bankMovementId: m.bankMovementId.trim(),
              amount: normalizeTreasuryMoneyString(m.amount),
              sortOrder: i,
            })),
            allocations: input.allocations.map((a, i) => ({
              kind: a.kind,
              amount: normalizeTreasuryMoneyString(a.amount),
              memo: a.memo,
              nomusSide: a.nomusSide,
              officialTitleId: a.officialTitleId,
              nomusExternalId: a.nomusExternalId,
              transferId: a.transferId,
              transferGroupId: a.transferGroupId,
              ledgerEntryId: a.ledgerEntryId,
              differenceCode: a.differenceCode,
              sortOrder: i,
            })),
          },
          tx as never
        );

        for (const mov of input.movements) {
          const id = mov.bankMovementId.trim();
          const snap = (await matchRepo.findMovementSnapshot(id, tx as never))!;
          const prevActive = already.get(id) ?? "0.00";
          const nextReconciled = addTreasuryMoney(prevActive, mov.amount);
          const status = deriveTreasuryBankMovementReconciliationStatus({
            amount: snap.amount,
            reconciledAmount: nextReconciled,
          });
          await matchRepo.updateMovementReconciliation(
            id,
            { reconciledAmount: nextReconciled, reconciliationStatus: status },
            tx as never
          );
        }

        const dto = toTreasuryReconciliationMatchDto(row);
        await writeTreasuryAuditLog(
          tx,
          buildTreasuryCreatedAudit({
            entityType: "RECONCILIATION_MATCH",
            entityId: row.id,
            after: dto,
            justification:
              input.justification ?? "Aceite de conciliação bancária.",
            metadata: {
              doesNotRealizeOfficial: true,
              movementIds,
              allocationKinds: input.allocations.map((a) => a.kind),
              matchedAmount: balanced.matchedAmount,
            },
            actor: actorCtx(actor),
          })
        );
        return dto;
      });

      return {
        match: created,
        projectionRecalc: enqueueRecalc(
          actor,
          created,
          "reconciliation_matched"
        ),
      };
    },

    async unmatch(actor, id, input) {
      assertCanManage(actor);
      const current = await matchRepo.findById(id.trim());
      if (!current) {
        throw new TreasuryDomainError(
          "NOT_FOUND",
          "Match de conciliação não encontrado.",
          "id"
        );
      }
      await requireOperateAccount(actor, current.accountId);
      assertTreasuryReconciliationMatchActive(current.status);
      assertTreasuryReconciliationMatchVersion(
        current.version,
        input.expectedVersion
      );

      const before = toTreasuryReconciliationMatchDto(current);

      const updated = await runInTransaction(async (tx) => {
        const row = await matchRepo.unmatch(
          id.trim(),
          {
            unmatchedByUserId: actor.userId,
            unmatchReason: input.reason,
            expectedVersion: input.expectedVersion,
          },
          tx as never
        );

        await restoreMovementsAfterDeactivate(current, tx);

        const dto = toTreasuryReconciliationMatchDto(row);
        await writeTreasuryAuditLog(
          tx,
          buildTreasuryUpdatedAudit({
            entityType: "RECONCILIATION_MATCH",
            entityId: row.id,
            before,
            after: dto,
            justification: input.reason,
            metadata: {
              action: "UNMATCH",
              doesNotRealizeOfficial: true,
            },
            actor: actorCtx(actor),
          })
        );
        return dto;
      });

      return {
        match: updated,
        projectionRecalc: enqueueRecalc(
          actor,
          updated,
          "reconciliation_unmatched"
        ),
      };
    },

    async reverse(actor, id, input) {
      assertCanReverse(actor);
      assertTreasuryReconciliationReverseConfirmPhrase(input.confirmPhrase);
      if (!input.reason.trim()) {
        throw new TreasuryDomainError(
          "VALIDATION_ERROR",
          "Justificativa obrigatória para reversão.",
          "reason"
        );
      }

      const current = await matchRepo.findById(id.trim());
      if (!current) {
        throw new TreasuryDomainError(
          "NOT_FOUND",
          "Match de conciliação não encontrado.",
          "id"
        );
      }
      await requireOperateAccount(actor, current.accountId);
      assertTreasuryReconciliationMatchActive(current.status);
      assertTreasuryReconciliationMatchVersion(
        current.version,
        input.expectedVersion
      );

      const before = toTreasuryReconciliationMatchDto(current);

      const updated = await runInTransaction(async (tx) => {
        const row = await matchRepo.unmatch(
          id.trim(),
          {
            unmatchedByUserId: actor.userId,
            unmatchReason: input.reason.trim(),
            expectedVersion: input.expectedVersion,
          },
          tx as never
        );

        // Alocações permanecem no registro (soft) — só o match fica UNMATCHED.
        await restoreMovementsAfterDeactivate(current, tx);

        const dto = toTreasuryReconciliationMatchDto(row);
        await writeTreasuryAuditLog(
          tx,
          buildTreasuryReversedAudit({
            entityType: "RECONCILIATION_MATCH",
            entityId: row.id,
            before,
            after: dto,
            justification: input.reason.trim(),
            metadata: {
              action: "REVERSE",
              doesNotRealizeOfficial: true,
              allocationsPreserved: true,
              movementIds: current.movements.map((m) => m.bankMovementId),
            },
            actor: actorCtx(actor),
          })
        );
        return dto;
      });

      const projectionRecalc = enqueueRecalc(
        actor,
        updated,
        "reconciliation_reversed"
      );

      const postClosing = await notifyPostClosing(
        {
          companyCode: updated.companyCode,
          civilDate: updated.matchedCivilDate,
          changeKind: "RECONCILIATION_CHANGE",
          entityKind: "RECONCILIATION",
          entityId: updated.id,
          accountId: updated.accountId,
          amount: updated.matchedAmount,
          changedAtIso: formatTreasuryTimestampIso(new Date()),
        },
        { prisma, requestId: actor.requestId ?? null }
      );

      return { match: updated, projectionRecalc, postClosing };
    },
  };
}
