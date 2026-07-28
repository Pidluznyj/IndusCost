/**
 * Repository Prisma — outbox do espelho planilha.
 */
import { randomUUID } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import {
  MATERIAL_STOCK_SPREADSHEET_MIRROR_ACTIVE_STATUSES,
  type MaterialStockSpreadsheetMirrorEventType,
  type MaterialStockSpreadsheetMirrorStatus,
} from "./types.js";
import { MATERIAL_STOCK_SPREADSHEET_MIRROR_DEFAULT_MAX_ATTEMPTS } from "./queueRules.js";

export type MaterialStockSpreadsheetOutboxRow = {
  id: string;
  materialId: string;
  materialCode: string;
  eventType: MaterialStockSpreadsheetMirrorEventType;
  status: MaterialStockSpreadsheetMirrorStatus;
  deduplicationKey: string;
  idempotencyKey: string;
  payloadJson: unknown;
  attempts: number;
  maxAttempts: number;
  availableAt: Date;
  lastAttemptAt: Date | null;
  lockedAt: Date | null;
  lockedBy: string | null;
  lockToken: string | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  syncedAt: Date | null;
  requestId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type MaterialStockSpreadsheetOutboxCreateData = {
  id?: string;
  materialId: string;
  materialCode: string;
  eventType: MaterialStockSpreadsheetMirrorEventType;
  deduplicationKey: string;
  idempotencyKey: string;
  payloadJson: unknown;
  maxAttempts?: number;
  availableAt: Date;
  requestId?: string | null;
};

export type MaterialStockSpreadsheetOutboxFailure = {
  code: string;
  message: string;
};

type Db = PrismaClient | Prisma.TransactionClient;

function mapRow(row: {
  id: string;
  materialId: string;
  materialCode: string;
  eventType: string;
  status: string;
  deduplicationKey: string;
  idempotencyKey: string;
  payloadJson: unknown;
  attempts: number;
  maxAttempts: number;
  availableAt: Date;
  lastAttemptAt: Date | null;
  lockedAt: Date | null;
  lockedBy: string | null;
  lockToken: string | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  syncedAt: Date | null;
  requestId: string | null;
  createdAt: Date;
  updatedAt: Date;
}): MaterialStockSpreadsheetOutboxRow {
  return {
    id: row.id,
    materialId: row.materialId,
    materialCode: row.materialCode,
    eventType: row.eventType as MaterialStockSpreadsheetMirrorEventType,
    status: row.status as MaterialStockSpreadsheetMirrorStatus,
    deduplicationKey: row.deduplicationKey,
    idempotencyKey: row.idempotencyKey,
    payloadJson: row.payloadJson,
    attempts: row.attempts,
    maxAttempts: row.maxAttempts,
    availableAt: new Date(row.availableAt),
    lastAttemptAt: row.lastAttemptAt ? new Date(row.lastAttemptAt) : null,
    lockedAt: row.lockedAt ? new Date(row.lockedAt) : null,
    lockedBy: row.lockedBy,
    lockToken: row.lockToken,
    lastErrorCode: row.lastErrorCode,
    lastErrorMessage: row.lastErrorMessage,
    syncedAt: row.syncedAt ? new Date(row.syncedAt) : null,
    requestId: row.requestId,
    createdAt: new Date(row.createdAt),
    updatedAt: new Date(row.updatedAt),
  };
}

export type MaterialStockSpreadsheetOutboxRepository = {
  findActiveByDeduplicationKey(
    deduplicationKey: string
  ): Promise<MaterialStockSpreadsheetOutboxRow | null>;
  create(
    data: MaterialStockSpreadsheetOutboxCreateData
  ): Promise<MaterialStockSpreadsheetOutboxRow>;
  touchPending(
    id: string,
    patch: {
      availableAt: Date;
      payloadJson: unknown;
      materialCode: string;
      eventType: MaterialStockSpreadsheetMirrorEventType;
      requestId?: string | null;
    }
  ): Promise<MaterialStockSpreadsheetOutboxRow>;
  claimNext(
    workerId: string,
    now: Date
  ): Promise<MaterialStockSpreadsheetOutboxRow | null>;
  markSynced(
    id: string,
    lockToken: string,
    syncedAt: Date
  ): Promise<MaterialStockSpreadsheetOutboxRow>;
  markRetry(
    id: string,
    lockToken: string,
    input: {
      attempts: number;
      availableAt: Date;
      error: MaterialStockSpreadsheetOutboxFailure;
      lastAttemptAt: Date;
    }
  ): Promise<MaterialStockSpreadsheetOutboxRow>;
  markError(
    id: string,
    lockToken: string,
    input: {
      attempts: number;
      completedAt: Date;
      error: MaterialStockSpreadsheetOutboxFailure;
      lastAttemptAt: Date;
    }
  ): Promise<MaterialStockSpreadsheetOutboxRow>;
  requeue(
    id: string,
    input: { availableAt: Date; idempotencyKey: string }
  ): Promise<MaterialStockSpreadsheetOutboxRow | null>;
  list(input: {
    status?: MaterialStockSpreadsheetMirrorStatus | "ACTIVE" | null;
    page: number;
    pageSize: number;
  }): Promise<{ rows: MaterialStockSpreadsheetOutboxRow[]; total: number }>;
  findLatestSynced(
    materialId?: string
  ): Promise<MaterialStockSpreadsheetOutboxRow | null>;
};

export function createMaterialStockSpreadsheetOutboxRepository(
  db: Db
): MaterialStockSpreadsheetOutboxRepository {
  return {
    async findActiveByDeduplicationKey(deduplicationKey) {
      const row = await db.materialStockSpreadsheetOutbox.findFirst({
        where: {
          deduplicationKey,
          status: { in: [...MATERIAL_STOCK_SPREADSHEET_MIRROR_ACTIVE_STATUSES] },
        },
        orderBy: { createdAt: "asc" },
      });
      return row ? mapRow(row) : null;
    },

    async create(data) {
      const row = await db.materialStockSpreadsheetOutbox.create({
        data: {
          ...(data.id ? { id: data.id } : {}),
          materialId: data.materialId,
          materialCode: data.materialCode,
          eventType: data.eventType,
          status: "PENDING",
          deduplicationKey: data.deduplicationKey,
          idempotencyKey: data.idempotencyKey,
          payloadJson: data.payloadJson as Prisma.InputJsonValue,
          maxAttempts:
            data.maxAttempts ??
            MATERIAL_STOCK_SPREADSHEET_MIRROR_DEFAULT_MAX_ATTEMPTS,
          availableAt: data.availableAt,
          requestId: data.requestId ?? null,
        },
      });
      return mapRow(row);
    },

    async touchPending(id, patch) {
      const row = await db.materialStockSpreadsheetOutbox.update({
        where: { id },
        data: {
          status: "PENDING",
          availableAt: patch.availableAt,
          payloadJson: patch.payloadJson as Prisma.InputJsonValue,
          materialCode: patch.materialCode,
          eventType: patch.eventType,
          ...(patch.requestId !== undefined
            ? { requestId: patch.requestId }
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
          materialId: string;
          materialCode: string;
          eventType: string;
          status: string;
          deduplicationKey: string;
          idempotencyKey: string;
          payloadJson: unknown;
          attempts: number;
          maxAttempts: number;
          availableAt: Date;
          lastAttemptAt: Date | null;
          lockedAt: Date | null;
          lockedBy: string | null;
          lockToken: string | null;
          lastErrorCode: string | null;
          lastErrorMessage: string | null;
          syncedAt: Date | null;
          requestId: string | null;
          createdAt: Date;
          updatedAt: Date;
        }>
      >(
        `
        WITH cte AS (
          SELECT id
          FROM "MaterialStockSpreadsheetOutbox"
          WHERE status = 'PENDING'
            AND "availableAt" <= $1
          ORDER BY "availableAt" ASC, "createdAt" ASC
          LIMIT 1
          FOR UPDATE SKIP LOCKED
        )
        UPDATE "MaterialStockSpreadsheetOutbox" AS j
        SET
          status = 'PROCESSING',
          attempts = j.attempts + 1,
          "lastAttemptAt" = $1,
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

    async markSynced(id, lockToken, syncedAt) {
      const updated = await db.materialStockSpreadsheetOutbox.updateMany({
        where: { id, lockToken, status: "PROCESSING" },
        data: {
          status: "SYNCED",
          syncedAt,
          lockedAt: null,
          lockedBy: null,
          lockToken: null,
          lastErrorCode: null,
          lastErrorMessage: null,
        },
      });
      if (updated.count !== 1) {
        throw new Error(
          `Falha ao marcar SYNCED ${id}: lockToken inválido ou status != PROCESSING`
        );
      }
      const found = await db.materialStockSpreadsheetOutbox.findUniqueOrThrow({
        where: { id },
      });
      return mapRow(found);
    },

    async markRetry(id, lockToken, input) {
      const updated = await db.materialStockSpreadsheetOutbox.updateMany({
        where: { id, lockToken, status: "PROCESSING" },
        data: {
          status: "PENDING",
          attempts: input.attempts,
          availableAt: input.availableAt,
          lastAttemptAt: input.lastAttemptAt,
          lockedAt: null,
          lockedBy: null,
          lockToken: null,
          lastErrorCode: input.error.code,
          lastErrorMessage: input.error.message.slice(0, 500),
          syncedAt: null,
        },
      });
      if (updated.count !== 1) {
        throw new Error(
          `Falha ao reagendar ${id}: lockToken inválido ou status != PROCESSING`
        );
      }
      const found = await db.materialStockSpreadsheetOutbox.findUniqueOrThrow({
        where: { id },
      });
      return mapRow(found);
    },

    async markError(id, lockToken, input) {
      const updated = await db.materialStockSpreadsheetOutbox.updateMany({
        where: { id, lockToken, status: "PROCESSING" },
        data: {
          status: "ERROR",
          attempts: input.attempts,
          lastAttemptAt: input.lastAttemptAt,
          lockedAt: null,
          lockedBy: null,
          lockToken: null,
          lastErrorCode: input.error.code,
          lastErrorMessage: input.error.message.slice(0, 500),
        },
      });
      if (updated.count !== 1) {
        throw new Error(
          `Falha ao marcar ERROR ${id}: lockToken inválido ou status != PROCESSING`
        );
      }
      const found = await db.materialStockSpreadsheetOutbox.findUniqueOrThrow({
        where: { id },
      });
      return mapRow(found);
    },

    async requeue(id, input) {
      const existing = await db.materialStockSpreadsheetOutbox.findUnique({
        where: { id },
      });
      if (!existing) return null;
      if (existing.status !== "ERROR" && existing.status !== "SYNCED") {
        return mapRow(existing);
      }
      const row = await db.materialStockSpreadsheetOutbox.update({
        where: { id },
        data: {
          status: "PENDING",
          availableAt: input.availableAt,
          idempotencyKey: input.idempotencyKey,
          attempts: 0,
          lockedAt: null,
          lockedBy: null,
          lockToken: null,
          lastErrorCode: null,
          lastErrorMessage: null,
          syncedAt: null,
        },
      });
      return mapRow(row);
    },

    async list(input) {
      const page = Math.max(1, input.page);
      const pageSize = Math.min(100, Math.max(1, input.pageSize));
      const where =
        input.status === "ACTIVE"
          ? {
              status: {
                in: [...MATERIAL_STOCK_SPREADSHEET_MIRROR_ACTIVE_STATUSES],
              },
            }
          : input.status
            ? { status: input.status }
            : {};
      const [total, rows] = await Promise.all([
        db.materialStockSpreadsheetOutbox.count({ where }),
        db.materialStockSpreadsheetOutbox.findMany({
          where,
          orderBy: [{ updatedAt: "desc" }],
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
      ]);
      return { rows: rows.map(mapRow), total };
    },

    async findLatestSynced(materialId) {
      const row = await db.materialStockSpreadsheetOutbox.findFirst({
        where: {
          status: "SYNCED",
          ...(materialId ? { materialId } : {}),
        },
        orderBy: { syncedAt: "desc" },
      });
      return row ? mapRow(row) : null;
    },
  };
}
