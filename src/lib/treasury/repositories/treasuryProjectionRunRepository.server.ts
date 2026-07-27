/**
 * Repository — execução/persistência de ProjectionRun + day lines.
 * Lock: pg_try_advisory_lock por empresa+cenário.
 */

import { Prisma, type PrismaClient } from "@prisma/client";
import { buildTreasuryProjectionAdvisoryLockKeys } from "../domain/treasuryProjectionLock.js";

export type TreasuryProjectionRunRow = {
  id: string;
  companyCode: string | null;
  scenario: string;
  status: string;
  periodFrom: Date;
  periodTo: Date;
  sourceVersion: string;
  algorithmVersion: string;
  requestedAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
  failureCode: string | null;
  failureMessage: string | null;
  failureDetail: unknown | null;
  requestId: string | null;
  idempotencyKey: string | null;
  notes: string | null;
  lineCount: number;
  itemCount: number;
  createdByUserId: string;
  createdAt: Date;
  updatedAt: Date;
  updatedByUserId: string | null;
};

export type TreasuryProjectionCompositionPersistInput = {
  itemKind: string;
  amount: string;
  label: string | null;
  officialTitleId: string | null;
  nomusExternalId: number | null;
  ledgerEntryId: string | null;
  transferGroupId: string | null;
  sourceRef: string | null;
  sortOrder: number;
  metadata: Record<string, unknown> | null;
};

export type TreasuryProjectionDayLinePersistInput = {
  accountId: string;
  civilDate: string;
  openingBalance: string;
  inflows: string;
  outflows: string;
  transfers: string;
  realized: string;
  closingBalance: string;
  uncertainReceivables: string;
  minimumBalance: string;
  riskAmount: string;
  riskCode: string;
  itemCount: number;
  composition: TreasuryProjectionCompositionPersistInput[];
};

export type TreasuryProjectionRunCreateData = {
  companyCode: string | null;
  scenario: string;
  periodFrom: string;
  periodTo: string;
  sourceVersion: string;
  algorithmVersion: string;
  createdByUserId: string;
  requestId?: string | null;
  idempotencyKey?: string | null;
  notes?: string | null;
};

export type TreasuryProjectionDayLineSummary = {
  id: string;
  accountId: string;
  civilDate: Date;
  openingBalance: string;
  closingBalance: string;
  itemCount: number;
};

export type TreasuryProjectionRunRepository = {
  tryAcquireExecutionLock(
    companyCode: string,
    scenario: string
  ): Promise<boolean>;
  releaseExecutionLock(companyCode: string, scenario: string): Promise<void>;
  createRun(data: TreasuryProjectionRunCreateData): Promise<TreasuryProjectionRunRow>;
  markRunning(runId: string, at: Date): Promise<TreasuryProjectionRunRow>;
  markSucceeded(
    runId: string,
    input: {
      finishedAt: Date;
      lineCount: number;
      itemCount: number;
      updatedByUserId?: string | null;
    }
  ): Promise<TreasuryProjectionRunRow>;
  markFailed(
    runId: string,
    input: {
      finishedAt: Date;
      failureCode: string;
      failureMessage: string;
      failureDetail?: unknown;
      updatedByUserId?: string | null;
    }
  ): Promise<TreasuryProjectionRunRow>;
  persistDayLines(
    runId: string,
    lines: TreasuryProjectionDayLinePersistInput[],
    options?: { batchSize?: number }
  ): Promise<void>;
  findById(runId: string): Promise<TreasuryProjectionRunRow | null>;
  findLatestSucceeded(
    companyCode: string | null,
    scenario: string
  ): Promise<TreasuryProjectionRunRow | null>;
  listDayLines(runId: string): Promise<TreasuryProjectionDayLineSummary[]>;
};

function civilToDate(value: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!m) throw new Error(`Data civil inválida: ${value}`);
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}

function moneyStr(value: { toFixed(d: number): string } | string | number): string {
  if (typeof value === "string") return value;
  if (typeof value === "number") return value.toFixed(2);
  return value.toFixed(2);
}

function mapRun(row: {
  id: string;
  companyCode: string | null;
  scenario: string;
  status: string;
  periodFrom: Date;
  periodTo: Date;
  sourceVersion: string;
  algorithmVersion: string;
  requestedAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
  failureCode: string | null;
  failureMessage: string | null;
  failureDetail: unknown;
  requestId: string | null;
  idempotencyKey: string | null;
  notes: string | null;
  lineCount: number;
  itemCount: number;
  createdByUserId: string;
  createdAt: Date;
  updatedAt: Date;
  updatedByUserId: string | null;
}): TreasuryProjectionRunRow {
  return {
    id: row.id,
    companyCode: row.companyCode,
    scenario: row.scenario,
    status: row.status,
    periodFrom: row.periodFrom,
    periodTo: row.periodTo,
    sourceVersion: row.sourceVersion,
    algorithmVersion: row.algorithmVersion,
    requestedAt: row.requestedAt,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    failureCode: row.failureCode,
    failureMessage: row.failureMessage,
    failureDetail: row.failureDetail ?? null,
    requestId: row.requestId,
    idempotencyKey: row.idempotencyKey,
    notes: row.notes,
    lineCount: row.lineCount,
    itemCount: row.itemCount,
    createdByUserId: row.createdByUserId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    updatedByUserId: row.updatedByUserId,
  };
}

