import { randomUUID } from "node:crypto";
import { TreasuryDomainError } from "../domain/treasuryErrors.js";
import type { TreasuryDisputeRow } from "../mappers/treasuryDisputeMappers.js";
import type {
  TreasuryDisputeCreateData,
  TreasuryDisputeRepository,
  TreasuryDisputeUpdateStatusData,
} from "./treasuryDisputeRepository.server.js";

export type TreasuryDisputeMemoryStore = { rows: TreasuryDisputeRow[] };

export function createEmptyTreasuryDisputeMemoryStore(): TreasuryDisputeMemoryStore {
  return { rows: [] };
}

function clone(row: TreasuryDisputeRow): TreasuryDisputeRow {
  return {
    ...row,
    dueDate: row.dueDate ? new Date(row.dueDate) : null,
    openedAt: new Date(row.openedAt),
    createdAt: new Date(row.createdAt),
    updatedAt: new Date(row.updatedAt),
    cancelledAt: row.cancelledAt ? new Date(row.cancelledAt) : null,
    resolvedAt: row.resolvedAt ? new Date(row.resolvedAt) : null,
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

export function createMemoryTreasuryDisputeRepository(
  store: TreasuryDisputeMemoryStore
): TreasuryDisputeRepository {
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
        .sort((a, b) => b.openedAt.getTime() - a.openedAt.getTime())
        .map(clone);
    },
    async create(data: TreasuryDisputeCreateData) {
      const now = new Date();
      const row: TreasuryDisputeRow = {
        id: randomUUID(),
        titleType: data.titleType,
        officialTitleId: data.officialTitleId,
        officialExternalId: data.officialExternalId,
        reason: data.reason,
        amountDisputed: data.amountDisputed ?? null,
        responsibleUserId: data.responsibleUserId ?? null,
        involvedArea: data.involvedArea ?? null,
        dueDate: parseCivil(data.dueDate),
        notes: data.notes ?? null,
        status: "OPEN",
        resolutionNote: null,
        version: 1,
        openedAt: now,
        createdAt: now,
        createdByUserId: data.createdByUserId,
        updatedAt: now,
        updatedByUserId: data.createdByUserId,
        cancelledAt: null,
        cancelledByUserId: null,
        resolvedAt: null,
      };
      store.rows.push(row);
      return clone(row);
    },
    async updateStatus(id, data: TreasuryDisputeUpdateStatusData) {
      const idx = store.rows.findIndex((r) => r.id === id);
      if (idx < 0) {
        throw new TreasuryDomainError(
          "NOT_FOUND",
          "Contestação não encontrada.",
          "disputeId"
        );
      }
      const current = store.rows[idx]!;
      if (current.version !== data.expectedVersion) {
        throw new TreasuryDomainError(
          "CONFLICT",
          "Versão da contestação desatualizada.",
          "expectedVersion"
        );
      }
      if (current.status !== "OPEN") {
        throw new TreasuryDomainError(
          "CONFLICT",
          "Somente contestações abertas podem mudar de status.",
          "status"
        );
      }
      const now = new Date();
      const next: TreasuryDisputeRow = {
        ...current,
        status: data.status,
        resolutionNote:
          data.resolutionNote === undefined
            ? current.resolutionNote
            : data.resolutionNote,
        notes: data.notes === undefined ? current.notes : data.notes,
        updatedByUserId: data.updatedByUserId,
        updatedAt: now,
        version: current.version + 1,
        resolvedAt: data.status === "RESOLVED" ? now : current.resolvedAt,
        cancelledAt: data.status === "CANCELLED" ? now : current.cancelledAt,
        cancelledByUserId:
          data.status === "CANCELLED"
            ? data.updatedByUserId
            : current.cancelledByUserId,
      };
      store.rows[idx] = next;
      return clone(next);
    },
  };
}
