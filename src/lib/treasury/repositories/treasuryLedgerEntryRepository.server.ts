/**
 * Repository Prisma — TreasuryLedgerEntry.
 */

import type { Prisma, PrismaClient } from "@prisma/client";
import { TreasuryDomainError } from "../domain/treasuryErrors.js";
import type { TreasuryLedgerEntryRow } from "../mappers/treasuryLedgerEntryMappers.js";
import type {
  TreasuryLedgerDirection,
  TreasuryLedgerNature,
  TreasuryLedgerStatus,
} from "../contracts/treasuryEnums.js";

type Db = PrismaClient | Prisma.TransactionClient;

export type TreasuryLedgerEntryCreateData = {
  companyCode: string;
  accountId: string;
  civilDate: string;
  amount: string;
  currency?: string;
  direction: TreasuryLedgerDirection;
  nature: TreasuryLedgerNature;
  status?: TreasuryLedgerStatus;
  memo: string | null;
  counterpartRef: string | null;
  transferGroupId?: string | null;
  reversesEntryId?: string | null;
  createdByUserId: string;
};

export type TreasuryLedgerEntryListFilter = {
  companyCode?: string | null;
  accountId?: string | null;
  status?: TreasuryLedgerStatus | null;
  from?: string | null;
  to?: string | null;
  page: number;
  pageSize: number;
};

export type TreasuryLedgerEntryRepository = {
  findById(id: string, db?: Db): Promise<TreasuryLedgerEntryRow | null>;
  list(
    filter: TreasuryLedgerEntryListFilter,
    db?: Db
  ): Promise<{ total: number; rows: TreasuryLedgerEntryRow[] }>;
  create(
    data: TreasuryLedgerEntryCreateData,
    db?: Db
  ): Promise<TreasuryLedgerEntryRow>;
  markReversed(
    input: {
      originalId: string;
      reversalId: string;
      expectedVersion: number;
      updatedByUserId: string;
    },
    db?: Db
  ): Promise<TreasuryLedgerEntryRow>;
};

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

function mapRow(row: {
  id: string;
  companyCode: string;
  accountId: string;
  civilDate: Date;
  amount: { toFixed(d: number): string };
  currency: string;
  direction: string;
  nature: string;
  status: string;
  memo: string | null;
  counterpartRef: string | null;
  transferGroupId: string | null;
  reversesEntryId: string | null;
  reversedByEntryId: string | null;
  version: number;
  createdAt: Date;
  createdByUserId: string;
  updatedAt: Date;
  updatedByUserId: string | null;
}): TreasuryLedgerEntryRow {
  return {
    id: row.id,
    companyCode: row.companyCode,
    accountId: row.accountId,
    civilDate: row.civilDate,
    amount: row.amount,
    currency: row.currency,
    direction: row.direction as TreasuryLedgerDirection,
    nature: row.nature as TreasuryLedgerNature,
    status: row.status as TreasuryLedgerStatus,
    memo: row.memo,
    counterpartRef: row.counterpartRef,
    transferGroupId: row.transferGroupId,
    reversesEntryId: row.reversesEntryId,
    reversedByEntryId: row.reversedByEntryId,
    version: row.version,
    createdAt: row.createdAt,
    createdByUserId: row.createdByUserId,
    updatedAt: row.updatedAt,
    updatedByUserId: row.updatedByUserId,
  };
}

export function createTreasuryLedgerEntryRepository(
  prisma: PrismaClient
): TreasuryLedgerEntryRepository {
  const client = (db?: Db) => db ?? prisma;

  return {
    async findById(id, db) {
      const row = await client(db).treasuryLedgerEntry.findUnique({
        where: { id },
      });
      return row ? mapRow(row) : null;
    },

    async list(filter, db) {
      const where: Prisma.TreasuryLedgerEntryWhereInput = {};
      if (filter.companyCode) where.companyCode = filter.companyCode;
      if (filter.accountId) where.accountId = filter.accountId;
      if (filter.status) where.status = filter.status;
      if (filter.from || filter.to) {
        where.civilDate = {
          ...(filter.from ? { gte: parseCivil(filter.from) } : {}),
          ...(filter.to ? { lte: parseCivil(filter.to) } : {}),
        };
      }
      const [total, rows] = await Promise.all([
        client(db).treasuryLedgerEntry.count({ where }),
        client(db).treasuryLedgerEntry.findMany({
          where,
          orderBy: [{ civilDate: "desc" }, { createdAt: "desc" }],
          skip: (filter.page - 1) * filter.pageSize,
          take: filter.pageSize,
        }),
      ]);
      return { total, rows: rows.map(mapRow) };
    },

    async create(data, db) {
      const row = await client(db).treasuryLedgerEntry.create({
        data: {
          companyCode: data.companyCode,
          accountId: data.accountId,
          civilDate: parseCivil(data.civilDate),
          amount: data.amount,
          currency: (data.currency as "BRL") ?? "BRL",
          direction: data.direction,
          nature: data.nature,
          status: data.status ?? "ACTIVE",
          memo: data.memo,
          counterpartRef: data.counterpartRef,
          transferGroupId: data.transferGroupId ?? null,
          reversesEntryId: data.reversesEntryId ?? null,
          createdByUserId: data.createdByUserId,
        },
      });
      return mapRow(row);
    },

    async markReversed(input, db) {
      const updated = await client(db).treasuryLedgerEntry.updateMany({
        where: {
          id: input.originalId,
          version: input.expectedVersion,
          status: "ACTIVE",
        },
        data: {
          status: "REVERSED",
          reversedByEntryId: input.reversalId,
          version: { increment: 1 },
          updatedByUserId: input.updatedByUserId,
        },
      });
      if (updated.count !== 1) {
        throw new TreasuryDomainError(
          "CONFLICT",
          "Não foi possível reverter o lançamento (conflito de versão/status).",
          "expectedVersion"
        );
      }
      const row = await client(db).treasuryLedgerEntry.findUnique({
        where: { id: input.originalId },
      });
      if (!row) {
        throw new TreasuryDomainError("NOT_FOUND", "Lançamento não encontrado.");
      }
      return mapRow(row);
    },
  };
}