type PrismaLike = Pick<
  PrismaClient,
  "treasuryProjectionRun" | "treasuryProjectionDayLine" | "$queryRaw" | "$transaction"
>;

export function createTreasuryProjectionRunRepository(
  db: PrismaLike
): TreasuryProjectionRunRepository {
  return {
    async tryAcquireExecutionLock(companyCode, scenario) {
      const { key1, key2 } = buildTreasuryProjectionAdvisoryLockKeys(
        companyCode,
        scenario
      );
      const rows = await db.$queryRaw<Array<{ locked: boolean }>>`
        SELECT pg_try_advisory_lock(${key1}::int, ${key2}::int) AS locked
      `;
      return Boolean(rows[0]?.locked);
    },

    async releaseExecutionLock(companyCode, scenario) {
      const { key1, key2 } = buildTreasuryProjectionAdvisoryLockKeys(
        companyCode,
        scenario
      );
      await db.$queryRaw`
        SELECT pg_advisory_unlock(${key1}::int, ${key2}::int)
      `;
    },

    async createRun(data) {
      const row = await db.treasuryProjectionRun.create({
        data: {
          companyCode: data.companyCode,
          scenario: data.scenario as never,
          status: "PENDING",
          periodFrom: civilToDate(data.periodFrom),
          periodTo: civilToDate(data.periodTo),
          sourceVersion: data.sourceVersion,
          algorithmVersion: data.algorithmVersion,
          createdByUserId: data.createdByUserId,
          requestId: data.requestId ?? null,
          idempotencyKey: data.idempotencyKey ?? null,
          notes: data.notes ?? null,
        },
      });
      return mapRun(row);
    },

    async markRunning(runId, at) {
      const row = await db.treasuryProjectionRun.update({
        where: { id: runId },
        data: { status: "RUNNING", startedAt: at },
      });
      return mapRun(row);
    },

    async markSucceeded(runId, input) {
      const row = await db.treasuryProjectionRun.update({
        where: { id: runId },
        data: {
          status: "SUCCEEDED",
          finishedAt: input.finishedAt,
          lineCount: input.lineCount,
          itemCount: input.itemCount,
          updatedByUserId: input.updatedByUserId ?? null,
          failureCode: null,
          failureMessage: null,
          failureDetail: Prisma.JsonNull,
        },
      });
      return mapRun(row);
    },

    async markFailed(runId, input) {
      const row = await db.treasuryProjectionRun.update({
        where: { id: runId },
        data: {
          status: "FAILED",
          finishedAt: input.finishedAt,
          failureCode: input.failureCode,
          failureMessage: input.failureMessage,
          failureDetail:
            input.failureDetail === undefined
              ? undefined
              : (input.failureDetail as Prisma.InputJsonValue),
          updatedByUserId: input.updatedByUserId ?? null,
        },
      });
      return mapRun(row);
    },

    async persistDayLines(runId, lines, options) {
      const batchSize = options?.batchSize ?? 50;
      for (let i = 0; i < lines.length; i += batchSize) {
        const batch = lines.slice(i, i + batchSize);
        await db.$transaction(
          batch.map((line) =>
            db.treasuryProjectionDayLine.create({
              data: {
                runId,
                accountId: line.accountId,
                civilDate: civilToDate(line.civilDate),
                openingBalance: line.openingBalance,
                inflows: line.inflows,
                outflows: line.outflows,
                transfers: line.transfers,
                realized: line.realized,
                closingBalance: line.closingBalance,
                uncertainReceivables: line.uncertainReceivables,
                minimumBalance: line.minimumBalance,
                riskAmount: line.riskAmount,
                riskCode: line.riskCode as never,
                itemCount: line.itemCount,
                compositionItems: {
                  create: line.composition.map((c) => ({
                    itemKind: c.itemKind as never,
                    amount: c.amount,
                    label: c.label,
                    officialTitleId: c.officialTitleId,
                    nomusExternalId: c.nomusExternalId,
                    ledgerEntryId: c.ledgerEntryId,
                    transferGroupId: c.transferGroupId,
                    sourceRef: c.sourceRef,
                    sortOrder: c.sortOrder,
                    metadataJson: c.metadata ?? undefined,
                  })),
                },
              },
            })
          )
        );
      }
    },

    async findById(runId) {
      const row = await db.treasuryProjectionRun.findUnique({
        where: { id: runId },
      });
      return row ? mapRun(row) : null;
    },

    async findLatestSucceeded(companyCode, scenario) {
      const row = await db.treasuryProjectionRun.findFirst({
        where: {
          companyCode: companyCode,
          scenario: scenario as never,
          status: "SUCCEEDED",
        },
        orderBy: [{ finishedAt: "desc" }, { createdAt: "desc" }],
      });
      return row ? mapRun(row) : null;
    },

    async listDayLines(runId) {
      const rows = await db.treasuryProjectionDayLine.findMany({
        where: { runId },
        orderBy: [{ civilDate: "asc" }, { accountId: "asc" }],
        select: {
          id: true,
          accountId: true,
          civilDate: true,
          openingBalance: true,
          closingBalance: true,
          itemCount: true,
        },
      });
      return rows.map((r) => ({
        id: r.id,
        accountId: r.accountId,
        civilDate: r.civilDate,
        openingBalance: moneyStr(r.openingBalance),
        closingBalance: moneyStr(r.closingBalance),
        itemCount: r.itemCount,
      }));
    },
  };
}
