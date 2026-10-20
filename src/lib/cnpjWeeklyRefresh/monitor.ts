import type { CnpjWeeklyRefreshConfig } from "./config.js";
import { nextCnpjWeeklyRefresh } from "./schedule.js";
import type { CnpjRefreshRunRecord } from "./store.js";

export type CnpjRefreshMonitor = {
  schedulerEnabled: boolean;
  nextSlot: string;
  nextAt: string;
  lastRun: {
    id: string;
    status: string;
    trigger: string;
    startedAt: string | null;
    finishedAt: string | null;
    durationMs: number | null;
    eligibleCount: number;
    consultedCount: number;
    updatedCount: number;
    unchangedCount: number;
    failedCount: number;
    partialCount: number;
    invalidCount: number;
    missingDocumentCount: number;
    customerCount: number;
    supplierCount: number;
    lastCnpj: string | null;
    sourceLabel: string | null;
    statusDetail: string | null;
    percent: number;
  } | null;
};

export function buildCnpjRefreshMonitor(input: {
  now: Date;
  config: Pick<CnpjWeeklyRefreshConfig, "enabled">;
  runs: readonly CnpjRefreshRunRecord[];
}): CnpjRefreshMonitor {
  const next = nextCnpjWeeklyRefresh(input.now);
  const last = input.runs[0] ?? null;
  const total = last ? last.eligibleCount + last.invalidCount + last.missingDocumentCount : 0;
  const done = last
    ? last.consultedCount + last.failedCount + last.invalidCount + last.missingDocumentCount
    : 0;
  return {
    schedulerEnabled: input.config.enabled,
    nextSlot: next.slot,
    nextAt: next.at.toISOString(),
    lastRun: last
      ? {
          id: last.id,
          status: last.status,
          trigger: last.trigger,
          startedAt: last.startedAt?.toISOString() ?? null,
          finishedAt: last.finishedAt?.toISOString() ?? null,
          durationMs:
            last.startedAt && last.finishedAt ? last.finishedAt.getTime() - last.startedAt.getTime() : null,
          eligibleCount: last.eligibleCount,
          consultedCount: last.consultedCount,
          updatedCount: last.updatedCount,
          unchangedCount: last.unchangedCount,
          failedCount: last.failedCount,
          partialCount: last.partialCount,
          invalidCount: last.invalidCount,
          missingDocumentCount: last.missingDocumentCount,
          customerCount: last.customerCount,
          supplierCount: last.supplierCount,
          lastCnpj: last.lastCnpj,
          sourceLabel: last.sourceLabel,
          statusDetail: last.statusDetail,
          percent: total === 0 ? 0 : Math.min(100, Math.round((done / total) * 100)),
        }
      : null,
  };
}
