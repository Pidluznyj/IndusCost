/**
 * Repository Prisma — fila persistente de recálculo de projeção.
 */

import { randomUUID } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import type {
  TreasuryProjectionRecalcEventType,
  TreasuryProjectionRecalcJobStatus,
  TreasuryProjectionScenario,
} from "../contracts/treasuryEnums.js";
import {
  TREASURY_PROJECTION_RECALC_ACTIVE_STATUSES,
  TREASURY_PROJECTION_RECALC_DEFAULT_MAX_ATTEMPTS,
} from "../domain/treasuryProjectionRecalcQueue.js";

export type TreasuryProjectionRecalcJobRow = {
  id: string;
  companyCode: string;
  scenario: TreasuryProjectionScenario;
  eventType: TreasuryProjectionRecalcEventType;
  status: TreasuryProjectionRecalcJobStatus;
  deduplicationKey: string;
  subjectId: string | null;
  payloadJson: unknown;
  attempts: number;
  maxAttempts: number;
  availableAt: Date;
  lockedAt: Date | null;
  lockedBy: string | null;
  lockToken: string | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  lastErrorDetail: unknown;
  completedAt: Date | null;
  requestId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type TreasuryProjectionRecalcJobCreateData = {
  companyCode: string;
  scenario: TreasuryProjectionScenario;
  eventType: TreasuryProjectionRecalcEventType;
  deduplicationKey: string;
  subjectId?: string | null;
  payloadJson?: unknown;
  maxAttempts?: number;
  availableAt: Date;
  requestId?: string | null;
};

export type TreasuryProjectionRecalcJobFailure = {
  code: string;
  message: string;
  detail?: unknown;
};

export type TreasuryProjectionRecalcJobRepository = {
  findActiveByDeduplicationKey(
    deduplicationKey: string
  ): Promise<TreasuryProjectionRecalcJobRow | null>;
  create(
    data: TreasuryProjectionRecalcJobCreateData
  ): Promise<TreasuryProjectionRecalcJobRow>;
  touchPending(
    id: string,
    patch: {
      availableAt: Date;
      payloadJson?: unknown;
      requestId?: string | null;
      eventType?: TreasuryProjectionRecalcEventType;
    }
  ): Promise<TreasuryProjectionRecalcJobRow>;
  claimNext(
    workerId: string,
    now: Date
  ): Promise<TreasuryProjectionRecalcJobRow | null>;
  markSucceeded(
    id: string,
    lockToken: string,
    completedAt: Date
  ): Promise<TreasuryProjectionRecalcJobRow>;
  markRetry(
    id: string,
    lockToken: string,
    input: {
      attempts: number;
      availableAt: Date;
      error: TreasuryProjectionRecalcJobFailure;
    }
  ): Promise<TreasuryProjectionRecalcJobRow>;
  markDead(
    id: string,
    lockToken: string,
    input: {
      attempts: number;
      completedAt: Date;
      error: TreasuryProjectionRecalcJobFailure;
    }
  ): Promise<TreasuryProjectionRecalcJobRow>;
};

type Db = PrismaClient | Prisma.TransactionClient;

function mapRow(row: {
  id: string;
  companyCode: string;
  scenario: string;
  eventType: string;
  status: string;
  deduplicationKey: string;
  subjectId: string | null;
  payloadJson: unknown;
  attempts: number;
  maxAttempts: number;
  availableAt: Date;
  lockedAt: Date | null;
  lockedBy: string | null;
  lockToken: string | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  lastErrorDetail: unknown;
  completedAt: Date | null;
  requestId: string | null;
  createdAt: Date;
  updatedAt: Date;
}): TreasuryProjectionRecalcJobRow {
  return {
    id: row.id,
    companyCode: row.companyCode,
    scenario: row.scenario as TreasuryProjectionScenario,
    eventType: row.eventType as TreasuryProjectionRecalcEventType,
    status: row.status as TreasuryProjectionRecalcJobStatus,
    deduplicationKey: row.deduplicationKey,
    subjectId: row.subjectId,
    payloadJson: row.payloadJson,
    attempts: row.attempts,
    maxAttempts: row.maxAttempts,
    availableAt: new Date(row.availableAt),
    lockedAt: row.lockedAt ? new Date(row.lockedAt) : null,
    lockedBy: row.lockedBy,
    lockToken: row.lockToken,
    lastErrorCode: row.lastErrorCode,
    lastErrorMessage: row.lastErrorMessage,
    lastErrorDetail: row.lastErrorDetail,
    completedAt: row.completedAt ? new Date(row.completedAt) : null,
    requestId: row.requestId,
    createdAt: new Date(row.createdAt),
    updatedAt: new Date(row.updatedAt),
  };
}

export function createTreasuryProjectionRecalcJobRepository(
  db: Db
): TreasuryProjectionRecalcJobRepository {
  return {
    async findActiveByDeduplicationKey(deduplicationKey) {
      const row = await db.treasuryProjectionRecalcJob.findFirst({
        where: {
          deduplicationKey,
          status: { in: [...TREASURY_PROJECTION_RECALC_ACTIVE_STATUSES] },
        },
        orderBy: { createdAt: "asc" },
      });
      return row ? mapRow(row) : null;
    },

    async create(data) {
      const row = await db.treasuryProjectionRecalcJob.create({
        data: {
          companyCode: data.companyCode,
          scenario: data.scenario,
          eventType: data.eventType,
          status: "PENDING",
          deduplicationKey: data.deduplicationKey,
          subjectId: data.subjectId ?? null,
          payloadJson:
            data.payloadJson === undefined
              ? undefined
              : (data.payloadJson as Prisma.InputJsonValue),
          maxAttempts:
            data.maxAttempts ?? TREASURY_PROJECTION_RECALC_DEFAULT_MAX_ATTEMPTS,
          availableAt: data.availableAt,
          requestId: data.requestId ?? null,
        },
      });
      return mapRow(row);
    },

    async touchPending(id, patch) {
      const row = await db.treasuryProjectionRecalcJob.update({
        where: { id },
        data: {
          status: "PENDING",
          availableAt: patch.availableAt,
          ...(patch.payloadJson !== undefined
            ? {
                payloadJson: patch.payloadJson as Prisma.InputJsonValue,
              }
            : {}),
          ...(patch.requestId !== undefined
            ? { requestId: patch.requestId }
            : {}),
          ...(patch.eventType !== undefined
            ? { eventType: patch.eventType }
            : {}),
          lockedAt: null,
          lockedBy: null,
          lockToken: null,
        },
      });
      return mapRow(row);
    },

    async claimNext(workerId, now) {
      const lockToken = randomUUID();
      const rows = await db.$queryRawUnsafe<
        Array<{
          id: string;
          companyCode: string;
          scenario: string;
          eventType: string;
          status: string;
          deduplicationKey: string;
          subjectId: string | null;
          payloadJson: unknown;
          attempts: number;
          maxAttempts: number;
          availableAt: Date;
          lockedAt: Date | null;
          lockedBy: string | null;
          lockToken: string | null;
          lastErrorCode: string | null;
          lastErrorMessage: string | null;
          lastErrorDetail: unknown;
          completedAt: Date | null;
          requestId: string | null;
          createdAt: Date;
          updatedAt: Date;
        }>
      >(
        `
        WITH cte AS (
          SELECT id
          FROM "TreasuryProjectionRecalcJob"
          WHERE status = 'PENDING'
            AND "availableAt" <= $1
          ORDER BY "availableAt" ASC, "createdAt" ASC
          LIMIT 1
          FOR UPDATE SKIP LOCKED
        )
        UPDATE "TreasuryProjectionRecalcJob" AS j
        SET
          status = 'PROCESSING',
          attempts = j.attempts + 1,
          "lockedAt" = $1,
          "lockedBy" = $2,
          "lockToken" = $3,
          "updatedAt" = $1
        FROM cte
        WHERE j.id = cte.id
        RETURNING j.*
        `,
        now,
        workerId,
        lockToken
      );
      const row = rows[0];
      return row ? mapRow(row) : null;
    },

    async markSucceeded(id, lockToken, completedAt) {
      const updated = await db.treasuryProjectionRecalcJob.updateMany({
        where: { id, lockToken, status: "PROCESSING" },
        data: {
          status: "SUCCEEDED",
          completedAt,
          lockedAt: null,
          lockedBy: null,
          lockToken: null,
          lastErrorCode: null,
          lastErrorMessage: null,
          lastErrorDetail: undefined,
        },
      });
      if (updated.count !== 1) {
        throw new Error(
          `Falha ao concluir job ${id}: lockToken inválido ou status != PROCESSING`
        );
      }
      const found = await db.treasuryProjectionRecalcJob.findUniqueOrThrow({
        where: { id },
      });
      return mapRow(found);
    },

    async markRetry(id, lockToken, input) {
      const updated = await db.treasuryProjectionRecalcJob.updateMany({
        where: { id, lockToken, status: "PROCESSING" },
        data: {
          status: "PENDING",
          attempts: input.attempts,
          availableAt: input.availableAt,
          lockedAt: null,
          lockedBy: null,
          lockToken: null,
          lastErrorCode: input.error.code,
          lastErrorMessage: input.error.message,
          lastErrorDetail:
            input.error.detail === undefined
              ? undefined
              : (input.error.detail as Prisma.InputJsonValue),
          completedAt: null,
        },
      });
      if (updated.count !== 1) {
        throw new Error(
          `Falha ao reagendar job ${id}: lockToken inválido ou status != PROCESSING`
        );
      }
      const found = await db.treasuryProjectionRecalcJob.findUniqueOrThrow({
        where: { id },
      });
      return mapRow(found);
    },

    async markDead(id, lockToken, input) {
      const updated = await db.treasuryProjectionRecalcJob.updateMany({
        where: { id, lockToken, status: "PROCESSING" },
        data: {
          status: "DEAD",
          attempts: input.attempts,
          completedAt: input.completedAt,
          lockedAt: null,
          lockedBy: null,
          lockToken: null,
          lastErrorCode: input.error.code,
          lastErrorMessage: input.error.message,
          lastErrorDetail:
            input.error.detail === undefined
              ? undefined
              : (input.error.detail as Prisma.InputJsonValue),
        },
      });
      if (updated.count !== 1) {
        throw new Error(
          `Falha ao marcar DEAD job ${id}: lockToken inválido ou status != PROCESSING`
        );
      }
      const found = await db.treasuryProjectionRecalcJob.findUniqueOrThrow({
        where: { id },
      });
      return mapRow(found);
    },
  };
}
