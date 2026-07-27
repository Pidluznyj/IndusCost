/**
 * Caso de uso — alterar expectativa operacional de CR.
 * Não muta vencimento/saldo/cliente oficiais Nomus.
 */

import type { PrismaClient } from "@prisma/client";
import type { AppAuthContext } from "@/src/lib/appAuth.js";
import { toCivilDateKey } from "@/src/lib/financeCivilDate.js";
import type { TreasuryReceivableExpectationInput } from "../contracts/treasurySchemas.js";
import type { TreasuryReceivableListItemDto } from "../contracts/treasuryReceivableContracts.js";
import {
  assertExpectationDateChangeJustified,
  assertExpectationVersionMatch,
  assertReceivableHasOpenBalanceForExpectation,
  assertReceivableNotCancelledForExpectation,
} from "../domain/treasuryReceivableExpectationRules.js";
import { TreasuryDomainError } from "../domain/treasuryErrors.js";
import {
  createTreasuryOfficialTitlesAdapter,
  type TreasuryOfficialTitlesAdapter,
} from "../adapters/treasuryOfficialTitlesAdapter.server.js";
import {
  toTreasuryReceivableComplementView,
  toTreasuryReceivableListItemDto,
} from "../mappers/treasuryReceivableQueryMappers.js";
import {
  toTreasuryTitleOperationalComplementDto,
  type TreasuryTitleOperationalComplementRow,
} from "../mappers/treasuryTitleOperationalComplementMappers.js";
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
import {
  requestTreasuryProjectionRecalc,
  type TreasuryProjectionRecalcResult,
} from "./treasuryProjectionRecalc.server.js";

export type TreasuryReceivableExpectationActor = {
  userId: string;
  userName?: string | null;
  role: string;
  sessionId?: string | null;
  requestId?: string | null;
  isSuperAdmin: boolean;
  canManageReceivables: boolean;
};

export function buildTreasuryReceivableExpectationActor(
  user: AppAuthContext,
  requestId?: string
): TreasuryReceivableExpectationActor {
  return {
    userId: user.id,
    userName: user.name,
    role: user.role,
    sessionId: user.sessionId,
    requestId: requestId ?? null,
    isSuperAdmin: user.role === "SUPER_ADMIN",
    canManageReceivables: canTreasuryCapability(user, "manageReceivables"),
  };
}

export type TreasuryReceivableExpectationResult = {
  receivable: TreasuryReceivableListItemDto;
  projectionRecalc: TreasuryProjectionRecalcResult;
};

export type TreasuryReceivableExpectationService = {
  putExpectation(
    actor: TreasuryReceivableExpectationActor,
    titleId: string,
    input: TreasuryReceivableExpectationInput
  ): Promise<TreasuryReceivableExpectationResult>;
};

function assertCanManage(actor: TreasuryReceivableExpectationActor) {
  if (!actor.canManageReceivables && !actor.isSuperAdmin) {
    throw new TreasuryDomainError(
      "FORBIDDEN",
      "Sem permissão para alterar expectativa operacional de contas a receber."
    );
  }
}

function actorCtx(actor: TreasuryReceivableExpectationActor) {
  return {
    userId: actor.userId,
    userName: actor.userName ?? null,
    sessionId: actor.sessionId ?? null,
    requestId: actor.requestId ?? null,
  };
}

function resolveNextPriority(
  input: TreasuryReceivableExpectationInput,
  current: TreasuryTitleOperationalComplementRow | null
): NonNullable<TreasuryTitleOperationalComplementRow["priority"]> {
  if (input.priority === undefined) {
    return current?.priority ?? "NORMAL";
  }
  return input.priority ?? "NORMAL";
}

