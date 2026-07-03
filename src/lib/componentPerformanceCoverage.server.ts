/**
 * Service read-only — cobertura de performance de componentes.
 */
import type { PrismaClient } from "@prisma/client";
import { toCivilDateKey } from "./financeCivilDate.js";
import {
  buildComponentPerformanceCoverageReport,
  classifyComponentPerformanceCoverage,
  parseComponentPerformanceCoverageOptions,
  serializeCoverageRowForAudit,
  type ComponentPerformanceCoverageOptions,
  type ComponentPerformanceCoverageReport,
} from "./componentPerformanceCoverage.js";

function decimalToNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function resolvePeriodBounds(options: ComponentPerformanceCoverageOptions): {
  from: Date;
  to: Date;
  label: string;
  fromKey: string;
  toKey: string;
} {
  const year = options.year ?? new Date().getFullYear();
  if (options.month != null) {
    const from = new Date(year, options.month - 1, 1);
    const to = new Date(year, options.month, 0, 23, 59, 59, 999);
    const mm = String(options.month).padStart(2, "0");
    return {
      from,
      to,
      label: `${mm}/${year}`,
      fromKey: toCivilDateKey(from) ?? "",
      toKey: toCivilDateKey(to) ?? "",
    };
  }
  const from = new Date(year, 0, 1);
  const to = new Date(year, 11, 31, 23, 59, 59, 999);
  return {
    from,
    to,
    label: `ano ${year}`,
    fromKey: toCivilDateKey(from) ?? "",
    toKey: toCivilDateKey(to) ?? "",
  };
}

export async function buildComponentPerformanceCoverageReportFromDb(
  db: PrismaClient,
  rawOptions: Record<string, unknown> = {}
): Promise<ComponentPerformanceCoverageReport> {
  const options = parseComponentPerformanceCoverageOptions(rawOptions);
  const { from, to, label, fromKey, toKey } = resolvePeriodBounds(options);

  const [activeComponents, products, soldGroups, changeLogCounts, latestChangeAtGroups] =
    await Promise.all([
      db.product.count({ where: { status: "ACTIVE", type: "COMPONENT" } }),
      db.product.findMany({
        where: { status: "ACTIVE", type: "COMPONENT" },
        select: {
          id: true,
          sku: true,
          name: true,
          status: true,
          cycleTimeSeconds: true,
          cavities: true,
          setupTimeMin: true,
          efficiencyExpected: true,
        },
        orderBy: { sku: "asc" },
      }),
      db.salesOrderItem.groupBy({
        by: ["productId"],
        where: {
          Product: { type: "COMPONENT", status: "ACTIVE" },
          SalesOrder: { issueDate: { gte: from, lte: to } },
        },
        _count: { _all: true },
        _sum: { totalNetValue: true },
      }),
      db.componentPerformanceChangeLog.groupBy({
        by: ["productId"],
        _count: { _all: true },
      }),
      db.componentPerformanceChangeLog.groupBy({
        by: ["productId"],
        _max: { changedAt: true },
      }),
    ]);

  const latestLogPairs = latestChangeAtGroups
    .filter((row) => row._max.changedAt != null)
    .map((row) => ({
      productId: row.productId,
      changedAt: row._max.changedAt as Date,
    }));

  const latestLogs =
    latestLogPairs.length > 0
      ? await db.componentPerformanceChangeLog.findMany({
          where: {
            OR: latestLogPairs.map((pair) => ({
              productId: pair.productId,
              changedAt: pair.changedAt,
            })),
          },
          select: {
            productId: true,
            changedAt: true,
            changedByUserName: true,
            responsiblePersonName: true,
          },
        })
      : [];

  const soldMap = new Map(
    soldGroups.map((row) => [
      row.productId,
      {
        orderCount: row._count._all,
        periodSoldValue: decimalToNumber(row._sum.totalNetValue),
      },
    ])
  );
  const logCountMap = new Map(
    changeLogCounts.map((row) => [row.productId, row._count._all])
  );
  const latestLogMap = new Map(latestLogs.map((row) => [row.productId, row]));

  let rows = products.map((product) => {
    const sold = soldMap.get(product.id);
    const latest = latestLogMap.get(product.id);
    return classifyComponentPerformanceCoverage({
      productId: product.id,
      sku: product.sku,
      name: product.name,
      status: product.status,
      cycleTimeSeconds: product.cycleTimeSeconds,
      cavities: product.cavities,
      setupTimeMin: product.setupTimeMin,
      efficiencyExpected: product.efficiencyExpected,
      soldInPeriod: sold != null,
      orderCountInPeriod: sold?.orderCount ?? 0,
      periodSoldValue: sold?.periodSoldValue ?? 0,
      changeLogCount: logCountMap.get(product.id) ?? 0,
      lastPerformanceChangeAt: latest?.changedAt ?? null,
      lastChangedByUserName: latest?.changedByUserName ?? null,
      lastResponsiblePersonName: latest?.responsiblePersonName ?? null,
    });
  });

  if (options.soldOnly) {
    rows = rows.filter((row) => row.soldInPeriod);
  }
  if (options.missingOnly) {
    rows = rows.filter(
      (row) => row.missingCycle || row.missingCavities || row.missingProcess
    );
  }

  return buildComponentPerformanceCoverageReport({
    rows,
    periodLabel: label,
    periodFrom: fromKey || null,
    periodTo: toKey || null,
    top: options.top,
    recentDays: options.recentDays,
    activeComponents,
  });
}

export function serializeCoverageReportForApi(report: ComponentPerformanceCoverageReport) {
  return {
    periodLabel: report.periodLabel,
    periodFrom: report.periodFrom,
    periodTo: report.periodTo,
    totals: report.totals,
    topSoldWithoutCompletePerformance: report.topSoldWithoutCompletePerformance.map(
      serializeCoverageRowForAudit
    ),
    recentlyChanged: report.recentlyChanged.map(serializeCoverageRowForAudit),
  };
}

export function serializeCoverageReportForAuditJson(report: ComponentPerformanceCoverageReport) {
  return {
    readOnly: true,
    periodLabel: report.periodLabel,
    periodFrom: report.periodFrom,
    periodTo: report.periodTo,
    totals: report.totals,
    topSoldWithoutCompletePerformance: report.topSoldWithoutCompletePerformance.map(
      serializeCoverageRowForAudit
    ),
    recentlyChanged: report.recentlyChanged.map(serializeCoverageRowForAudit),
  };
}
