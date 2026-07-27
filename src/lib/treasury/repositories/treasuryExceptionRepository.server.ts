/**
 * Repository de exceções da Tesouraria — Prisma.
 */

import { Prisma } from "@prisma/client";
import type {
  PrismaClient,
  TreasuryExceptionEntityKind,
  TreasuryExceptionSeverity,
  TreasuryExceptionStatus,
  TreasuryExceptionType,
} from "@prisma/client";
import { TreasuryDomainError } from "../domain/treasuryErrors.js";
import type { TreasuryExceptionRow } from "../mappers/treasuryExceptionMappers.js";

export type TreasuryExceptionDb = PrismaClient | Prisma.TransactionClient;

function moneyToDecimal(value: string | null | undefined): Prisma.Decimal | null {
  if (value == null || value === "") return null;
  return new Prisma.Decimal(value);
}

function civilDateToUtcDate(value: string | null | undefined): Date | null {
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

function mapRow(row: {
  id: string;
  companyCode: string;
  uniqueKey: string;
  type: TreasuryExceptionType;
  severity: TreasuryExceptionSeverity;
  status: TreasuryExceptionStatus;
  entityKind: TreasuryExceptionEntityKind | null;
  entityId: string | null;
  accountId: string | null;
  nomusExternalId: string | null;
  title: string;
  description: string | null;
  amount: Prisma.Decimal | null;
  detectedAt: Date;
  dueAt: Date | null;
  responsibleUserId: string | null;
  resolution: string | null;
  ignoreJustification: string | null;
  recurrenceCount: number;
  metadataJson: Prisma.JsonValue | null;
  version: number;
  createdAt: Date;
  createdByUserId: string;
  updatedAt: Date;
  updatedByUserId: string | null;
  acknowledgedAt: Date | null;
  resolvedAt: Date | null;
  cancelledAt: Date | null;
  cancelledByUserId: string | null;
}): TreasuryExceptionRow {
  return {
    ...row,
    amount: row.amount,
    metadataJson: row.metadataJson,
  };
}

export type TreasuryExceptionCreateData = {
  companyCode: string;
  uniqueKey: string;
  type: TreasuryExceptionType;
  severity: TreasuryExceptionSeverity;
  status?: TreasuryExceptionStatus;
  entityKind?: TreasuryExceptionEntityKind | null;
  entityId?: string | null;
  accountId?: string | null;
  nomusExternalId?: string | null;
  title: string;
  description?: string | null;
  amount?: string | null;
  detectedAt: Date;
  dueAt?: string | null;
  responsibleUserId?: string | null;
  recurrenceCount?: number;
  metadataJson?: Record<string, unknown> | null;
  createdByUserId: string;
};

export type TreasuryExceptionUpdateData = {
  type?: TreasuryExceptionType;
  severity?: TreasuryExceptionSeverity;
  status?: TreasuryExceptionStatus;
  entityKind?: TreasuryExceptionEntityKind | null;
  entityId?: string | null;
  accountId?: string | null;
  nomusExternalId?: string | null;
  title?: string;
  description?: string | null;
  amount?: string | null;
  detectedAt?: Date;
  dueAt?: string | null;
  responsibleUserId?: string | null;
  resolution?: string | null;
  ignoreJustification?: string | null;
  recurrenceCount?: number;
  metadataJson?: Record<string, unknown> | null;
  acknowledgedAt?: Date | null;
  resolvedAt?: Date | null;
  cancelledAt?: Date | null;
  cancelledByUserId?: string | null;
  updatedByUserId: string;
  expectedVersion: number;
};

export type TreasuryExceptionListFilter = {
  companyCode?: string | null;
  status?: TreasuryExceptionStatus | null;
  type?: TreasuryExceptionType | null;
  severity?: TreasuryExceptionSeverity | null;
  responsibleUserId?: string | null;
  search?: string | null;
  sortBy?: string;
  sortDirection?: "asc" | "desc";
  page: number;
  pageSize: number;
};

export type TreasuryExceptionRepository = {
  findById(
    id: string,
    db?: TreasuryExceptionDb
  ): Promise<TreasuryExceptionRow | null>;
  findByUniqueKey(
    uniqueKey: string,
    db?: TreasuryExceptionDb
  ): Promise<TreasuryExceptionRow | null>;
  list(
    filter: TreasuryExceptionListFilter,
    db?: TreasuryExceptionDb
  ): Promise<{ total: number; rows: TreasuryExceptionRow[] }>;
  create(
    data: TreasuryExceptionCreateData,
    db?: TreasuryExceptionDb
  ): Promise<TreasuryExceptionRow>;
  update(
    id: string,
    data: TreasuryExceptionUpdateData,
    db?: TreasuryExceptionDb
  ): Promise<TreasuryExceptionRow>;
};

export function createTreasuryExceptionRepository(
  prisma: PrismaClient
): TreasuryExceptionRepository {
  function client(db?: TreasuryExceptionDb): TreasuryExceptionDb {
    return db ?? prisma;
  }

  return {
    async findById(id, db) {
      const row = await client(db).treasuryException.findUnique({
        where: { id },
      });
      return row ? mapRow(row) : null;
    },

    async findByUniqueKey(uniqueKey, db) {
      const row = await client(db).treasuryException.findUnique({
        where: { uniqueKey },
      });
      return row ? mapRow(row) : null;
    },

    async list(filter, db) {
      const where: Prisma.TreasuryExceptionWhereInput = {};
      if (filter.companyCode) where.companyCode = filter.companyCode;
      if (filter.status) where.status = filter.status;
      if (filter.type) where.type = filter.type;
      if (filter.severity) where.severity = filter.severity;
      if (filter.responsibleUserId) {
        where.responsibleUserId = filter.responsibleUserId;
      }
      if (filter.search?.trim()) {
        const q = filter.search.trim();
        where.OR = [
          { title: { contains: q, mode: "insensitive" } },
          { description: { contains: q, mode: "insensitive" } },
          { uniqueKey: { contains: q, mode: "insensitive" } },
          { entityId: { contains: q, mode: "insensitive" } },
        ];
      }
      const dir = filter.sortDirection === "asc" ? "asc" : "desc";
      let orderBy: Prisma.TreasuryExceptionOrderByWithRelationInput[];
      switch (filter.sortBy) {
        case "dueAt":
          orderBy = [{ dueAt: dir }, { detectedAt: "desc" }];
          break;
        case "severity":
          orderBy = [{ severity: dir }, { detectedAt: "desc" }];
          break;
        case "status":
          orderBy = [{ status: dir }, { detectedAt: "desc" }];
          break;
        case "amount":
          orderBy = [{ amount: dir }, { detectedAt: "desc" }];
          break;
        case "title":
          orderBy = [{ title: dir }];
          break;
        case "ageDays":
          // idade desc = detectedAt asc
          orderBy = [
            { detectedAt: dir === "desc" ? "asc" : "desc" },
          ];
          break;
        case "detectedAt":
        default:
          orderBy = [{ detectedAt: dir }];
          break;
      }
      const [total, rows] = await Promise.all([
        client(db).treasuryException.count({ where }),
        client(db).treasuryException.findMany({
          where,
          orderBy,
          skip: (filter.page - 1) * filter.pageSize,
          take: filter.pageSize,
        }),
      ]);
      return { total, rows: rows.map(mapRow) };
    },

    async create(data, db) {
      try {
        const row = await client(db).treasuryException.create({
          data: {
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
            amount: moneyToDecimal(data.amount),
            detectedAt: data.detectedAt,
            dueAt: civilDateToUtcDate(data.dueAt),
            responsibleUserId: data.responsibleUserId ?? null,
            recurrenceCount: data.recurrenceCount ?? 1,
            metadataJson:
              data.metadataJson === undefined
                ? undefined
                : (data.metadataJson as Prisma.InputJsonValue),
            createdByUserId: data.createdByUserId,
            updatedByUserId: data.createdByUserId,
          },
        });
        return mapRow(row);
      } catch (err) {
        if (
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === "P2002"
        ) {
          const existing = await client(db).treasuryException.findUnique({
            where: { uniqueKey: data.uniqueKey },
          });
          if (existing) return mapRow(existing);
        }
        throw err;
      }
    },

    async update(id, data, db) {
      const current = await client(db).treasuryException.findUnique({
        where: { id },
        select: { version: true },
      });
      if (!current) {
        throw new TreasuryDomainError(
          "NOT_FOUND",
          "Exceção não encontrada.",
          "id"
        );
      }
      if (current.version !== data.expectedVersion) {
        throw new TreasuryDomainError(
          "CONFLICT",
          "Versão da exceção desatualizada.",
          "expectedVersion"
        );
      }
      const row = await client(db).treasuryException.update({
        where: { id },
        data: {
          type: data.type,
          severity: data.severity,
          status: data.status,
          entityKind:
            data.entityKind === undefined ? undefined : data.entityKind,
          entityId: data.entityId === undefined ? undefined : data.entityId,
          accountId: data.accountId === undefined ? undefined : data.accountId,
          nomusExternalId:
            data.nomusExternalId === undefined
              ? undefined
              : data.nomusExternalId,
          title: data.title,
          description:
            data.description === undefined ? undefined : data.description,
          amount:
            data.amount === undefined
              ? undefined
              : moneyToDecimal(data.amount),
          detectedAt: data.detectedAt,
          dueAt:
            data.dueAt === undefined
              ? undefined
              : civilDateToUtcDate(data.dueAt),
          responsibleUserId:
            data.responsibleUserId === undefined
              ? undefined
              : data.responsibleUserId,
          resolution:
            data.resolution === undefined ? undefined : data.resolution,
          ignoreJustification:
            data.ignoreJustification === undefined
              ? undefined
              : data.ignoreJustification,
          recurrenceCount: data.recurrenceCount,
          metadataJson:
            data.metadataJson === undefined
              ? undefined
              : (data.metadataJson as Prisma.InputJsonValue),
          acknowledgedAt:
            data.acknowledgedAt === undefined
              ? undefined
              : data.acknowledgedAt,
          resolvedAt:
            data.resolvedAt === undefined ? undefined : data.resolvedAt,
          cancelledAt:
            data.cancelledAt === undefined ? undefined : data.cancelledAt,
          cancelledByUserId:
            data.cancelledByUserId === undefined
              ? undefined
              : data.cancelledByUserId,
          updatedByUserId: data.updatedByUserId,
          version: { increment: 1 },
        },
      });
      return mapRow(row);
    },
  };
}
