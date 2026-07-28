/**
 * Caso de uso — programação de pagamentos (CP).
 * Não muta vencimento/saldo oficiais Nomus. Preserva histórico via complemento + audit.
 */

import type { PrismaClient } from "@prisma/client";
import type { AppAuthContext } from "@/src/lib/appAuth.js";
import { toCivilDateKey } from "@/src/lib/financeCivilDate.js";
import type {
  TreasuryPayableHoldInput,
  TreasuryPayableProgramPaymentCancelInput,
  TreasuryPayableProgramPaymentInput,
  TreasuryPayableProgramPaymentUpdateInput,
} from "../contracts/treasurySchemas.js";
import type {
  TreasuryPayableListItemDto,
  TreasuryPayableProgramPaymentResponse,
  TreasuryPayableProgrammingImpactDto,
  TreasuryPayableProgrammingView,
} from "../contracts/treasuryPayableContracts.js";
import type { TreasuryPayableProgrammingStatus } from "../contracts/treasuryEnums.js";
import {
  createTreasuryOfficialTitlesAdapter,
  type TreasuryOfficialTitlesAdapter,
} from "../adapters/treasuryOfficialTitlesAdapter.server.js";
import {
  assertPayableAllowsProgramming,
  assertPayableProgrammingAmountAllowed,
  assertPayableProgrammingVersionMatch,
  computeTreasuryPayableProgrammingImpact,
  hasActiveLocalPayableProgramming,
  resolveTreasuryPayableProgrammingStatus,
} from "../domain/treasuryPayableProgrammingRules.js";
import { TreasuryDomainError } from "../domain/treasuryErrors.js";
import {
  toTreasuryPayableComplementView,
  toTreasuryPayableListItemDto,
} from "../mappers/treasuryPayableQueryMappers.js";
import {
  toTreasuryTitleOperationalComplementDto,
  type TreasuryTitleOperationalComplementRow,
} from "../mappers/treasuryTitleOperationalComplementMappers.js";
import {
  createTreasuryAccountRepository,
  type TreasuryAccountRepository,
} from "../repositories/treasuryAccountRepository.server.js";
import {
  createTreasuryBalanceRepository,
  type TreasuryBalanceRepository,
} from "../repositories/treasuryBalanceRepository.server.js";
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
  addTreasuryMoney,
  normalizeTreasuryMoneyString,
} from "../treasuryMoney.js";
import {
  writeTreasuryAuditLog,
  type TreasuryAuditDb,
} from "./treasuryAuditService.server.js";
import {
  requestTreasuryProjectionRecalc,
  type TreasuryProjectionRecalcResult,
} from "./treasuryProjectionRecalc.server.js";

export type TreasuryPayableProgrammingActor = {
  userId: string;
  userName?: string | null;
  role: string;
  sessionId?: string | null;
  requestId?: string | null;
  isSuperAdmin: boolean;
  canProgramPayables: boolean;
};

export function buildTreasuryPayableProgrammingActor(
  user: AppAuthContext,
  requestId?: string
): TreasuryPayableProgrammingActor {
  return {
    userId: user.id,
    userName: user.name,
    role: user.role,
    sessionId: user.sessionId,
    requestId: requestId ?? null,
    isSuperAdmin: user.role === "SUPER_ADMIN",
    canProgramPayables: canTreasuryCapability(user, "programPayables"),
  };
}

function assertCanProgram(actor: TreasuryPayableProgrammingActor) {
  if (!actor.canProgramPayables && !actor.isSuperAdmin) {
    throw new TreasuryDomainError(
      "FORBIDDEN",
      "Sem permissão para programar pagamentos."
    );
  }
}

function actorCtx(actor: TreasuryPayableProgrammingActor) {
  return {
    userId: actor.userId,
    userName: actor.userName ?? null,
    sessionId: actor.sessionId ?? null,
    requestId: actor.requestId ?? null,
  };
}

function moneyFromBalance(
  value: { toFixed(digits: number): string } | string | number | null | undefined
): string {
  if (value == null || value === "") return "0.00";
  if (typeof value === "string") return normalizeTreasuryMoneyString(value);
  if (typeof value === "number") {
    return normalizeTreasuryMoneyString(value.toFixed(2));
  }
  return normalizeTreasuryMoneyString(value.toFixed(2));
}