export function createTreasuryReceivableExpectationService(deps: {
  prisma?: PrismaClient;
  officialAdapter?: TreasuryOfficialTitlesAdapter;
  complementRepository?: TreasuryTitleOperationalComplementRepository;
  runTransaction?: <T>(fn: (tx: TreasuryAuditDb) => Promise<T>) => Promise<T>;
  requestProjectionRecalc?: typeof requestTreasuryProjectionRecalc;
}): TreasuryReceivableExpectationService {
  const prisma = deps.prisma;
  const officialAdapter =
    deps.officialAdapter ??
    createTreasuryOfficialTitlesAdapter(prisma!);
  const complementRepo =
    deps.complementRepository ??
    createTreasuryTitleOperationalComplementRepository(prisma!);
  const requestProjection =
    deps.requestProjectionRecalc ?? requestTreasuryProjectionRecalc;

  async function runInTransaction<T>(
    fn: (tx: TreasuryAuditDb) => Promise<T>
  ): Promise<T> {
    if (deps.runTransaction) return deps.runTransaction(fn);
    return prisma!.$transaction(async (tx) => fn(tx));
  }

  return {
    async putExpectation(actor, titleId, input) {
      assertCanManage(actor);
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

      const existing = await complementRepo.findByOfficialTitle(
        "RECEIVABLE",
        official.id
      );

      assertReceivableNotCancelledForExpectation(official, existing);
      assertReceivableHasOpenBalanceForExpectation(official);
      assertExpectationVersionMatch({
        expectedVersion: input.expectedVersion,
        actualVersion: existing?.version ?? null,
      });

      const previousExpectedDate = existing
        ? toCivilDateKey(existing.expectedDate)
        : null;
      assertExpectationDateChangeJustified({
        previousExpectedDate,
        nextExpectedDate: input.expectedDate,
        reason: input.reason,
      });

      const saved = await runInTransaction(async (tx) => {
        let row: TreasuryTitleOperationalComplementRow;
        const beforeDto = existing
          ? toTreasuryTitleOperationalComplementDto(existing)
          : null;

        if (!existing) {
          row = await complementRepo.create(
            {
              titleType: "RECEIVABLE",
              officialTitleId: official.id,
              officialExternalId: official.externalId,
              expectedDate:
                input.expectedDate === undefined ? null : input.expectedDate,
              plannedAccountId:
                input.plannedAccountId === undefined
                  ? null
                  : input.plannedAccountId,
              responsibleUserId:
                input.responsibleUserId === undefined
                  ? null
                  : input.responsibleUserId,
              priority: resolveNextPriority(input, null),
              nextAction:
                input.nextAction === undefined ? null : input.nextAction,
              reason: input.reason === undefined ? null : input.reason,
              notes: input.notes === undefined ? null : input.notes,
              createdByUserId: actor.userId,
            },
            tx
          );
          await writeTreasuryAuditLog(
            tx,
            buildTreasuryCreatedAudit({
              entityType: "TITLE_OPERATIONAL_COMPLEMENT",
              entityId: row.id,
              after: toTreasuryTitleOperationalComplementDto(row),
              justification: input.reason ?? null,
              metadata: {
                titleId: official.id,
                titleType: "RECEIVABLE",
                officialDueDate: official.dueDate,
              },
              actor: actorCtx(actor),
            })
          );
        } else {
          row = await complementRepo.update(
            existing.id,
            {
              expectedDate: input.expectedDate,
              plannedAccountId: input.plannedAccountId,
              responsibleUserId: input.responsibleUserId,
              priority:
                input.priority === undefined
                  ? undefined
                  : resolveNextPriority(input, existing),
              nextAction: input.nextAction,
              reason: input.reason,
              notes: input.notes,
              updatedByUserId: actor.userId,
              expectedVersion: input.expectedVersion,
            },
            tx
          );
          await writeTreasuryAuditLog(
            tx,
            buildTreasuryUpdatedAudit({
              entityType: "TITLE_OPERATIONAL_COMPLEMENT",
              entityId: row.id,
              before: beforeDto,
              after: toTreasuryTitleOperationalComplementDto(row),
              justification: input.reason ?? null,
              metadata: {
                titleId: official.id,
                titleType: "RECEIVABLE",
                officialDueDate: official.dueDate,
                expectedDateChanged:
                  previousExpectedDate !==
                  (toCivilDateKey(row.expectedDate) ?? null),
              },
              actor: actorCtx(actor),
            })
          );
        }

        return row;
      });

      const complement = toTreasuryReceivableComplementView(saved);
      const receivable = toTreasuryReceivableListItemDto({
        official,
        complement,
      });

      const projectionRecalc = requestProjection({
        reason: "receivable_expectation_updated",
        titleId: official.id,
        titleType: "RECEIVABLE",
        expectedDate: complement.expectedDate,
        requestId: actor.requestId ?? null,
      });

      return { receivable, projectionRecalc };
    },
  };
}
