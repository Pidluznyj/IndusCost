/**
 * Repository in-memory de exceções — testes.
 */

import { randomUUID } from "node:crypto";
import { TreasuryDomainError } from "../domain/treasuryErrors.js";
import type { TreasuryExceptionRow } from "../mappers/treasuryExceptionMappers.js";
import type {
  TreasuryExceptionCreateData,
  TreasuryExceptionListFilter,
  TreasuryExceptionRepository,
  TreasuryExceptionUpdateData,
} from "./treasuryExceptionRepository.server.js";

export type TreasuryExceptionMemoryStore = {
  rows: TreasuryExceptionRow[];
};

export function createEmptyTreasuryExceptionMemoryStore(): TreasuryExceptionMemoryStore {
  return { rows: [] };
}

function clone(row: TreasuryExceptionRow): TreasuryExceptionRow {
  return {
    ...row,
    detectedAt: new Date(row.detectedAt),
    dueAt: row.dueAt ? new Date(row.dueAt) : null,
    createdAt: new Date(row.createdAt),
    updatedAt: new Date(row.updatedAt),
    acknowledgedAt: row.acknowledgedAt ? new Date(row.acknowledgedAt) : null,
    resolvedAt: row.resolvedAt ? new Date(row.resolvedAt) : null,
    cancelledAt: row.cancelledAt ? new Date(row.cancelledAt) : null,
    metadataJson:
      row.metadataJson && typeof row.metadataJson === "object"
        ? { ...(row.metadataJson as Record<string, unknown>) }
        : row.metadataJson,
  };
}

function parseCivil(value: string | null | undefined): Date | null {
  if (value == null || value === "") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!m) {
    throw new TreasuryDomainError(
      "INVALID_CIVIL_DATE",
      `Data civil inválida: ${value}`,
      "dueAt"
    );
  }
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}

export function createMemoryTreasuryExceptionRepository(
  store: TreasuryExceptionMemoryStore
): TreasuryExceptionRepository {
  return {
    async findById(id) {
      const row = store.rows.find((r) => r.id === id);
      return row ? clone(row) : null;
    },

    async findByUniqueKey(uniqueKey) {
      const row = store.rows.find((r) => r.uniqueKey === uniqueKey);
      return row ? clone(row) : null;
    },

    async list(filter: TreasuryExceptionListFilter) {
      let rows = [...store.rows];
      if (filter.companyCode) {
        rows = rows.filter((r) => r.companyCode === filter.companyCode);
      }
      if (filter.status) rows = rows.filter((r) => r.status === filter.status);
      if (filter.type) rows = rows.filter((r) => r.type === filter.type);
      if (filter.severity) {
        rows = rows.filter((r) => r.severity === filter.severity);
      }
      const severityRank: Record<string, number> = {
        CRITICAL: 0,
        WARNING: 1,
        INFO: 2,
      };
      rows.sort((a, b) => {
        const bySev =
          (severityRank[String(a.severity)] ?? 9) -
          (severityRank[String(b.severity)] ?? 9);
        if (bySev !== 0) return bySev;
        return b.detectedAt.getTime() - a.detectedAt.getTime();
      });
      const total = rows.length;
      const start = (filter.page - 1) * filter.pageSize;
      return {
        total,
        rows: rows.slice(start, start + filter.pageSize).map(clone),
      };
    },

    async create(data: TreasuryExceptionCreateData) {
      if (store.rows.some((r) => r.uniqueKey === data.uniqueKey)) {
        return clone(store.rows.find((r) => r.uniqueKey === data.uniqueKey)!);
      }
      const now = new Date();
      const row: TreasuryExceptionRow = {
        id: randomUUID(),
        companyCode: data.companyCode,
        uniqueKey: data.uniqueKey,
        type: data.type,
        severity: data.severity,
        status: data.status ?? "OPEN",
        entityKind: data.entityKind ?? null,
        entityId: data.entityId ?? null,
        accountId: data.accountId ?? null,
        nomusExternalId: data.nomusExternalId ?? null,
        title: data.title,
        description: data.description ?? null,
        amount: data.amount ?? null,
        detectedAt: data.detectedAt,
        dueAt: parseCivil(data.dueAt),
        responsibleUserId: data.responsibleUserId ?? null,
        resolution: null,
        ignoreJustification: null,
        recurrenceCount: data.recurrenceCount ?? 1,
        metadataJson: data.metadataJson ?? null,
        version: 1,
        createdAt: now,
        createdByUserId: data.createdByUserId,
        updatedAt: now,
        updatedByUserId: data.createdByUserId,
        acknowledgedAt: null,
        resolvedAt: null,
        cancelledAt: null,
        cancelledByUserId: null,
      };
      store.rows.push(row);
      return clone(row);
    },

    async update(id, data: TreasuryExceptionUpdateData) {
      const idx = store.rows.findIndex((r) => r.id === id);
      if (idx < 0) {
        throw new TreasuryDomainError("NOT_FOUND", "Exceção não encontrada.");
      }
      const current = store.rows[idx]!;
      if (current.version !== data.expectedVersion) {
        throw new TreasuryDomainError(
          "CONFLICT",
          "Versão da exceção desatualizada.",
          "expectedVersion"
        );
      }
      const next: TreasuryExceptionRow = {
        ...current,
        type: data.type ?? current.type,
        severity: data.severity ?? current.severity,
        status: data.status ?? current.status,
        entityKind:
          data.entityKind === undefined ? current.entityKind : data.entityKind,
        entityId:
          data.entityId === undefined ? current.entityId : data.entityId,
        accountId:
          data.accountId === undefined ? current.accountId : data.accountId,
        nomusExternalId:
          data.nomusExternalId === undefined
            ? current.nomusExternalId
            : data.nomusExternalId,
        title: data.title ?? current.title,
        description:
          data.description === undefined
            ? current.description
            : data.description,
        amount: data.amount === undefined ? current.amount : data.amount,
        detectedAt: data.detectedAt ?? current.detectedAt,
        dueAt:
          data.dueAt === undefined ? current.dueAt : parseCivil(data.dueAt),
        responsibleUserId:
          data.responsibleUserId === undefined
            ? current.responsibleUserId
            : data.responsibleUserId,
        resolution:
          data.resolution === undefined ? current.resolution : data.resolution,
        ignoreJustification:
          data.ignoreJustification === undefined
            ? current.ignoreJustification
            : data.ignoreJustification,
        recurrenceCount: data.recurrenceCount ?? current.recurrenceCount,
        metadataJson:
          data.metadataJson === undefined
            ? current.metadataJson
            : data.metadataJson,
        acknowledgedAt:
          data.acknowledgedAt === undefined
            ? current.acknowledgedAt
            : data.acknowledgedAt,
        resolvedAt:
          data.resolvedAt === undefined ? current.resolvedAt : data.resolvedAt,
        cancelledAt:
          data.cancelledAt === undefined
            ? current.cancelledAt
            : data.cancelledAt,
        cancelledByUserId:
          data.cancelledByUserId === undefined
            ? current.cancelledByUserId
            : data.cancelledByUserId,
        version: current.version + 1,
        updatedAt: new Date(),
        updatedByUserId: data.updatedByUserId,
      };
      store.rows[idx] = next;
      return clone(next);
    },
  };
}
