/**
 * Repository de contas financeiras da Tesouraria — server-only (Prisma).
 */

import type {
  Prisma,
  PrismaClient,
  TreasuryAccountAccessLevel,
  TreasuryAccountLiquidity,
  TreasuryBalanceOrigin,
  TreasuryCurrencyCode,
  TreasuryFinancialAccountType,
} from "@prisma/client";
import type {
  TreasuryAccountAccessRow,
  TreasuryAccountRow,
} from "../mappers/treasuryAccountMappers.js";

export type TreasuryAccountDb = PrismaClient | Prisma.TransactionClient;

export type TreasuryAccountListFilter = {
  companyCode?: string | null;
  search?: string | null;
  isActive?: boolean | null;
  accountType?: TreasuryFinancialAccountType | string | null;
  /** Quando setado, restringe a contas com grant ativo para o usuário. */
  accessibleByUserId?: string | null;
  sortBy: "code" | "name" | "createdAt" | "updatedAt" | "sortOrder";
  sortDirection: "asc" | "desc";
  page: number;
  pageSize: number;
};

export type TreasuryAccountCreateData = {
  companyCode: string;
  companyName?: string | null;
  code: string;
  name: string;
  institutionName: string;
  institutionCode?: string | null;
  accountType: TreasuryFinancialAccountType;
  currency: TreasuryCurrencyCode;
  agencyMasked: string;
  accountNumberMasked: string;
  includeInConsolidated: boolean;
  minimumBalance: string;
  allowNegativeBalance: boolean;
  liquidity: TreasuryAccountLiquidity;
  defaultBalanceOrigin: TreasuryBalanceOrigin;
  sortOrder: number;
  nomusBankAccountId?: string | null;
  createdByUserId: string;
};

export type TreasuryAccountUpdateData = {
  name?: string;
  institutionName?: string;
  institutionCode?: string | null;
  accountType?: TreasuryFinancialAccountType;
  agencyMasked?: string;
  accountNumberMasked?: string;
  includeInConsolidated?: boolean;
  minimumBalance?: string;
  allowNegativeBalance?: boolean;
  liquidity?: TreasuryAccountLiquidity;
  defaultBalanceOrigin?: TreasuryBalanceOrigin;
  sortOrder?: number;
  nomusBankAccountId?: string | null;
  companyName?: string | null;
};

export type TreasuryAccountHistoryCounts = {
  snapshotCount: number;
  auditCount: number;
  accessCount: number;
};

export type TreasuryAccountRepository = {
  findById(id: string, db?: TreasuryAccountDb): Promise<TreasuryAccountRow | null>;
  list(
    filter: TreasuryAccountListFilter,
    db?: TreasuryAccountDb
  ): Promise<{ rows: TreasuryAccountRow[]; total: number }>;
  create(
    data: TreasuryAccountCreateData,
    db?: TreasuryAccountDb
  ): Promise<TreasuryAccountRow>;
  /**
   * Optimistic lock por `updatedAt`. Retorna null se versão divergiu.
   */
  updateIfUnchanged(
    id: string,
    expectedUpdatedAt: Date,
    data: TreasuryAccountUpdateData,
    db?: TreasuryAccountDb
  ): Promise<TreasuryAccountRow | null>;
  deactivateIfUnchanged(
    id: string,
    expectedUpdatedAt: Date,
    input: {
      deactivatedByUserId: string;
      deactivationReason: string;
    },
    db?: TreasuryAccountDb
  ): Promise<TreasuryAccountRow | null>;
  reactivateIfUnchanged(
    id: string,
    expectedUpdatedAt: Date,
    db?: TreasuryAccountDb
  ): Promise<TreasuryAccountRow | null>;
  countHistory(
    accountId: string,
    db?: TreasuryAccountDb
  ): Promise<TreasuryAccountHistoryCounts>;
  findAccess(
    accountId: string,
    userId: string,
    db?: TreasuryAccountDb
  ): Promise<TreasuryAccountAccessRow | null>;
  listAccess(
    accountId: string,
    db?: TreasuryAccountDb
  ): Promise<TreasuryAccountAccessRow[]>;
  upsertAccess(
    input: {
      accountId: string;
      userId: string;
      accessLevel: TreasuryAccountAccessLevel;
      canViewBalance: boolean;
      canMutateBalance: boolean;
      grantedByUserId: string | null;
      notes?: string | null;
    },
    db?: TreasuryAccountDb
  ): Promise<TreasuryAccountAccessRow>;
  revokeAccess(
    accountId: string,
    userId: string,
    db?: TreasuryAccountDb
  ): Promise<TreasuryAccountAccessRow | null>;
};

