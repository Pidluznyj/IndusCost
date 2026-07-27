/**
 * Repository in-memory — ProjectionRun + advisory lock simulado.
 */

import { randomUUID } from "node:crypto";
import { buildTreasuryProjectionAdvisoryLockKeys } from "../domain/treasuryProjectionLock.js";
import type {
  TreasuryProjectionCompositionItemRow,
  TreasuryProjectionDayLineDetailed,
  TreasuryProjectionDayLineFilter,
  TreasuryProjectionDayLinePersistInput,
  TreasuryProjectionDayLineSummary,
  TreasuryProjectionRunCreateData,
  TreasuryProjectionRunRepository,
  TreasuryProjectionRunRow,
} from "./treasuryProjectionRunRepository.server.js";

export type TreasuryProjectionMemoryDayLine = TreasuryProjectionDayLinePersistInput & {
  id: string;
  runId: string;
  civilDateObj: Date;
};

export type TreasuryProjectionRunMemoryStore = {
  runs: TreasuryProjectionRunRow[];
  dayLines: TreasuryProjectionMemoryDayLine[];
  locks: Set<string>;
};

export function createEmptyTreasuryProjectionRunMemoryStore(): TreasuryProjectionRunMemoryStore {
  return { runs: [], dayLines: [], locks: new Set() };
}

function civilToDate(value: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!m) throw new Error(`Data civil inválida: ${value}`);
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}

function cloneRun(row: TreasuryProjectionRunRow): TreasuryProjectionRunRow {
  return {
    ...row,
    periodFrom: new Date(row.periodFrom),
    periodTo: new Date(row.periodTo),
    requestedAt: new Date(row.requestedAt),
    startedAt: row.startedAt ? new Date(row.startedAt) : null,
    finishedAt: row.finishedAt ? new Date(row.finishedAt) : null,
    createdAt: new Date(row.createdAt),
    updatedAt: new Date(row.updatedAt),
  };
}

function lockToken(companyCode: string, scenario: string): string {
  const { lockName } = buildTreasuryProjectionAdvisoryLockKeys(
    companyCode,
    scenario
  );
  return lockName;
}

