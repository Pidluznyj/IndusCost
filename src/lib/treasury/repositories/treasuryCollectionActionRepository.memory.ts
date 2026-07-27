import { randomUUID } from "node:crypto";
import { TreasuryDomainError } from "../domain/treasuryErrors.js";
import type { TreasuryCollectionActionRow } from "../mappers/treasuryCollectionActionMappers.js";
import type {
  TreasuryCollectionActionCancelData,
  TreasuryCollectionActionCreateData,
  TreasuryCollectionActionRepository,
} from "./treasuryCollectionActionRepository.server.js";

export type TreasuryCollectionActionMemoryStore = {
  rows: TreasuryCollectionActionRow[];
};

export function createEmptyTreasuryCollectionActionMemoryStore(): TreasuryCollectionActionMemoryStore {
  return { rows: [] };
}

function clone(row: TreasuryCollectionActionRow): TreasuryCollectionActionRow {
  return {
    ...row,
    performedAt: new Date(row.performedAt),
    createdAt: new Date(row.createdAt),
    updatedAt: new Date(row.updatedAt),
    cancelledAt: row.cancelledAt ? new Date(row.cancelledAt) : null,
  };
}

export function createMemoryTreasuryCollectionActionRepository(
  store: TreasuryCollectionActionMemoryStore
): TreasuryCollectionActionRepository {
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
        .sort((a, b) => b.performedAt.getTime() - a.performedAt.getTime())
        .map(clone);
    },
    async listTitleIdsByNextAction(titleType, nextAction) {
      const needle = nextAction.trim().toLowerCase();
      if (!needle) return [];
      const out = new Set<string>();
      for (const r of store.rows) {
        if (
          r.titleType === titleType &&
          !r.cancelledAt &&
          (r.nextAction ?? "").toLowerCase().includes(needle)
        ) {
          out.add(r.officialTitleId);
        }
      }
      return [...out];
    },
    async create(data: TreasuryCollectionActionCreateData) {
      const now = new Date();
      const row: TreasuryCollectionActionRow = {
        id: randomUUID(),
        titleType: data.titleType,
        officialTitleId: data.officialTitleId,
        officialExternalId: data.officialExternalId,
        actionType: data.actionType,
        performedAt: data.performedAt,
        contactPerson: data.contactPerson ?? null,
        result: data.result ?? null,
        notes: data.notes ?? null,
        nextAction: data.nextAction ?? null,
        responsibleUserId: data.responsibleUserId ?? null,
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
    async cancel(id, data: TreasuryCollectionActionCancelData) {
      const idx = store.rows.findIndex((r) => r.id === id);
      if (idx < 0) {
        throw new TreasuryDomainError(
          "NOT_FOUND",
          "Ação de cobrança não encontrada.",
          "actionId"
        );
      }
      const current = store.rows[idx]!;
      if (current.cancelledAt) {
        throw new TreasuryDomainError(
          "CONFLICT",
          "Ação de cobrança já está cancelada.",
          "actionId"
        );
      }
      if (current.version !== data.expectedVersion) {
        throw new TreasuryDomainError(
          "CONFLICT",
          "Versão da ação desatualizada.",
          "expectedVersion"
        );
      }
      const next = {
        ...current,
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
  };
}
