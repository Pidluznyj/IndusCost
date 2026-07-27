/**
 * Repository in-memory para testes unitários/integração sem DB.
 */

import { randomUUID } from "node:crypto";
import type {
  TreasuryAccountAccessRow,
  TreasuryAccountRow,
} from "../mappers/treasuryAccountMappers.js";
import type {
  TreasuryAccountCreateData,
  TreasuryAccountListFilter,
  TreasuryAccountRepository,
  TreasuryAccountUpdateData,
} from "./treasuryAccountRepository.server.js";

export type TreasuryAccountMemoryStore = {
  accounts: TreasuryAccountRow[];
  access: TreasuryAccountAccessRow[];
  snapshots: Array<{ accountId: string }>;
  audits: Array<{ entityType: string; entityId: string; action: string }>;
};

export function createEmptyTreasuryAccountMemoryStore(): TreasuryAccountMemoryStore {
  return { accounts: [], access: [], snapshots: [], audits: [] };
}

function cloneAccount(row: TreasuryAccountRow): TreasuryAccountRow {
  return {
    ...row,
    createdAt: new Date(row.createdAt),
    updatedAt: new Date(row.updatedAt),
    deactivatedAt: row.deactivatedAt ? new Date(row.deactivatedAt) : null,
  };
}

function cloneAccess(row: TreasuryAccountAccessRow): TreasuryAccountAccessRow {
  return {
    ...row,
    grantedAt: new Date(row.grantedAt),
    revokedAt: row.revokedAt ? new Date(row.revokedAt) : null,
  };
}

