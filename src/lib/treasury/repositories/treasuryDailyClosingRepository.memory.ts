/**
 * Repository in-memory — fechamento diário + lock simulado (testes).
 */

import { randomUUID } from "node:crypto";
import type { TreasuryClosingStatus } from "../contracts/treasuryEnums.js";
import { formatTreasuryTimestampIso } from "../contracts/treasuryTimestamp.js";
import { buildTreasuryDailyClosingAdvisoryLockKeys } from "../domain/treasuryDailyClosingLock.js";
import type {
  TreasuryDailyClosingCaveatRow,
  TreasuryDailyClosingCreateClosedInput,
  TreasuryDailyClosingRepository,
  TreasuryDailyClosingRow,
} from "./treasuryDailyClosingRepository.server.js";
import type {
  TreasuryDailyClosingAccountPositionDto,
  TreasuryDailyClosingReopeningDto,
} from "../contracts/treasuryDto.js";

export type TreasuryDailyClosingMemoryStore = {
  closings: TreasuryDailyClosingRow[];
  positions: TreasuryDailyClosingAccountPositionDto[];
  caveats: TreasuryDailyClosingCaveatRow[];
  reopenings: TreasuryDailyClosingReopeningDto[];
  locks: Set<string>;
};

export function createEmptyTreasuryDailyClosingMemoryStore(): TreasuryDailyClosingMemoryStore {
  return {
    closings: [],
    positions: [],
    caveats: [],
    reopenings: [],
    locks: new Set(),
  };
}

function cloneRow(row: TreasuryDailyClosingRow): TreasuryDailyClosingRow {
  return { ...row };
}

export function createMemoryTreasuryDailyClosingRepository(
  store: TreasuryDailyClosingMemoryStore
): TreasuryDailyClosingRepository {
  return {
    async tryAcquireLock(companyCode, civilDate) {
      const { lockName } = buildTreasuryDailyClosingAdvisoryLockKeys(
        companyCode,
        civilDate
      );
      if (store.locks.has(lockName)) return false;
      store.locks.add(lockName);
      return true;
    },

    async releaseLock(companyCode, civilDate) {
      const { lockName } = buildTreasuryDailyClosingAdvisoryLockKeys(
        companyCode,
        civilDate
      );
      store.locks.delete(lockName);
    },

    async findCurrent(companyCode, civilDate) {
      const rows = store.closings
        .filter(
          (c) =>
            c.companyCode === companyCode &&
            c.civilDate === civilDate &&
            (c.status === "OPEN" || c.status === "CLOSED")
        )
        .sort((a, b) => b.version - a.version);
      return rows[0] ? cloneRow(rows[0]) : null;
    },

    async findById(id) {
      const row = store.closings.find((c) => c.id === id);
      return row ? cloneRow(row) : null;
    },

    async list(input) {
      let rows = [...store.closings];
      if (input.companyCode) {
        rows = rows.filter((c) => c.companyCode === input.companyCode);
      }
      if (input.status) {
        rows = rows.filter((c) => c.status === input.status);
      }
      if (input.dateFrom) {
        rows = rows.filter((c) => c.civilDate >= input.dateFrom!);
      }
      if (input.dateTo) {
        rows = rows.filter((c) => c.civilDate <= input.dateTo!);
      }
      rows.sort((a, b) => {
        if (a.civilDate === b.civilDate) return b.version - a.version;
        return a.civilDate < b.civilDate ? 1 : -1;
      });
      const total = rows.length;
      const start = (input.page - 1) * input.pageSize;
      return {
        rows: rows.slice(start, start + input.pageSize).map(cloneRow),
        total,
      };
    },

    async createClosed(input) {
      const now = input.closedAt;
      const row: TreasuryDailyClosingRow = {
        id: randomUUID(),
        companyCode: input.companyCode,
        civilDate: input.civilDate,
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
        supersededByClosingId: null,
        createdByUserId: input.createdByUserId,
        createdAt: now,
        closedByUserId: input.closedByUserId,
        closedAt: input.closedAt,
      };
      store.closings.push(row);
      for (const p of input.positions) {
        store.positions.push({
          id: randomUUID(),
          closingId: row.id,
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
        });
      }
      for (const c of input.caveats) {
        store.caveats.push({
          id: randomUUID(),
          closingId: row.id,
          code: c.code,
          severity: c.severity,
          message: c.message,
          acknowledged: true,
          sortOrder: c.sortOrder,
        });
      }
      return cloneRow(row);
    },

    async finalizeOpenToClosed(openId, input) {
      const idx = store.closings.findIndex((c) => c.id === openId);
      if (idx < 0) throw new Error("OPEN closing not found");
      const prev = store.closings[idx]!;
      const row: TreasuryDailyClosingRow = {
        ...prev,
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
      };
      store.closings[idx] = row;
      for (const p of input.positions) {
        store.positions.push({
          id: randomUUID(),
          closingId: row.id,
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
        });
      }
      for (const c of input.caveats) {
        store.caveats.push({
          id: randomUUID(),
          closingId: row.id,
          code: c.code,
          severity: c.severity,
          message: c.message,
          acknowledged: true,
          sortOrder: c.sortOrder,
        });
      }
      return cloneRow(row);
    },

    async reopen(input) {
      const prevIdx = store.closings.findIndex(
        (c) => c.id === input.fromClosingId
      );
      if (prevIdx < 0) throw new Error("closing not found");
      const previous = store.closings[prevIdx]!;
      const next: TreasuryDailyClosingRow = {
        id: randomUUID(),
        companyCode: input.companyCode,
        civilDate: input.civilDate,
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
        notes: null,
        previousClosingId: previous.id,
        supersededByClosingId: null,
        createdByUserId: input.reopenedByUserId,
        createdAt: new Date(),
        closedByUserId: null,
        closedAt: null,
      };
      const prevUpdated: TreasuryDailyClosingRow = {
        ...previous,
        status: "REOPENED" satisfies TreasuryClosingStatus,
        supersededByClosingId: next.id,
      };
      store.closings[prevIdx] = prevUpdated;
      store.closings.push(next);
      const reopening: TreasuryDailyClosingReopeningDto = {
        id: randomUUID(),
        fromClosingId: previous.id,
        toClosingId: next.id,
        reason: input.reason,
        reopenedByUserId: input.reopenedByUserId,
        reopenedAt: formatTreasuryTimestampIso(new Date()),
        requestId: input.requestId,
      };
      store.reopenings.push(reopening);
      return {
        previous: cloneRow(prevUpdated),
        next: cloneRow(next),
        reopening,
      };
    },

    async listAccountPositions(closingId) {
      return store.positions
        .filter((p) => p.closingId === closingId)
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((p) => ({ ...p }));
    },

    async listCaveats(closingId) {
      return store.caveats
        .filter((c) => c.closingId === closingId)
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((c) => ({ ...c }));
    },
  };
}
