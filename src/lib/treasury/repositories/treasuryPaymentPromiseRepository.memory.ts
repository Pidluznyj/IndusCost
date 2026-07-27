/**
 * Repository in-memory de promessas — testes.
 */

import { randomUUID } from "node:crypto";
import { TreasuryDomainError } from "../domain/treasuryErrors.js";
import type { TreasuryPaymentPromiseRow } from "../mappers/treasuryPaymentPromiseMappers.js";
import type {
  TreasuryPaymentPromiseCancelData,
  TreasuryPaymentPromiseCreateData,
  TreasuryPaymentPromiseRepository,
  TreasuryPaymentPromiseUpdateData,
} from "./treasuryPaymentPromiseRepository.server.js";

export type TreasuryPaymentPromiseMemoryStore = {
  rows: TreasuryPaymentPromiseRow[];
};

export function createEmptyTreasuryPaymentPromiseMemoryStore(): TreasuryPaymentPromiseMemoryStore {
  return { rows: [] };
}

function clone(row: TreasuryPaymentPromiseRow): TreasuryPaymentPromiseRow {
  return {
    ...row,
    promisedDate: new Date(row.promisedDate),
    createdAt: new Date(row.createdAt),
    updatedAt: new Date(row.updatedAt),
    cancelledAt: row.cancelledAt ? new Date(row.cancelledAt) : null,
    fulfilledAt: row.fulfilledAt ? new Date(row.fulfilledAt) : null,
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

export function createMemoryTreasuryPaymentPromiseRepository(
  store: TreasuryPaymentPromiseMemoryStore
): TreasuryPaymentPromiseRepository {
  return {
    async findById(id) {
      const row = store.rows.find((r) => r.id === id);
      return row ? clone(row) : null;
    },

    async listByOfficialTitle(titleType, officialTitleId) {
      return store.rows
        .filter(
          (r) =>
            r.titleType === titleType && r.officialTitleId === officialTitleId
        )
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .map(clone);
    },

    async listByOfficialTitleIds(titleType, officialTitleIds) {
      const set = new Set(officialTitleIds);
      if (!set.size) return [];
      return store.rows
        .filter(
          (r) => r.titleType === titleType && set.has(r.officialTitleId)
        )
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .map(clone);
    },

    async listActiveTitleIds(titleType, officialTitleIds) {
      const set = new Set(officialTitleIds);
      const out = new Set<string>();
      for (const r of store.rows) {
        if (
          r.titleType === titleType &&
          set.has(r.officialTitleId) &&
          (r.status === "ACTIVE" || r.status === "PARTIALLY_FULFILLED")
        ) {
          out.add(r.officialTitleId);
        }
      }
      return [...out];
    },

    async create(data: TreasuryPaymentPromiseCreateData) {
      const now = new Date();
      const row: TreasuryPaymentPromiseRow = {
        id: randomUUID(),
        titleType: data.titleType,
        officialTitleId: data.officialTitleId,
        officialExternalId: data.officialExternalId,
        promisedDate: parseCivil(data.promisedDate),
        promisedAmount: data.promisedAmount,
        fulfilledAmount: data.fulfilledAmount ?? "0.00",
        contactNote: data.contactNote ?? null,
        channel: data.channel ?? null,
        notes: data.notes ?? null,
        responsibleUserId: data.responsibleUserId ?? null,
        status: data.status ?? "ACTIVE",
        version: 1,
        createdAt: now,
        createdByUserId: data.createdByUserId,
        updatedAt: now,
        updatedByUserId: data.createdByUserId,
        cancelledAt: null,
        cancelledByUserId: null,
        cancellationReason: null,
        fulfilledAt: null,
      };
      store.rows.push(row);
      return clone(row);
    },

    async update(id, data: TreasuryPaymentPromiseUpdateData) {
      const idx = store.rows.findIndex((r) => r.id === id);
      if (idx < 0) {
        throw new TreasuryDomainError(
          "NOT_FOUND",
          "Promessa não encontrada.",
          "promiseId"
        );
      }
      const current = store.rows[idx]!;
      if (current.cancelledAt) {
        throw new TreasuryDomainError(
          "CONFLICT",
          "Promessa cancelada não pode ser alterada.",
          "promiseId"
        );
      }
      if (current.version !== data.expectedVersion) {
        throw new TreasuryDomainError(
          "CONFLICT",
          "Versão da promessa desatualizada.",
          "expectedVersion"
        );
      }
      const next: TreasuryPaymentPromiseRow = {
        ...current,
        promisedDate:
          data.promisedDate === undefined
            ? current.promisedDate
            : parseCivil(data.promisedDate),
        promisedAmount:
          data.promisedAmount === undefined
            ? current.promisedAmount
            : data.promisedAmount,
        fulfilledAmount:
          data.fulfilledAmount === undefined
            ? current.fulfilledAmount
            : data.fulfilledAmount,
        contactNote:
          data.contactNote === undefined
            ? current.contactNote
            : data.contactNote,
        channel: data.channel === undefined ? current.channel : data.channel,
        notes: data.notes === undefined ? current.notes : data.notes,
        responsibleUserId:
          data.responsibleUserId === undefined
            ? current.responsibleUserId
            : data.responsibleUserId,
        status: data.status ?? current.status,
        fulfilledAt:
          data.fulfilledAt === undefined
            ? current.fulfilledAt
            : data.fulfilledAt,
        updatedByUserId: data.updatedByUserId,
        updatedAt: new Date(),
        version: current.version + 1,
      };
      store.rows[idx] = next;
      return clone(next);
    },

    async cancel(id, data: TreasuryPaymentPromiseCancelData) {
      const idx = store.rows.findIndex((r) => r.id === id);
      if (idx < 0) {
        throw new TreasuryDomainError(
          "NOT_FOUND",
          "Promessa não encontrada.",
          "promiseId"
        );
      }
      const current = store.rows[idx]!;
      if (current.cancelledAt || current.status === "CANCELLED") {
        throw new TreasuryDomainError(
          "CONFLICT",
          "Promessa já está cancelada.",
          "promiseId"
        );
      }
      if (current.version !== data.expectedVersion) {
        throw new TreasuryDomainError(
          "CONFLICT",
          "Versão da promessa desatualizada.",
          "expectedVersion"
        );
      }
      const next: TreasuryPaymentPromiseRow = {
        ...current,
        status: "CANCELLED",
        cancelledAt: new Date(),
        cancelledByUserId: data.cancelledByUserId,
        cancellationReason: data.cancellationReason ?? null,
        updatedByUserId: data.cancelledByUserId,
        updatedAt: new Date(),
        version: current.version + 1,
      };
      store.rows[idx] = next;
      return clone(next);
    },

    async expireMany(ids, updatedByUserId) {
      const set = new Set(ids);
      let count = 0;
      for (let i = 0; i < store.rows.length; i++) {
        const row = store.rows[i]!;
        if (
          set.has(row.id) &&
          (row.status === "ACTIVE" || row.status === "PARTIALLY_FULFILLED")
        ) {
          store.rows[i] = {
            ...row,
            status: "EXPIRED",
            updatedByUserId,
            updatedAt: new Date(),
            version: row.version + 1,
          };
          count += 1;
        }
      }
      return count;
    },
  };
}
