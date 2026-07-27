/**
 * Service de snapshots de saldo da Tesouraria — server-only.
 */

import type { PrismaClient } from "@prisma/client";
import type { TreasuryBalanceOrigin } from "../contracts/treasuryEnums.js";
import type {
  TreasuryBalanceSnapshotDto,
  TreasuryListResponse,
} from "../contracts/treasuryDto.js";
import { buildTreasuryPaginationMeta } from "../contracts/treasuryPagination.js";
import { buildTreasuryBalanceSnapshotAudit } from "../treasuryAuditHelpers.js";
import {
  canTreasuryActorMutateAccountBalance,
  canTreasuryActorViewAccountBalance,
  type TreasuryAccountActor,
} from "../domain/treasuryAccountRules.js";
import {
  assertTreasuryIdempotencyKey,
  normalizeTreasuryBalanceComponents,
} from "../domain/treasuryBalanceRules.js";
import { TreasuryDomainError } from "../domain/treasuryErrors.js";
import { toTreasuryBalanceSnapshotDto } from "../mappers/treasuryBalanceMappers.js";
import {
  createTreasuryAccountRepository,
  type TreasuryAccountRepository,
} from "../repositories/treasuryAccountRepository.server.js";
import {
  createTreasuryBalanceRepository,
  type TreasuryBalanceDb,
  type TreasuryBalanceRepository,
} from "../repositories/treasuryBalanceRepository.server.js";
import {
  writeTreasuryAuditLog,
  type TreasuryAuditDb,
} from "./treasuryAuditService.server.js";

type TreasuryBalanceTx = TreasuryAuditDb & TreasuryBalanceDb;

export type TreasuryCreateBalanceSnapshotCommand = {
  referenceAt: Date | string;
  availableBalance: string;
  blockedBalance?: string | null;
  investmentsBalance?: string | null;
  usedLimit?: string | null;
  origin?: TreasuryBalanceOrigin;
  idempotencyKey: string;
  notes?: string | null;
  attachmentUrl?: string | null;
  justification?: string | null;
};

export type TreasuryBalanceListCommand = {
  origin?: TreasuryBalanceOrigin | null;
  from?: string | null;
  to?: string | null;
  page?: number;
  pageSize?: number;
};

export type TreasuryCreateBalanceSnapshotResult = {
  snapshot: TreasuryBalanceSnapshotDto;
  created: boolean;
};

function actorCtx(actor: TreasuryAccountActor) {
  return {
    userId: actor.userId,
    userName: actor.userName ?? null,
    sessionId: actor.sessionId ?? null,
    requestId: actor.requestId ?? null,
  };
}

function parseReferenceAt(value: Date | string): Date {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) {
    throw new TreasuryDomainError(
      "INVALID_TIMESTAMP",
      "referenceAt inválido.",
      "referenceAt"
    );
  }
  return d;
}

function civilRangeBound(civil: string, endOfDay: boolean): Date {
  const [y, m, d] = civil.split("-").map(Number);
  if (endOfDay) {
    return new Date(Date.UTC(y, m - 1, d, 23, 59, 59, 999));
  }
  return new Date(Date.UTC(y, m - 1, d, 0, 0, 0, 0));
}

