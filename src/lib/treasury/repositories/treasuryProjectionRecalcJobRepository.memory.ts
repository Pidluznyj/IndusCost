/**
 * Repository in-memory — fila de recálculo (testes).
 */

import { randomUUID } from "node:crypto";
import type { TreasuryProjectionRecalcJobStatus } from "../contracts/treasuryEnums.js";
import {
  TREASURY_PROJECTION_RECALC_ACTIVE_STATUSES,
  TREASURY_PROJECTION_RECALC_DEFAULT_MAX_ATTEMPTS,
} from "../domain/treasuryProjectionRecalcQueue.js";
import type {
  TreasuryProjectionRecalcJobCreateData,
  TreasuryProjectionRecalcJobRepository,
  TreasuryProjectionRecalcJobRow,
} from "./treasuryProjectionRecalcJobRepository.server.js";

export type TreasuryProjectionRecalcJobMemoryStore = {
  jobs: TreasuryProjectionRecalcJobRow[];
};

export function createEmptyTreasuryProjectionRecalcJobMemoryStore(): TreasuryProjectionRecalcJobMemoryStore {
  return { jobs: [] };
}

function clone(
  row: TreasuryProjectionRecalcJobRow
): TreasuryProjectionRecalcJobRow {
  return {
    ...row,
    availableAt: new Date(row.availableAt),
    lockedAt: row.lockedAt ? new Date(row.lockedAt) : null,
    completedAt: row.completedAt ? new Date(row.completedAt) : null,
    createdAt: new Date(row.createdAt),
    updatedAt: new Date(row.updatedAt),
    payloadJson:
      row.payloadJson === undefined || row.payloadJson === null
        ? row.payloadJson
        : JSON.parse(JSON.stringify(row.payloadJson)),
    lastErrorDetail:
      row.lastErrorDetail === undefined || row.lastErrorDetail === null
        ? row.lastErrorDetail
        : JSON.parse(JSON.stringify(row.lastErrorDetail)),
  };
}

function isActive(status: TreasuryProjectionRecalcJobStatus): boolean {
  return (
    TREASURY_PROJECTION_RECALC_ACTIVE_STATUSES as readonly string[]
  ).includes(status);
}

export function createMemoryTreasuryProjectionRecalcJobRepository(
  store: TreasuryProjectionRecalcJobMemoryStore
): TreasuryProjectionRecalcJobRepository & {
  listAll(): TreasuryProjectionRecalcJobRow[];
} {
  return {
    listAll() {
      return store.jobs.map(clone);
    },

    async findActiveByDeduplicationKey(deduplicationKey) {
      const row = store.jobs.find(
        (j) => j.deduplicationKey === deduplicationKey && isActive(j.status)
      );
      return row ? clone(row) : null;
    },

    async create(data: TreasuryProjectionRecalcJobCreateData) {
      const existing = store.jobs.find(
        (j) =>
          j.deduplicationKey === data.deduplicationKey && isActive(j.status)
      );
      if (existing) {
        const err = new Error("Unique constraint failed on deduplicationKey");
        (err as Error & { code: string }).code = "P2002";
        throw err;
      }
      const now = new Date();
      const row: TreasuryProjectionRecalcJobRow = {
        id: randomUUID(),
        companyCode: data.companyCode,
        scenario: data.scenario,
        eventType: data.eventType,
        status: "PENDING",
        deduplicationKey: data.deduplicationKey,
        subjectId: data.subjectId ?? null,
        payloadJson: data.payloadJson ?? null,
        attempts: 0,
        maxAttempts:
          data.maxAttempts ?? TREASURY_PROJECTION_RECALC_DEFAULT_MAX_ATTEMPTS,
        availableAt: new Date(data.availableAt),
        lockedAt: null,
        lockedBy: null,
        lockToken: null,
        lastErrorCode: null,
        lastErrorMessage: null,
        lastErrorDetail: null,
        completedAt: null,
        requestId: data.requestId ?? null,
        createdAt: now,
        updatedAt: now,
      };
      store.jobs.push(row);
      return clone(row);
    },

    async touchPending(id, patch) {
      const row = store.jobs.find((j) => j.id === id);
      if (!row) throw new Error(`Job not found: ${id}`);
      row.status = "PENDING";
      row.availableAt = new Date(patch.availableAt);
      if (patch.payloadJson !== undefined) row.payloadJson = patch.payloadJson;
      if (patch.requestId !== undefined) row.requestId = patch.requestId;
      if (patch.eventType !== undefined) row.eventType = patch.eventType;
      row.lockedAt = null;
      row.lockedBy = null;
      row.lockToken = null;
      row.updatedAt = new Date();
      return clone(row);
    },

    async claimNext(workerId, now) {
      const candidates = store.jobs
        .filter(
          (j) =>
            j.status === "PENDING" && j.availableAt.getTime() <= now.getTime()
        )
        .sort(
          (a, b) =>
            a.availableAt.getTime() - b.availableAt.getTime() ||
            a.createdAt.getTime() - b.createdAt.getTime()
        );
      const row = candidates[0];
      if (!row) return null;
      row.status = "PROCESSING";
      row.attempts += 1;
      row.lockedAt = new Date(now);
      row.lockedBy = workerId;
      row.lockToken = randomUUID();
      row.updatedAt = new Date(now);
      return clone(row);
    },

    async markSucceeded(id, lockToken, completedAt) {
      const row = store.jobs.find((j) => j.id === id);
      if (!row || row.lockToken !== lockToken || row.status !== "PROCESSING") {
        throw new Error(
          `Falha ao concluir job ${id}: lockToken inválido ou status != PROCESSING`
        );
      }
      row.status = "SUCCEEDED";
      row.completedAt = new Date(completedAt);
      row.lockedAt = null;
      row.lockedBy = null;
      row.lockToken = null;
      row.lastErrorCode = null;
      row.lastErrorMessage = null;
      row.lastErrorDetail = null;
      row.updatedAt = new Date(completedAt);
      return clone(row);
    },

    async markRetry(id, lockToken, input) {
      const row = store.jobs.find((j) => j.id === id);
      if (!row || row.lockToken !== lockToken || row.status !== "PROCESSING") {
        throw new Error(
          `Falha ao reagendar job ${id}: lockToken inválido ou status != PROCESSING`
        );
      }
      row.status = "PENDING";
      row.attempts = input.attempts;
      row.availableAt = new Date(input.availableAt);
      row.lockedAt = null;
      row.lockedBy = null;
      row.lockToken = null;
      row.lastErrorCode = input.error.code;
      row.lastErrorMessage = input.error.message;
      row.lastErrorDetail = input.error.detail ?? null;
      row.completedAt = null;
      row.updatedAt = new Date();
      return clone(row);
    },

    async markDead(id, lockToken, input) {
      const row = store.jobs.find((j) => j.id === id);
      if (!row || row.lockToken !== lockToken || row.status !== "PROCESSING") {
        throw new Error(
          `Falha ao marcar DEAD job ${id}: lockToken inválido ou status != PROCESSING`
        );
      }
      row.status = "DEAD";
      row.attempts = input.attempts;
      row.completedAt = new Date(input.completedAt);
      row.lockedAt = null;
      row.lockedBy = null;
      row.lockToken = null;
      row.lastErrorCode = input.error.code;
      row.lastErrorMessage = input.error.message;
      row.lastErrorDetail = input.error.detail ?? null;
      row.updatedAt = new Date(input.completedAt);
      return clone(row);
    },
  };
}
