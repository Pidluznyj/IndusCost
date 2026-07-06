/**
 * Auditoria operacional — cobertura de performance de componentes (read-only).
 * Reutilizado pelo script CLI, API de cobertura e filtros da UI.
 */
import {
  isMissingComponentProcess,
  snapshotFromProduct,
  type ComponentPerformanceProcessSnapshot,
} from "./componentPerformanceChange.js";

export type ComponentPerformanceCoverageSeverity = "OK" | "INCOMPLETE" | "CRITICAL";

export type ComponentPerformanceCoverageInput = {
  productId: string;
  sku: string;
  name: string;
  status?: string | null;
  cycleTimeSeconds?: unknown;
  cavities?: unknown;
  setupTimeMin?: unknown;
  efficiencyExpected?: unknown;
  soldInPeriod?: boolean;
  orderCountInPeriod?: number;
  periodSoldValue?: number;
  lastPerformanceChangeAt?: Date | string | null;
  lastChangedByUserName?: string | null;
  lastResponsiblePersonName?: string | null;
  changeLogCount?: number;
};

export type ComponentPerformanceCoverageRow = {
  productId: string;
  sku: string;
  name: string;
  status: string | null;
  process: ComponentPerformanceProcessSnapshot;
  missingCycle: boolean;
  missingCavities: boolean;
  missingProcess: boolean;
  neverReviewed: boolean;
  soldInPeriod: boolean;
  orderCountInPeriod: number;
  periodSoldValue: number;
  lastPerformanceChangeAt: string | null;
  lastChangedByUserName: string | null;
  lastResponsiblePersonName: string | null;
  severity: ComponentPerformanceCoverageSeverity;
};

export type ComponentPerformanceCoverageTotals = {
  activeComponents: number;
  soldComponentsInPeriod: number;
  withoutCycle: number;
  withoutCavities: number;
  withoutCycleOrCavities: number;
  soldWithoutCompletePerformance: number;
  neverReviewed: number;
  recentlyChanged: number;
};

export type ComponentPerformanceCoverageReport = {
  periodLabel: string;
  periodFrom: string | null;
  periodTo: string | null;
  totals: ComponentPerformanceCoverageTotals;
  topSoldWithoutCompletePerformance: ComponentPerformanceCoverageRow[];
  recentlyChanged: ComponentPerformanceCoverageRow[];
};

export type ComponentPerformanceCoverageOptions = {
  year?: number;
  month?: number;
  top?: number;
  soldOnly?: boolean;
  missingOnly?: boolean;
  recentDays?: number;
};

export function isMissingPerformanceCycle(process: ComponentPerformanceProcessSnapshot): boolean {
  return process.cycleTimeSeconds == null || process.cycleTimeSeconds <= 0;
}

export function isMissingPerformanceCavities(process: ComponentPerformanceProcessSnapshot): boolean {
  return process.cavities == null || process.cavities < 1;
}

export function isIncompletePerformance(process: ComponentPerformanceProcessSnapshot): boolean {
  return (
    isMissingPerformanceCycle(process) ||
    isMissingPerformanceCavities(process) ||
    isMissingComponentProcess(process)
  );
}

export function classifyComponentPerformanceSeverity(input: {
  process: ComponentPerformanceProcessSnapshot;
  soldInPeriod: boolean;
}): ComponentPerformanceCoverageSeverity {
  const incomplete =
    isMissingPerformanceCycle(input.process) ||
    isMissingPerformanceCavities(input.process) ||
    isMissingComponentProcess(input.process);
  if (!incomplete) return "OK";
  if (input.soldInPeriod) return "CRITICAL";
  return "INCOMPLETE";
}

export function classifyComponentPerformanceCoverage(
  input: ComponentPerformanceCoverageInput
): ComponentPerformanceCoverageRow {
  const process = snapshotFromProduct(input);
  const missingCycle = isMissingPerformanceCycle(process);
  const missingCavities = isMissingPerformanceCavities(process);
  const missingProcess = isMissingComponentProcess(process);
  const soldInPeriod = input.soldInPeriod === true;
  const neverReviewed = (input.changeLogCount ?? 0) <= 0;

  const lastAt =
    input.lastPerformanceChangeAt instanceof Date
      ? input.lastPerformanceChangeAt.toISOString()
      : typeof input.lastPerformanceChangeAt === "string"
        ? input.lastPerformanceChangeAt
        : null;

  return {
    productId: input.productId,
    sku: input.sku,
    name: input.name,
    status: input.status?.trim() || null,
    process,
    missingCycle,
    missingCavities,
    missingProcess,
    neverReviewed,
    soldInPeriod,
    orderCountInPeriod: Math.max(0, Math.floor(input.orderCountInPeriod ?? 0)),
    periodSoldValue: roundMoney(input.periodSoldValue ?? 0),
    lastPerformanceChangeAt: lastAt,
    lastChangedByUserName: input.lastChangedByUserName?.trim() || null,
    lastResponsiblePersonName: input.lastResponsiblePersonName?.trim() || null,
    severity: classifyComponentPerformanceSeverity({ process, soldInPeriod }),
  };
}

function roundMoney(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100) / 100;
}

