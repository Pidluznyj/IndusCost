/**
 * Repository Prisma — snapshots de saldo da Tesouraria (server-only).
 */

import type { Prisma, PrismaClient } from "@prisma/client";
import type { TreasuryBalanceOrigin } from "../contracts/treasuryEnums.js";
import {
  type TreasuryBalanceSnapshotRow,
} from "../mappers/treasuryBalanceMappers.js";

export type TreasuryBalanceDb = PrismaClient | Prisma.TransactionClient;

export type TreasuryBalanceListFilter = {
  accountId: string;
  origin?: TreasuryBalanceOrigin | string | null;
  referenceFrom?: Date | null;
  referenceTo?: Date | null;
  page: number;
  pageSize: number;
};

export type TreasuryBalanceCreateData = {
  accountId: string;
  referenceAt: Date;
  availableBalance: string;
  blockedBalance: string;
  investmentsBalance: string;
  usedLimit: string;
  origin: TreasuryBalanceOrigin;
  idempotencyKey: string;
  notes: string | null;
  attachmentUrl: string | null;
  createdByUserId: string;
  previousSnapshotId: string | null;
};

function mapRow(row: {
  id: string;
  accountId: string;
  referenceAt: Date;
  availableBalance: { toFixed(digits: number): string } | string | number;
  blockedBalance: { toFixed(digits: number): string } | string | number;
  investmentsBalance: { toFixed(digits: number): string } | string | number;
  usedLimit: { toFixed(digits: number): string } | string | number;
  origin: string;
  idempotencyKey: string;
  notes: string | null;
  attachmentUrl: string | null;
  createdByUserId: string;
  previousSnapshotId: string | null;
  createdAt: Date;
}): TreasuryBalanceSnapshotRow {
  return row as TreasuryBalanceSnapshotRow;
}

export type TreasuryBalanceCancelData = {
  cancelledByUserId: string;
  cancelReason: string;
};

export type TreasuryBalanceRepository = {
  findById(
    id: string,
    db?: TreasuryBalanceDb
  ): Promise<TreasuryBalanceSnapshotRow | null>;
  findByIdempotency(
    accountId: string,
    origin: string,
    idempotencyKey: string,
    db?: TreasuryBalanceDb
  ): Promise<TreasuryBalanceSnapshotRow | null>;
  findLatest(
    accountId: string,
    db?: TreasuryBalanceDb
  ): Promise<TreasuryBalanceSnapshotRow | null>;
  /** Último snapshot por conta em uma query (DISTINCT ON). */
  findLatestByAccountIds(
    accountIds: string[],
    db?: TreasuryBalanceDb
  ): Promise<Map<string, TreasuryBalanceSnapshotRow>>;
  list(
    filter: TreasuryBalanceListFilter,
    db?: TreasuryBalanceDb
  ): Promise<{ rows: TreasuryBalanceSnapshotRow[]; total: number }>;
  create(
    data: TreasuryBalanceCreateData,
    db?: TreasuryBalanceDb
  ): Promise<TreasuryBalanceSnapshotRow>;
  /** Cancelamento lógico (SUPER_ADMIN) — nunca DELETE físico. */
  cancel(
    id: string,
    data: TreasuryBalanceCancelData,
    db?: TreasuryBalanceDb
  ): Promise<TreasuryBalanceSnapshotRow>;
};