export function createMemoryTreasuryProjectionRunRepository(
  store: TreasuryProjectionRunMemoryStore
): TreasuryProjectionRunRepository {
  return {
    async tryAcquireExecutionLock(companyCode, scenario) {
      const token = lockToken(companyCode, scenario);
      if (store.locks.has(token)) return false;
      store.locks.add(token);
      return true;
    },

    async releaseExecutionLock(companyCode, scenario) {
      store.locks.delete(lockToken(companyCode, scenario));
    },

    async createRun(data: TreasuryProjectionRunCreateData) {
      if (data.idempotencyKey) {
        const existing = store.runs.find(
          (r) => r.idempotencyKey === data.idempotencyKey
        );
        if (existing) {
          const err = new Error("Unique constraint failed on idempotencyKey");
          (err as Error & { code: string }).code = "P2002";
          throw err;
        }
      }
      const now = new Date();
      const row: TreasuryProjectionRunRow = {
        id: randomUUID(),
        companyCode: data.companyCode,
        scenario: data.scenario,
        status: "PENDING",
        periodFrom: civilToDate(data.periodFrom),
        periodTo: civilToDate(data.periodTo),
        sourceVersion: data.sourceVersion,
        algorithmVersion: data.algorithmVersion,
        requestedAt: now,
        startedAt: null,
        finishedAt: null,
        failureCode: null,
        failureMessage: null,
        failureDetail: null,
        requestId: data.requestId ?? null,
        idempotencyKey: data.idempotencyKey ?? null,
        notes: data.notes ?? null,
        lineCount: 0,
        itemCount: 0,
        createdByUserId: data.createdByUserId,
        createdAt: now,
        updatedAt: now,
        updatedByUserId: null,
      };
      store.runs.push(row);
      return cloneRun(row);
    },

    async markRunning(runId, at) {
      const row = store.runs.find((r) => r.id === runId);
      if (!row) throw new Error(`Run not found: ${runId}`);
      row.status = "RUNNING";
      row.startedAt = at;
      row.updatedAt = new Date();
      return cloneRun(row);
    },

    async markSucceeded(runId, input) {
      const row = store.runs.find((r) => r.id === runId);
      if (!row) throw new Error(`Run not found: ${runId}`);
      row.status = "SUCCEEDED";
      row.finishedAt = input.finishedAt;
      row.lineCount = input.lineCount;
      row.itemCount = input.itemCount;
      row.updatedByUserId = input.updatedByUserId ?? null;
      row.failureCode = null;
      row.failureMessage = null;
      row.failureDetail = null;
      row.updatedAt = new Date();
      return cloneRun(row);
    },

    async markFailed(runId, input) {
      const row = store.runs.find((r) => r.id === runId);
      if (!row) throw new Error(`Run not found: ${runId}`);
      row.status = "FAILED";
      row.finishedAt = input.finishedAt;
      row.failureCode = input.failureCode;
      row.failureMessage = input.failureMessage;
      row.failureDetail = input.failureDetail ?? null;
      row.updatedByUserId = input.updatedByUserId ?? null;
      row.updatedAt = new Date();
      return cloneRun(row);
    },

    async persistDayLines(runId, lines, options) {
      const batchSize = options?.batchSize ?? 50;
      for (let i = 0; i < lines.length; i += batchSize) {
        const batch = lines.slice(i, i + batchSize);
        for (const line of batch) {
          store.dayLines.push({
            ...line,
            id: randomUUID(),
            runId,
            civilDateObj: civilToDate(line.civilDate),
            composition: line.composition.map((c) => ({ ...c })),
          });
        }
      }
    },

    async findById(runId) {
      const row = store.runs.find((r) => r.id === runId);
      return row ? cloneRun(row) : null;
    },

    async findLatestSucceeded(companyCode, scenario) {
      const rows = store.runs
        .map((r, index) => ({ r, index }))
        .filter(
          ({ r }) =>
            r.companyCode === companyCode &&
            r.scenario === scenario &&
            r.status === "SUCCEEDED"
        )
        .sort((a, b) => {
          const fa = (a.r.finishedAt ?? a.r.createdAt).getTime();
          const fb = (b.r.finishedAt ?? b.r.createdAt).getTime();
          if (fb !== fa) return fb - fa;
          const ca = b.r.createdAt.getTime() - a.r.createdAt.getTime();
          if (ca !== 0) return ca;
          return b.index - a.index;
        });
      return rows[0] ? cloneRun(rows[0].r) : null;
    },

    async listDayLines(runId): Promise<TreasuryProjectionDayLineSummary[]> {
      return store.dayLines
        .filter((l) => l.runId === runId)
        .sort((a, b) => {
          const byDate =
            a.civilDateObj.getTime() - b.civilDateObj.getTime();
          if (byDate !== 0) return byDate;
          return a.accountId.localeCompare(b.accountId);
        })
        .map((l) => ({
          id: l.id,
          accountId: l.accountId,
          civilDate: l.civilDateObj,
          openingBalance: l.openingBalance,
          closingBalance: l.closingBalance,
          itemCount: l.itemCount,
        }));
    },

    async listDayLinesDetailed(
      runId,
      filter?: TreasuryProjectionDayLineFilter
    ): Promise<TreasuryProjectionDayLineDetailed[]> {
      return filterDayLines(store.dayLines, runId, filter).map((l) => ({
        id: l.id,
        accountId: l.accountId,
        civilDate: l.civilDateObj,
        openingBalance: l.openingBalance,
        inflows: l.inflows,
        outflows: l.outflows,
        transfers: l.transfers,
        realized: l.realized,
        closingBalance: l.closingBalance,
        uncertainReceivables: l.uncertainReceivables,
        minimumBalance: l.minimumBalance,
        riskAmount: l.riskAmount,
        riskCode: l.riskCode,
        itemCount: l.itemCount,
      }));
    },

    async listCompositionItems(
      runId,
      filter?: TreasuryProjectionDayLineFilter
    ): Promise<TreasuryProjectionCompositionItemRow[]> {
      const lines = filterDayLines(store.dayLines, runId, filter);
      const items: TreasuryProjectionCompositionItemRow[] = [];
      for (const line of lines) {
        for (const [idx, c] of line.composition.entries()) {
          items.push({
            id: `${line.id}:${idx}`,
            dayLineId: line.id,
            accountId: line.accountId,
            civilDate: line.civilDateObj,
            itemKind: c.itemKind,
            amount: c.amount,
            label: c.label,
            officialTitleId: c.officialTitleId,
            nomusExternalId: c.nomusExternalId,
            ledgerEntryId: c.ledgerEntryId,
            transferGroupId: c.transferGroupId,
            sourceRef: c.sourceRef,
            sortOrder: c.sortOrder,
          });
        }
      }
      return items.sort(
        (a, b) =>
          a.civilDate.getTime() - b.civilDate.getTime() ||
          a.sortOrder - b.sortOrder
      );
    },
  };
}

function filterDayLines(
  dayLines: TreasuryProjectionMemoryDayLine[],
  runId: string,
  filter?: TreasuryProjectionDayLineFilter
): TreasuryProjectionMemoryDayLine[] {
  const accountSet = filter?.accountIds?.length
    ? new Set(filter.accountIds)
    : null;
  const fromMs = filter?.from ? civilToDate(filter.from).getTime() : null;
  const toMs = filter?.to ? civilToDate(filter.to).getTime() : null;
  return dayLines
    .filter((l) => l.runId === runId)
    .filter((l) => (accountSet ? accountSet.has(l.accountId) : true))
    .filter((l) =>
      fromMs == null ? true : l.civilDateObj.getTime() >= fromMs
    )
    .filter((l) => (toMs == null ? true : l.civilDateObj.getTime() <= toMs))
    .sort((a, b) => {
      const byDate = a.civilDateObj.getTime() - b.civilDateObj.getTime();
      if (byDate !== 0) return byDate;
      return a.accountId.localeCompare(b.accountId);
    });
}
