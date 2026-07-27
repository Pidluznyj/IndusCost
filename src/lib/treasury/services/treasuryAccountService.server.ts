/**
 * Service de contas financeiras da Tesouraria — server-only.
 */

import type { PrismaClient } from "@prisma/client";
import type {
  TreasuryAccountAccessLevel,
  TreasuryAccountLiquidity,
  TreasuryAccountType,
  TreasuryBalanceOrigin,
  TreasuryCurrency,
} from "../contracts/treasuryEnums.js";
import type {
  TreasuryFinancialAccountAccessDto,
  TreasuryFinancialAccountDto,
  TreasuryListResponse,
} from "../contracts/treasuryDto.js";
import {
  buildTreasuryAccessGrantedAudit,
  buildTreasuryCreatedAudit,
  buildTreasuryDeactivatedAudit,
  buildTreasuryUpdatedAudit,
} from "../treasuryAuditHelpers.js";
import {
  assertOptimisticLockMatch,
  assertTreasuryAccountHardDeleteAllowed,
  assertTreasuryTransferAccountsDistinct,
  canRevealTreasuryBankIdentifiers,
  canTreasuryActorAccessAccount,
  canTreasuryActorManageAccount,
  canTreasuryActorViewAllAccounts,
  type TreasuryAccountActor,
} from "../domain/treasuryAccountRules.js";
import { TreasuryDomainError } from "../domain/treasuryErrors.js";
import {
  toTreasuryAccountAuditPayload,
  toTreasuryFinancialAccountAccessDto,
  toTreasuryFinancialAccountDto,
  type TreasuryAccountRow,
} from "../mappers/treasuryAccountMappers.js";
import { normalizeTreasuryMoneyString } from "../treasuryMoney.js";
import {
  createTreasuryAccountRepository,
  type TreasuryAccountRepository,
  type TreasuryAccountUpdateData,
} from "../repositories/treasuryAccountRepository.server.js";
import {
  writeTreasuryAuditLog,
  type TreasuryAuditDb,
} from "./treasuryAuditService.server.js";

export type {
  TreasuryAccountActor,
} from "../domain/treasuryAccountRules.js";

export type TreasuryCreateAccountCommand = {
  companyCode: string;
  companyName?: string | null;
  code: string;
  name: string;
  institutionName: string;
  institutionCode?: string | null;
  accountType: TreasuryAccountType;
  currency?: TreasuryCurrency;
  agencyMasked: string;
  accountNumberMasked: string;
  includeInConsolidated?: boolean;
  minimumBalance?: string;
  allowNegativeBalance?: boolean;
  liquidity?: TreasuryAccountLiquidity;
  defaultBalanceOrigin?: TreasuryBalanceOrigin;
  sortOrder?: number;
  nomusBankAccountId?: string | null;
};

export type TreasuryUpdateAccountCommand = {
  expectedUpdatedAt: Date | string;
  name?: string;
  institutionName?: string;
  institutionCode?: string | null;
  accountType?: TreasuryAccountType;
  agencyMasked?: string;
  accountNumberMasked?: string;
  companyName?: string | null;
  nomusBankAccountId?: string | null;
  allowNegativeBalance?: boolean;
  defaultBalanceOrigin?: TreasuryBalanceOrigin;
  justification?: string | null;
};

export type TreasuryAccountListCommand = {
  companyCode?: string | null;
  search?: string | null;
  isActive?: boolean | null;
  accountType?: TreasuryAccountType | null;
  sortBy?: "code" | "name" | "createdAt" | "updatedAt" | "sortOrder";
  sortDirection?: "asc" | "desc";
  page?: number;
  pageSize?: number;
};

export type TreasuryGrantAccessCommand = {
  userId: string;
  accessLevel: TreasuryAccountAccessLevel;
  canViewBalance?: boolean;
  canMutateBalance?: boolean;
  notes?: string | null;
};

function actorCtx(actor: TreasuryAccountActor) {
  return {
    userId: actor.userId,
    userName: actor.userName ?? null,
    sessionId: actor.sessionId ?? null,
    requestId: actor.requestId ?? null,
  };
}

function parseExpectedUpdatedAt(value: Date | string): Date {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) {
    throw new TreasuryDomainError(
      "VALIDATION_ERROR",
      "expectedUpdatedAt inválido.",
      "expectedUpdatedAt"
    );
  }
  return d;
}

