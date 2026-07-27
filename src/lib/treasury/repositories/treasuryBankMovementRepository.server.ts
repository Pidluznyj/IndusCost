/**
 * Repository de lote/movimentos bancários — dedupe + persistência (server-only).
 */

import type {
  Prisma,
  PrismaClient,
  TreasuryBankImportBatchStatus,
  TreasuryBankMovementDirection,
  TreasuryBankOfxFormat,
  TreasuryCurrencyCode,
} from "@prisma/client";

export type TreasuryBankMovementDb = PrismaClient | Prisma.TransactionClient;

export type TreasuryBankImportBatchRow = {
  id: string;
  companyCode: string;
  accountId: string;
  fileSha256: string;
  originalFileName: string;
  byteLength: number;
  format: TreasuryBankOfxFormat | string;
  status: TreasuryBankImportBatchStatus | string;
  transactionCount: number;
  summaryJson: unknown | null;
  requestId: string | null;
  notes: string | null;
  createdByUserId: string;
  createdAt: Date;
  processedAt: Date | null;
};

export type TreasuryBankMovementCreateData = {
  batchId: string;
  companyCode: string;
  accountId: string;
  fingerprint: string;
  fitId: string | null;
  direction: TreasuryBankMovementDirection | string;
  amount: string;
  currency: TreasuryCurrencyCode | string;
  postedCivilDate: Date;
  userCivilDate: Date | null;
  description: string | null;
  documentNumber: string | null;
  counterpartyName: string | null;
  trnType: string | null;
  normalizedPayloadJson: Prisma.InputJsonValue | null;
  sortOrder: number;
};

export type TreasuryBankImportBatchCreateData = {
  companyCode: string;
  accountId: string;
  fileSha256: string;
  originalFileName: string;
  byteLength: number;
  format: TreasuryBankOfxFormat | string;
  status: TreasuryBankImportBatchStatus | string;
  transactionCount: number;
  summaryJson: Prisma.InputJsonValue | null;
  requestId: string | null;
  notes: string | null;
  createdByUserId: string;
  processedAt: Date | null;
};

export type TreasuryBankImportBatchListFilter = {
  companyCode?: string | null;
  accountId?: string | null;
  /** Restringe a um conjunto autorizado (ACL) — nunca omitir no service. */
  accountIds?: string[] | null;
  status?: string | null;
  from?: Date | null;
  to?: Date | null;
  page: number;
  pageSize: number;
};

export type TreasuryBankMovementListFilter = {
  companyCode?: string | null;
  accountId?: string | null;
  /** Restringe a um conjunto autorizado (ACL) — nunca omitir no service. */
  accountIds?: string[] | null;
  batchId?: string | null;
  reconciliationStatuses?: string[] | null;
  search?: string | null;
  from?: Date | null;
  to?: Date | null;
  page: number;
  pageSize: number;
};

export type TreasuryBankMovementRepository = {
  findExistingFingerprints(
    accountId: string,
    fingerprints: readonly string[],
    db?: TreasuryBankMovementDb
  ): Promise<Set<string>>;
  findBatchIdByFileSha256(
    accountId: string,
    fileSha256: string,
    db?: TreasuryBankMovementDb
  ): Promise<string | null>;
  findBatchByFileSha256(
    accountId: string,
    fileSha256: string,
    db?: TreasuryBankMovementDb
  ): Promise<TreasuryBankImportBatchRow | null>;
  findBatchById(
    id: string,
    db?: TreasuryBankMovementDb
  ): Promise<TreasuryBankImportBatchRow | null>;
  createBatch(
    data: TreasuryBankImportBatchCreateData,
    db?: TreasuryBankMovementDb
  ): Promise<TreasuryBankImportBatchRow>;
  createMovements(
    rows: readonly TreasuryBankMovementCreateData[],
    db?: TreasuryBankMovementDb
  ): Promise<{ id: string; fingerprint: string }[]>;
  listBatches(
    filter: TreasuryBankImportBatchListFilter,
    db?: TreasuryBankMovementDb
  ): Promise<{ rows: unknown[]; totalRows: number }>;
  listMovements(
    filter: TreasuryBankMovementListFilter,
    db?: TreasuryBankMovementDb
  ): Promise<{ rows: unknown[]; totalRows: number }>;
  findMovementById(
    id: string,
    db?: TreasuryBankMovementDb
  ): Promise<unknown | null>;
};

function mapBatch(
  row: {
    id: string;
    companyCode: string;
    accountId: string;
    fileSha256: string;
    originalFileName: string;
    byteLength: number;
    format: TreasuryBankOfxFormat;
    status: TreasuryBankImportBatchStatus;
    transactionCount: number;
    summaryJson: Prisma.JsonValue | null;
    requestId: string | null;
    notes: string | null;
    createdByUserId: string;
    createdAt: Date;
    processedAt: Date | null;
  }
): TreasuryBankImportBatchRow {
  return {
    id: row.id,
    companyCode: row.companyCode,
    accountId: row.accountId,
    fileSha256: row.fileSha256,
    originalFileName: row.originalFileName,
    byteLength: row.byteLength,
    format: row.format,
    status: row.status,
    transactionCount: row.transactionCount,
    summaryJson: row.summaryJson,
    requestId: row.requestId,
    notes: row.notes,
    createdByUserId: row.createdByUserId,
    createdAt: row.createdAt,
    processedAt: row.processedAt,
  };
}