export function createTreasuryBalanceRepository(
  prisma: PrismaClient
): TreasuryBalanceRepository {
  const client = (db?: TreasuryBalanceDb) => db ?? prisma;

  return {
    async findById(id, db) {
      const row = await client(db).treasuryBalanceSnapshot.findUnique({
        where: { id },
      });
      return row ? mapRow(row) : null;
    },

    async findByIdempotency(accountId, origin, idempotencyKey, db) {
      const row = await client(db).treasuryBalanceSnapshot.findUnique({
        where: {
          accountId_origin_idempotencyKey: {
            accountId,
            origin: origin as TreasuryBalanceOrigin,
            idempotencyKey,
          },
        },
      });
      return row ? mapRow(row) : null;
    },

    async findLatest(accountId, db) {
      const row = await client(db).treasuryBalanceSnapshot.findFirst({
        where: { accountId, cancelledAt: null },
        orderBy: [{ referenceAt: "desc" }, { createdAt: "desc" }],
      });
      return row ? mapRow(row) : null;
    },

    async findLatestByAccountIds(accountIds, db) {
      const out = new Map<string, TreasuryBalanceSnapshotRow>();
      if (!accountIds.length) return out;
      const c = client(db);
      const rows = await c.$queryRaw<
        Array<{
          id: string;
          accountId: string;
          referenceAt: Date;
          availableBalance: { toFixed(digits: number): string } | string | number;
          blockedBalance: { toFixed(digits: number): string } | string | number;
          investmentsBalance:
            | { toFixed(digits: number): string }
            | string
            | number;
          usedLimit: { toFixed(digits: number): string } | string | number;
          origin: string;
          idempotencyKey: string;
          notes: string | null;
          attachmentUrl: string | null;
          createdByUserId: string;
          previousSnapshotId: string | null;
          createdAt: Date;
        }>
      >`
        SELECT DISTINCT ON ("accountId")
          id,
          "accountId",
          "referenceAt",
          "availableBalance",
          "blockedBalance",
          "investmentsBalance",
          "usedLimit",
          origin,
          "idempotencyKey",
          notes,
          "attachmentUrl",
          "createdByUserId",
          "previousSnapshotId",
          "createdAt"
        FROM "TreasuryBalanceSnapshot"
        WHERE "accountId" = ANY(${accountIds}::uuid[])
          AND "cancelledAt" IS NULL
        ORDER BY "accountId", "referenceAt" DESC, "createdAt" DESC
      `;
      for (const row of rows) {
        out.set(row.accountId, mapRow(row));
      }
      return out;
    },

    async list(filter, db) {
      const where: Prisma.TreasuryBalanceSnapshotWhereInput = {
        accountId: filter.accountId,
      };
      if (filter.origin) {
        where.origin = filter.origin as TreasuryBalanceOrigin;
      }
      if (filter.referenceFrom || filter.referenceTo) {
        where.referenceAt = {};
        if (filter.referenceFrom) {
          where.referenceAt.gte = filter.referenceFrom;
        }
        if (filter.referenceTo) {
          where.referenceAt.lte = filter.referenceTo;
        }
      }
      const c = client(db);
      const [total, rows] = await Promise.all([
        c.treasuryBalanceSnapshot.count({ where }),
        c.treasuryBalanceSnapshot.findMany({
          where,
          orderBy: [{ referenceAt: "desc" }, { createdAt: "desc" }],
          skip: (filter.page - 1) * filter.pageSize,
          take: filter.pageSize,
        }),
      ]);
      return { rows: rows.map(mapRow), total };
    },

    async create(data, db) {
      const row = await client(db).treasuryBalanceSnapshot.create({
        data: {
          accountId: data.accountId,
          referenceAt: data.referenceAt,
          availableBalance: data.availableBalance,
          blockedBalance: data.blockedBalance,
          investmentsBalance: data.investmentsBalance,
          usedLimit: data.usedLimit,
          origin: data.origin,
          idempotencyKey: data.idempotencyKey,
          notes: data.notes,
          attachmentUrl: data.attachmentUrl,
          createdByUserId: data.createdByUserId,
          previousSnapshotId: data.previousSnapshotId,
        },
      });
      return mapRow(row);
    },

    async cancel(id, data, db) {
      const row = await client(db).treasuryBalanceSnapshot.update({
        where: { id },
        data: {
          cancelledAt: new Date(),
          cancelledByUserId: data.cancelledByUserId,
          cancelReason: data.cancelReason,
        },
      });
      return mapRow(row);
    },
  };
}
