/**
 * Repository in-memory de lançamentos — testes.
 */

import { randomUUID } from "node:crypto";
import { TreasuryDomainError } from "../domain/treasuryErrors.js";
import type { TreasuryLedgerEntryRow } from "../mappers/treasuryLedgerEntryMappers.js";
import type {
  TreasuryLedgerEntryCreateData,
  TreasuryLedgerEntryListFilter,
  TreasuryLedgerEntryRepository,
} from "./treasuryLedgerEntryRepository.server.js";

export type TreasuryLedgerEntryMemoryStore = {
  rows: TreasuryLedgerEntryRow[];
};

export function createEmptyTreasuryLedgerEntryMemoryStore(): TreasuryLedgerEntryMemoryStore {
  return { rows: [] };
}

function clone(row: TreasuryLedgerEntryRow): TreasuryLedgerEntryRow {
  return {
    ...row,
    civilDate: new Date(row.civilDate),
    createdAt: new Date(row.createdAt),
    updatedAt: new Date(row.updatedAt),
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

export function createMemoryTreasuryLedgerEntryRepository(
  store: TreasuryLedgerEntryMemoryStore
): TreasuryLedgerEntryRepository {
  return {
    async findById(id) {
      const row = store.rows.find((r) => r.id === id);
      return row ? clone(row) : null;
    },

    async list(filter: TreasuryLedgerEntryListFilter) {
      let rows = [...store.rows];
      if (filter.companyCode) {
        rows = rows.filter((r) => r.companyCode === filter.companyCode);
      }
      if (filter.accountId) {
        rows = rows.filter((r) => r.accountId === filter.accountId);
      }
      if (filter.status) {
        rows = rows.filter((r) => r.status === filter.status);
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

    async create(data: TreasuryLedgerEntryCreateData) {
      const now = new Date();
      const row: TreasuryLedgerEntryRow = {
        id: randomUUID(),
        companyCode: data.companyCode,
        accountId: data.accountId,
        civilDate: parseCivil(data.civilDate),
        amount: data.amount,
        currency: data.currency ?? "BRL",
        direction: data.direction,
        nature: data.nature,
        status: data.status ?? "ACTIVE",
        memo: data.memo,
        counterpartRef: data.counterpartRef,
        transferGroupId: data.transferGroupId ?? null,
        reversesEntryId: data.reversesEntryId ?? null,
        reversedByEntryId: null,
        version: 1,
        createdAt: now,
        createdByUserId: data.createdByUserId,
        updatedAt: now,
        updatedByUserId: null,
      };
      store.rows.push(row);
      return clone(row);
    },

    async markReversed(input) {
      const idx = store.rows.findIndex((r) => r.id === input.originalId);
      if (idx < 0) {
        throw new TreasuryDomainError("NOT_FOUND", "Lançamento não encontrado.");
      }
      const current = store.rows[idx]!;
      if (
        current.version !== input.expectedVersion ||
        current.status !== "ACTIVE"
      ) {
        throw new TreasuryDomainError(
          "CONFLICT",
          "Não foi possível reverter o lançamento (conflito de versão/status).",
          "expectedVersion"
        );
      }
      const next: TreasuryLedgerEntryRow = {
        ...current,
        status: "REVERSED",
        reversedByEntryId: input.reversalId,
        version: current.version + 1,
        updatedAt: new Date(),
        updatedByUserId: input.updatedByUserId,
      };
      store.rows[idx] = next;
      return clone(next);
    },
  };
}
