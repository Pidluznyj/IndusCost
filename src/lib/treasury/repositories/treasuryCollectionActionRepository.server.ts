/**
 * Repository de ações de cobrança — append-only (cancelamento lógico).
 */

import { Prisma } from "@prisma/client";
import type {
  PrismaClient,
  TreasuryCollectionActionType,
  TreasuryOfficialTitleKind,
} from "@prisma/client";
import { TreasuryDomainError } from "../domain/treasuryErrors.js";
import type { TreasuryCollectionActionRow } from "../mappers/treasuryCollectionActionMappers.js";

export type TreasuryCollectionActionDb = PrismaClient | Prisma.TransactionClient;

export type TreasuryCollectionActionCreateData = {
  titleType: TreasuryOfficialTitleKind;
  officialTitleId: string;
  officialExternalId: number;
  actionType: TreasuryCollectionActionType;
  performedAt: Date;
  contactPerson?: string | null;
  result?: string | null;
  notes?: string | null;
  nextAction?: string | null;
  responsibleUserId?: string | null;
  createdByUserId: string;
};

export type TreasuryCollectionActionCancelData = {
  cancelledByUserId: string;
  cancellationReason?: string | null;
  expectedVersion: number;
};

export type TreasuryCollectionActionRepository = {
  findById(
    id: string,
    db?: TreasuryCollectionActionDb
  ): Promise<TreasuryCollectionActionRow | null>;
  listByOfficialTitle(
    titleType: TreasuryOfficialTitleKind,
    officialTitleId: string,
    db?: TreasuryCollectionActionDb
  ): Promise<TreasuryCollectionActionRow[]>;
  listByOfficialTitleIds(
    titleType: TreasuryOfficialTitleKind,
    officialTitleIds: string[],
    db?: TreasuryCollectionActionDb
  ): Promise<TreasuryCollectionActionRow[]>;
  listTitleIdsByNextAction(
    titleType: TreasuryOfficialTitleKind,
    nextAction: string,
    db?: TreasuryCollectionActionDb
  ): Promise<string[]>;
  create(
    data: TreasuryCollectionActionCreateData,
    db?: TreasuryCollectionActionDb
  ): Promise<TreasuryCollectionActionRow>;
  cancel(
    id: string,
    data: TreasuryCollectionActionCancelData,
    db?: TreasuryCollectionActionDb
  ): Promise<TreasuryCollectionActionRow>;
};

const SELECT = {
  id: true,
  titleType: true,
  officialTitleId: true,
  officialExternalId: true,
  actionType: true,
  performedAt: true,
  contactPerson: true,
  result: true,
  notes: true,
  nextAction: true,
  responsibleUserId: true,
  version: true,
  createdAt: true,
  createdByUserId: true,
  updatedAt: true,
  updatedByUserId: true,
  cancelledAt: true,
  cancelledByUserId: true,
  cancellationReason: true,
} as const;

export function createTreasuryCollectionActionRepository(
  prisma: PrismaClient
): TreasuryCollectionActionRepository {
  const client = (db?: TreasuryCollectionActionDb) => db ?? prisma;

  return {
    async findById(id, db) {
      return (await client(db).treasuryCollectionAction.findUnique({
        where: { id },
        select: SELECT,
      })) as TreasuryCollectionActionRow | null;
    },

    async listByOfficialTitle(titleType, officialTitleId, db) {
      return (await client(db).treasuryCollectionAction.findMany({
        where: { titleType, officialTitleId },
        orderBy: [{ performedAt: "desc" }, { createdAt: "desc" }],
        select: SELECT,
      })) as TreasuryCollectionActionRow[];
    },

    async listByOfficialTitleIds(titleType, officialTitleIds, db) {
      if (!officialTitleIds.length) return [];
      return (await client(db).treasuryCollectionAction.findMany({
        where: {
          titleType,
          officialTitleId: { in: officialTitleIds },
        },
        orderBy: [{ performedAt: "desc" }, { createdAt: "desc" }],
        select: SELECT,
      })) as TreasuryCollectionActionRow[];
    },

    async listTitleIdsByNextAction(titleType, nextAction, db) {
      const needle = nextAction.trim();
      if (!needle) return [];
      const rows = await client(db).treasuryCollectionAction.findMany({
        where: {
          titleType,
          cancelledAt: null,
          nextAction: { contains: needle, mode: "insensitive" },
        },
        select: { officialTitleId: true },
        distinct: ["officialTitleId"],
      });
      return rows.map((r) => r.officialTitleId);
    },

    async create(data, db) {
      return (await client(db).treasuryCollectionAction.create({
        data: {
          titleType: data.titleType,
          officialTitleId: data.officialTitleId,
          officialExternalId: data.officialExternalId,
          actionType: data.actionType,
          performedAt: data.performedAt,
          contactPerson: data.contactPerson ?? null,
          result: data.result ?? null,
          notes: data.notes ?? null,
          nextAction: data.nextAction ?? null,
          responsibleUserId: data.responsibleUserId ?? null,
          createdByUserId: data.createdByUserId,
          updatedByUserId: data.createdByUserId,
        },
        select: SELECT,
      })) as TreasuryCollectionActionRow;
    },

    async cancel(id, data, db) {
      const current = await client(db).treasuryCollectionAction.findUnique({
        where: { id },
        select: { version: true, cancelledAt: true },
      });
      if (!current) {
        throw new TreasuryDomainError(
          "NOT_FOUND",
          "Ação de cobrança não encontrada.",
          "actionId"
        );
      }
      if (current.cancelledAt) {
        throw new TreasuryDomainError(
          "CONFLICT",
          "Ação de cobrança já está cancelada.",
          "actionId"
        );
      }
      if (current.version !== data.expectedVersion) {
        throw new TreasuryDomainError(
          "CONFLICT",
          "Versão da ação desatualizada.",
          "expectedVersion"
        );
      }
      return (await client(db).treasuryCollectionAction.update({
        where: { id },
        data: {
          cancelledAt: new Date(),
          cancelledByUserId: data.cancelledByUserId,
          cancellationReason: data.cancellationReason ?? null,
          updatedByUserId: data.cancelledByUserId,
          version: { increment: 1 },
        },
        select: SELECT,
      })) as TreasuryCollectionActionRow;
    },
  };
}