export function createMemoryTreasuryAccountRepository(
  store: TreasuryAccountMemoryStore
): TreasuryAccountRepository {
  return {
    async findById(id) {
      const row = store.accounts.find((a) => a.id === id);
      return row ? cloneAccount(row) : null;
    },

    async list(filter: TreasuryAccountListFilter) {
      let rows = [...store.accounts];
      if (filter.companyCode) {
        rows = rows.filter((r) => r.companyCode === filter.companyCode);
      }
      if (filter.isActive != null) {
        rows = rows.filter((r) => r.isActive === filter.isActive);
      }
      if (filter.accountType) {
        rows = rows.filter((r) => r.accountType === filter.accountType);
      }
      if (filter.search) {
        const q = filter.search.toLowerCase();
        rows = rows.filter(
          (r) =>
            r.code.toLowerCase().includes(q) ||
            r.name.toLowerCase().includes(q) ||
            r.institutionName.toLowerCase().includes(q)
        );
      }
      if (filter.accessibleByUserId) {
        const allowed = new Set(
          store.access
            .filter(
              (a) =>
                a.userId === filter.accessibleByUserId &&
                a.isActive &&
                !a.revokedAt
            )
            .map((a) => a.accountId)
        );
        rows = rows.filter((r) => allowed.has(r.id));
      }
      rows.sort((a, b) => {
        const dir = filter.sortDirection === "desc" ? -1 : 1;
        const av = a[filter.sortBy];
        const bv = b[filter.sortBy];
        if (av instanceof Date && bv instanceof Date) {
          return (av.getTime() - bv.getTime()) * dir;
        }
        return String(av).localeCompare(String(bv), "pt-BR") * dir;
      });
      const total = rows.length;
      const start = (filter.page - 1) * filter.pageSize;
      return {
        total,
        rows: rows.slice(start, start + filter.pageSize).map(cloneAccount),
      };
    },

    async create(data: TreasuryAccountCreateData) {
      const now = new Date();
      const row: TreasuryAccountRow = {
        id: randomUUID(),
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
        isActive: true,
        createdByUserId: data.createdByUserId,
        createdAt: now,
        updatedAt: now,
        deactivatedAt: null,
        deactivatedByUserId: null,
        deactivationReason: null,
      };
      store.accounts.push(row);
      return cloneAccount(row);
    },

    async updateIfUnchanged(id, expectedUpdatedAt, data: TreasuryAccountUpdateData) {
      const idx = store.accounts.findIndex((a) => a.id === id);
      if (idx < 0) return null;
      const current = store.accounts[idx];
      if (current.updatedAt.getTime() !== expectedUpdatedAt.getTime()) return null;
      const next: TreasuryAccountRow = {
        ...current,
        ...data,
        updatedAt: new Date(expectedUpdatedAt.getTime() + 1),
      };
      store.accounts[idx] = next;
      return cloneAccount(next);
    },

    async deactivateIfUnchanged(id, expectedUpdatedAt, input) {
      const idx = store.accounts.findIndex((a) => a.id === id);
      if (idx < 0) return null;
      const current = store.accounts[idx];
      if (
        current.updatedAt.getTime() !== expectedUpdatedAt.getTime() ||
        !current.isActive
      ) {
        return null;
      }
      const next: TreasuryAccountRow = {
        ...current,
        isActive: false,
        deactivatedAt: new Date(),
        deactivatedByUserId: input.deactivatedByUserId,
        deactivationReason: input.deactivationReason,
        updatedAt: new Date(expectedUpdatedAt.getTime() + 1),
      };
      store.accounts[idx] = next;
      return cloneAccount(next);
    },

    async reactivateIfUnchanged(id, expectedUpdatedAt) {
      const idx = store.accounts.findIndex((a) => a.id === id);
      if (idx < 0) return null;
      const current = store.accounts[idx];
      if (
        current.updatedAt.getTime() !== expectedUpdatedAt.getTime() ||
        current.isActive
      ) {
        return null;
      }
      const next: TreasuryAccountRow = {
        ...current,
        isActive: true,
        deactivatedAt: null,
        deactivatedByUserId: null,
        deactivationReason: null,
        updatedAt: new Date(expectedUpdatedAt.getTime() + 1),
      };
      store.accounts[idx] = next;
      return cloneAccount(next);
    },

    async countHistory(accountId) {
      return {
        snapshotCount: store.snapshots.filter((s) => s.accountId === accountId)
          .length,
        auditCount: store.audits.filter(
          (a) =>
            a.entityType === "FINANCIAL_ACCOUNT" && a.entityId === accountId
        ).length,
        accessCount: store.access.filter((a) => a.accountId === accountId)
          .length,
      };
    },

    async findAccess(accountId, userId) {
      const row = store.access.find(
        (a) => a.accountId === accountId && a.userId === userId
      );
      return row ? cloneAccess(row) : null;
    },

    async listAccess(accountId) {
      return store.access
        .filter((a) => a.accountId === accountId)
        .map(cloneAccess);
    },

    async upsertAccess(input) {
      const idx = store.access.findIndex(
        (a) => a.accountId === input.accountId && a.userId === input.userId
      );
      const now = new Date();
      if (idx >= 0) {
        const next: TreasuryAccountAccessRow = {
          ...store.access[idx],
          accessLevel: input.accessLevel,
          canViewBalance: input.canViewBalance,
          canMutateBalance: input.canMutateBalance,
          grantedByUserId: input.grantedByUserId,
          notes: input.notes ?? null,
          isActive: true,
          revokedAt: null,
          grantedAt: now,
        };
        store.access[idx] = next;
        return cloneAccess(next);
      }
      const created: TreasuryAccountAccessRow = {
        id: randomUUID(),
        accountId: input.accountId,
        userId: input.userId,
        accessLevel: input.accessLevel,
        canViewBalance: input.canViewBalance,
        canMutateBalance: input.canMutateBalance,
        isActive: true,
        grantedByUserId: input.grantedByUserId,
        grantedAt: now,
        revokedAt: null,
        notes: input.notes ?? null,
      };
      store.access.push(created);
      return cloneAccess(created);
    },

    async revokeAccess(accountId, userId) {
      const idx = store.access.findIndex(
        (a) => a.accountId === accountId && a.userId === userId
      );
      if (idx < 0) return null;
      const next: TreasuryAccountAccessRow = {
        ...store.access[idx],
        isActive: false,
        revokedAt: new Date(),
      };
      store.access[idx] = next;
      return cloneAccess(next);
    },
  };
}