function mapAccount(row: {
  id: string;
  companyCode: string;
  companyName: string | null;
  code: string;
  name: string;
  institutionName: string;
  institutionCode: string | null;
  accountType: string;
  currency: string;
  agencyMasked: string;
  accountNumberMasked: string;
  includeInConsolidated: boolean;
  minimumBalance: { toFixed(d: number): string } | string;
  allowNegativeBalance: boolean;
  liquidity: string;
  defaultBalanceOrigin: string;
  sortOrder: number;
  nomusBankAccountId: string | null;
  isActive: boolean;
  createdByUserId: string;
  createdAt: Date;
  updatedAt: Date;
  deactivatedAt: Date | null;
  deactivatedByUserId: string | null;
  deactivationReason: string | null;
}): TreasuryAccountRow {
  return row as TreasuryAccountRow;
}

function mapAccess(row: {
  id: string;
  accountId: string;
  userId: string;
  accessLevel: string;
  canViewBalance: boolean;
  canMutateBalance: boolean;
  isActive: boolean;
  grantedByUserId: string | null;
  grantedAt: Date;
  revokedAt: Date | null;
  notes: string | null;
}): TreasuryAccountAccessRow {
  return row as TreasuryAccountAccessRow;
}

export function createTreasuryAccountRepository(
  prisma: PrismaClient
): TreasuryAccountRepository {
  const client = (db?: TreasuryAccountDb) => db ?? prisma;

  return {
    async findById(id, db) {
      const row = await client(db).treasuryFinancialAccount.findUnique({
        where: { id },
      });
      return row ? mapAccount(row) : null;
    },

    async list(filter, db) {
      const where: Prisma.TreasuryFinancialAccountWhereInput = {};
      if (filter.companyCode) where.companyCode = filter.companyCode;
      if (filter.isActive != null) where.isActive = filter.isActive;
      if (filter.accountType) {
        where.accountType = filter.accountType as TreasuryFinancialAccountType;
      }
      if (filter.search) {
        const q = filter.search.trim();
        where.OR = [
          { code: { contains: q, mode: "insensitive" } },
          { name: { contains: q, mode: "insensitive" } },
          { institutionName: { contains: q, mode: "insensitive" } },
        ];
      }
      if (filter.accessibleByUserId) {
        where.accessGrants = {
          some: {
            userId: filter.accessibleByUserId,
            isActive: true,
            revokedAt: null,
          },
        };
      }

      const c = client(db);
      const [total, rows] = await Promise.all([
        c.treasuryFinancialAccount.count({ where }),
        c.treasuryFinancialAccount.findMany({
          where,
          orderBy: { [filter.sortBy]: filter.sortDirection },
          skip: (filter.page - 1) * filter.pageSize,
          take: filter.pageSize,
        }),
      ]);
      return { total, rows: rows.map(mapAccount) };
    },

    async create(data, db) {
      const row = await client(db).treasuryFinancialAccount.create({
        data: {
          companyCode: data.companyCode,
          companyName: data.companyName ?? null,
          code: data.code,
          name: data.name,
          institutionName: data.institutionName,
          institutionCode: data.institutionCode ?? null,
          accountType: data.accountType,
          currency: data.currency,
          agencyMasked: data.agencyMasked,
          accountNumberMasked: data.accountNumberMasked,
          includeInConsolidated: data.includeInConsolidated,
          minimumBalance: data.minimumBalance,
          allowNegativeBalance: data.allowNegativeBalance,
          liquidity: data.liquidity,
          defaultBalanceOrigin: data.defaultBalanceOrigin,
          sortOrder: data.sortOrder,
          nomusBankAccountId: data.nomusBankAccountId ?? null,
          createdByUserId: data.createdByUserId,
          isActive: true,
        },
      });
      return mapAccount(row);
    },

    async updateIfUnchanged(id, expectedUpdatedAt, data, db) {
      const result = await client(db).treasuryFinancialAccount.updateMany({
        where: { id, updatedAt: expectedUpdatedAt },
        data: {
          ...(data.name != null ? { name: data.name } : {}),
          ...(data.institutionName != null
            ? { institutionName: data.institutionName }
            : {}),
          ...(data.institutionCode !== undefined
            ? { institutionCode: data.institutionCode }
            : {}),
          ...(data.accountType != null ? { accountType: data.accountType } : {}),
          ...(data.agencyMasked != null
            ? { agencyMasked: data.agencyMasked }
            : {}),
          ...(data.accountNumberMasked != null
            ? { accountNumberMasked: data.accountNumberMasked }
            : {}),
          ...(data.includeInConsolidated != null
            ? { includeInConsolidated: data.includeInConsolidated }
            : {}),
          ...(data.minimumBalance != null
            ? { minimumBalance: data.minimumBalance }
            : {}),
          ...(data.allowNegativeBalance != null
            ? { allowNegativeBalance: data.allowNegativeBalance }
            : {}),
          ...(data.liquidity != null ? { liquidity: data.liquidity } : {}),
          ...(data.defaultBalanceOrigin != null
            ? { defaultBalanceOrigin: data.defaultBalanceOrigin }
            : {}),
          ...(data.sortOrder != null ? { sortOrder: data.sortOrder } : {}),
          ...(data.nomusBankAccountId !== undefined
            ? { nomusBankAccountId: data.nomusBankAccountId }
            : {}),
          ...(data.companyName !== undefined
            ? { companyName: data.companyName }
            : {}),
          updatedAt: new Date(),
        },
      });
      if (result.count === 0) return null;
      return this.findById(id, db);
    },

    async deactivateIfUnchanged(id, expectedUpdatedAt, input, db) {
      const result = await client(db).treasuryFinancialAccount.updateMany({
        where: { id, updatedAt: expectedUpdatedAt, isActive: true },
        data: {
          isActive: false,
          deactivatedAt: new Date(),
          deactivatedByUserId: input.deactivatedByUserId,
          deactivationReason: input.deactivationReason,
          updatedAt: new Date(),
        },
      });
      if (result.count === 0) return null;
      return this.findById(id, db);
    },

    async reactivateIfUnchanged(id, expectedUpdatedAt, db) {
      const result = await client(db).treasuryFinancialAccount.updateMany({
        where: { id, updatedAt: expectedUpdatedAt, isActive: false },
        data: {
          isActive: true,
          deactivatedAt: null,
          deactivatedByUserId: null,
          deactivationReason: null,
          updatedAt: new Date(),
        },
      });
      if (result.count === 0) return null;
      return this.findById(id, db);
    },

    async countHistory(accountId, db) {
      const c = client(db);
      const [snapshotCount, auditCount, accessCount] = await Promise.all([
        c.treasuryBalanceSnapshot.count({ where: { accountId } }),
        c.treasuryAuditLog.count({
          where: { entityType: "FINANCIAL_ACCOUNT", entityId: accountId },
        }),
        c.treasuryFinancialAccountAccess.count({ where: { accountId } }),
      ]);
      return { snapshotCount, auditCount, accessCount };
    },

    async findAccess(accountId, userId, db) {
      const row = await client(db).treasuryFinancialAccountAccess.findUnique({
        where: { accountId_userId: { accountId, userId } },
      });
      return row ? mapAccess(row) : null;
    },

    async listAccess(accountId, db) {
      const rows = await client(db).treasuryFinancialAccountAccess.findMany({
        where: { accountId },
        orderBy: { createdAt: "asc" },
      });
      return rows.map(mapAccess);
    },

    async upsertAccess(input, db) {
      const row = await client(db).treasuryFinancialAccountAccess.upsert({
        where: {
          accountId_userId: {
            accountId: input.accountId,
            userId: input.userId,
          },
        },
        create: {
          accountId: input.accountId,
          userId: input.userId,
          accessLevel: input.accessLevel,
          canViewBalance: input.canViewBalance,
          canMutateBalance: input.canMutateBalance,
          grantedByUserId: input.grantedByUserId,
          notes: input.notes ?? null,
          isActive: true,
          revokedAt: null,
        },
        update: {
          accessLevel: input.accessLevel,
          canViewBalance: input.canViewBalance,
          canMutateBalance: input.canMutateBalance,
          grantedByUserId: input.grantedByUserId,
          notes: input.notes ?? null,
          isActive: true,
          revokedAt: null,
          grantedAt: new Date(),
        },
      });
      return mapAccess(row);
    },

    async revokeAccess(accountId, userId, db) {
      const existing = await this.findAccess(accountId, userId, db);
      if (!existing) return null;
      const row = await client(db).treasuryFinancialAccountAccess.update({
        where: { accountId_userId: { accountId, userId } },
        data: {
          isActive: false,
          revokedAt: new Date(),
        },
      });
      return mapAccess(row);
    },
  };
}
