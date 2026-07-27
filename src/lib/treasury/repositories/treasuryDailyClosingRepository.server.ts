/**
 * Repository Prisma — fechamento diário + lock advisory empresa+data.
 */

import type { Prisma, PrismaClient } from "@prisma/client";
import { toCivilDateKey } from "@/src/lib/financeCivilDate.js";
import type { TreasuryClosingStatus } from "../contracts/treasuryEnums.js";
import { formatTreasuryTimestampIso } from "../contracts/treasuryTimestamp.js";
import type {
  TreasuryDailyClosingDto,
  TreasuryDailyClosingAccountPositionDto,
  TreasuryDailyClosingReopeningDto,
} from "../contracts/treasuryDto.js";
import { buildTreasuryDailyClosingAdvisoryLockKeys } from "../domain/treasuryDailyClosingLock.js";
import { normalizeTreasuryMoneyString } from "../treasuryMoney.js";

function civilToDate(civil: string): Date {
  const [y, m, d] = civil.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function money(value: { toFixed(d: number): string } | string): string {
  if (typeof value === "string") return normalizeTreasuryMoneyString(value);
  return normalizeTreasuryMoneyString(value.toFixed(2));
}

export type TreasuryDailyClosingRow = {
  id: string;
  companyCode: string;
  civilDate: string;
  version: number;
  status: TreasuryClosingStatus;
  sourceHash: string;
  contentHash: string | null;
  openingBalance: string;
  realizedInflows: string;
  realizedOutflows: string;
  pendenciesAmount: string;
  closingBalance: string;
  observedBalance: string;
  reconciledBalance: string;
  differenceAmount: string;
  exceptionsCount: number;
  exceptionsAmount: string;
  caveatsCount: number;
  notes: string | null;
  previousClosingId: string | null;
  supersededByClosingId: string | null;
  createdByUserId: string;
  createdAt: Date;
  closedByUserId: string | null;
  closedAt: Date | null;
};

export type TreasuryDailyClosingCaveatRow = {
  id: string;
  closingId: string;
  code: string | null;
  severity: "INFO" | "WARNING" | "CRITICAL";
  message: string;
  acknowledged: boolean;
  sortOrder: number;
};

export type TreasuryDailyClosingCreateClosedInput = {
  companyCode: string;
  civilDate: string;
  version: number;
  sourceHash: string;
  contentHash: string;
  openingBalance: string;
  realizedInflows: string;
  realizedOutflows: string;
  pendenciesAmount: string;
  closingBalance: string;
  observedBalance: string;
  reconciledBalance: string;
  differenceAmount: string;
  exceptionsCount: number;
  exceptionsAmount: string;
  caveatsCount: number;
  notes: string | null;
  previousClosingId: string | null;
  createdByUserId: string;
  closedByUserId: string;
  closedAt: Date;
  positions: Array<{
    accountId: string;
    openingBalance: string;
    realizedInflows: string;
    realizedOutflows: string;
    pendenciesAmount: string;
    closingBalance: string;
    observedBalance: string;
    reconciledBalance: string;
    differenceAmount: string;
    sortOrder: number;
  }>;
  pendencies: Array<{
    titleKind: "RECEIVABLE" | "PAYABLE";
    officialTitleId: string | null;
    nomusExternalId: number | null;
    dueDate: string | null;
    expectedDate: string | null;
    openAmount: string;
    counterpartyName: string | null;
    accountId: string | null;
    sortOrder: number;
  }>;
  caveats: Array<{
    code: string;
    severity: "INFO" | "WARNING" | "CRITICAL";
    message: string;
    sortOrder: number;
  }>;
};

export type TreasuryDailyClosingRepository = {
  tryAcquireLock(companyCode: string, civilDate: string): Promise<boolean>;
  releaseLock(companyCode: string, civilDate: string): Promise<void>;
  findCurrent(
    companyCode: string,
    civilDate: string
  ): Promise<TreasuryDailyClosingRow | null>;
  findById(id: string): Promise<TreasuryDailyClosingRow | null>;
  list(input: {
    companyCode?: string | null;
    dateFrom?: string | null;
    dateTo?: string | null;
    status?: TreasuryClosingStatus | null;
    page: number;
    pageSize: number;
  }): Promise<{ rows: TreasuryDailyClosingRow[]; total: number }>;
  createClosed(
    input: TreasuryDailyClosingCreateClosedInput
  ): Promise<TreasuryDailyClosingRow>;
  finalizeOpenToClosed(
    openId: string,
    input: Omit<
      TreasuryDailyClosingCreateClosedInput,
      "companyCode" | "civilDate" | "version" | "previousClosingId" | "createdByUserId"
    >
  ): Promise<TreasuryDailyClosingRow>;
  reopen(input: {
    fromClosingId: string;
    reason: string;
    reopenedByUserId: string;
    requestId: string | null;
    newVersion: number;
    companyCode: string;
    civilDate: string;
    sourceHash: string;
  }): Promise<{
    previous: TreasuryDailyClosingRow;
    next: TreasuryDailyClosingRow;
    reopening: TreasuryDailyClosingReopeningDto;
  }>;
  listAccountPositions(
    closingId: string
  ): Promise<TreasuryDailyClosingAccountPositionDto[]>;
  listCaveats(closingId: string): Promise<TreasuryDailyClosingCaveatRow[]>;
};

export function toTreasuryDailyClosingDto(
  row: TreasuryDailyClosingRow
): TreasuryDailyClosingDto {
  return {
    id: row.id,
    companyCode: row.companyCode,
    civilDate: row.civilDate,
    status: row.status,
    version: row.version,
    sourceHash: row.sourceHash,
    contentHash: row.contentHash,
    openingBalance: row.openingBalance,
    realizedInflows: row.realizedInflows,
    realizedOutflows: row.realizedOutflows,
    pendenciesAmount: row.pendenciesAmount,
    closingBalance: row.closingBalance,
    observedBalance: row.observedBalance,
    reconciledBalance: row.reconciledBalance,
    differenceAmount: row.differenceAmount,
    exceptionsCount: row.exceptionsCount,
    exceptionsAmount: row.exceptionsAmount,
    caveatsCount: row.caveatsCount,
    previousClosingId: row.previousClosingId,
    supersededByClosingId: row.supersededByClosingId,
    closedByUserId: row.closedByUserId,
    closedAt: row.closedAt
      ? formatTreasuryTimestampIso(row.closedAt)
      : null,
    createdByUserId: row.createdByUserId,
    createdAt: formatTreasuryTimestampIso(row.createdAt),
  };
}

function mapRow(row: {
  id: string;
  companyCode: string;
  civilDate: Date;
  version: number;
  status: string;
  sourceHash: string;
  contentHash: string | null;
  openingBalance: { toFixed(d: number): string };
  realizedInflows: { toFixed(d: number): string };
  realizedOutflows: { toFixed(d: number): string };
  pendenciesAmount: { toFixed(d: number): string };
  closingBalance: { toFixed(d: number): string };
  observedBalance: { toFixed(d: number): string };
  reconciledBalance: { toFixed(d: number): string };
  differenceAmount: { toFixed(d: number): string };
  exceptionsCount: number;
  exceptionsAmount: { toFixed(d: number): string };
  caveatsCount: number;
  notes: string | null;
  previousClosingId: string | null;
  supersededByClosingId: string | null;
  createdByUserId: string;
  createdAt: Date;
  closedByUserId: string | null;
  closedAt: Date | null;
}): TreasuryDailyClosingRow {
  return {
    id: row.id,
    companyCode: row.companyCode,
    civilDate: toCivilDateKey(row.civilDate),
    version: row.version,
    status: row.status as TreasuryClosingStatus,
    sourceHash: row.sourceHash,
    contentHash: row.contentHash,
    openingBalance: money(row.openingBalance),
    realizedInflows: money(row.realizedInflows),
    realizedOutflows: money(row.realizedOutflows),
    pendenciesAmount: money(row.pendenciesAmount),
    closingBalance: money(row.closingBalance),
    observedBalance: money(row.observedBalance),
    reconciledBalance: money(row.reconciledBalance),
    differenceAmount: money(row.differenceAmount),
    exceptionsCount: row.exceptionsCount,
    exceptionsAmount: money(row.exceptionsAmount),
    caveatsCount: row.caveatsCount,
    notes: row.notes,
    previousClosingId: row.previousClosingId,
    supersededByClosingId: row.supersededByClosingId,
    createdByUserId: row.createdByUserId,
    createdAt: row.createdAt,
    closedByUserId: row.closedByUserId,
    closedAt: row.closedAt,
  };
}

type Db = PrismaClient | Prisma.TransactionClient;

async function insertChildren(
  db: Db,
  closingId: string,
  input: Pick<
    TreasuryDailyClosingCreateClosedInput,
    "positions" | "pendencies" | "caveats"
  >
): Promise<void> {
  if (input.positions.length) {
    await db.treasuryDailyClosingAccountPosition.createMany({
      data: input.positions.map((p) => ({
        closingId,
        accountId: p.accountId,
        openingBalance: p.openingBalance,
        realizedInflows: p.realizedInflows,
        realizedOutflows: p.realizedOutflows,
        pendenciesAmount: p.pendenciesAmount,
        closingBalance: p.closingBalance,
        observedBalance: p.observedBalance,
        reconciledBalance: p.reconciledBalance,
        differenceAmount: p.differenceAmount,
        sortOrder: p.sortOrder,
      })),
    });
  }
  if (input.pendencies.length) {
    await db.treasuryDailyClosingFrozenPendency.createMany({
      data: input.pendencies.map((p) => ({
        closingId,
        accountId: p.accountId,
        titleKind: p.titleKind,
        officialTitleId: p.officialTitleId,
        nomusExternalId: p.nomusExternalId,
        dueDate: p.dueDate ? civilToDate(p.dueDate) : null,
        expectedDate: p.expectedDate ? civilToDate(p.expectedDate) : null,
        openAmount: p.openAmount,
        counterpartyName: p.counterpartyName,
        sortOrder: p.sortOrder,
      })),
    });
  }
  if (input.caveats.length) {
    await db.treasuryDailyClosingCaveat.createMany({
      data: input.caveats.map((c) => ({
        closingId,
        code: c.code,
        severity: c.severity,
        message: c.message,
        acknowledged: true,
        sortOrder: c.sortOrder,
      })),
    });
  }
}

export function createTreasuryDailyClosingRepository(
  prisma: PrismaClient
): TreasuryDailyClosingRepository {
  return {
    async tryAcquireLock(companyCode, civilDate) {
      const { key1, key2 } = buildTreasuryDailyClosingAdvisoryLockKeys(
        companyCode,
        civilDate
      );
      const rows = await prisma.$queryRaw<Array<{ locked: boolean }>>`
        SELECT pg_try_advisory_lock(${key1}::int, ${key2}::int) AS locked
      `;
      return Boolean(rows[0]?.locked);
    },

    async releaseLock(companyCode, civilDate) {
      const { key1, key2 } = buildTreasuryDailyClosingAdvisoryLockKeys(
        companyCode,
        civilDate
      );
      await prisma.$queryRaw`
        SELECT pg_advisory_unlock(${key1}::int, ${key2}::int)
      `;
    },

    async findCurrent(companyCode, civilDate) {
      const row = await prisma.treasuryDailyClosing.findFirst({
        where: {
          companyCode,
          civilDate: civilToDate(civilDate),
          status: { in: ["OPEN", "CLOSED"] },
        },
        orderBy: { version: "desc" },
      });
      return row ? mapRow(row) : null;
    },

    async findById(id) {
      const row = await prisma.treasuryDailyClosing.findUnique({
        where: { id },
      });
      return row ? mapRow(row) : null;
    },

    async list(input) {
      const where: Prisma.TreasuryDailyClosingWhereInput = {};
      if (input.companyCode) where.companyCode = input.companyCode;
      if (input.status) where.status = input.status;
      if (input.dateFrom || input.dateTo) {
        where.civilDate = {};
        if (input.dateFrom) where.civilDate.gte = civilToDate(input.dateFrom);
        if (input.dateTo) where.civilDate.lte = civilToDate(input.dateTo);
      }
      const [total, rows] = await Promise.all([
        prisma.treasuryDailyClosing.count({ where }),
        prisma.treasuryDailyClosing.findMany({
          where,
          orderBy: [{ civilDate: "desc" }, { version: "desc" }],
          skip: (input.page - 1) * input.pageSize,
          take: input.pageSize,
        }),
      ]);
      return { rows: rows.map(mapRow), total };
    },

    async createClosed(input) {
      const created = await prisma.$transaction(async (tx) => {
        const row = await tx.treasuryDailyClosing.create({
          data: {
            companyCode: input.companyCode,
            civilDate: civilToDate(input.civilDate),
            version: input.version,
            status: "CLOSED",
            sourceHash: input.sourceHash,
            contentHash: input.contentHash,
            openingBalance: input.openingBalance,
            realizedInflows: input.realizedInflows,
            realizedOutflows: input.realizedOutflows,
            pendenciesAmount: input.pendenciesAmount,
            closingBalance: input.closingBalance,
            observedBalance: input.observedBalance,
            reconciledBalance: input.reconciledBalance,
            differenceAmount: input.differenceAmount,
            exceptionsCount: input.exceptionsCount,
            exceptionsAmount: input.exceptionsAmount,
            caveatsCount: input.caveatsCount,
            notes: input.notes,
            previousClosingId: input.previousClosingId,
            createdByUserId: input.createdByUserId,
            closedByUserId: input.closedByUserId,
            closedAt: input.closedAt,
          },
        });
        await insertChildren(tx, row.id, input);
        return row;
      });
      return mapRow(created);
    },

    async finalizeOpenToClosed(openId, input) {
      const updated = await prisma.$transaction(async (tx) => {
        const row = await tx.treasuryDailyClosing.update({
          where: { id: openId },
          data: {
            status: "CLOSED",
            sourceHash: input.sourceHash,
            contentHash: input.contentHash,
            openingBalance: input.openingBalance,
            realizedInflows: input.realizedInflows,
            realizedOutflows: input.realizedOutflows,
            pendenciesAmount: input.pendenciesAmount,
            closingBalance: input.closingBalance,
            observedBalance: input.observedBalance,
            reconciledBalance: input.reconciledBalance,
            differenceAmount: input.differenceAmount,
            exceptionsCount: input.exceptionsCount,
            exceptionsAmount: input.exceptionsAmount,
            caveatsCount: input.caveatsCount,
            notes: input.notes,
            closedByUserId: input.closedByUserId,
            closedAt: input.closedAt,
          },
        });
        await insertChildren(tx, row.id, input);
        return row;
      });
      return mapRow(updated);
    },

    async reopen(input) {
      const result = await prisma.$transaction(async (tx) => {
        const previous = await tx.treasuryDailyClosing.findUniqueOrThrow({
          where: { id: input.fromClosingId },
        });
        const next = await tx.treasuryDailyClosing.create({
          data: {
            companyCode: input.companyCode,
            civilDate: civilToDate(input.civilDate),
            version: input.newVersion,
            status: "OPEN",
            sourceHash: input.sourceHash,
            contentHash: null,
            openingBalance: "0.00",
            realizedInflows: "0.00",
            realizedOutflows: "0.00",
            pendenciesAmount: "0.00",
            closingBalance: "0.00",
            observedBalance: "0.00",
            reconciledBalance: "0.00",
            differenceAmount: "0.00",
            exceptionsCount: 0,
            exceptionsAmount: "0.00",
            caveatsCount: 0,
            previousClosingId: previous.id,
            createdByUserId: input.reopenedByUserId,
          },
        });
        const prevUpdated = await tx.treasuryDailyClosing.update({
          where: { id: previous.id },
          data: {
            status: "REOPENED",
            supersededByClosingId: next.id,
          },
        });
        const reopening = await tx.treasuryDailyClosingReopening.create({
          data: {
            fromClosingId: previous.id,
            toClosingId: next.id,
            reason: input.reason,
            requestId: input.requestId,
            reopenedByUserId: input.reopenedByUserId,
          },
        });
        return { previous: prevUpdated, next, reopening };
      });
      return {
        previous: mapRow(result.previous),
        next: mapRow(result.next),
        reopening: {
          id: result.reopening.id,
          fromClosingId: result.reopening.fromClosingId,
          toClosingId: result.reopening.toClosingId,
          reason: result.reopening.reason,
          reopenedByUserId: result.reopening.reopenedByUserId,
          reopenedAt: formatTreasuryTimestampIso(result.reopening.reopenedAt),
          requestId: result.reopening.requestId,
        },
      };
    },

    async listAccountPositions(closingId) {
      const rows = await prisma.treasuryDailyClosingAccountPosition.findMany({
        where: { closingId },
        orderBy: { sortOrder: "asc" },
      });
      return rows.map((r) => ({
        id: r.id,
        closingId: r.closingId,
        accountId: r.accountId,
        openingBalance: money(r.openingBalance),
        realizedInflows: money(r.realizedInflows),
        realizedOutflows: money(r.realizedOutflows),
        pendenciesAmount: money(r.pendenciesAmount),
        closingBalance: money(r.closingBalance),
        observedBalance: money(r.observedBalance),
        reconciledBalance: money(r.reconciledBalance),
        differenceAmount: money(r.differenceAmount),
        sortOrder: r.sortOrder,
      }));
    },

    async listCaveats(closingId) {
      const rows = await prisma.treasuryDailyClosingCaveat.findMany({
        where: { closingId },
        orderBy: { sortOrder: "asc" },
      });
      return rows.map((r) => ({
        id: r.id,
        closingId: r.closingId,
        code: r.code,
        severity: r.severity as "INFO" | "WARNING" | "CRITICAL",
        message: r.message,
        acknowledged: r.acknowledged,
        sortOrder: r.sortOrder,
      }));
    },
  };
}