function toProgrammingView(
  row: TreasuryTitleOperationalComplementRow
): TreasuryPayableProgrammingView {
  const scheduledDate = toCivilDateKey(row.scheduledDate);
  const scheduledAmount =
    row.scheduledAmount == null || row.scheduledAmount === ""
      ? null
      : typeof row.scheduledAmount === "string"
        ? normalizeTreasuryMoneyString(row.scheduledAmount)
        : normalizeTreasuryMoneyString(row.scheduledAmount.toFixed(2));
  if (!scheduledDate || !scheduledAmount || !row.plannedAccountId) {
    throw new TreasuryDomainError(
      "CONFLICT",
      "Programação incompleta no complemento operacional.",
      "titleId"
    );
  }
  return {
    scheduledDate,
    scheduledAmount,
    plannedAccountId: row.plannedAccountId,
    priority: row.priority,
    responsibleUserId: row.responsibleUserId,
    status: resolveTreasuryPayableProgrammingStatus(row.nextAction),
    justification: row.reason,
    version: row.version,
  };
}

export type TreasuryPayableProgrammingMutationResult =
  TreasuryPayableProgramPaymentResponse & {
    projectionRecalc: TreasuryProjectionRecalcResult;
  };

export type TreasuryPayableProgrammingService = {
  programPayment(
    actor: TreasuryPayableProgrammingActor,
    titleId: string,
    input: TreasuryPayableProgramPaymentInput
  ): Promise<TreasuryPayableProgrammingMutationResult>;
  updateProgramPayment(
    actor: TreasuryPayableProgrammingActor,
    titleId: string,
    input: TreasuryPayableProgramPaymentUpdateInput
  ): Promise<TreasuryPayableProgrammingMutationResult>;
  cancelProgramPayment(
    actor: TreasuryPayableProgrammingActor,
    titleId: string,
    input: TreasuryPayableProgramPaymentCancelInput
  ): Promise<{
    payable: TreasuryPayableListItemDto;
    impact: TreasuryPayableProgrammingImpactDto | null;
    projectionRecalc: TreasuryProjectionRecalcResult;
  }>;
  holdPayable(
    actor: TreasuryPayableProgrammingActor,
    titleId: string,
    input: TreasuryPayableHoldInput
  ): Promise<{
    payable: TreasuryPayableListItemDto;
    projectionRecalc: TreasuryProjectionRecalcResult;
  }>;
  releaseHoldPayable(
    actor: TreasuryPayableProgrammingActor,
    titleId: string,
    input: TreasuryPayableHoldInput
  ): Promise<{
    payable: TreasuryPayableListItemDto;
    projectionRecalc: TreasuryProjectionRecalcResult;
  }>;
};

