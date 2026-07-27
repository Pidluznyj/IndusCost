/**
 * Repository in-memory do complemento operacional — testes de integridade.
 */

import { randomUUID } from "node:crypto";
import { TreasuryDomainError } from "../domain/treasuryErrors.js";
import type {
  TreasuryOfficialTitleKindCode,
  TreasuryTitleOperationalComplementRow,
  TreasuryTitleOperationalPriorityCode,
  TreasuryTitleOperationalStatusCode,
} from "../mappers/treasuryTitleOperationalComplementMappers.js";
import type {
  TreasuryTitleComplementCancelData,
  TreasuryTitleComplementCreateData,
  TreasuryTitleComplementUpdateData,
  TreasuryTitleOperationalComplementRepository,
} from "./treasuryTitleOperationalComplementRepository.server.js";

export type TreasuryTitleComplementMemoryStore = {
  rows: TreasuryTitleOperationalComplementRow[];
};

export function createEmptyTreasuryTitleComplementMemoryStore(): TreasuryTitleComplementMemoryStore {
  return { rows: [] };
}

function clone(
  row: TreasuryTitleOperationalComplementRow
): TreasuryTitleOperationalComplementRow {
  return {
    ...row,
    expectedDate: row.expectedDate ? new Date(row.expectedDate) : null,
    confirmedDate: row.confirmedDate ? new Date(row.confirmedDate) : null,
    scheduledDate: row.scheduledDate ? new Date(row.scheduledDate) : null,
    createdAt: new Date(row.createdAt),
    updatedAt: new Date(row.updatedAt),
    cancelledAt: row.cancelledAt ? new Date(row.cancelledAt) : null,
  };
}

function parseCivil(value: string | null | undefined): Date | null {
  if (value == null || value === "") return null;
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

function assertUnique(
  store: TreasuryTitleComplementMemoryStore,
  titleType: TreasuryOfficialTitleKindCode,
  officialTitleId: string,
  officialExternalId: number,
  exceptId?: string
) {
  const clash = store.rows.find(
    (r) =>
      r.id !== exceptId &&
      r.titleType === titleType &&
      (r.officialTitleId === officialTitleId ||
        r.officialExternalId === officialExternalId)
  );
  if (clash) {
    throw new TreasuryDomainError(
      "CONFLICT",
      "Já existe complemento operacional para este título oficial.",
      "officialTitleId"
    );
  }
}

export function createMemoryTreasuryTitleOperationalComplementRepository(
  store: TreasuryTitleComplementMemoryStore
): TreasuryTitleOperationalComplementRepository {
  return {
    async findById(id) {
      const row = store.rows.find((r) => r.id === id);
      return row ? clone(row) : null;
    },

    async findByOfficialTitle(titleType, officialTitleId) {
      const row = store.rows.find(
        (r) => r.titleType === titleType && r.officialTitleId === officialTitleId
      );
      return row ? clone(row) : null;
    },

    async findByOfficialExternalId(titleType, officialExternalId) {
      const row = store.rows.find(
        (r) =>
          r.titleType === titleType &&
          r.officialExternalId === officialExternalId
      );
      return row ? clone(row) : null;
    },

    async create(data: TreasuryTitleComplementCreateData) {
      assertUnique(
        store,
        data.titleType,
        data.officialTitleId,
        data.officialExternalId
      );
      const now = new Date();
      const row: TreasuryTitleOperationalComplementRow = {
        id: randomUUID(),
        titleType: data.titleType as TreasuryOfficialTitleKindCode,
        officialTitleId: data.officialTitleId,
        officialExternalId: data.officialExternalId,
        expectedDate: parseCivil(data.expectedDate),
        confirmedDate: parseCivil(data.confirmedDate),
        scheduledDate: parseCivil(data.scheduledDate),
        expectedAmount: data.expectedAmount ?? null,
        confirmedAmount: data.confirmedAmount ?? null,
        scheduledAmount: data.scheduledAmount ?? null,
        status: (data.status ??
          "ACTIVE") as TreasuryTitleOperationalStatusCode,
        priority: (data.priority ??
          "NORMAL") as TreasuryTitleOperationalPriorityCode,
        plannedAccountId: data.plannedAccountId ?? null,
        responsibleUserId: data.responsibleUserId ?? null,
        nextAction: data.nextAction ?? null,
        reason: data.reason ?? null,
        notes: data.notes ?? null,
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

    async update(id, data: TreasuryTitleComplementUpdateData) {
      const idx = store.rows.findIndex((r) => r.id === id);
      if (idx < 0) {
        throw new TreasuryDomainError(
          "NOT_FOUND",
          "Complemento operacional não encontrado.",
          "id"
        );
      }
      const current = store.rows[idx]!;
      if (current.cancelledAt) {
        throw new TreasuryDomainError(
          "CONFLICT",
          "Complemento operacional cancelado não pode ser alterado.",
          "id"
        );
      }
      if (current.version !== data.expectedVersion) {
        throw new TreasuryDomainError(
          "CONFLICT",
          "Versão do complemento desatualizada.",
          "version"
        );
      }
      const next: TreasuryTitleOperationalComplementRow = {
        ...current,
        expectedDate:
          data.expectedDate === undefined
            ? current.expectedDate
            : parseCivil(data.expectedDate),
        confirmedDate:
          data.confirmedDate === undefined
            ? current.confirmedDate
            : parseCivil(data.confirmedDate),
        scheduledDate:
          data.scheduledDate === undefined
            ? current.scheduledDate
            : parseCivil(data.scheduledDate),
        expectedAmount:
          data.expectedAmount === undefined
            ? current.expectedAmount
            : data.expectedAmount,
        confirmedAmount:
          data.confirmedAmount === undefined
            ? current.confirmedAmount
            : data.confirmedAmount,
        scheduledAmount:
          data.scheduledAmount === undefined
            ? current.scheduledAmount
            : data.scheduledAmount,
        status: (data.status ??
          current.status) as TreasuryTitleOperationalStatusCode,
        priority: (data.priority ??
          current.priority) as TreasuryTitleOperationalPriorityCode,
        plannedAccountId:
          data.plannedAccountId === undefined
            ? current.plannedAccountId
            : data.plannedAccountId,
        responsibleUserId:
          data.responsibleUserId === undefined
            ? current.responsibleUserId
            : data.responsibleUserId,
        nextAction:
          data.nextAction === undefined ? current.nextAction : data.nextAction,
        reason: data.reason === undefined ? current.reason : data.reason,
        notes: data.notes === undefined ? current.notes : data.notes,
        updatedByUserId: data.updatedByUserId,
        updatedAt: new Date(),
        version: current.version + 1,
      };
      store.rows[idx] = next;
      return clone(next);
    },

    async cancel(id, data: TreasuryTitleComplementCancelData) {
      const idx = store.rows.findIndex((r) => r.id === id);
      if (idx < 0) {
        throw new TreasuryDomainError(
          "NOT_FOUND",
          "Complemento operacional não encontrado.",
          "id"
        );
      }
      const current = store.rows[idx]!;
      if (current.cancelledAt) {
        throw new TreasuryDomainError(
          "CONFLICT",
          "Complemento operacional já está cancelado.",
          "id"
        );
      }
      if (current.version !== data.expectedVersion) {
        throw new TreasuryDomainError(
          "CONFLICT",
          "Versão do complemento desatualizada.",
          "version"
        );
      }
      const next: TreasuryTitleOperationalComplementRow = {
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
  };
}
