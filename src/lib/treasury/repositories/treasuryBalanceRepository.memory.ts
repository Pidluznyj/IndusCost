/**
 * Repository in-memory de snapshots de saldo (testes).
 */

import { randomUUID } from "node:crypto";
import type { TreasuryBalanceSnapshotRow } from "../mappers/treasuryBalanceMappers.js";
import type {
  TreasuryBalanceCreateData,
  TreasuryBalanceListFilter,
  TreasuryBalanceRepository,
} from "./treasuryBalanceRepository.server.js";

export type TreasuryBalanceMemoryStore = {
  snapshots: TreasuryBalanceSnapshotRow[];
};

export function createEmptyTreasuryBalanceMemoryStore(): TreasuryBalanceMemoryStore {
  return { snapshots: [] };
}

function clone(row: TreasuryBalanceSnapshotRow): TreasuryBalanceSnapshotRow {
  return {
    ...row,
    referenceAt: new Date(row.referenceAt),
    createdAt: new Date(row.createdAt),
  };
}

export function createMemoryTreasuryBalanceRepository(
  store: TreasuryBalanceMemoryStore
): TreasuryBalanceRepository {
  return {
    async findByIdempotency(accountId, origin, idempotencyKey) {
      const row = store.snapshots.find(
        (s) =>
          s.accountId === accountId &&
          s.origin === origin &&
          s.idempotencyKey === idempotencyKey
      );
      return row ? clone(row) : null;
    },

    async findLatest(accountId) {
      const rows = store.snapshots
        .filter((s) => s.accountId === accountId)
        .sort((a, b) => {
          const ref = b.referenceAt.getTime() - a.referenceAt.getTime();
          if (ref !== 0) return ref;
          return b.createdAt.getTime() - a.createdAt.getTime();
        });
      return rows[0] ? clone(rows[0]) : null;
    },

    async findLatestByAccountIds(accountIds) {
      const out = new Map<string, TreasuryBalanceSnapshotRow>();
      for (const id of accountIds) {
        const latest = await this.findLatest(id);
        if (latest) out.set(id, latest);
      }
      return out;
    },

    async list(filter: TreasuryBalanceListFilter) {
      let rows = store.snapshots.filter((s) => s.accountId === filter.accountId);
      if (filter.origin) {
        rows = rows.filter((s) => s.origin === filter.origin);
      }
      if (filter.referenceFrom) {
        const from = filter.referenceFrom.getTime();
        rows = rows.filter((s) => s.referenceAt.getTime() >= from);
      }
      if (filter.referenceTo) {
        const to = filter.referenceTo.getTime();
        rows = rows.filter((s) => s.referenceAt.getTime() <= to);
      }
      rows.sort((a, b) => {
        const ref = b.referenceAt.getTime() - a.referenceAt.getTime();
        if (ref !== 0) return ref;
        return b.createdAt.getTime() - a.createdAt.getTime();
      });
      const total = rows.length;
      const start = (filter.page - 1) * filter.pageSize;
      return {
        rows: rows.slice(start, start + filter.pageSize).map(clone),
        total,
      };
    },

    async create(data: TreasuryBalanceCreateData) {
      const existing = store.snapshots.find(
        (s) =>
          s.accountId === data.accountId &&
          s.origin === data.origin &&
          s.idempotencyKey === data.idempotencyKey
      );
      if (existing) {
        const err = new Error("Unique constraint failed") as Error & {
          code?: string;
        };
        err.code = "P2002";
        throw err;
      }
      const row: TreasuryBalanceSnapshotRow = {
        id: randomUUID(),
        accountId: data.accountId,
        referenceAt: new Date(data.referenceAt),
        availableBalance: data.availableBalance,
        blockedBalance: data.blockedBalance,
        investmentsBalance: data.investmentsBalance,
        usedLimit: data.usedLimit,
        origin: data.origin,
        idempotencyKey: data.idempotencyKey,
        notes: data.notes,
        attachmentUrl: data.attachmentUrl,
        createdByUserId: data.createdByUserId,
        previousSnapshotId: data.previousSnapshotId,
        createdAt: new Date(),
      };
      store.snapshots.push(row);
      return clone(row);
    },
  };
}