export function createTreasuryPayableProgrammingService(deps: {
  prisma?: PrismaClient;
  officialAdapter?: TreasuryOfficialTitlesAdapter;
  complementRepository?: TreasuryTitleOperationalComplementRepository;
  accountRepository?: TreasuryAccountRepository;
  balanceRepository?: TreasuryBalanceRepository;
  runTransaction?: <T>(fn: (tx: TreasuryAuditDb) => Promise<T>) => Promise<T>;
  requestProjectionRecalc?: typeof requestTreasuryProjectionRecalc;
}): TreasuryPayableProgrammingService {
  const prisma = deps.prisma;
  const officialAdapter =
    deps.officialAdapter ?? createTreasuryOfficialTitlesAdapter(prisma!);
  const complementRepo =
    deps.complementRepository ??
    createTreasuryTitleOperationalComplementRepository(prisma!);
  const accountRepo =
    deps.accountRepository ?? createTreasuryAccountRepository(prisma!);
  const balanceRepo =
    deps.balanceRepository ?? createTreasuryBalanceRepository(prisma!);
  const requestProjection =
    deps.requestProjectionRecalc ?? requestTreasuryProjectionRecalc;

  async function runInTransaction<T>(
    fn: (tx: TreasuryAuditDb) => Promise<T>
  ): Promise<T> {
    if (deps.runTransaction) return deps.runTransaction(fn);
    return prisma!.$transaction(async (tx) => fn(tx));
  }

  async function resolveImpact(
    accountId: string,
    scheduledAmount: string
  ): Promise<TreasuryPayableProgrammingImpactDto> {
    const account = await accountRepo.findById(accountId);
    if (!account || !account.isActive) {
      throw new TreasuryDomainError(
        "NOT_FOUND",
        "Conta pagadora não encontrada ou inativa.",
        "plannedAccountId"
      );
    }
    const consolidated = await accountRepo.list({
      isActive: true,
      sortBy: "sortOrder",
      sortDirection: "asc",
      page: 1,
      pageSize: 200,
    });
    const consolidatedIds = consolidated.rows
      .filter((row) => row.includeInConsolidated)
      .map((row) => row.id);
    const idsForLatest = Array.from(
      new Set([accountId, ...consolidatedIds])
    );
    const latestByAccount =
      await balanceRepo.findLatestByAccountIds(idsForLatest);
    const latest = latestByAccount.get(accountId) ?? null;
    const accountBalanceBefore = moneyFromBalance(latest?.availableBalance);

    let consolidatedBalanceBefore = "0.00";
    for (const id of consolidatedIds) {
      const snap = latestByAccount.get(id);
      consolidatedBalanceBefore = addTreasuryMoney(
        consolidatedBalanceBefore,
        moneyFromBalance(snap?.availableBalance)
      );
    }

    return computeTreasuryPayableProgrammingImpact({
      accountId,
      accountBalanceBefore,
      consolidatedBalanceBefore,
      scheduledAmount,
      accountIncludedInConsolidated: account.includeInConsolidated,
    });
  }

  function buildPayable(
    official: Awaited<
      ReturnType<TreasuryOfficialTitlesAdapter["findPayableById"]>
    >,
    row: TreasuryTitleOperationalComplementRow | null
  ): TreasuryPayableListItemDto {
    if (!official) {
      throw new TreasuryDomainError(
        "NOT_FOUND",
        "Título a pagar não encontrado.",
        "titleId"
      );
    }
    return toTreasuryPayableListItemDto({
      official,
      complement: row ? toTreasuryPayableComplementView(row) : null,
    });
  }

  return {
    async programPayment(actor, titleId, input) {
      assertCanProgram(actor);
      const id = titleId.trim();
      if (!id) {
        throw new TreasuryDomainError(
          "REQUIRED_FIELD",
          "titleId é obrigatório.",
          "titleId"
        );
      }

      const official = await officialAdapter.findPayableById(id);
      if (!official) {
        throw new TreasuryDomainError(
          "NOT_FOUND",
          "Título a pagar não encontrado.",
          "titleId"
        );
      }

      const existing = await complementRepo.findByOfficialTitle(
        "PAYABLE",
        official.id
      );
      assertPayableAllowsProgramming(official, existing);
      assertPayableProgrammingVersionMatch({
        expectedVersion: input.expectedVersion,
        actualVersion: existing?.version ?? null,
      });
      if (hasActiveLocalPayableProgramming(existing)) {
        throw new TreasuryDomainError(
          "CONFLICT",
          "Já existe programação ativa. Use PUT para alterar.",
          "titleId"
        );
      }
      assertPayableProgrammingAmountAllowed({
        scheduledAmount: input.scheduledAmount,
        openBalance: official.openBalance,
        justification: input.justification,
      });

      const impact = await resolveImpact(
        input.plannedAccountId,
        input.scheduledAmount
      );

      const saved = await runInTransaction(async (tx) => {
        let row: TreasuryTitleOperationalComplementRow;
        if (!existing) {
          row = await complementRepo.create(
            {
              titleType: "PAYABLE",
              officialTitleId: official.id,
              officialExternalId: official.externalId,
              scheduledDate: input.scheduledDate,
              scheduledAmount: input.scheduledAmount,
              plannedAccountId: input.plannedAccountId,
              responsibleUserId: input.responsibleUserId,
              priority: input.priority,
              nextAction: input.status,
              reason: input.justification,
              notes: input.notes,
              createdByUserId: actor.userId,
            },
            tx
          );
          await writeTreasuryAuditLog(
            tx,
            buildTreasuryCreatedAudit({
              entityType: "PAYMENT_SCHEDULE",
              entityId: row.id,
              after: {
                ...toTreasuryTitleOperationalComplementDto(row),
                programmingStatus: input.status,
                impact,
              },
              justification: input.justification,
              metadata: {
                titleId: official.id,
                titleType: "PAYABLE",
                officialDueDate: official.dueDate,
                action: "program_payment",
              },
              actor: actorCtx(actor),
            })
          );
        } else {
          const beforeDto = toTreasuryTitleOperationalComplementDto(existing);
          row = await complementRepo.update(
            existing.id,
            {
              scheduledDate: input.scheduledDate,
              scheduledAmount: input.scheduledAmount,
              plannedAccountId: input.plannedAccountId,
              responsibleUserId: input.responsibleUserId,
              priority: input.priority,
              nextAction: input.status,
              reason: input.justification,
              notes: input.notes,
              updatedByUserId: actor.userId,
              expectedVersion: input.expectedVersion,
            },
            tx
          );
          await writeTreasuryAuditLog(
            tx,
            buildTreasuryUpdatedAudit({
              entityType: "PAYMENT_SCHEDULE",
              entityId: row.id,
              before: beforeDto,
              after: {
                ...toTreasuryTitleOperationalComplementDto(row),
                programmingStatus: input.status,
                impact,
              },
              justification: input.justification,
              metadata: {
                titleId: official.id,
                titleType: "PAYABLE",
                officialDueDate: official.dueDate,
                action: "program_payment",
              },
              actor: actorCtx(actor),
            })
          );
        }
        return row;
      });

      const programming = toProgrammingView(saved);
      const payable = buildPayable(official, saved);
      const projectionRecalc = requestProjection({
        reason: "payable_payment_programmed",
        titleId: official.id,
        titleType: "PAYABLE",
        expectedDate: toCivilDateKey(saved.expectedDate),
        scheduledDate: programming.scheduledDate,
        projectionLayer:
          programming.status === "AUTHORIZED" ? "CONFIRMED" : "PROBABLE",
        requestId: actor.requestId ?? null,
      });

      return { ok: true, payable, programming, impact, projectionRecalc };
    },

    async updateProgramPayment(actor, titleId, input) {
      assertCanProgram(actor);
      const id = titleId.trim();
      if (!id) {
        throw new TreasuryDomainError(
          "REQUIRED_FIELD",
          "titleId é obrigatório.",
          "titleId"
        );
      }

      const official = await officialAdapter.findPayableById(id);
      if (!official) {
        throw new TreasuryDomainError(
          "NOT_FOUND",
          "Título a pagar não encontrado.",
          "titleId"
        );
      }

      const existing = await complementRepo.findByOfficialTitle(
        "PAYABLE",
        official.id
      );
      assertPayableAllowsProgramming(official, existing);
      if (!hasActiveLocalPayableProgramming(existing)) {
        throw new TreasuryDomainError(
          "NOT_FOUND",
          "Não há programação ativa para alterar.",
          "titleId"
        );
      }
      assertPayableProgrammingVersionMatch({
        expectedVersion: input.expectedVersion,
        actualVersion: existing!.version,
      });

      const currentView = toProgrammingView(existing!);
      const nextAmount = input.scheduledAmount ?? currentView.scheduledAmount;
      const nextAccountId =
        input.plannedAccountId ?? currentView.plannedAccountId;
      const nextStatus: TreasuryPayableProgrammingStatus =
        input.status ?? currentView.status;
      const nextDate = input.scheduledDate ?? currentView.scheduledDate;
      const nextPriority = input.priority ?? currentView.priority;
      const nextResponsible =
        input.responsibleUserId === undefined
          ? currentView.responsibleUserId
          : input.responsibleUserId;

      assertPayableProgrammingAmountAllowed({
        scheduledAmount: nextAmount,
        openBalance: official.openBalance,
        justification: input.justification,
      });

      const impact = await resolveImpact(nextAccountId, nextAmount);
      const beforeDto = toTreasuryTitleOperationalComplementDto(existing!);

      const saved = await runInTransaction(async (tx) => {
        const row = await complementRepo.update(
          existing!.id,
          {
            scheduledDate: nextDate,
            scheduledAmount: nextAmount,
            plannedAccountId: nextAccountId,
            responsibleUserId: nextResponsible,
            priority: nextPriority,
            nextAction: nextStatus,
            reason: input.justification,
            notes: input.notes,
            updatedByUserId: actor.userId,
            expectedVersion: input.expectedVersion,
          },
          tx
        );
        await writeTreasuryAuditLog(
          tx,
          buildTreasuryUpdatedAudit({
            entityType: "PAYMENT_SCHEDULE",
            entityId: row.id,
            before: beforeDto,
            after: {
              ...toTreasuryTitleOperationalComplementDto(row),
              programmingStatus: nextStatus,
              impact,
            },
            justification: input.justification,
            metadata: {
              titleId: official.id,
              titleType: "PAYABLE",
              officialDueDate: official.dueDate,
              action: "update_program_payment",
            },
            actor: actorCtx(actor),
          })
        );
        return row;
      });

      const programming = toProgrammingView(saved);
      const payable = buildPayable(official, saved);
      const projectionRecalc = requestProjection({
        reason: "payable_payment_programming_updated",
        titleId: official.id,
        titleType: "PAYABLE",
        expectedDate: toCivilDateKey(saved.expectedDate),
        scheduledDate: programming.scheduledDate,
        projectionLayer:
          programming.status === "AUTHORIZED" ? "CONFIRMED" : "PROBABLE",
        requestId: actor.requestId ?? null,
      });

      return { ok: true, payable, programming, impact, projectionRecalc };
    },

    async cancelProgramPayment(actor, titleId, input) {
      assertCanProgram(actor);
      const id = titleId.trim();
      if (!id) {
        throw new TreasuryDomainError(
          "REQUIRED_FIELD",
          "titleId é obrigatório.",
          "titleId"
        );
      }

      const official = await officialAdapter.findPayableById(id);
      if (!official) {
        throw new TreasuryDomainError(
          "NOT_FOUND",
          "Título a pagar não encontrado.",
          "titleId"
        );
      }

      const existing = await complementRepo.findByOfficialTitle(
        "PAYABLE",
        official.id
      );
      if (!hasActiveLocalPayableProgramming(existing)) {
        throw new TreasuryDomainError(
          "NOT_FOUND",
          "Não há programação ativa para cancelar.",
          "titleId"
        );
      }
      assertPayableProgrammingVersionMatch({
        expectedVersion: input.expectedVersion,
        actualVersion: existing!.version,
      });

      const currentView = toProgrammingView(existing!);
      const impact = await resolveImpact(
        currentView.plannedAccountId,
        currentView.scheduledAmount
      );
      const beforeDto = toTreasuryTitleOperationalComplementDto(existing!);

      const saved = await runInTransaction(async (tx) => {
        const row = await complementRepo.update(
          existing!.id,
          {
            scheduledDate: null,
            scheduledAmount: null,
            nextAction: null,
            reason: input.reason,
            updatedByUserId: actor.userId,
            expectedVersion: input.expectedVersion,
          },
          tx
        );
        await writeTreasuryAuditLog(
          tx,
          buildTreasuryUpdatedAudit({
            entityType: "PAYMENT_SCHEDULE",
            entityId: row.id,
            before: beforeDto,
            after: {
              ...toTreasuryTitleOperationalComplementDto(row),
              programmingStatus: null,
              cancelledProgramming: true,
            },
            justification: input.reason,
            metadata: {
              titleId: official.id,
              titleType: "PAYABLE",
              officialDueDate: official.dueDate,
              action: "cancel_program_payment",
            },
            actor: actorCtx(actor),
          })
        );
        return row;
      });

      const payable = buildPayable(official, saved);
      const projectionRecalc = requestProjection({
        reason: "payable_payment_programming_cancelled",
        titleId: official.id,
        titleType: "PAYABLE",
        expectedDate: toCivilDateKey(saved.expectedDate),
        scheduledDate: null,
        requestId: actor.requestId ?? null,
      });

      return { payable, impact, projectionRecalc };
    },

    async holdPayable(actor, titleId, input) {
      assertCanProgram(actor);
      const id = titleId.trim();
      if (!id) {
        throw new TreasuryDomainError(
          "REQUIRED_FIELD",
          "titleId é obrigatório.",
          "titleId"
        );
      }
      const official = await officialAdapter.findPayableById(id);
      if (!official) {
        throw new TreasuryDomainError(
          "NOT_FOUND",
          "Título a pagar não encontrado.",
          "titleId"
        );
      }
      const existing = await complementRepo.findByOfficialTitle(
        "PAYABLE",
        official.id
      );
      assertPayableAllowsProgramming(official, existing);
      assertPayableProgrammingVersionMatch({
        expectedVersion: input.expectedVersion,
        actualVersion: existing?.version ?? null,
      });
      if (existing?.status === "ON_HOLD") {
        throw new TreasuryDomainError(
          "CONFLICT",
          "Título já está bloqueado (ON_HOLD).",
          "titleId"
        );
      }

      const saved = await runInTransaction(async (tx) => {
        let row: TreasuryTitleOperationalComplementRow;
        if (!existing) {
          row = await complementRepo.create(
            {
              titleType: "PAYABLE",
              officialTitleId: official.id,
              officialExternalId: official.externalId,
              status: "ON_HOLD",
              reason: input.reason,
              notes: input.notes ?? null,
              createdByUserId: actor.userId,
            },
            tx
          );
          await writeTreasuryAuditLog(
            tx,
            buildTreasuryCreatedAudit({
              entityType: "PAYMENT_SCHEDULE",
              entityId: row.id,
              after: toTreasuryTitleOperationalComplementDto(row),
              justification: input.reason,
              metadata: {
                titleId: official.id,
                titleType: "PAYABLE",
                action: "hold_payable",
              },
              actor: actorCtx(actor),
            })
          );
        } else {
          const beforeDto = toTreasuryTitleOperationalComplementDto(existing);
          row = await complementRepo.update(
            existing.id,
            {
              status: "ON_HOLD",
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
              entityType: "PAYMENT_SCHEDULE",
              entityId: row.id,
              before: beforeDto,
              after: toTreasuryTitleOperationalComplementDto(row),
              justification: input.reason,
              metadata: {
                titleId: official.id,
                titleType: "PAYABLE",
                action: "hold_payable",
              },
              actor: actorCtx(actor),
            })
          );
        }
        return row;
      });

      return {
        payable: buildPayable(official, saved),
        projectionRecalc: requestProjection({
          reason: "payable_held",
          titleId: official.id,
          titleType: "PAYABLE",
          expectedDate: toCivilDateKey(saved.expectedDate),
          requestId: actor.requestId ?? null,
        }),
      };
    },

    async releaseHoldPayable(actor, titleId, input) {
      assertCanProgram(actor);
      const id = titleId.trim();
      if (!id) {
        throw new TreasuryDomainError(
          "REQUIRED_FIELD",
          "titleId é obrigatório.",
          "titleId"
        );
      }
      const official = await officialAdapter.findPayableById(id);
      if (!official) {
        throw new TreasuryDomainError(
          "NOT_FOUND",
          "Título a pagar não encontrado.",
          "titleId"
        );
      }
      const existing = await complementRepo.findByOfficialTitle(
        "PAYABLE",
        official.id
      );
      if (!existing || existing.status !== "ON_HOLD") {
        throw new TreasuryDomainError(
          "CONFLICT",
          "Título não está bloqueado.",
          "titleId"
        );
      }
      assertPayableProgrammingVersionMatch({
        expectedVersion: input.expectedVersion,
        actualVersion: existing.version,
      });
      const beforeDto = toTreasuryTitleOperationalComplementDto(existing);
      const saved = await runInTransaction(async (tx) => {
        const row = await complementRepo.update(
          existing.id,
          {
            status: "ACTIVE",
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
            entityType: "PAYMENT_SCHEDULE",
            entityId: row.id,
            before: beforeDto,
            after: toTreasuryTitleOperationalComplementDto(row),
            justification: input.reason,
            metadata: {
              titleId: official.id,
              titleType: "PAYABLE",
              action: "release_hold_payable",
            },
            actor: actorCtx(actor),
          })
        );
        return row;
      });
      return {
        payable: buildPayable(official, saved),
        projectionRecalc: requestProjection({
          reason: "payable_hold_released",
          titleId: official.id,
          titleType: "PAYABLE",
          expectedDate: toCivilDateKey(saved.expectedDate),
          requestId: actor.requestId ?? null,
        }),
      };
    },
  };
}
