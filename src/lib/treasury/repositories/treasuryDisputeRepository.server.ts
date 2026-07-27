/**
 * Repository de contestações — sem exclusão física; status OPEN/RESOLVED/CANCELLED.
 */

import { Prisma } from "@prisma/client";
import type {
  PrismaClient,
  TreasuryDisputeStatus,
  TreasuryOfficialTitleKind,
} from "@prisma/client";
import { TreasuryDomainError } from "../domain/treasuryErrors.js";
import type { TreasuryDisputeRow } from "../mappers/treasuryDisputeMappers.js";

export type TreasuryDisputeDb = PrismaClient | Prisma.TransactionClient;

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

export type TreasuryDisputeCreateData = {
  titleType: TreasuryOfficialTitleKind;
  officialTitleId: string;
  officialExternalId: number;
  reason: string;
  amountDisputed?: string | null;
  responsibleUserId?: string | null;
  involvedArea?: string | null;
  dueDate?: string | null;
  notes?: string | null;
  createdByUserId: string;
};

export type TreasuryDisputeUpdateStatusData = {
  status: TreasuryDisputeStatus;
  resolutionNote?: string | null;
  notes?: string | null;
  updatedByUserId: string;
  expectedVersion: number;
};

export type TreasuryDisputeRepository = {
  findById(
    id: string,
    db?: TreasuryDisputeDb
  ): Promise<TreasuryDisputeRow | null>;
  listByOfficialTitle(
    titleType: TreasuryOfficialTitleKind,
    officialTitleId: string,
    db?: TreasuryDisputeDb
  ): Promise<TreasuryDisputeRow[]>;
  create(
    data: TreasuryDisputeCreateData,
    db?: TreasuryDisputeDb
  ): Promise<TreasuryDisputeRow>;
  updateStatus(
    id: string,
    data: TreasuryDisputeUpdateStatusData,
    db?: TreasuryDisputeDb
  ): Promise<TreasuryDisputeRow>;
};

const SELECT = {
  id: true,
  titleType: true,
  officialTitleId: true,
  officialExternalId: true,
  reason: true,
  amountDisputed: true,
  responsibleUserId: true,
  involvedArea: true,
  dueDate: true,
  notes: true,
  status: true,
  resolutionNote: true,
  version: true,
  openedAt: true,
  createdAt: true,
  createdByUserId: true,
  updatedAt: true,
  updatedByUserId: true,
  cancelledAt: true,
  cancelledByUserId: true,
  resolvedAt: true,
} as const;

export function createTreasuryDisputeRepository(
  prisma: PrismaClient
): TreasuryDisputeRepository {
  const client = (db?: TreasuryDisputeDb) => db ?? prisma;

  return {
    async findById(id, db) {
      return (await client(db).treasuryDispute.findUnique({
        where: { id },
        select: SELECT,
      })) as TreasuryDisputeRow | null;
    },

    async listByOfficialTitle(titleType, officialTitleId, db) {
      return (await client(db).treasuryDispute.findMany({
        where: { titleType, officialTitleId },
        orderBy: [{ openedAt: "desc" }, { createdAt: "desc" }],
        select: SELECT,
      })) as TreasuryDisputeRow[];
    },

    async create(data, db) {
      return (await client(db).treasuryDispute.create({
        data: {
          titleType: data.titleType,
          officialTitleId: data.officialTitleId,
          officialExternalId: data.officialExternalId,
          reason: data.reason,
          amountDisputed: moneyToDecimal(data.amountDisputed),
          responsibleUserId: data.responsibleUserId ?? null,
          involvedArea: data.involvedArea ?? null,
          dueDate: civilDateToUtcDate(data.dueDate),
          notes: data.notes ?? null,
          status: "OPEN",
          createdByUserId: data.createdByUserId,
          updatedByUserId: data.createdByUserId,
        },
        select: SELECT,
      })) as TreasuryDisputeRow;
    },

    async updateStatus(id, data, db) {
      const current = await client(db).treasuryDispute.findUnique({
        where: { id },
        select: { version: true, status: true },
      });
      if (!current) {
        throw new TreasuryDomainError(
          "NOT_FOUND",
          "Contestação não encontrada.",
          "disputeId"
        );
      }
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
      return (await client(db).treasuryDispute.update({
        where: { id },
        data: {
          status: data.status,
          resolutionNote: data.resolutionNote,
          notes: data.notes,
          updatedByUserId: data.updatedByUserId,
          resolvedAt: data.status === "RESOLVED" ? now : undefined,
          cancelledAt: data.status === "CANCELLED" ? now : undefined,
          cancelledByUserId:
            data.status === "CANCELLED" ? data.updatedByUserId : undefined,
          version: { increment: 1 },
        },
        select: SELECT,
      })) as TreasuryDisputeRow;
    },
  };
}