export function createTreasuryBalanceService(deps: {
  prisma: PrismaClient;
  accountRepository?: TreasuryAccountRepository;
  balanceRepository?: TreasuryBalanceRepository;
  runTransaction?: <T>(fn: (tx: TreasuryBalanceTx) => Promise<T>) => Promise<T>;
}) {
  const accountRepo =
    deps.accountRepository ?? createTreasuryAccountRepository(deps.prisma);
  const balanceRepo =
    deps.balanceRepository ?? createTreasuryBalanceRepository(deps.prisma);
  const prisma = deps.prisma;

  async function requireBalanceReadableAccount(
    actor: TreasuryAccountActor,
    accountId: string
  ) {
    const account = await accountRepo.findById(accountId);
    if (!account) {
      throw new TreasuryDomainError(
        "NOT_FOUND",
        "Conta financeira não encontrada."
      );
    }
    const access = await accountRepo.findAccess(accountId, actor.userId);
    if (!canTreasuryActorViewAccountBalance(actor, access)) {
      throw new TreasuryDomainError(
        "FORBIDDEN",
        "Sem permissão para consultar saldos desta conta."
      );
    }
    return { account, access };
  }

  async function requireBalanceWritableAccount(
    actor: TreasuryAccountActor,
    accountId: string
  ) {
    const account = await accountRepo.findById(accountId);
    if (!account) {
      throw new TreasuryDomainError(
        "NOT_FOUND",
        "Conta financeira não encontrada."
      );
    }
    if (!account.isActive) {
      throw new TreasuryDomainError(
        "CONFLICT",
        "Conta financeira inativa não admite novos saldos."
      );
    }
    const access = await accountRepo.findAccess(accountId, actor.userId);
    if (!canTreasuryActorMutateAccountBalance(actor, access)) {
      throw new TreasuryDomainError(
        "FORBIDDEN",
        "Sem permissão para informar saldo nesta conta."
      );
    }
    return { account, access };
  }

  async function runInTransaction<T>(
    fn: (tx: TreasuryBalanceTx) => Promise<T>
  ): Promise<T> {
    if (deps.runTransaction) return deps.runTransaction(fn);
    return prisma.$transaction(async (tx) => fn(tx as TreasuryBalanceTx));
  }

  return {
    async listBalances(
      actor: TreasuryAccountActor,
      accountId: string,
      query: TreasuryBalanceListCommand = {}
    ): Promise<TreasuryListResponse<TreasuryBalanceSnapshotDto>> {
      await requireBalanceReadableAccount(actor, accountId);
      const page = query.page ?? 1;
      const pageSize = query.pageSize ?? 50;
      const { rows, total } = await balanceRepo.list({
        accountId,
        origin: query.origin ?? null,
        referenceFrom: query.from ? civilRangeBound(query.from, false) : null,
        referenceTo: query.to ? civilRangeBound(query.to, true) : null,
        page,
        pageSize,
      });
      return {
        ok: true,
        rows: rows.map(toTreasuryBalanceSnapshotDto),
        pagination: buildTreasuryPaginationMeta({
          page,
          pageSize,
          totalRows: total,
        }),
        sortBy: "referenceAt",
        sortDirection: "desc",
      };
    },

    async getLatestBalance(
      actor: TreasuryAccountActor,
      accountId: string
    ): Promise<TreasuryBalanceSnapshotDto | null> {
      await requireBalanceReadableAccount(actor, accountId);
      const latest = await balanceRepo.findLatest(accountId);
      return latest ? toTreasuryBalanceSnapshotDto(latest) : null;
    },

    async createBalanceSnapshot(
      actor: TreasuryAccountActor,
      accountId: string,
      command: TreasuryCreateBalanceSnapshotCommand
    ): Promise<TreasuryCreateBalanceSnapshotResult> {
      await requireBalanceWritableAccount(actor, accountId);
      const idempotencyKey = assertTreasuryIdempotencyKey(
        command.idempotencyKey
      );
      const origin = command.origin ?? "MANUAL";
      const existing = await balanceRepo.findByIdempotency(
        accountId,
        origin,
        idempotencyKey
      );
      if (existing) {
        return {
          snapshot: toTreasuryBalanceSnapshotDto(existing),
          created: false,
        };
      }

      const parts = normalizeTreasuryBalanceComponents({
        availableBalance: command.availableBalance,
        blockedBalance: command.blockedBalance,
        investmentsBalance: command.investmentsBalance,
        usedLimit: command.usedLimit,
      });
      const referenceAt = parseReferenceAt(command.referenceAt);
      const previous = await balanceRepo.findLatest(accountId);

      try {
        const created = await runInTransaction(async (tx) => {
          const row = await balanceRepo.create(
            {
              accountId,
              referenceAt,
              availableBalance: parts.availableBalance,
              blockedBalance: parts.blockedBalance,
              investmentsBalance: parts.investmentsBalance,
              usedLimit: parts.usedLimit,
              origin,
              idempotencyKey,
              notes: command.notes ?? null,
              attachmentUrl: command.attachmentUrl ?? null,
              createdByUserId: actor.userId,
              previousSnapshotId: previous?.id ?? null,
            },
            tx
          );
          const dto = toTreasuryBalanceSnapshotDto(row);
          await writeTreasuryAuditLog(
            tx,
            buildTreasuryBalanceSnapshotAudit({
              snapshotId: row.id,
              after: dto,
              actor: actorCtx(actor),
              justification: command.justification ?? "novo saldo informado",
            })
          );
          return dto;
        });
        return { snapshot: created, created: true };
      } catch (err) {
        const code =
          err && typeof err === "object" && "code" in err
            ? String((err as { code?: string }).code)
            : "";
        if (code === "P2002") {
          const raced = await balanceRepo.findByIdempotency(
            accountId,
            origin,
            idempotencyKey
          );
          if (raced) {
            return {
              snapshot: toTreasuryBalanceSnapshotDto(raced),
              created: false,
            };
          }
        }
        throw err;
      }
    },
  };
}

export type TreasuryBalanceService = ReturnType<
  typeof createTreasuryBalanceService
>;
