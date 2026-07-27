/**
 * Repository de promessas de pagamento — sem mutar NomusAccounts*.
 */

import { Prisma } from "@prisma/client";
import type {
  PrismaClient,
  TreasuryOfficialTitleKind,
  TreasuryPaymentPromiseStatus,
} from "@prisma/client";
import { TreasuryDomainError } from "../domain/treasuryErrors.js";
import type { TreasuryPaymentPromiseRow } from "../mappers/treasuryPaymentPromiseMappers.js";

export type TreasuryPaymentPromiseDb = PrismaClient | Prisma.TransactionClient;

function moneyToDecimal(
  value: string | null | undefined
): Prisma.Decimal | null {
  if (value == null || value === "") return null;
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

export type TreasuryPaymentPromiseCreateData = {
  titleType: TreasuryOfficialTitleKind;
  officialTitleId: string;
  officialExternalId: number;
  promisedDate: string;
  promisedAmount: string;
  fulfilledAmount?: string;
  contactNote?: string | null;
  channel?: string | null;
  notes?: string | null;
  responsibleUserId?: string | null;
  status?: TreasuryPaymentPromiseStatus;
  createdByUserId: string;
};

export type TreasuryPaymentPromiseUpdateData = {
  promisedDate?: string;
  promisedAmount?: string;
  fulfilledAmount?: string;
  contactNote?: string | null;
  channel?: string | null;
  notes?: string | null;
  responsibleUserId?: string | null;
  status?: TreasuryPaymentPromiseStatus;
  fulfilledAt?: Date | null;
  updatedByUserId: string;
  expectedVersion: number;
};

export type TreasuryPaymentPromiseCancelData = {
  cancelledByUserId: string;
  cancellationReason?: string | null;
  expectedVersion: number;
};

export type TreasuryPaymentPromiseRepository = {
  findById(
    id: string,
    db?: TreasuryPaymentPromiseDb
  ): Promise<TreasuryPaymentPromiseRow | null>;
  listByOfficialTitle(
    titleType: TreasuryOfficialTitleKind,
    officialTitleId: string,
    db?: TreasuryPaymentPromiseDb
  ): Promise<TreasuryPaymentPromiseRow[]>;
  listByOfficialTitleIds(
    titleType: TreasuryOfficialTitleKind,
    officialTitleIds: string[],
    db?: TreasuryPaymentPromiseDb
  ): Promise<TreasuryPaymentPromiseRow[]>;
  listActiveTitleIds(
    titleType: TreasuryOfficialTitleKind,
    officialTitleIds: string[],
    db?: TreasuryPaymentPromiseDb
  ): Promise<string[]>;
  create(
    data: TreasuryPaymentPromiseCreateData,
    db?: TreasuryPaymentPromiseDb
  ): Promise<TreasuryPaymentPromiseRow>;
  update(
    id: string,
    data: TreasuryPaymentPromiseUpdateData,
    db?: TreasuryPaymentPromiseDb
  ): Promise<TreasuryPaymentPromiseRow>;
  cancel(
    id: string,
    data: TreasuryPaymentPromiseCancelData,
    db?: TreasuryPaymentPromiseDb
  ): Promise<TreasuryPaymentPromiseRow>;
  expireMany(
    ids: string[],
    updatedByUserId: string | null,
    db?: TreasuryPaymentPromiseDb
  ): Promise<number>;
};

const SELECT = {
  id: true,
  titleType: true,
  officialTitleId: true,
  officialExternalId: true,
  promisedDate: true,
  promisedAmount: true,
  fulfilledAmount: true,
  contactNote: true,
  channel: true,
  notes: true,
  responsibleUserId: true,
  status: true,
  version: true,
  createdAt: true,
  createdByUserId: true,
  updatedAt: true,
  updatedByUserId: true,
  cancelledAt: true,
  cancelledByUserId: true,
  cancellationReason: true,
  fulfilledAt: true,
} as const;

export function createTreasuryPaymentPromiseRepository(
  prisma: PrismaClient
): TreasuryPaymentPromiseRepository {
  const client = (db?: TreasuryPaymentPromiseDb) => db ?? prisma;

  return {
    async findById(id, db) {
      return (await client(db).treasuryPaymentPromise.findUnique({
        where: { id },
        select: SELECT,
      })) as TreasuryPaymentPromiseRow | null;
    },

    async listByOfficialTitle(titleType, officialTitleId, db) {
      return (await client(db).treasuryPaymentPromise.findMany({
        where: { titleType, officialTitleId },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        select: SELECT,
      })) as TreasuryPaymentPromiseRow[];
    },

    async listByOfficialTitleIds(titleType, officialTitleIds, db) {
      if (!officialTitleIds.length) return [];
      return (await client(db).treasuryPaymentPromise.findMany({
        where: {
          titleType,
          officialTitleId: { in: officialTitleIds },
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        select: SELECT,
      })) as TreasuryPaymentPromiseRow[];
    },

    async listActiveTitleIds(titleType, officialTitleIds, db) {
      if (!officialTitleIds.length) return [];
      const rows = await client(db).treasuryPaymentPromise.findMany({
        where: {
          titleType,
          officialTitleId: { in: officialTitleIds },
          status: { in: ["ACTIVE", "PARTIALLY_FULFILLED"] },
        },
        select: { officialTitleId: true },
        distinct: ["officialTitleId"],
      });
      return rows.map((r) => r.officialTitleId);
    },

    async create(data, db) {
      return (await client(db).treasuryPaymentPromise.create({
        data: {
          titleType: data.titleType,
          officialTitleId: data.officialTitleId,
          officialExternalId: data.officialExternalId,
          promisedDate: civilDateToUtcDate(data.promisedDate),
          promisedAmount: moneyToDecimal(data.promisedAmount)!,
          fulfilledAmount: moneyToDecimal(data.fulfilledAmount ?? "0.00")!,
          contactNote: data.contactNote ?? null,
          channel: data.channel ?? null,
          notes: data.notes ?? null,
          responsibleUserId: data.responsibleUserId ?? null,
          status: data.status ?? "ACTIVE",
          createdByUserId: data.createdByUserId,
          updatedByUserId: data.createdByUserId,
        },
        select: SELECT,
      })) as TreasuryPaymentPromiseRow;
    },

    async update(id, data, db) {
      const current = await client(db).treasuryPaymentPromise.findUnique({
        where: { id },
        select: { version: true, cancelledAt: true },
      });
      if (!current) {
        throw new TreasuryDomainError(
          "NOT_FOUND",
          "Promessa não encontrada.",
          "promiseId"
        );
      }
      if (current.cancelledAt) {
        throw new TreasuryDomainError(
          "CONFLICT",
          "Promessa cancelada não pode ser alterada.",
          "promiseId"
        );
      }
      if (current.version !== data.expectedVersion) {
        throw new TreasuryDomainError(
          "CONFLICT",
          "Versão da promessa desatualizada.",
          "expectedVersion"
        );
      }
      return (await client(db).treasuryPaymentPromise.update({
        where: { id },
        data: {
          promisedDate:
            data.promisedDate === undefined
              ? undefined
              : civilDateToUtcDate(data.promisedDate),
          promisedAmount:
            data.promisedAmount === undefined
              ? undefined
              : moneyToDecimal(data.promisedAmount),
          fulfilledAmount:
            data.fulfilledAmount === undefined
              ? undefined
              : moneyToDecimal(data.fulfilledAmount),
          contactNote: data.contactNote,
          channel: data.channel,
          notes: data.notes,
          responsibleUserId: data.responsibleUserId,
          status: data.status,
          fulfilledAt: data.fulfilledAt,
          updatedByUserId: data.updatedByUserId,
          version: { increment: 1 },
        },
        select: SELECT,
      })) as TreasuryPaymentPromiseRow;
    },

    async cancel(id, data, db) {
      const current = await client(db).treasuryPaymentPromise.findUnique({
        where: { id },
        select: { version: true, cancelledAt: true, status: true },
      });
      if (!current) {
        throw new TreasuryDomainError(
          "NOT_FOUND",
          "Promessa não encontrada.",
          "promiseId"
        );
      }
      if (current.cancelledAt || current.status === "CANCELLED") {
        throw new TreasuryDomainError(
          "CONFLICT",
          "Promessa já está cancelada.",
          "promiseId"
        );
      }
      if (current.version !== data.expectedVersion) {
        throw new TreasuryDomainError(
          "CONFLICT",
          "Versão da promessa desatualizada.",
          "expectedVersion"
        );
      }
      return (await client(db).treasuryPaymentPromise.update({
        where: { id },
        data: {
          status: "CANCELLED",
          cancelledAt: new Date(),
          cancelledByUserId: data.cancelledByUserId,
          cancellationReason: data.cancellationReason ?? null,
          updatedByUserId: data.cancelledByUserId,
          version: { increment: 1 },
        },
        select: SELECT,
      })) as TreasuryPaymentPromiseRow;
    },

    async expireMany(ids, updatedByUserId, db) {
      if (!ids.length) return 0;
      const result = await client(db).treasuryPaymentPromise.updateMany({
        where: {
          id: { in: ids },
          status: { in: ["ACTIVE", "PARTIALLY_FULFILLED"] },
        },
        data: {
          status: "EXPIRED",
          updatedByUserId,
          updatedAt: new Date(),
        },
      });
      return result.count;
    },
  };
}
