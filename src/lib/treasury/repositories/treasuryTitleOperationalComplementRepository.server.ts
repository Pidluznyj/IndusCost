/**
 * Repository base do complemento operacional de títulos oficiais.
 * Persistência local Tesouraria — sem mutar NomusAccounts*.
 */

import { Prisma } from "@prisma/client";
import type {
  PrismaClient,
  TreasuryOfficialTitleKind,
  TreasuryTitleOperationalPriority,
  TreasuryTitleOperationalStatus,
} from "@prisma/client";
import { TreasuryDomainError } from "../domain/treasuryErrors.js";
import type { TreasuryTitleOperationalComplementRow } from "../mappers/treasuryTitleOperationalComplementMappers.js";

export type TreasuryTitleComplementDb = PrismaClient | Prisma.TransactionClient;

function moneyToDecimal(
  value: string | null | undefined
): Prisma.Decimal | null {
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
      "civilDate"
    );
  }
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}

export type TreasuryTitleComplementCreateData = {
  titleType: TreasuryOfficialTitleKind;
  officialTitleId: string;
  officialExternalId: number;
  expectedDate?: string | null;
  confirmedDate?: string | null;
  scheduledDate?: string | null;
  expectedAmount?: string | null;
  confirmedAmount?: string | null;
  scheduledAmount?: string | null;
  status?: TreasuryTitleOperationalStatus;
  priority?: TreasuryTitleOperationalPriority;
  plannedAccountId?: string | null;
  responsibleUserId?: string | null;
  nextAction?: string | null;
  reason?: string | null;
  notes?: string | null;
  createdByUserId: string;
};

export type TreasuryTitleComplementUpdateData = {
  expectedDate?: string | null;
  confirmedDate?: string | null;
  scheduledDate?: string | null;
  expectedAmount?: string | null;
  confirmedAmount?: string | null;
  scheduledAmount?: string | null;
  status?: TreasuryTitleOperationalStatus;
  priority?: TreasuryTitleOperationalPriority;
  plannedAccountId?: string | null;
  responsibleUserId?: string | null;
  nextAction?: string | null;
  reason?: string | null;
  notes?: string | null;
  updatedByUserId: string;
  expectedVersion: number;
};

export type TreasuryTitleComplementCancelData = {
  cancelledByUserId: string;
  cancellationReason?: string | null;
  expectedVersion: number;
};

export type TreasuryTitleOperationalComplementRepository = {
  findById(
    id: string,
    db?: TreasuryTitleComplementDb
  ): Promise<TreasuryTitleOperationalComplementRow | null>;
  findByOfficialTitle(
    titleType: TreasuryOfficialTitleKind,
    officialTitleId: string,
    db?: TreasuryTitleComplementDb
  ): Promise<TreasuryTitleOperationalComplementRow | null>;
  findByOfficialExternalId(
    titleType: TreasuryOfficialTitleKind,
    officialExternalId: number,
    db?: TreasuryTitleComplementDb
  ): Promise<TreasuryTitleOperationalComplementRow | null>;
  create(
    data: TreasuryTitleComplementCreateData,
    db?: TreasuryTitleComplementDb
  ): Promise<TreasuryTitleOperationalComplementRow>;
  update(
    id: string,
    data: TreasuryTitleComplementUpdateData,
    db?: TreasuryTitleComplementDb
  ): Promise<TreasuryTitleOperationalComplementRow>;
  cancel(
    id: string,
    data: TreasuryTitleComplementCancelData,
    db?: TreasuryTitleComplementDb
  ): Promise<TreasuryTitleOperationalComplementRow>;
};

const SELECT = {
  id: true,
  titleType: true,
  officialTitleId: true,
  officialExternalId: true,
  expectedDate: true,
  confirmedDate: true,
  scheduledDate: true,
  expectedAmount: true,
  confirmedAmount: true,
  scheduledAmount: true,
  status: true,
  priority: true,
  plannedAccountId: true,
  responsibleUserId: true,
  nextAction: true,
  reason: true,
  notes: true,
  version: true,
  createdAt: true,
  createdByUserId: true,
  updatedAt: true,
  updatedByUserId: true,
  cancelledAt: true,
  cancelledByUserId: true,
  cancellationReason: true,
} satisfies Prisma.TreasuryTitleOperationalComplementSelect;

