/**
 * Repository de transferências internas — Prisma.
 */

import { Prisma } from "@prisma/client";
import type {
  PrismaClient,
  TreasuryTransferStatus,
} from "@prisma/client";
import { TreasuryDomainError } from "../domain/treasuryErrors.js";
import type { TreasuryTransferRow } from "../mappers/treasuryTransferMappers.js";

export type TreasuryTransferDb = PrismaClient | Prisma.TransactionClient;

function moneyToDecimal(value: string): Prisma.Decimal {
  return new Prisma.Decimal(value);
}

function civilDateToUtcDate(value: string): Date {
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

function mapRow(row: {
  id: string;
  transferGroupId: string;
  companyCode: string;
  fromAccountId: string;
  toAccountId: string;
  amount: Prisma.Decimal;
  currency: string;
  civilDate: Date;
  sentCivilDate: Date | null;
  receivedCivilDate: Date | null;
  reconciledCivilDate: Date | null;
  sentAt: Date | null;
  receivedAt: Date | null;
  reconciledAt: Date | null;
  status: TreasuryTransferStatus;
  memo: string | null;
  version: number;
  createdAt: Date;
  createdByUserId: string;
  updatedAt: Date;
  updatedByUserId: string | null;
  cancelledAt: Date | null;
  cancelledByUserId: string | null;
  cancellationReason: string | null;
}): TreasuryTransferRow {
  return {
    ...row,
    amount: row.amount,
    currency: row.currency,
  };
}

export type TreasuryTransferCreateData = {
  transferGroupId: string;
  companyCode: string;
  fromAccountId: string;
  toAccountId: string;
  amount: string;
  currency?: string;
  civilDate: string;
  status: TreasuryTransferStatus;
  memo?: string | null;
  createdByUserId: string;
};

export type TreasuryTransferUpdateData = {
  status?: TreasuryTransferStatus;
  civilDate?: string;
  sentCivilDate?: string | null;
  receivedCivilDate?: string | null;
  reconciledCivilDate?: string | null;
  sentAt?: Date | null;
  receivedAt?: Date | null;
  reconciledAt?: Date | null;
  memo?: string | null;
  updatedByUserId: string;
  expectedVersion: number;
};

export type TreasuryTransferCancelData = {
  cancelledByUserId: string;
  cancellationReason: string;
  expectedVersion: number;
};

export type TreasuryTransferListFilter = {
  companyCode?: string | null;
  status?: TreasuryTransferStatus | null;
  fromAccountId?: string | null;
  toAccountId?: string | null;
  from?: string | null;
  to?: string | null;
  page: number;
  pageSize: number;
};

export type TreasuryTransferRepository = {
  findById(
    id: string,
    db?: TreasuryTransferDb
  ): Promise<TreasuryTransferRow | null>;
  list(
    filter: TreasuryTransferListFilter,
    db?: TreasuryTransferDb
  ): Promise<{ total: number; rows: TreasuryTransferRow[] }>;
  listActiveForAccounts(
    accountIds: string[],
    db?: TreasuryTransferDb
  ): Promise<TreasuryTransferRow[]>;
  create(
    data: TreasuryTransferCreateData,
    db?: TreasuryTransferDb
  ): Promise<TreasuryTransferRow>;
  update(
    id: string,
    data: TreasuryTransferUpdateData,
    db?: TreasuryTransferDb
  ): Promise<TreasuryTransferRow>;
  cancel(
    id: string,
    data: TreasuryTransferCancelData,
    db?: TreasuryTransferDb
  ): Promise<TreasuryTransferRow>;
};

export function createTreasuryTransferRepository(
  prisma: PrismaClient
): TreasuryTransferRepository {
  function client(db?: TreasuryTransferDb): TreasuryTransferDb {
    return db ?? prisma;
  }

  return {
    async findById(id, db) {
      const row = await client(db).treasuryTransfer.findUnique({
        where: { id },
      });
      return row ? mapRow(row) : null;
    },

    async list(filter, db) {
      const where: Prisma.TreasuryTransferWhereInput = {};
      if (filter.companyCode) where.companyCode = filter.companyCode;
      if (filter.status) where.status = filter.status;
      if (filter.fromAccountId) where.fromAccountId = filter.fromAccountId;
      if (filter.toAccountId) where.toAccountId = filter.toAccountId;
      if (filter.from || filter.to) {
        where.civilDate = {};
        if (filter.from) {
          where.civilDate.gte = civilDateToUtcDate(filter.from);
        }
        if (filter.to) {
          where.civilDate.lte = civilDateToUtcDate(filter.to);
        }
      }
      const [total, rows] = await Promise.all([
        client(db).treasuryTransfer.count({ where }),
        client(db).treasuryTransfer.findMany({
          where,
          orderBy: [{ civilDate: "desc" }, { createdAt: "desc" }],
          skip: (filter.page - 1) * filter.pageSize,
          take: filter.pageSize,
        }),
      ]);
      return { total, rows: rows.map(mapRow) };
    },

    async listActiveForAccounts(accountIds, db) {
      if (!accountIds.length) return [];
      const rows = await client(db).treasuryTransfer.findMany({
        where: {
          status: { not: "CANCELLED" },
          OR: [
            { fromAccountId: { in: accountIds } },
            { toAccountId: { in: accountIds } },
          ],
        },
        orderBy: [{ civilDate: "asc" }, { createdAt: "asc" }],
      });
      return rows.map(mapRow);
    },

    async create(data, db) {
      const row = await client(db).treasuryTransfer.create({
        data: {
          transferGroupId: data.transferGroupId,
          companyCode: data.companyCode,
          fromAccountId: data.fromAccountId,
          toAccountId: data.toAccountId,
          amount: moneyToDecimal(data.amount),
          currency: (data.currency as "BRL") ?? "BRL",
          civilDate: civilDateToUtcDate(data.civilDate),
          status: data.status,
          memo: data.memo ?? null,
          createdByUserId: data.createdByUserId,
          updatedByUserId: data.createdByUserId,
        },
      });
      return mapRow(row);
    },

    async update(id, data, db) {
      const current = await client(db).treasuryTransfer.findUnique({
        where: { id },
        select: { version: true, status: true },
      });
      if (!current) {
        throw new TreasuryDomainError(
          "NOT_FOUND",
          "Transferência não encontrada.",
          "id"
        );
      }
      if (current.status === "CANCELLED") {
        throw new TreasuryDomainError(
          "CONFLICT",
          "Transferência cancelada não pode ser alterada.",
          "id"
        );
      }
      if (current.version !== data.expectedVersion) {
        throw new TreasuryDomainError(
          "CONFLICT",
          "Versão da transferência desatualizada.",
          "expectedVersion"
        );
      }
      const row = await client(db).treasuryTransfer.update({
        where: { id },
        data: {
          status: data.status,
          civilDate:
            data.civilDate != null
              ? civilDateToUtcDate(data.civilDate)
              : undefined,
          sentCivilDate:
            data.sentCivilDate === undefined
              ? undefined
              : data.sentCivilDate
                ? civilDateToUtcDate(data.sentCivilDate)
                : null,
          receivedCivilDate:
            data.receivedCivilDate === undefined
              ? undefined
              : data.receivedCivilDate
                ? civilDateToUtcDate(data.receivedCivilDate)
                : null,
          reconciledCivilDate:
            data.reconciledCivilDate === undefined
              ? undefined
              : data.reconciledCivilDate
                ? civilDateToUtcDate(data.reconciledCivilDate)
                : null,
          sentAt: data.sentAt === undefined ? undefined : data.sentAt,
          receivedAt:
            data.receivedAt === undefined ? undefined : data.receivedAt,
          reconciledAt:
            data.reconciledAt === undefined ? undefined : data.reconciledAt,
          memo: data.memo === undefined ? undefined : data.memo,
          updatedByUserId: data.updatedByUserId,
          version: { increment: 1 },
        },
      });
      return mapRow(row);
    },

    async cancel(id, data, db) {
      const current = await client(db).treasuryTransfer.findUnique({
        where: { id },
        select: { version: true, status: true },
      });
      if (!current) {
        throw new TreasuryDomainError(
          "NOT_FOUND",
          "Transferência não encontrada.",
          "id"
        );
      }
      if (current.status === "CANCELLED") {
        throw new TreasuryDomainError(
          "CONFLICT",
          "Transferência já está cancelada.",
          "id"
        );
      }
      if (current.version !== data.expectedVersion) {
        throw new TreasuryDomainError(
          "CONFLICT",
          "Versão da transferência desatualizada.",
          "expectedVersion"
        );
      }
      const row = await client(db).treasuryTransfer.update({
        where: { id },
        data: {
          status: "CANCELLED",
          cancelledAt: new Date(),
          cancelledByUserId: data.cancelledByUserId,
          cancellationReason: data.cancellationReason,
          updatedByUserId: data.cancelledByUserId,
          version: { increment: 1 },
        },
      });
      return mapRow(row);
    },
  };
}