function requireManage(actor: TreasuryAccountActor): void {
  if (canTreasuryActorViewAllAccounts(actor)) return;
  throw new TreasuryDomainError(
    "FORBIDDEN",
    "Sem permissão manage em finance.treasury.accounts."
  );
}

export function createTreasuryAccountService(deps: {
  prisma: PrismaClient;
  repository?: TreasuryAccountRepository;
  /** Override para testes (fake TX). Default: `prisma.$transaction`. */
  runTransaction?: <T>(fn: (tx: TreasuryAuditDb) => Promise<T>) => Promise<T>;
}) {
  const repo = deps.repository ?? createTreasuryAccountRepository(deps.prisma);
  const prisma = deps.prisma;

  async function requireAccessibleAccount(
    actor: TreasuryAccountActor,
    accountId: string
  ): Promise<{
    account: TreasuryAccountRow;
    access: Awaited<ReturnType<TreasuryAccountRepository["findAccess"]>>;
  }> {
    const account = await repo.findById(accountId);
    if (!account) {
      throw new TreasuryDomainError("NOT_FOUND", "Conta financeira não encontrada.");
    }
    const access = await repo.findAccess(accountId, actor.userId);
    if (!canTreasuryActorAccessAccount(actor, access)) {
      throw new TreasuryDomainError(
        "FORBIDDEN",
        "Conta financeira não autorizada para este usuário."
      );
    }
    return { account, access };
  }

  function toDto(
    actor: TreasuryAccountActor,
    account: TreasuryAccountRow,
    access: Awaited<ReturnType<TreasuryAccountRepository["findAccess"]>>
  ): TreasuryFinancialAccountDto {
    return toTreasuryFinancialAccountDto(account, {
      revealBankIdentifiers: canRevealTreasuryBankIdentifiers(actor, access),
    });
  }

  async function runInTransaction<T>(
    fn: (tx: TreasuryAuditDb) => Promise<T>
  ): Promise<T> {
    if (deps.runTransaction) return deps.runTransaction(fn);
    return prisma.$transaction(async (tx) => fn(tx));
  }

  return {
    assertTransferAccountsDistinct: assertTreasuryTransferAccountsDistinct,

    async listAccessibleAccounts(
      actor: TreasuryAccountActor,
      query: TreasuryAccountListCommand = {}
    ): Promise<TreasuryListResponse<TreasuryFinancialAccountDto>> {
      if (!actor.canViewAccounts && !canTreasuryActorViewAllAccounts(actor)) {
        throw new TreasuryDomainError(
          "FORBIDDEN",
          "Sem permissão para listar contas financeiras."
        );
      }
      const page = query.page ?? 1;
      const pageSize = query.pageSize ?? 50;
      const sortBy = query.sortBy ?? "sortOrder";
      const sortDirection = query.sortDirection ?? "asc";
      const { rows, total } = await repo.list({
        companyCode: query.companyCode ?? null,
        search: query.search ?? null,
        isActive: query.isActive ?? null,
        accountType: query.accountType ?? null,
        accessibleByUserId: canTreasuryActorViewAllAccounts(actor)
          ? null
          : actor.userId,
        sortBy,
        sortDirection,
        page,
        pageSize,
      });

      const dtoRows: TreasuryFinancialAccountDto[] = [];
      for (const row of rows) {
        const access = canTreasuryActorViewAllAccounts(actor)
          ? null
          : await repo.findAccess(row.id, actor.userId);
        dtoRows.push(toDto(actor, row, access));
      }

      return {
        ok: true,
        rows: dtoRows,
        pagination: {
          page,
          pageSize,
          totalRows: total,
          totalPages: Math.max(1, Math.ceil(total / pageSize) || 1),
        },
        sortBy,
        sortDirection,
      };
    },

    async getAccount(
      actor: TreasuryAccountActor,
      accountId: string
    ): Promise<TreasuryFinancialAccountDto> {
      const { account, access } = await requireAccessibleAccount(actor, accountId);
      return toDto(actor, account, access);
    },

    async createAccount(
      actor: TreasuryAccountActor,
      command: TreasuryCreateAccountCommand
    ): Promise<TreasuryFinancialAccountDto> {
      requireManage(actor);
      const created = await runInTransaction(async (tx) => {
        const row = await repo.create(
          {
            companyCode: command.companyCode.trim(),
            companyName: command.companyName ?? null,
            code: command.code.trim(),
            name: command.name.trim(),
            institutionName: command.institutionName.trim(),
            institutionCode: command.institutionCode ?? null,
            accountType: command.accountType,
            currency: command.currency ?? "BRL",
            agencyMasked: command.agencyMasked.trim(),
            accountNumberMasked: command.accountNumberMasked.trim(),
            includeInConsolidated: command.includeInConsolidated ?? true,
            minimumBalance: normalizeTreasuryMoneyString(
              command.minimumBalance ?? "0"
            ),
            allowNegativeBalance: command.allowNegativeBalance ?? false,
            liquidity: command.liquidity ?? "IMMEDIATE",
            defaultBalanceOrigin: command.defaultBalanceOrigin ?? "MANUAL",
            sortOrder: command.sortOrder ?? 0,
            nomusBankAccountId: command.nomusBankAccountId ?? null,
            createdByUserId: actor.userId,
          },
          tx
        );
        await writeTreasuryAuditLog(
          tx,
          buildTreasuryCreatedAudit({
            entityType: "FINANCIAL_ACCOUNT",
            entityId: row.id,
            after: toTreasuryAccountAuditPayload(row),
            actor: actorCtx(actor),
          })
        );
        return row;
      });
      return toDto(actor, created, null);
    },

    async updateAccount(
      actor: TreasuryAccountActor,
      accountId: string,
      command: TreasuryUpdateAccountCommand
    ): Promise<TreasuryFinancialAccountDto> {
      const { account, access } = await requireAccessibleAccount(actor, accountId);
      if (!canTreasuryActorManageAccount(actor, access)) {
        throw new TreasuryDomainError(
          "FORBIDDEN",
          "Sem permissão para atualizar esta conta."
        );
      }
      const expected = parseExpectedUpdatedAt(command.expectedUpdatedAt);
      assertOptimisticLockMatch({
        expectedUpdatedAt: expected,
        actualUpdatedAt: account.updatedAt,
      });

      const patch: TreasuryAccountUpdateData = {};
      if (command.name != null) patch.name = command.name.trim();
      if (command.institutionName != null) {
        patch.institutionName = command.institutionName.trim();
      }
      if (command.institutionCode !== undefined) {
        patch.institutionCode = command.institutionCode;
      }
      if (command.accountType != null) patch.accountType = command.accountType;
      if (command.agencyMasked != null) {
        patch.agencyMasked = command.agencyMasked.trim();
      }
      if (command.accountNumberMasked != null) {
        patch.accountNumberMasked = command.accountNumberMasked.trim();
      }
      if (command.companyName !== undefined) patch.companyName = command.companyName;
      if (command.nomusBankAccountId !== undefined) {
        patch.nomusBankAccountId = command.nomusBankAccountId;
      }
      if (command.allowNegativeBalance != null) {
        patch.allowNegativeBalance = command.allowNegativeBalance;
      }
      if (command.defaultBalanceOrigin != null) {
        patch.defaultBalanceOrigin = command.defaultBalanceOrigin;
      }

      const updated = await runInTransaction(async (tx) => {
        const row = await repo.updateIfUnchanged(accountId, expected, patch, tx);
        if (!row) {
          throw new TreasuryDomainError(
            "CONFLICT",
            "Conta foi alterada por outro processo (optimistic lock).",
            "expectedUpdatedAt"
          );
        }
        await writeTreasuryAuditLog(
          tx,
          buildTreasuryUpdatedAudit({
            entityType: "FINANCIAL_ACCOUNT",
            entityId: accountId,
            before: toTreasuryAccountAuditPayload(account),
            after: toTreasuryAccountAuditPayload(row),
            justification: command.justification ?? null,
            actor: actorCtx(actor),
          })
        );
        return row;
      });
      return toDto(actor, updated, access);
    },

    async setMinimumBalance(
      actor: TreasuryAccountActor,
      accountId: string,
      input: { minimumBalance: string; expectedUpdatedAt: Date | string }
    ): Promise<TreasuryFinancialAccountDto> {
      const { account, access } = await requireAccessibleAccount(
        actor,
        accountId
      );
      if (!canTreasuryActorManageAccount(actor, access)) {
        throw new TreasuryDomainError(
          "FORBIDDEN",
          "Sem permissão para configurar saldo mínimo."
        );
      }
      const expected = parseExpectedUpdatedAt(input.expectedUpdatedAt);
      assertOptimisticLockMatch({
        expectedUpdatedAt: expected,
        actualUpdatedAt: account.updatedAt,
      });
      const money = normalizeTreasuryMoneyString(input.minimumBalance);
      const updated = await runInTransaction(async (tx) => {
        const row = await repo.updateIfUnchanged(
          accountId,
          expected,
          { minimumBalance: money },
          tx
        );
        if (!row) {
          throw new TreasuryDomainError(
            "CONFLICT",
            "Conta foi alterada por outro processo (optimistic lock).",
            "expectedUpdatedAt"
          );
        }
        await writeTreasuryAuditLog(
          tx,
          buildTreasuryUpdatedAudit({
            entityType: "FINANCIAL_ACCOUNT",
            entityId: accountId,
            before: toTreasuryAccountAuditPayload(account),
            after: toTreasuryAccountAuditPayload(row),
            metadata: { field: "minimumBalance" },
            justification: "configuração de saldo mínimo",
            actor: actorCtx(actor),
          })
        );
        return row;
      });
      return toDto(actor, updated, access);
    },

    async setLiquidity(
      actor: TreasuryAccountActor,
      accountId: string,
      input: {
        liquidity: TreasuryAccountLiquidity;
        expectedUpdatedAt: Date | string;
      }
    ): Promise<TreasuryFinancialAccountDto> {
      const { account, access } = await requireAccessibleAccount(actor, accountId);
      if (!canTreasuryActorManageAccount(actor, access)) {
        throw new TreasuryDomainError(
          "FORBIDDEN",
          "Sem permissão para configurar liquidez."
        );
      }
      const expected = parseExpectedUpdatedAt(input.expectedUpdatedAt);
      assertOptimisticLockMatch({
        expectedUpdatedAt: expected,
        actualUpdatedAt: account.updatedAt,
      });
      const updated = await runInTransaction(async (tx) => {
        const row = await repo.updateIfUnchanged(
          accountId,
          expected,
          { liquidity: input.liquidity },
          tx
        );
        if (!row) {
          throw new TreasuryDomainError(
            "CONFLICT",
            "Conta foi alterada por outro processo (optimistic lock).",
            "expectedUpdatedAt"
          );
        }
        await writeTreasuryAuditLog(
          tx,
          buildTreasuryUpdatedAudit({
            entityType: "FINANCIAL_ACCOUNT",
            entityId: accountId,
            before: toTreasuryAccountAuditPayload(account),
            after: toTreasuryAccountAuditPayload(row),
            metadata: { field: "liquidity" },
            justification: "configuração de liquidez",
            actor: actorCtx(actor),
          })
        );
        return row;
      });
      return toDto(actor, updated, access);
    },

    async setIncludeInConsolidated(
      actor: TreasuryAccountActor,
      accountId: string,
      input: {
        includeInConsolidated: boolean;
        expectedUpdatedAt: Date | string;
      }
    ): Promise<TreasuryFinancialAccountDto> {
      const { account, access } = await requireAccessibleAccount(actor, accountId);
      if (!canTreasuryActorManageAccount(actor, access)) {
        throw new TreasuryDomainError(
          "FORBIDDEN",
          "Sem permissão para configurar consolidado."
        );
      }
      const expected = parseExpectedUpdatedAt(input.expectedUpdatedAt);
      assertOptimisticLockMatch({
        expectedUpdatedAt: expected,
        actualUpdatedAt: account.updatedAt,
      });
      const updated = await runInTransaction(async (tx) => {
        const row = await repo.updateIfUnchanged(
          accountId,
          expected,
          { includeInConsolidated: input.includeInConsolidated },
          tx
        );
        if (!row) {
          throw new TreasuryDomainError(
            "CONFLICT",
            "Conta foi alterada por outro processo (optimistic lock).",
            "expectedUpdatedAt"
          );
        }
        await writeTreasuryAuditLog(
          tx,
          buildTreasuryUpdatedAudit({
            entityType: "FINANCIAL_ACCOUNT",
            entityId: accountId,
            before: toTreasuryAccountAuditPayload(account),
            after: toTreasuryAccountAuditPayload(row),
            metadata: { field: "includeInConsolidated" },
            justification: "configuração de inclusão no consolidado",
            actor: actorCtx(actor),
          })
        );
        return row;
      });
      return toDto(actor, updated, access);
    },

    async setSortOrder(
      actor: TreasuryAccountActor,
      accountId: string,
      input: { sortOrder: number; expectedUpdatedAt: Date | string }
    ): Promise<TreasuryFinancialAccountDto> {
      const { account, access } = await requireAccessibleAccount(actor, accountId);
      if (!canTreasuryActorManageAccount(actor, access)) {
        throw new TreasuryDomainError(
          "FORBIDDEN",
          "Sem permissão para ordenar contas."
        );
      }
      if (!Number.isInteger(input.sortOrder)) {
        throw new TreasuryDomainError(
          "VALIDATION_ERROR",
          "sortOrder deve ser inteiro.",
          "sortOrder"
        );
      }
      const expected = parseExpectedUpdatedAt(input.expectedUpdatedAt);
      assertOptimisticLockMatch({
        expectedUpdatedAt: expected,
        actualUpdatedAt: account.updatedAt,
      });
      const updated = await runInTransaction(async (tx) => {
        const row = await repo.updateIfUnchanged(
          accountId,
          expected,
          { sortOrder: input.sortOrder },
          tx
        );
        if (!row) {
          throw new TreasuryDomainError(
            "CONFLICT",
            "Conta foi alterada por outro processo (optimistic lock).",
            "expectedUpdatedAt"
          );
        }
        await writeTreasuryAuditLog(
          tx,
          buildTreasuryUpdatedAudit({
            entityType: "FINANCIAL_ACCOUNT",
            entityId: accountId,
            before: toTreasuryAccountAuditPayload(account),
            after: toTreasuryAccountAuditPayload(row),
            metadata: { field: "sortOrder" },
            justification: "reordenação visual",
            actor: actorCtx(actor),
          })
        );
        return row;
      });
      return toDto(actor, updated, access);
    },

    async deactivateAccount(
      actor: TreasuryAccountActor,
      accountId: string,
      input: {
        reason: string;
        expectedUpdatedAt: Date | string;
      }
    ): Promise<TreasuryFinancialAccountDto> {
      requireManage(actor);
      const { account, access } = await requireAccessibleAccount(actor, accountId);
      if (!account.isActive) {
        throw new TreasuryDomainError(
          "CONFLICT",
          "Conta já está desativada."
        );
      }
      const reason = input.reason.trim();
      if (!reason) {
        throw new TreasuryDomainError(
          "REQUIRED_FIELD",
          "Motivo de desativação é obrigatório.",
          "reason"
        );
      }
      const expected = parseExpectedUpdatedAt(input.expectedUpdatedAt);
      assertOptimisticLockMatch({
        expectedUpdatedAt: expected,
        actualUpdatedAt: account.updatedAt,
      });
      const updated = await runInTransaction(async (tx) => {
        const row = await repo.deactivateIfUnchanged(
          accountId,
          expected,
          {
            deactivatedByUserId: actor.userId,
            deactivationReason: reason,
          },
          tx
        );
        if (!row) {
          throw new TreasuryDomainError(
            "CONFLICT",
            "Conta foi alterada por outro processo (optimistic lock).",
            "expectedUpdatedAt"
          );
        }
        await writeTreasuryAuditLog(
          tx,
          buildTreasuryDeactivatedAudit({
            entityType: "FINANCIAL_ACCOUNT",
            entityId: accountId,
            before: toTreasuryAccountAuditPayload(account),
            after: toTreasuryAccountAuditPayload(row),
            justification: reason,
            actor: actorCtx(actor),
          })
        );
        return row;
      });
      return toDto(actor, updated, access);
    },

    async reactivateAccount(
      actor: TreasuryAccountActor,
      accountId: string,
      input: { expectedUpdatedAt: Date | string }
    ): Promise<TreasuryFinancialAccountDto> {
      requireManage(actor);
      const { account, access } = await requireAccessibleAccount(actor, accountId);
      if (account.isActive) {
        throw new TreasuryDomainError("CONFLICT", "Conta já está ativa.");
      }
      const expected = parseExpectedUpdatedAt(input.expectedUpdatedAt);
      assertOptimisticLockMatch({
        expectedUpdatedAt: expected,
        actualUpdatedAt: account.updatedAt,
      });
      const updated = await runInTransaction(async (tx) => {
        const row = await repo.reactivateIfUnchanged(accountId, expected, tx);
        if (!row) {
          throw new TreasuryDomainError(
            "CONFLICT",
            "Conta foi alterada por outro processo (optimistic lock).",
            "expectedUpdatedAt"
          );
        }
        await writeTreasuryAuditLog(
          tx,
          buildTreasuryUpdatedAudit({
            entityType: "FINANCIAL_ACCOUNT",
            entityId: accountId,
            before: toTreasuryAccountAuditPayload(account),
            after: toTreasuryAccountAuditPayload(row),
            metadata: { action: "REACTIVATE" },
            justification: "reativação de conta",
            actor: actorCtx(actor),
          })
        );
        return row;
      });
      return toDto(actor, updated, access);
    },

    /** Exclusão física proibida — especialmente com histórico. */
    async deleteAccount(accountId: string): Promise<never> {
      const history = await repo.countHistory(accountId);
      return assertTreasuryAccountHardDeleteAllowed(history);
    },

    async listAccountAccess(
      actor: TreasuryAccountActor,
      accountId: string
    ): Promise<TreasuryFinancialAccountAccessDto[]> {
      await requireAccessibleAccount(actor, accountId);
      if (!actor.canManageAccounts && !actor.isSuperAdmin && actor.role !== "SUPER_ADMIN") {
        throw new TreasuryDomainError(
          "FORBIDDEN",
          "Sem permissão para listar acessos da conta."
        );
      }
      const rows = await repo.listAccess(accountId);
      return rows.map(toTreasuryFinancialAccountAccessDto);
    },

    async grantAccountAccess(
      actor: TreasuryAccountActor,
      accountId: string,
      command: TreasuryGrantAccessCommand
    ): Promise<TreasuryFinancialAccountAccessDto> {
      requireManage(actor);
      await requireAccessibleAccount(actor, accountId);
      const access = await runInTransaction(async (tx) => {
        const row = await repo.upsertAccess(
          {
            accountId,
            userId: command.userId,
            accessLevel: command.accessLevel,
            canViewBalance: command.canViewBalance ?? true,
            canMutateBalance: command.canMutateBalance ?? false,
            grantedByUserId: actor.userId,
            notes: command.notes ?? null,
          },
          tx
        );
        await writeTreasuryAuditLog(
          tx,
          buildTreasuryAccessGrantedAudit({
            accountId,
            accessId: row.id,
            after: toTreasuryFinancialAccountAccessDto(row),
            actor: actorCtx(actor),
          })
        );
        return row;
      });
      return toTreasuryFinancialAccountAccessDto(access);
    },

    async revokeAccountAccess(
      actor: TreasuryAccountActor,
      accountId: string,
      userId: string
    ): Promise<TreasuryFinancialAccountAccessDto> {
      requireManage(actor);
      await requireAccessibleAccount(actor, accountId);
      const revoked = await runInTransaction(async (tx) => {
        const before = await repo.findAccess(accountId, userId, tx);
        if (!before) {
          throw new TreasuryDomainError(
            "NOT_FOUND",
            "Acesso de usuário na conta não encontrado."
          );
        }
        const row = await repo.revokeAccess(accountId, userId, tx);
        if (!row) {
          throw new TreasuryDomainError(
            "NOT_FOUND",
            "Acesso de usuário na conta não encontrado."
          );
        }
        await writeTreasuryAuditLog(tx, {
          entityType: "ACCOUNT_ACCESS",
          entityId: row.id,
          action: "ACCESS_REVOKE",
          before: toTreasuryFinancialAccountAccessDto(before),
          after: toTreasuryFinancialAccountAccessDto(row),
          metadata: { accountId },
          justification: "revogação de acesso à conta",
          ...actorCtx(actor),
        });
        return row;
      });
      return toTreasuryFinancialAccountAccessDto(revoked);
    },
  };
}

export type TreasuryAccountService = ReturnType<
  typeof createTreasuryAccountService
>;
