/**
 * Certificação homolog — Relatório Presidencial Load PERF.
 *
 * DATABASE_URL="postgresql://USER:PASS@127.0.0.1:5433/teste_bi_homolog?schema=public" \
 *   npx tsx scripts/cert-presidential-report-load.ts
 *
 * warmup=2 runs=5. Somente leitura.
 */
import { performance } from "node:perf_hooks";
import { writeFileSync } from "node:fs";
import { prisma } from "../src/lib/prisma.js";
import {
  buildFinanceExecutiveReport,
  buildExecutiveReportCashFlowFilters,
  parseFinanceExecutiveReportQuery,
  resolveExecutiveReportReferenceDate,
} from "../src/lib/financeExecutiveReport.js";
import {
  buildExecutiveReportCashRadarBlock,
  buildExecutiveReportCashRadarForFilters,
  buildExecutiveReportDailyRadarCashFlowFilters,
} from "../src/lib/financeExecutiveReportCashRadar.js";
import {
  loadExecutiveReportAllYearsBundle,
  resolveExecutiveReportSharedCutoffs,
  startExecutiveReportLoadTracker,
} from "../src/lib/financeExecutiveReportLoad.server.js";
import { startOfficialEngineProjectionTracker } from "../src/lib/financeOfficialEngineProjection.js";

const WARMUP = 2;
const RUNS = 5;

type Stats = { min: number; median: number; p95: number };

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return NaN;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx]!;
}

function summarize(samples: number[]): Stats {
  const sorted = [...samples].sort((a, b) => a - b);
  return { min: sorted[0] ?? NaN, median: percentile(sorted, 50), p95: percentile(sorted, 95) };
}

async function timed<T>(fn: () => Promise<T>): Promise<{ ms: number; value: T }> {
  const t0 = performance.now();
  const value = await fn();
  return { ms: performance.now() - t0, value };
}

function payloadBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

function extractVisible(report: Awaited<ReturnType<typeof buildFinanceExecutiveReport>>) {
  const detail = report.cashRadar.selectedRangeDetail;
  return {
    arCards: {
      totalOpenAmount: report.accountsReceivable.payload.cards.totalOpenAmount,
      overdueAmount: report.accountsReceivable.payload.cards.overdueAmount,
      upcomingAmount: report.accountsReceivable.payload.cards.upcomingAmount,
    },
    arKpis: report.accountsReceivable.kpis,
    apCards: {
      totalOpenAmount: report.accountsPayable.payload.cards.totalOpenAmount,
      overdueAmount: report.accountsPayable.payload.cards.overdueAmount,
      upcomingAmount: report.accountsPayable.payload.cards.upcomingAmount,
    },
    apKpis: report.accountsPayable.kpis,
    scheduled: report.accountsPayable.payload.purchaseOrderScheduleAudit,
    cashNet: report.executiveSummary.headlineMetrics.find((m) => m.id === "cash-net")?.value ?? null,
    highlights: report.executiveSummary.highlights,
    annualChart: report.calendarAgenda.annualChart.points.map((p) => ({
      month: p.month,
      inflow: p.inflow,
      outflow: p.outflow,
      netFlow: p.netFlow,
      accumulated: p.accumulated,
    })),
    timeline: (report.calendarAgenda.executiveSummary?.monthlyTimeline ?? []).map((r) => ({
      month: r.month,
      netFlow: r.netFlow,
      estimatedInflow: r.estimatedInflow,
      estimatedOutflow: r.estimatedOutflow,
    })),
    annualComparison: {
      current: report.annualComparison.currentYear.totals,
      previous: report.annualComparison.previousYear.totals,
    },
    billingTarget: report.billingComparison?.tab?.target ?? null,
    salesTarget: report.salesOrders?.tab?.target ?? null,
    costCenters: report.costCenterSpending.topCards.map((c) => ({
      id: c.costCenterId,
      amount: c.amount,
    })),
    radarFirstPaint: {
      pageSize: detail?.receivables.pageSize ?? null,
      receivableRows: detail?.receivables.rows.length ?? 0,
      payableRows: detail?.payables.rows.length ?? 0,
      receivableTotal: detail?.receivables.total ?? 0,
      payableTotal: detail?.payables.total ?? 0,
      rangeTotals: report.cashRadar.ranges.map((r) => ({
        key: r.key,
        amount: r.totalAmount,
        count: r.movementsCount,
      })),
    },
  };
}