export function buildComponentPerformanceCoverageTotals(
  rows: ComponentPerformanceCoverageRow[],
  activeComponents?: number
): ComponentPerformanceCoverageTotals {
  const withoutCycle = rows.filter((row) => row.missingCycle).length;
  const withoutCavities = rows.filter((row) => row.missingCavities).length;
  const withoutCycleOrCavities = rows.filter(
    (row) => row.missingCycle || row.missingCavities
  ).length;
  const soldWithoutCompletePerformance = rows.filter(
    (row) =>
      row.soldInPeriod &&
      (row.missingCycle || row.missingCavities || row.missingProcess)
  ).length;

  return {
    activeComponents: activeComponents ?? rows.length,
    soldComponentsInPeriod: rows.filter((row) => row.soldInPeriod).length,
    withoutCycle,
    withoutCavities,
    withoutCycleOrCavities,
    soldWithoutCompletePerformance,
    neverReviewed: rows.filter((row) => row.neverReviewed).length,
    recentlyChanged: 0,
  };
}

export function rankSoldComponentsByCommercialImpact(
  rows: ComponentPerformanceCoverageRow[],
  top: number
): ComponentPerformanceCoverageRow[] {
  const limit = Math.min(Math.max(Math.floor(top), 1), 100);
  return rows
    .filter(
      (row) =>
        row.soldInPeriod &&
        (row.missingCycle || row.missingCavities || row.missingProcess)
    )
    .sort(
      (a, b) =>
        b.periodSoldValue - a.periodSoldValue ||
        b.orderCountInPeriod - a.orderCountInPeriod ||
        a.sku.localeCompare(b.sku)
    )
    .slice(0, limit);
}

export function filterRecentlyChangedRows(
  rows: ComponentPerformanceCoverageRow[],
  recentDays: number
): ComponentPerformanceCoverageRow[] {
  const days = Math.min(Math.max(Math.floor(recentDays), 1), 365);
  const since = Date.now() - days * 24 * 60 * 60 * 1000;
  return rows
    .filter((row) => {
      if (!row.lastPerformanceChangeAt) return false;
      const ts = Date.parse(row.lastPerformanceChangeAt);
      return Number.isFinite(ts) && ts >= since;
    })
    .sort(
      (a, b) =>
        Date.parse(b.lastPerformanceChangeAt ?? "") -
        Date.parse(a.lastPerformanceChangeAt ?? "")
    );
}

export function buildComponentPerformanceCoverageReport(input: {
  rows: ComponentPerformanceCoverageRow[];
  periodLabel: string;
  periodFrom: string | null;
  periodTo: string | null;
  top?: number;
  recentDays?: number;
  activeComponents?: number;
}): ComponentPerformanceCoverageReport {
  const top = input.top ?? 15;
  const recentDays = input.recentDays ?? 30;
  const totals = buildComponentPerformanceCoverageTotals(input.rows, input.activeComponents);
  const recentlyChanged = filterRecentlyChangedRows(input.rows, recentDays);
  totals.recentlyChanged = recentlyChanged.length;

  return {
    periodLabel: input.periodLabel,
    periodFrom: input.periodFrom,
    periodTo: input.periodTo,
    totals,
    topSoldWithoutCompletePerformance: rankSoldComponentsByCommercialImpact(input.rows, top),
    recentlyChanged: recentlyChanged.slice(0, top),
  };
}

export function parseComponentPerformanceCoverageOptions(
  query: Record<string, unknown>
): ComponentPerformanceCoverageOptions {
  const yearRaw = query.year != null ? Number(query.year) : undefined;
  const monthRaw = query.month != null ? Number(query.month) : undefined;
  const topRaw = query.top != null ? Number(query.top) : 15;
  const recentDaysRaw = query.recentDays != null ? Number(query.recentDays) : 30;

  return {
    year: yearRaw != null && Number.isFinite(yearRaw) ? Math.floor(yearRaw) : undefined,
    month:
      monthRaw != null && Number.isFinite(monthRaw)
        ? Math.min(Math.max(Math.floor(monthRaw), 1), 12)
        : undefined,
    top: Number.isFinite(topRaw) ? Math.min(Math.max(Math.floor(topRaw), 1), 100) : 15,
    soldOnly: query.soldOnly === "1" || query.soldOnly === "true",
    missingOnly: query.missingOnly === "1" || query.missingOnly === "true",
    recentDays: Number.isFinite(recentDaysRaw)
      ? Math.min(Math.max(Math.floor(recentDaysRaw), 1), 365)
      : 30,
  };
}

export function serializeCoverageRowForAudit(row: ComponentPerformanceCoverageRow) {
  return {
    sku: row.sku,
    name: row.name,
    severity: row.severity,
    missingCycle: row.missingCycle,
    missingCavities: row.missingCavities,
    missingProcess: row.missingProcess,
    neverReviewed: row.neverReviewed,
    soldInPeriod: row.soldInPeriod,
    orderCountInPeriod: row.orderCountInPeriod,
    periodSoldValue: row.periodSoldValue,
    lastPerformanceChangeAt: row.lastPerformanceChangeAt,
    lastChangedByUserName: row.lastChangedByUserName,
    lastResponsiblePersonName: row.lastResponsiblePersonName,
    cycleTimeSeconds: row.process.cycleTimeSeconds,
    cavities: row.process.cavities,
  };
}
