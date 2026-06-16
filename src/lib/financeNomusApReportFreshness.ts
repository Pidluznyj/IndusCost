import type { Prisma } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import {
  isFinanceApExcludedFromManagement,
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
export const NOMUS_AP_STALE_SYNC_FALLBACK_WINDOW_MS = 60 * 60 * 1000;

export type NomusApReportSyncCutoffStrategy = "MAX_SYNCED_AT_MINUS_WINDOW";

export type NomusApReportSyncCutoff = {
  maxSyncedAt: Date;
  minEligibleSyncedAt: Date;
  strategy: NomusApReportSyncCutoffStrategy;
};

export type NomusApReportFreshnessRow = {
  syncedAt: Date;
};

export function buildNomusApReportSyncCutoff(
  maxSyncedAt: Date | null | undefined
): NomusApReportSyncCutoff | null {
  if (!maxSyncedAt) return null;
  return {
    maxSyncedAt,
    minEligibleSyncedAt: new Date(
      maxSyncedAt.getTime() - NOMUS_AP_STALE_SYNC_FALLBACK_WINDOW_MS
    ),
    strategy: "MAX_SYNCED_AT_MINUS_WINDOW",
  };
}

export function resolveNomusApReportSyncCutoffFromRows(
  rows: NomusApReportFreshnessRow[]
): NomusApReportSyncCutoff | null {
  let maxSyncedAt: Date | null = null;
  for (const row of rows) {
    if (!maxSyncedAt || row.syncedAt.getTime() > maxSyncedAt.getTime()) {
      maxSyncedAt = row.syncedAt;
    }
  }
  return buildNomusApReportSyncCutoff(maxSyncedAt);
}

export async function resolveNomusApReportSyncCutoffFromPrisma(
  db: Pick<PrismaClient, "nomusAccountsPayable">
): Promise<NomusApReportSyncCutoff | null> {
  const agg = await db.nomusAccountsPayable.aggregate({
    _max: { syncedAt: true },
  });
  return buildNomusApReportSyncCutoff(agg._max.syncedAt);
}

export function isNomusApCurrentInLastSync(
  syncedAt: Date,
  cutoff: NomusApReportSyncCutoff
): boolean {
  return syncedAt.getTime() >= cutoff.minEligibleSyncedAt.getTime();
}

export function isNomusApStaleForReports(
  row: NomusApReportFreshnessRow,
  cutoff: NomusApReportSyncCutoff | null | undefined
): boolean {
  if (!cutoff) return false;
  return !isNomusApCurrentInLastSync(row.syncedAt, cutoff);
}

export function buildNomusApCurrentSyncPrismaWhere(
  cutoff: NomusApReportSyncCutoff
): Prisma.NomusAccountsPayableWhereInput {
  return {
    syncedAt: { gte: cutoff.minEligibleSyncedAt },
  };
}

export function mergeFinanceApPrismaWhereWithSyncCutoff(
  where: Prisma.NomusAccountsPayableWhereInput,
  cutoff: NomusApReportSyncCutoff | null | undefined
): Prisma.NomusAccountsPayableWhereInput {
  if (!cutoff) return where;
  const syncClause = buildNomusApCurrentSyncPrismaWhere(cutoff);
  if (Object.keys(where).length === 0) return syncClause;
  return { AND: [where, syncClause] };
}

type FinanceApReportRow = NomusApReportFreshnessRow & {
  companyName?: string | null;
  personName?: string | null;
  personCnpj?: string | null;
  description?: string | null;
  type?: number | null;
};

/** Exclusões de relatório financeiro: intercompany, pedido de compra e stale Nomus. */
export function isFinanceApExcludedFromReports(
  row: FinanceApReportRow,
  syncCutoff: NomusApReportSyncCutoff | null | undefined
): boolean {
  if (isFinanceApExcludedFromManagement(row)) return true;
  return isNomusApStaleForReports(row, syncCutoff);
}

export function resolveEffectiveNomusApReportSyncCutoff(
  rows: NomusApReportFreshnessRow[],
  syncCutoff: NomusApReportSyncCutoff | null | undefined
): NomusApReportSyncCutoff | null {
  if (syncCutoff !== undefined) return syncCutoff;
  return resolveNomusApReportSyncCutoffFromRows(rows);
}

export function countStaleFinanceApRowsInScope(
  rows: FinanceApReportRow[],
  syncCutoff: NomusApReportSyncCutoff | null | undefined
): Pick<FinanceDataSanitization, "ignoredStalePayables"> {
  const cutoff = resolveEffectiveNomusApReportSyncCutoff(rows, syncCutoff);
  if (!cutoff) return { ignoredStalePayables: 0 };
  let ignoredStalePayables = 0;
  for (const row of rows) {
    if (isNomusApStaleForReports(row, cutoff)) ignoredStalePayables += 1;
  }
  return { ignoredStalePayables };
}