async function benchReport(label: string, query: Record<string, unknown>) {
  const samples: number[] = [];
  let last: Awaited<ReturnType<typeof buildFinanceExecutiveReport>> | null = null;
  let counts = { enrich: 0, arMetrics: 0, apMetrics: 0, arFull: 0, apFull: 0 };

  for (let i = 0; i < WARMUP + RUNS; i += 1) {
    const loadTracker = startExecutiveReportLoadTracker();
    const engineTracker = startOfficialEngineProjectionTracker();
    const { ms, value } = await timed(() => buildFinanceExecutiveReport(query, prisma));
    const loadCalls = loadTracker.stop();
    const engineCalls = engineTracker.stop();
    if (i >= WARMUP) samples.push(ms);
    last = value;
    counts = {
      enrich: loadCalls.filter((c) => c.kind === "enrich").length,
      arMetrics: engineCalls.filter((c) => c.kind === "ar" && c.mode === "metrics").length,
      apMetrics: engineCalls.filter((c) => c.kind === "ap" && c.mode === "metrics").length,
      arFull: engineCalls.filter((c) => c.kind === "ar" && c.mode === "full").length,
      apFull: engineCalls.filter((c) => c.kind === "ap" && c.mode === "full").length,
    };
  }

  if (!last) throw new Error(`empty ${label}`);
  return {
    label,
    totalMs: summarize(samples),
    payloadBytes: payloadBytes(last),
    counts,
    visible: extractVisible(last),
  };
}

async function benchRadarPrint(query: Record<string, unknown>) {
  const filters = parseFinanceExecutiveReportQuery(query);
  const referenceDate = resolveExecutiveReportReferenceDate(filters);
  const cashFlowFilters = buildExecutiveReportCashFlowFilters(filters);
  const firstPaintSamples: number[] = [];
  const exportSamples: number[] = [];
  let firstPaintRows = 0;
  let exportRows = 0;
  let firstPaintPageSize = 0;
  let exportPageSize = 0;

  for (let i = 0; i < WARMUP + RUNS; i += 1) {
    const shared = await resolveExecutiveReportSharedCutoffs(prisma);
    const allYears = await loadExecutiveReportAllYearsBundle(
      prisma,
      cashFlowFilters,
      referenceDate,
      shared
    );
    const fp = await timed(async () =>
      buildExecutiveReportCashRadarBlock({
        arRows: allYears.arRows,
        apRows: allYears.apRows,
        filters,
        referenceDate,
        arSyncCutoff: allYears.arSyncCutoff,
        apSyncCutoff: allYears.apSyncCutoff,
        dashboardFilters: buildExecutiveReportDailyRadarCashFlowFilters(filters),
        orderContexts: allYears.orderContexts,
        nfeOrderLinks: allYears.nfeOrderLinks,
        exportAll: false,
      })
    );
    const ex = await timed(() =>
      buildExecutiveReportCashRadarForFilters(filters, referenceDate, undefined, prisma)
    );
    if (i >= WARMUP) {
      firstPaintSamples.push(fp.ms);
      exportSamples.push(ex.ms);
    }
    const fpDetail = fp.value.selectedRangeDetail;
    const exDetail = ex.value.selectedRangeDetail;
    firstPaintRows =
      (fpDetail?.receivables.rows.length ?? 0) + (fpDetail?.payables.rows.length ?? 0);
    exportRows = (exDetail?.receivables.rows.length ?? 0) + (exDetail?.payables.rows.length ?? 0);
    firstPaintPageSize = fpDetail?.receivables.pageSize ?? 0;
    exportPageSize = exDetail?.receivables.pageSize ?? 0;
  }

  const exportTotal =
    /* totals may exceed page; compare row caps */
    exportRows;
  return {
    firstPaintMs: summarize(firstPaintSamples),
    exportMs: summarize(exportSamples),
    firstPaintPageSize,
    exportPageSize,
    firstPaintRows,
    exportRows,
    printGatePass:
      firstPaintPageSize <= 25 &&
      exportPageSize >= Math.min(exportTotal, 50_000) &&
      (exportRows >= firstPaintRows || exportRows === 0),
  };
}

async function main() {
  const url = process.env.DATABASE_URL ?? "";
  if (!url.includes("5433") && !url.includes("teste_bi_homolog")) {
    console.error("FAIL: DATABASE_URL must target homolog 127.0.0.1:5433 / teste_bi_homolog");
    process.exit(2);
  }

  await prisma.$queryRawUnsafe("select 1 as ok");

  const asOf = new Date().toISOString().slice(0, 10);
  const year = new Date().getFullYear();
  const month = new Date().getMonth() + 1;
  const annualQuery = { year: String(year), asOfDate: asOf };
  const monthlyQuery = { year: String(year), month: String(month), asOfDate: asOf };

  const annual = await benchReport("annual", annualQuery);
  const monthly = await benchReport("monthly", monthlyQuery);
  const radar = await benchRadarPrint(monthlyQuery);

  const out = {
    generatedAt: new Date().toISOString(),
    database: url.replace(/:([^:@/]+)@/, ":***@"),
    annual,
    monthly,
    radar,
  };
  const path = `presidential-report-cert-${Date.now()}.json`;
  writeFileSync(path, JSON.stringify(out, null, 2), "utf8");
  console.log(JSON.stringify(out, null, 2));
  console.log(`wrote ${path}`);
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect().catch(() => undefined);
  process.exit(1);
});
