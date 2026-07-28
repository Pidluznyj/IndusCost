/**
 * Caso de uso — lançamentos manuais no ledger local.
 * Create + reverse (sem DELETE); não muta títulos oficiais Nomus.
 */

import type { PrismaClient } from "@prisma/client";
import type { AppAuthContext } from "@/src/lib/appAuth.js";
import type { TreasuryLedgerEntryDto } from "../contracts/treasuryDto.js";
import type { TreasuryManualLedgerEntryInput } from "../contracts/treasurySchemas.js";
import { buildTreasuryPaginationMeta } from "../contracts/treasuryPagination.js";
import {
  canTreasuryActorAccessAccount,
  canTreasuryActorManageAccount,
  type TreasuryAccountAccessSnapshot,
  type TreasuryAccountActor,
} from "../domain/treasuryAccountRules.js";
import { TreasuryDomainError } from "../domain/treasuryErrors.js";
import {
  assertTreasuryManualLedgerCreateable,
  assertTreasuryManualLedgerNotOfficialSettlement,
  assertTreasuryManualLedgerReversible,
  oppositeTreasuryLedgerDirection,
} from "../domain/treasuryManualLedgerRules.js";
import {
  toTreasuryLedgerEntryDto,
  type TreasuryLedgerEntryRow,
} from "../mappers/treasuryLedgerEntryMappers.js";
import {
  createTreasuryAccountRepository,
  type TreasuryAccountRepository,
} from "../repositories/treasuryAccountRepository.server.js";
import {
  createTreasuryDailyClosingRepository,
  type TreasuryDailyClosingRepository,
} from "../repositories/treasuryDailyClosingRepository.server.js";
import {
  createTreasuryLedgerEntryRepository,
  type TreasuryLedgerEntryRepository,
} from "../repositories/treasuryLedgerEntryRepository.server.js";
import {
  buildTreasuryCreatedAudit,
  buildTreasuryReversedAudit,
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

export type TreasuryManualLedgerReverseInput = {
  expectedVersion: number;
  justification: string;
};

export type TreasuryManualLedgerListQuery = {
  companyCode?: string | null;
  accountId?: string | null;
  status?: "ACTIVE" | "REVERSED" | null;
  from?: string | null;
  to?: string | null;
  page: number;
  pageSize: number;
};

export type TreasuryManualLedgerActor = {
  userId: string;
  userName?: string | null;
  role: string;
  sessionId?: string | null;
  requestId?: string | null;
  isSuperAdmin: boolean;
  canViewManualEntries: boolean;
  canManageManualEntries: boolean;
  canViewAccounts: boolean;
  canManageAccounts: boolean;
};

export function buildTreasuryManualLedgerActor(
  user: AppAuthContext,
  requestId?: string
): TreasuryManualLedgerActor {
  return {
    userId: user.id,
    userName: user.name,
    role: user.role,
    sessionId: user.sessionId,
    requestId: requestId ?? null,
    isSuperAdmin: user.role === "SUPER_ADMIN",
    canViewManualEntries: canTreasuryCapability(user, "viewManualEntries"),
    canManageManualEntries: canTreasuryCapability(user, "manageManualEntries"),
    canViewAccounts: canTreasuryCapability(user, "viewAccounts"),
    canManageAccounts: canTreasuryCapability(user, "manageAccounts"),
  };
}

export type TreasuryManualLedgerService = {
  list(
    actor: TreasuryManualLedgerActor,
    query: TreasuryManualLedgerListQuery
  ): Promise<{
    items: TreasuryLedgerEntryDto[];
    pagination: ReturnType<typeof buildTreasuryPaginationMeta>;
  }>;
  getById(
    actor: TreasuryManualLedgerActor,
    id: string
  ): Promise<TreasuryLedgerEntryDto>;
  create(
    actor: TreasuryManualLedgerActor,
    input: TreasuryManualLedgerEntryInput
  ): Promise<{
    entry: TreasuryLedgerEntryDto;
    projectionRecalc: TreasuryProjectionRecalcResult;
  }>;
  reverse(
    actor: TreasuryManualLedgerActor,
    id: string,
    input: TreasuryManualLedgerReverseInput
  ): Promise<{
    entry: TreasuryLedgerEntryDto;
    reversal: TreasuryLedgerEntryDto;
    projectionRecalc: TreasuryProjectionRecalcResult;
  }>;
};

function asAccountActor(actor: TreasuryManualLedgerActor): TreasuryAccountActor {
  return {
    userId: actor.userId,
    userName: actor.userName,
    role: actor.role,
    sessionId: actor.sessionId,
    requestId: actor.requestId,
    isSuperAdmin: actor.isSuperAdmin,
    canViewAccounts: actor.canViewAccounts || actor.canViewManualEntries,
    canManageAccounts: actor.canManageAccounts || actor.canManageManualEntries,
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

export function createTreasuryManualLedgerService(deps: {
  prisma?: PrismaClient;
  ledgerRepository?: TreasuryLedgerEntryRepository;
  accountRepository?: TreasuryAccountRepository;
  closingRepository?: TreasuryDailyClosingRepository;
  runTransaction?: <T>(fn: (tx: TreasuryAuditDb) => Promise<T>) => Promise<T>;
  requestProjectionRecalc?: typeof requestTreasuryProjectionRecalc;
}): TreasuryManualLedgerService {
  const prisma = deps.prisma;
  if (!prisma && !deps.ledgerRepository) {
    throw new Error("prisma ou ledgerRepository é obrigatório.");
  }
  const ledgerRepo =
    deps.ledgerRepository ?? createTreasuryLedgerEntryRepository(prisma!);
  const accountRepo =
    deps.accountRepository ?? createTreasuryAccountRepository(prisma!);
  const closingRepo =
    deps.closingRepository ??
    (prisma ? createTreasuryDailyClosingRepository(prisma) : null);
  const requestRecalc =
    deps.requestProjectionRecalc ?? requestTreasuryProjectionRecalc;

  async function runInTransaction<T>(
    fn: (tx: TreasuryAuditDb) => Promise<T>
  ): Promise<T> {
    if (deps.runTransaction) return deps.runTransaction(fn);
    if (!prisma) return fn({} as TreasuryAuditDb);
    return prisma.$transaction(async (tx) => fn(tx));
  }

  function assertCanView(actor: TreasuryManualLedgerActor) {
    if (!actor.canViewManualEntries && !actor.isSuperAdmin) {
      throw new TreasuryDomainError(
        "FORBIDDEN",
        "Sem permissão para consultar lançamentos manuais."
      );
    }
  }

  function assertCanManage(actor: TreasuryManualLedgerActor) {
    if (!actor.canManageManualEntries && !actor.isSuperAdmin) {
      throw new TreasuryDomainError(
        "FORBIDDEN",
        "Sem permissão para gerenciar lançamentos manuais."
      );
    }
  }

  async function assertAccountAccess(
    actor: TreasuryManualLedgerActor,
    accountId: string,
    mutate: boolean
  ) {
    const account = await accountRepo.findById(accountId);
    if (!account || !account.isActive) {
      throw new TreasuryDomainError("NOT_FOUND", "Conta financeira não encontrada.");
    }
    const access = asAccessSnapshot(
      await accountRepo.findAccess(accountId, actor.userId)
    );
    const accountActor = asAccountActor(actor);
    const ok = mutate
      ? canTreasuryActorManageAccount(accountActor, access)
      : canTreasuryActorAccessAccount(accountActor, access);
    if (!ok) {
      throw new TreasuryDomainError(
        "FORBIDDEN",
        "Sem acesso à conta financeira do lançamento."
      );
    }
    return account;
  }

  async function assertDayOpen(companyCode: string, civilDate: string) {
    if (!closingRepo) return;
    const current = await closingRepo.findCurrent(companyCode, civilDate);
    if (current?.status === "CLOSED") {
      throw new TreasuryDomainError(
        "VALIDATION_ERROR",
        `Dia ${civilDate} está fechado. Reabra o fechamento antes de lançar.`,
        "civilDate"
      );
    }
  }

  function enqueueRecalc(
    actor: TreasuryManualLedgerActor,
    row: TreasuryLedgerEntryRow,
    reason: string
  ): TreasuryProjectionRecalcResult {
    return requestRecalc({
      reason,
      titleId: row.id,
      titleType: "RECEIVABLE",
      expectedDate: toTreasuryLedgerEntryDto(row).civilDate,
      requestId: actor.requestId,
      companyCode: row.companyCode,
      projectionLayer: "MANUAL",
    });
  }

  return {
    async list(actor, query) {
      assertCanView(actor);
      if (query.accountId) {
        await assertAccountAccess(actor, query.accountId, false);
      }
      const listed = await ledgerRepo.list({
        companyCode: query.companyCode,
        accountId: query.accountId,
        status: query.status,
        from: query.from,
        to: query.to,
        page: query.page,
        pageSize: query.pageSize,
      });
      return {
        items: listed.rows.map(toTreasuryLedgerEntryDto),
        pagination: buildTreasuryPaginationMeta({
          page: query.page,
          pageSize: query.pageSize,
          totalRows: listed.total,
        }),
      };
    },

    async getById(actor, id) {
      assertCanView(actor);
      const row = await ledgerRepo.findById(id.trim());
      if (!row) {
        throw new TreasuryDomainError("NOT_FOUND", "Lançamento não encontrado.");
      }
      await assertAccountAccess(actor, row.accountId, false);
      return toTreasuryLedgerEntryDto(row);
    },

    async create(actor, input) {
      assertCanManage(actor);
      const nature = input.nature === "ADJUSTMENT" ? "ADJUSTMENT" : "MANUAL";
      assertTreasuryManualLedgerCreateable({
        amount: input.amount,
        nature,
      });
      assertTreasuryManualLedgerNotOfficialSettlement({
        counterpartRef: input.counterpartRef,
        memo: input.memo,
      });
      const account = await assertAccountAccess(actor, input.accountId, true);
      await assertDayOpen(account.companyCode, input.civilDate);

      const created = await runInTransaction(async (tx) => {
        const row = await ledgerRepo.create(
          {
            companyCode: account.companyCode,
            accountId: input.accountId,
            civilDate: input.civilDate,
            amount: input.amount,
            direction: input.direction,
            nature,
            memo: input.memo,
            counterpartRef: input.counterpartRef,
            createdByUserId: actor.userId,
          },
          tx as never
        );
        await writeTreasuryAuditLog(
          tx,
          buildTreasuryCreatedAudit({
            entityType: "LEDGER_ENTRY",
            entityId: row.id,
            after: toTreasuryLedgerEntryDto(row),
            justification: "Lançamento manual criado.",
            metadata: { accountId: row.accountId, nature },
            actor: {
              userId: actor.userId,
              userName: actor.userName,
              sessionId: actor.sessionId,
              requestId: actor.requestId,
            },
          })
        );
        return row;
      });

      return {
        entry: toTreasuryLedgerEntryDto(created),
        projectionRecalc: enqueueRecalc(actor, created, "manual_ledger_created"),
      };
    },

    async reverse(actor, id, input) {
      assertCanManage(actor);
      if (!input.justification?.trim()) {
        throw new TreasuryDomainError(
          "VALIDATION_ERROR",
          "Justificativa é obrigatória na reversão.",
          "justification"
        );
      }
      const current = await ledgerRepo.findById(id.trim());
      if (!current) {
        throw new TreasuryDomainError("NOT_FOUND", "Lançamento não encontrado.");
      }
      await assertAccountAccess(actor, current.accountId, true);
      assertTreasuryManualLedgerReversible({
        status: current.status,
        nature: current.nature,
        expectedVersion: input.expectedVersion,
        currentVersion: current.version,
      });
      const civilDate = toTreasuryLedgerEntryDto(current).civilDate;
      await assertDayOpen(current.companyCode, civilDate);

      const result = await runInTransaction(async (tx) => {
        const reversal = await ledgerRepo.create(
          {
            companyCode: current.companyCode,
            accountId: current.accountId,
            civilDate,
            amount:
              typeof current.amount === "string"
                ? current.amount
                : current.amount.toFixed(2),
            direction: oppositeTreasuryLedgerDirection(current.direction),
            nature: "REVERSAL",
            memo: `Reversão de ${current.id}: ${input.justification.trim()}`,
            counterpartRef: current.counterpartRef,
            reversesEntryId: current.id,
            createdByUserId: actor.userId,
          },
          tx as never
        );
        const original = await ledgerRepo.markReversed(
          {
            originalId: current.id,
            reversalId: reversal.id,
            expectedVersion: input.expectedVersion,
            updatedByUserId: actor.userId,
          },
          tx as never
        );
        await writeTreasuryAuditLog(
          tx,
          buildTreasuryReversedAudit({
            entityType: "LEDGER_ENTRY",
            entityId: current.id,
            before: toTreasuryLedgerEntryDto(current),
            after: toTreasuryLedgerEntryDto(original),
            justification: input.justification.trim(),
            metadata: { reversalId: reversal.id },
            actor: {
              userId: actor.userId,
              userName: actor.userName,
              sessionId: actor.sessionId,
              requestId: actor.requestId,
            },
          })
        );
        return { original, reversal };
      });

      return {
        entry: toTreasuryLedgerEntryDto(result.original),
        reversal: toTreasuryLedgerEntryDto(result.reversal),
        projectionRecalc: enqueueRecalc(
          actor,
          result.original,
          "manual_ledger_reversed"
        ),
      };
    },
  };
}