export function createTreasuryTitleOperationalComplementRepository(
  prisma: PrismaClient
): TreasuryTitleOperationalComplementRepository {
  const client = (db?: TreasuryTitleComplementDb) => db ?? prisma;

  return {
    async findById(id, db) {
      return client(db).treasuryTitleOperationalComplement.findUnique({
        where: { id },
        select: SELECT,
      }) as Promise<TreasuryTitleOperationalComplementRow | null>;
    },

    async findByOfficialTitle(titleType, officialTitleId, db) {
      return client(db).treasuryTitleOperationalComplement.findUnique({
        where: {
          titleType_officialTitleId: { titleType, officialTitleId },
        },
        select: SELECT,
      }) as Promise<TreasuryTitleOperationalComplementRow | null>;
    },

    async findByOfficialExternalId(titleType, officialExternalId, db) {
      return client(db).treasuryTitleOperationalComplement.findUnique({
        where: {
          titleType_officialExternalId: { titleType, officialExternalId },
        },
        select: SELECT,
      }) as Promise<TreasuryTitleOperationalComplementRow | null>;
    },

    async create(data, db) {
      try {
        return (await client(db).treasuryTitleOperationalComplement.create({
          data: {
            titleType: data.titleType,
            officialTitleId: data.officialTitleId,
            officialExternalId: data.officialExternalId,
            expectedDate: civilDateToUtcDate(data.expectedDate),
            confirmedDate: civilDateToUtcDate(data.confirmedDate),
            scheduledDate: civilDateToUtcDate(data.scheduledDate),
            expectedAmount: moneyToDecimal(data.expectedAmount),
            confirmedAmount: moneyToDecimal(data.confirmedAmount),
            scheduledAmount: moneyToDecimal(data.scheduledAmount),
            status: data.status ?? "ACTIVE",
            priority: data.priority ?? "NORMAL",
            plannedAccountId: data.plannedAccountId ?? null,
            responsibleUserId: data.responsibleUserId ?? null,
            nextAction: data.nextAction ?? null,
            reason: data.reason ?? null,
            notes: data.notes ?? null,
            createdByUserId: data.createdByUserId,
            updatedByUserId: data.createdByUserId,
          },
          select: SELECT,
        })) as TreasuryTitleOperationalComplementRow;
      } catch (err) {
        if (
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === "P2002"
        ) {
          throw new TreasuryDomainError(
            "CONFLICT",
            "Já existe complemento operacional para este título oficial.",
            "officialTitleId"
          );
        }
        throw err;
      }
    },

    async update(id, data, db) {
      const current = await client(db).treasuryTitleOperationalComplement.findUnique({
        where: { id },
        select: { version: true, cancelledAt: true },
      });
      if (!current) {
        throw new TreasuryDomainError(
          "NOT_FOUND",
          "Complemento operacional não encontrado.",
          "id"
        );
      }
      if (current.cancelledAt) {
        throw new TreasuryDomainError(
          "CONFLICT",
          "Complemento operacional cancelado não pode ser alterado.",
          "id"
        );
      }
      if (current.version !== data.expectedVersion) {
        throw new TreasuryDomainError(
          "CONFLICT",
          "Versão do complemento desatualizada.",
          "version"
        );
      }
      return (await client(db).treasuryTitleOperationalComplement.update({
        where: { id },
        data: {
          expectedDate:
            data.expectedDate === undefined
              ? undefined
              : civilDateToUtcDate(data.expectedDate),
          confirmedDate:
            data.confirmedDate === undefined
              ? undefined
              : civilDateToUtcDate(data.confirmedDate),
          scheduledDate:
            data.scheduledDate === undefined
              ? undefined
              : civilDateToUtcDate(data.scheduledDate),
          expectedAmount:
            data.expectedAmount === undefined
              ? undefined
              : moneyToDecimal(data.expectedAmount),
          confirmedAmount:
            data.confirmedAmount === undefined
              ? undefined
              : moneyToDecimal(data.confirmedAmount),
          scheduledAmount:
            data.scheduledAmount === undefined
              ? undefined
              : moneyToDecimal(data.scheduledAmount),
          status: data.status,
          priority: data.priority,
          plannedAccountId: data.plannedAccountId,
          responsibleUserId: data.responsibleUserId,
          nextAction: data.nextAction,
          reason: data.reason,
          notes: data.notes,
          updatedByUserId: data.updatedByUserId,
          version: { increment: 1 },
        },
        select: SELECT,
      })) as TreasuryTitleOperationalComplementRow;
    },

    async cancel(id, data, db) {
      const current = await client(db).treasuryTitleOperationalComplement.findUnique({
        where: { id },
        select: { version: true, cancelledAt: true },
      });
      if (!current) {
        throw new TreasuryDomainError(
          "NOT_FOUND",
          "Complemento operacional não encontrado.",
          "id"
        );
      }
      if (current.cancelledAt) {
        throw new TreasuryDomainError(
          "CONFLICT",
          "Complemento operacional já está cancelado.",
          "id"
        );
      }
      if (current.version !== data.expectedVersion) {
        throw new TreasuryDomainError(
          "CONFLICT",
          "Versão do complemento desatualizada.",
          "version"
        );
      }
      return (await client(db).treasuryTitleOperationalComplement.update({
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
      })) as TreasuryTitleOperationalComplementRow;
    },
  };
}
