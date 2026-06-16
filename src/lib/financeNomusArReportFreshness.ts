import type { Prisma } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import {
  isFinanceArExcludedFromManagement,
  type FinanceDataSanitization,
} from "./financeInternalGroupExclusions.js";

/**
 * Fallback técnico enquanto o stage não persiste `lastSeenAt` / `lastSeenSyncRunId`.
 * Títulos com syncedAt anterior a (MAX(syncedAt) - janela) são tratados como stale
 * (deixaram de retornar na última sync completa da API Nomus).
 *
 * TODO(schema): preferir `isCurrentInNomus`, `lastSeenAt`, `lastSeenSyncRunId`,
 * `missingFromNomusSince`, `excludedFromCashFlow`, `excludedReason` quando existirem.
 */
export const NOMUS_AR_STALE_SYNC_FALLBACK_WINDOW_MS = 60 * 60 * 1000;

export type NomusArReportSyncCutoffStrategy = "MAX_SYNCED_AT_MINUS_WINDOW";

export type NomusArReportSyncCutoff = {
  maxSyncedAt: Date;
  minEligibleSyncedAt: Date;
  strategy: NomusArReportSyncCutoffStrategy;
};

export type NomusArReportFreshnessRow = {
  syncedAt: Date;
};

export function buildNomusArReportSyncCutoff(
  maxSyncedAt: Date | null | undefined
): NomusArReportSyncCutoff | null {
  if (!maxSyncedAt) return null;
  return {
    maxSyncedAt,
    minEligibleSyncedAt: new Date(
      maxSyncedAt.getTime() - NOMUS_AR_STALE_SYNC_FALLBACK_WINDOW_MS
    ),
    strategy: "MAX_SYNCED_AT_MINUS_WINDOW",
  };
}

export function resolveNomusArReportSyncCutoffFromRows(
  rows: NomusArReportFreshnessRow[]
): NomusArReportSyncCutoff | null {
  let maxSyncedAt: Date | null = null;
  for (const row of rows) {
    if (!maxSyncedAt || row.syncedAt.getTime() > maxSyncedAt.getTime()) {
      maxSyncedAt = row.syncedAt;
    }
  }
  return buildNomusArReportSyncCutoff(maxSyncedAt);
}

export async function resolveNomusArReportSyncCutoffFromPrisma(
  db: Pick<PrismaClient, "nomusAccountsReceivable">
): Promise<NomusArReportSyncCutoff | null> {
  const agg = await db.nomusAccountsReceivable.aggregate({
    _max: { syncedAt: true },
  });
  return buildNomusArReportSyncCutoff(agg._max.syncedAt);
}

export function isNomusArCurrentInLastSync(
  syncedAt: Date,
  cutoff: NomusArReportSyncCutoff
): boolean {
  return syncedAt.getTime() >= cutoff.minEligibleSyncedAt.getTime();
}

export function isNomusArStaleForReports(
  row: NomusArReportFreshnessRow,
  cutoff: NomusArReportSyncCutoff | null | undefined
): boolean {
  if (!cutoff) return false;
  return !isNomusArCurrentInLastSync(row.syncedAt, cutoff);
}

export function buildNomusArCurrentSyncPrismaWhere(
  cutoff: NomusArReportSyncCutoff
): Prisma.NomusAccountsReceivableWhereInput {
  return {
    syncedAt: { gte: cutoff.minEligibleSyncedAt },
  };
}

export function mergeFinanceArPrismaWhereWithSyncCutoff(
  where: Prisma.NomusAccountsReceivableWhereInput,
  cutoff: NomusArReportSyncCutoff | null | undefined
): Prisma.NomusAccountsReceivableWhereInput {
  if (!cutoff) return where;
  const syncClause = buildNomusArCurrentSyncPrismaWhere(cutoff);
  if (Object.keys(where).length === 0) return syncClause;
  return { AND: [where, syncClause] };
}

type FinanceArReportRow = NomusArReportFreshnessRow & {
  personName?: string | null;
  personCnpj?: string | null;
  amountReceivable?: unknown;
  amountReceived?: unknown;
  balanceReceivable?: unknown;
};

/** Exclusões de relatório financeiro: grupo interno, fantasma e stale Nomus. */
export function isFinanceArExcludedFromReports(
  row: FinanceArReportRow,
  syncCutoff: NomusArReportSyncCutoff | null | undefined
): boolean {
  if (isFinanceArExcludedFromManagement(row)) return true;
  return isNomusArStaleForReports(row, syncCutoff);
}

export function resolveEffectiveNomusArReportSyncCutoff(
  rows: NomusArReportFreshnessRow[],
  syncCutoff: NomusArReportSyncCutoff | null | undefined
): NomusArReportSyncCutoff | null {
  if (syncCutoff !== undefined) return syncCutoff;
  return resolveNomusArReportSyncCutoffFromRows(rows);
}

export function countStaleFinanceArRowsInScope(
  rows: FinanceArReportRow[],
  syncCutoff: NomusArReportSyncCutoff | null | undefined
): Pick<FinanceDataSanitization, "ignoredStaleReceivables"> {
  const cutoff = resolveEffectiveNomusArReportSyncCutoff(rows, syncCutoff);
  if (!cutoff) return { ignoredStaleReceivables: 0 };
  let ignoredStaleReceivables = 0;
  for (const row of rows) {
    if (isNomusArStaleForReports(row, cutoff)) ignoredStaleReceivables += 1;
  }
  return { ignoredStaleReceivables };
}