export function createTreasuryBankMovementRepository(
  prisma: PrismaClient
): TreasuryBankMovementRepository {
  return {
    async findExistingFingerprints(accountId, fingerprints, db = prisma) {
      const unique = [
        ...new Set(fingerprints.map((f) => f.trim()).filter(Boolean)),
      ];
      if (unique.length === 0) return new Set();
      const rows = await db.treasuryBankMovement.findMany({
        where: { accountId, fingerprint: { in: unique } },
        select: { fingerprint: true },
      });
      return new Set(rows.map((r) => r.fingerprint));
    },

    async findBatchIdByFileSha256(accountId, fileSha256, db = prisma) {
      const row = await db.treasuryBankImportBatch.findUnique({
        where: {
          accountId_fileSha256: {
            accountId,
            fileSha256: fileSha256.trim(),
          },
        },
        select: { id: true },
      });
      return row?.id ?? null;
    },

    async findBatchByFileSha256(accountId, fileSha256, db = prisma) {
      const row = await db.treasuryBankImportBatch.findUnique({
        where: {
          accountId_fileSha256: {
            accountId,
            fileSha256: fileSha256.trim(),
          },
        },
      });
      return row ? mapBatch(row) : null;
    },

    async findBatchById(id, db = prisma) {
      const row = await db.treasuryBankImportBatch.findUnique({ where: { id } });
      return row ? mapBatch(row) : null;
    },

    async createBatch(data, db = prisma) {
      const row = await db.treasuryBankImportBatch.create({
        data: {
          companyCode: data.companyCode,
          accountId: data.accountId,
          fileSha256: data.fileSha256,
          originalFileName: data.originalFileName,
          byteLength: data.byteLength,
          format: data.format as TreasuryBankOfxFormat,
          status: data.status as TreasuryBankImportBatchStatus,
          transactionCount: data.transactionCount,
          summaryJson: data.summaryJson ?? undefined,
          requestId: data.requestId,
          notes: data.notes,
          createdByUserId: data.createdByUserId,
          processedAt: data.processedAt,
        },
      });
      return mapBatch(row);
    },

    async createMovements(rows, db = prisma) {
      if (rows.length === 0) return [];
      const created: { id: string; fingerprint: string }[] = [];
      for (const row of rows) {
        const inserted = await db.treasuryBankMovement.create({
          data: {
            batchId: row.batchId,
            companyCode: row.companyCode,
            accountId: row.accountId,
            fingerprint: row.fingerprint,
            fitId: row.fitId,
            direction: row.direction as TreasuryBankMovementDirection,
            amount: row.amount,
            currency: row.currency as TreasuryCurrencyCode,
            postedCivilDate: row.postedCivilDate,
            userCivilDate: row.userCivilDate,
            description: row.description,
            documentNumber: row.documentNumber,
            counterpartyName: row.counterpartyName,
            trnType: row.trnType,
            normalizedPayloadJson: row.normalizedPayloadJson ?? undefined,
            sortOrder: row.sortOrder,
            reconciliationStatus: "PENDING",
            reconciledAmount: "0.00",
          },
          select: { id: true, fingerprint: true },
        });
        created.push(inserted);
      }
      return created;
    },

    async listBatches(filter, db = prisma) {
      const where: Prisma.TreasuryBankImportBatchWhereInput = {};
      if (filter.companyCode?.trim()) where.companyCode = filter.companyCode.trim();
      if (filter.accountId?.trim()) {
        where.accountId = filter.accountId.trim();
      } else if (filter.accountIds?.length) {
        where.accountId = { in: filter.accountIds };
      }
      if (filter.status?.trim()) {
        where.status = filter.status.trim() as TreasuryBankImportBatchStatus;
      }
      if (filter.from || filter.to) {
        where.createdAt = {};
        if (filter.from) where.createdAt.gte = filter.from;
        if (filter.to) where.createdAt.lte = filter.to;
      }
      const skip = (filter.page - 1) * filter.pageSize;
      const [totalRows, rows] = await Promise.all([
        db.treasuryBankImportBatch.count({ where }),
        db.treasuryBankImportBatch.findMany({
          where,
          orderBy: { createdAt: "desc" },
          skip,
          take: filter.pageSize,
          include: { account: { select: { code: true, name: true } } },
        }),
      ]);
      return { rows, totalRows };
    },

    async listMovements(filter, db = prisma) {
      const where: Prisma.TreasuryBankMovementWhereInput = {};
      if (filter.companyCode?.trim()) where.companyCode = filter.companyCode.trim();
      if (filter.accountId?.trim()) {
        where.accountId = filter.accountId.trim();
      } else if (filter.accountIds?.length) {
        where.accountId = { in: filter.accountIds };
      }
      if (filter.batchId?.trim()) where.batchId = filter.batchId.trim();
      if (filter.reconciliationStatuses?.length) {
        where.reconciliationStatus = {
          in: filter.reconciliationStatuses as never,
        };
      }
      if (filter.from || filter.to) {
        where.postedCivilDate = {};
        if (filter.from) where.postedCivilDate.gte = filter.from;
        if (filter.to) where.postedCivilDate.lte = filter.to;
      }
      const search = filter.search?.trim();
      if (search) {
        where.OR = [
          { description: { contains: search, mode: "insensitive" } },
          { counterpartyName: { contains: search, mode: "insensitive" } },
          { documentNumber: { contains: search, mode: "insensitive" } },
          { fitId: { contains: search, mode: "insensitive" } },
        ];
      }
      const skip = (filter.page - 1) * filter.pageSize;
      const [totalRows, rows] = await Promise.all([
        db.treasuryBankMovement.count({ where }),
        db.treasuryBankMovement.findMany({
          where,
          orderBy: [{ postedCivilDate: "desc" }, { sortOrder: "asc" }],
          skip,
          take: filter.pageSize,
          include: { account: { select: { code: true, name: true } } },
        }),
      ]);
      return { rows, totalRows };
    },

    async findMovementById(id, db = prisma) {
      return db.treasuryBankMovement.findUnique({
        where: { id },
        include: { account: { select: { code: true, name: true } } },
      });
    },
  };
}
