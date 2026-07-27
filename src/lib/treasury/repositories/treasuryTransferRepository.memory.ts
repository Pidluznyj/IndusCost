/**
 * Repository in-memory de transferências — testes.
 */

import { randomUUID } from "node:crypto";
import { TreasuryDomainError } from "../domain/treasuryErrors.js";
import type { TreasuryTransferRow } from "../mappers/treasuryTransferMappers.js";
import type {
  TreasuryTransferCancelData,
  TreasuryTransferCreateData,
  TreasuryTransferListFilter,
  TreasuryTransferRepository,
  TreasuryTransferUpdateData,
} from "./treasuryTransferRepository.server.js";

export type TreasuryTransferMemoryStore = {
  rows: TreasuryTransferRow[];
};

export function createEmptyTreasuryTransferMemoryStore(): TreasuryTransferMemoryStore {
  return { rows: [] };
}

function clone(row: TreasuryTransferRow): TreasuryTransferRow {
  return {
    ...row,
    civilDate: new Date(row.civilDate),
    sentCivilDate: row.sentCivilDate ? new Date(row.sentCivilDate) : null,
    receivedCivilDate: row.receivedCivilDate
      ? new Date(row.receivedCivilDate)
      : null,
    reconciledCivilDate: row.reconciledCivilDate
      ? new Date(row.reconciledCivilDate)
      : null,
    sentAt: row.sentAt ? new Date(row.sentAt) : null,
    receivedAt: row.receivedAt ? new Date(row.receivedAt) : null,
    reconciledAt: row.reconciledAt ? new Date(row.reconciledAt) : null,
    createdAt: new Date(row.createdAt),
    updatedAt: new Date(row.updatedAt),
    cancelledAt: row.cancelledAt ? new Date(row.cancelledAt) : null,
  };
}

function parseCivil(value: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!m) {
    throw new TreasuryDomainError(
      "INVALID_CIVIL_DATE",
      `Data civil inválida: ${value}`,
      "civilDate"
    );
  }
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}

function civilKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function createMemoryTreasuryTransferRepository(
  store: TreasuryTransferMemoryStore
): TreasuryTransferRepository {
  return {
    async findById(id) {
      const row = store.rows.find((r) => r.id === id);
      return row ? clone(row) : null;
    },

    async list(filter: TreasuryTransferListFilter) {
      let rows = [...store.rows];
      if (filter.companyCode) {
        rows = rows.filter((r) => r.companyCode === filter.companyCode);
      }
      if (filter.status) {
        rows = rows.filter((r) => r.status === filter.status);
      }
      if (filter.fromAccountId) {
        rows = rows.filter((r) => r.fromAccountId === filter.fromAccountId);
      }
      if (filter.toAccountId) {
        rows = rows.filter((r) => r.toAccountId === filter.toAccountId);
      }
      if (filter.from) {
        rows = rows.filter((r) => civilKey(r.civilDate) >= filter.from!);
      }
      if (filter.to) {
        rows = rows.filter((r) => civilKey(r.civilDate) <= filter.to!);
      }
      rows.sort((a, b) => {
        const byDate = b.civilDate.getTime() - a.civilDate.getTime();
        if (byDate !== 0) return byDate;
        return b.createdAt.getTime() - a.createdAt.getTime();
      });
      const total = rows.length;
      const start = (filter.page - 1) * filter.pageSize;
      return {
        total,
        rows: rows.slice(start, start + filter.pageSize).map(clone),
      };
    },

    async listActiveForAccounts(accountIds) {
      const set = new Set(accountIds);
      return store.rows
        .filter(
          (r) =>
            r.status !== "CANCELLED" &&
            (set.has(r.fromAccountId) || set.has(r.toAccountId))
        )
        .sort((a, b) => a.civilDate.getTime() - b.civilDate.getTime())
        .map(clone);
    },

    async create(data: TreasuryTransferCreateData) {
      const now = new Date();
      const row: TreasuryTransferRow = {
        id: randomUUID(),
        transferGroupId: data.transferGroupId,
        companyCode: data.companyCode,
        fromAccountId: data.fromAccountId,
        toAccountId: data.toAccountId,
        amount: data.amount,
        currency: data.currency ?? "BRL",
        civilDate: parseCivil(data.civilDate),
        sentCivilDate: null,
        receivedCivilDate: null,
        reconciledCivilDate: null,
        sentAt: null,
        receivedAt: null,
        reconciledAt: null,
        status: data.status,
        memo: data.memo ?? null,
        version: 1,
        createdAt: now,
        createdByUserId: data.createdByUserId,
        updatedAt: now,
        updatedByUserId: data.createdByUserId,
        cancelledAt: null,
        cancelledByUserId: null,
        cancellationReason: null,
      };
      store.rows.push(row);
      return clone(row);
    },

    async update(id, data: TreasuryTransferUpdateData) {
      const idx = store.rows.findIndex((r) => r.id === id);
      if (idx < 0) {
        throw new TreasuryDomainError("NOT_FOUND", "Transferência não encontrada.");
      }
      const current = store.rows[idx]!;
      if (current.version !== data.expectedVersion) {
        throw new TreasuryDomainError(
          "CONFLICT",
          "Versão da transferência desatualizada.",
          "expectedVersion"
        );
      }
      const next: TreasuryTransferRow = {
        ...current,
        status: data.status ?? current.status,
        civilDate:
          data.civilDate != null ? parseCivil(data.civilDate) : current.civilDate,
        sentCivilDate:
          data.sentCivilDate === undefined
            ? current.sentCivilDate
            : data.sentCivilDate
              ? parseCivil(data.sentCivilDate)
              : null,
        receivedCivilDate:
          data.receivedCivilDate === undefined
            ? current.receivedCivilDate
            : data.receivedCivilDate
              ? parseCivil(data.receivedCivilDate)
              : null,
        reconciledCivilDate:
          data.reconciledCivilDate === undefined
            ? current.reconciledCivilDate
            : data.reconciledCivilDate
              ? parseCivil(data.reconciledCivilDate)
              : null,
        sentAt: data.sentAt === undefined ? current.sentAt : data.sentAt,
        receivedAt:
          data.receivedAt === undefined ? current.receivedAt : data.receivedAt,
        reconciledAt:
          data.reconciledAt === undefined
            ? current.reconciledAt
            : data.reconciledAt,
        memo: data.memo === undefined ? current.memo : data.memo,
        version: current.version + 1,
        updatedAt: new Date(),
        updatedByUserId: data.updatedByUserId,
      };
      store.rows[idx] = next;
      return clone(next);
    },

    async cancel(id, data: TreasuryTransferCancelData) {
      const idx = store.rows.findIndex((r) => r.id === id);
      if (idx < 0) {
        throw new TreasuryDomainError("NOT_FOUND", "Transferência não encontrada.");
      }
      const current = store.rows[idx]!;
      if (current.version !== data.expectedVersion) {
        throw new TreasuryDomainError(
          "CONFLICT",
          "Versão da transferência desatualizada.",
          "expectedVersion"
        );
      }
      const next: TreasuryTransferRow = {
        ...current,
        status: "CANCELLED",
        cancelledAt: new Date(),
        cancelledByUserId: data.cancelledByUserId,
        cancellationReason: data.cancellationReason,
        version: current.version + 1,
        updatedAt: new Date(),
        updatedByUserId: data.cancelledByUserId,
      };
      store.rows[idx] = next;
      return clone(next);
    },
  };
}
