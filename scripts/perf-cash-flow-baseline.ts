/**
 * PERF 3.1 — linha de base do Fluxo de Caixa (serviços reais + Prisma).
 *
 * Uso:
 *   INDUSCOST_PERF_BASELINE=1 npx tsx scripts/perf-cash-flow-baseline.ts
 *   npm run perf:cash-flow:baseline
 *
 * Warm-up 2 + 5 medições por endpoint, em dois modos de fonte de projeção:
 *   - legacy (default da tela)
 *   - light = Cash Flow Light Projection (PERF 2C)
 *
 * Saída: tmp-audits/perf-cash-flow-baseline-<timestamp>.json
 * Não altera dados. Não chama produção. Não imprime payloads financeiros.
 *
 * dbMs NÃO é wall-clock. NÃO use totalMs - dbMs como CPU.
 * profilingSerializeMs NÃO entra em totalMs.
 * OPENING BACKEND WORK NÃO é cf:ready.
 */

process.env.INDUSCOST_PERF_BASELINE = "1";
if (process.env.NODE_ENV === "production") {
  console.error("[perf-cash-flow] recusado em NODE_ENV=production");
  process.exit(1);
}

async function main() {
  const { mkdirSync, writeFileSync } = await import("node:fs");
  const path = await import("node:path");
  const { prisma } = await import("../src/lib/prisma.js");
  const { measureDevPerfScenario, clearDevPerfSamples, getDevPerfSamples } =
    await import("../src/lib/devPerfBaseline.server.js");
  const {
    loadCashFlowRows,
    loadDailyRadarPortfolioRows,
  } = await import("../src/lib/financeCashFlowRoutes.js");
  const {
    parseFinanceCashFlowDashboardFilters,
    resolveFinanceCashFlowFiltersForLoad,
    buildFinanceCashFlowDashboard,
  } = await import("../src/lib/financeCashFlowDashboard.js");
  const { loadRawMaterialCostCenterSpotlight } = await import(
    "../src/lib/financeCashFlowRawMaterialSpotlight.server.js"
  );
  const { loadAnnualComparisonPortfolioRows } = await import(
    "../src/lib/financeExecutiveReportAnnualLoad.js"
  );
  const {
    parseAnnualComparisonYear,
    buildCashFlowAnnualComparison,
  } = await import("../src/lib/financeCashFlowAnnualComparison.js");
  const {
    parseDailyRadarQuery,
    filterDailyRadarPortfolioRows,
    buildFinanceCashFlowDailyRadar,
  } = await import("../src/lib/financeCashFlowDailyRadar.js");
  const {
    getCashFlowProjectionTelemetry,
    resetCashFlowProjectionTelemetry,
  } = await import("../src/lib/finance/cashFlowProjectionTelemetry.js");
  const {
    CASH_FLOW_PERF_DBMS_DISCLAIMER,
    CASH_FLOW_PERF_NESTED_PHASES_NOTE,
    CASH_FLOW_PERF_OPENING_DISCLAIMER,
    CASH_FLOW_PERF_PERCENTILE_METHOD,
    CASH_FLOW_PERF_SERIALIZE_DISCLAIMER,
    summarizeNumeric,
    roundPerfMs,
  } = await import("../src/lib/finance/cashFlowPerfStats.js");
  type ProjectionMode = "legacy" | "light";

  const YEAR = Number(process.env.PERF_BASELINE_YEAR ?? new Date().getFullYear());
  const WARMUP = Math.max(0, Number(process.env.PERF_CASH_FLOW_WARMUP ?? 2));
  const RUNS = Math.max(1, Number(process.env.PERF_CASH_FLOW_RUNS ?? 5));
  const referenceDate = new Date();

  type RunSample = {
    totalMs: number;
    dbMs: number | null;
    queryCount: number | null;
    payloadBytesApprox: number | null;
    profilingSerializeMs: number | null;
    serializeMs: number | null;
    phases: Record<string, number> | null;
    rowCounts: { ar?: number; ap?: number; orders?: number } | null;
    projectionTelemetry: {
      lastProjectionMode: string | null;
      lightLoaderCalls: number;
      fullAuditCalls: number;
    };
  };

  function summarizeField(
    runs: RunSample[],
    pick: (r: RunSample) => number | null | undefined
  ) {
    return summarizeNumeric(
      runs.map(pick).filter((n): n is number => n != null && Number.isFinite(n))
    );
  }

  function lastPhases(runs: RunSample[]): Record<string, number> | null {
    return runs.at(-1)?.phases ?? null;
  }

  function phaseSummaries(runs: RunSample[]): Record<string, ReturnType<typeof summarizeNumeric>> {
    const keys = new Set<string>();
    for (const run of runs) {
      for (const key of Object.keys(run.phases ?? {})) keys.add(key);
    }
    const out: Record<string, ReturnType<typeof summarizeNumeric>> = {};
    for (const key of [...keys].sort()) {
      out[key] = summarizeNumeric(
        runs.map((r) => r.phases?.[key]).filter((n): n is number => n != null)
      );
    }
    return out;
  }

  async function measureOnce(
    scenario: string,
    apiPath: string,
    mode: ProjectionMode,
    run: () => Promise<unknown>
  ): Promise<RunSample> {
    resetCashFlowProjectionTelemetry();
    const { sample } = await measureDevPerfScenario({
      scenario,
      path: apiPath,
      run,
    });
    const telemetry = getCashFlowProjectionTelemetry();
    return {
      totalMs: sample.totalMs,
      dbMs: sample.dbMs,
      queryCount: sample.queryCount,
      payloadBytesApprox: sample.payloadBytesApprox,
      profilingSerializeMs: sample.profilingSerializeMs ?? null,
      serializeMs: sample.serializeMs ?? null,
      phases: sample.phases ?? null,
      rowCounts: sample.rowCounts ?? null,
      projectionTelemetry: telemetry,
    };
  }

  async function runEndpoint(
    label: string,
    apiPath: string,
    mode: ProjectionMode,
    run: () => Promise<unknown>
  ) {
    console.info(`[perf-cash-flow] ${label} ${mode} warmup=${WARMUP} runs=${RUNS}`);
    for (let i = 0; i < WARMUP; i += 1) {
      await run();
    }
    const samples: RunSample[] = [];
    for (let i = 0; i < RUNS; i += 1) {
      samples.push(await measureOnce(label, apiPath, mode, run));
    }
    const last = samples.at(-1);
    return {
      endpoint: label,
      path: apiPath,
      projectionSource: mode,
      projectionSourceNote:
        mode === "light"
          ? "Cash Flow Light Projection (PERF 2C) — mesma fonte dos três handlers HTTP quando INDUSCOST_CASH_FLOW_LIGHT_PROJECTION=1"
          : "legacy — default da tela (getOrderFullAudit por pedido, teto 80)",
      warmupDiscarded: WARMUP,
      runs: RUNS,
      totalMs: summarizeField(samples, (s) => s.totalMs),
      queryCount: summarizeField(samples, (s) => s.queryCount),
      dbMs: summarizeField(samples, (s) => s.dbMs),
      bytes: summarizeField(samples, (s) => s.payloadBytesApprox),
      profilingSerializeMs: summarizeField(samples, (s) => s.profilingSerializeMs),
      rowCountsLast: last?.rowCounts ?? null,
      phasesLast: lastPhases(samples),
      phases: phaseSummaries(samples),
      projectionTelemetryLast: last?.projectionTelemetry ?? null,
      samples: samples.map((s) => ({
        totalMs: s.totalMs,
        dbMs: s.dbMs,
        queryCount: s.queryCount,
        bytes: s.payloadBytesApprox,
        profilingSerializeMs: s.profilingSerializeMs,
        phases: s.phases,
        rowCounts: s.rowCounts,
      })),
    };
  }

  function openingBackendWork(
    dashboard: Awaited<ReturnType<typeof runEndpoint>>,
    annual: Awaited<ReturnType<typeof runEndpoint>>,
    radar: Awaited<ReturnType<typeof runEndpoint>>
  ) {
    const add = (
      a: number | null,
      b: number | null,
      c: number | null
    ): number | null => {
      if (a == null || b == null || c == null) return null;
      return roundPerfMs(a + b + c);
    };
    return {
      disclaimer: CASH_FLOW_PERF_OPENING_DISCLAIMER,
      notScreenReadyMetric: "cf:ready",
      totalMsMedianSum: add(
        dashboard.totalMs.median,
        annual.totalMs.median,
        radar.totalMs.median
      ),
      queryCountMedianSum: add(
        dashboard.queryCount.median,
        annual.queryCount.median,
        radar.queryCount.median
      ),
      dbMsMedianSum: add(dashboard.dbMs.median, annual.dbMs.median, radar.dbMs.median),
      bytesMedianSum: add(dashboard.bytes.median, annual.bytes.median, radar.bytes.median),
      dbMsMedianSumNote:
        "Soma de dbMs (cada um já é soma Prisma). Ainda menos interpretável como wall-clock.",
    };
  }

  function kb(bytes: number | null): string {
    if (bytes == null) return "?";
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  function printEndpoint(block: Awaited<ReturnType<typeof runEndpoint>>): void {
    console.info(
      `  ${block.endpoint} [${block.projectionSource}] totalMs min/median/p95=${block.totalMs.min}/${block.totalMs.median}/${block.totalMs.p95} q=${block.queryCount.median} dbMs=${block.dbMs.median} bytes≈${kb(block.bytes.median)} rows=${JSON.stringify(block.rowCountsLast)}`
    );
    if (block.phasesLast) {
      console.info(`    phasesLast=${JSON.stringify(block.phasesLast)}`);
    }
  }

  const dashboardQuery = { year: String(YEAR) };
  const dashboardFilters = resolveFinanceCashFlowFiltersForLoad(
    dashboardQuery,
    parseFinanceCashFlowDashboardFilters(dashboardQuery),
    referenceDate
  );
  const radarQuery = parseDailyRadarQuery({
    payableSortBy: "amount",
    payableSortDirection: "desc",
    receivableSortBy: "amount",
    receivableSortDirection: "desc",
    page: "1",
    pageSize: "25",
  });

  async function runDashboard(mode: ProjectionMode) {
    const load = await loadCashFlowRows(dashboardFilters, mode);
    const payload = buildFinanceCashFlowDashboard(
      load.arRows,
      load.apRows,
      dashboardFilters,
      referenceDate,
      load.arSyncCutoff,
      load.apSyncCutoff,
      { orderContexts: load.orderContexts, nfeOrderLinks: load.nfeOrderLinks }
    );
    const rawMaterialCostCenterSpotlight = await loadRawMaterialCostCenterSpotlight({
      ytdYear: referenceDate.getFullYear(),
      companyName: dashboardFilters.companyName,
      referenceDate,
    });
    return { ...payload, rawMaterialCostCenterSpotlight };
  }

  async function runAnnual(mode: ProjectionMode) {
    const year = parseAnnualComparisonYear(undefined, referenceDate);
    const load = await loadAnnualComparisonPortfolioRows(
      prisma,
      referenceDate,
      undefined,
      mode
    );
    return buildCashFlowAnnualComparison(
      load.arRows,
      load.apRows,
      year,
      referenceDate,
      load.arSyncCutoff,
      load.apSyncCutoff,
      { orderContexts: load.orderContexts, nfeOrderLinks: load.nfeOrderLinks }
    );
  }

  async function runRadar(mode: ProjectionMode) {
    const load = await loadDailyRadarPortfolioRows(referenceDate, mode);
    const portfolio = filterDailyRadarPortfolioRows(
      load.arRows,
      load.apRows,
      referenceDate,
      load.arSyncCutoff,
      load.apSyncCutoff,
      undefined,
      { orderContexts: load.orderContexts, nfeOrderLinks: load.nfeOrderLinks }
    );
    return buildFinanceCashFlowDailyRadar(
      portfolio.arRows,
      portfolio.apRows,
      radarQuery,
      referenceDate
    );
  }

  const modes: ProjectionMode[] = ["legacy", "light"];
  const byMode: Record<string, unknown> = {};

  clearDevPerfSamples();
  console.info(`[perf-cash-flow] year=${YEAR} warmup=${WARMUP} runs=${RUNS}`);
  console.info(`[perf-cash-flow] ${CASH_FLOW_PERF_DBMS_DISCLAIMER}`);
  console.info(`[perf-cash-flow] ${CASH_FLOW_PERF_SERIALIZE_DISCLAIMER}`);
  console.info(`[perf-cash-flow] ${CASH_FLOW_PERF_OPENING_DISCLAIMER}`);

  for (const mode of modes) {
    const dashboard = await runEndpoint(
      "dashboard",
      "/api/finance/cash-flow/dashboard",
      mode,
      () => runDashboard(mode)
    );
    const annual = await runEndpoint(
      "annual-comparison",
      "/api/finance/cash-flow/annual-comparison",
      mode,
      () => runAnnual(mode)
    );
    const radar = await runEndpoint(
      "daily-radar",
      "/api/finance/cash-flow/daily-radar",
      mode,
      () => runRadar(mode)
    );
    printEndpoint(dashboard);
    printEndpoint(annual);
    printEndpoint(radar);
    const opening = openingBackendWork(dashboard, annual, radar);
    console.info(
      `  OPENING BACKEND WORK [${mode}] totalMsMedianSum=${opening.totalMsMedianSum} qSum=${opening.queryCountMedianSum} dbMsSum=${opening.dbMsMedianSum} bytes≈${kb(opening.bytesMedianSum)} (NOT cf:ready)`
    );
    byMode[mode] = { dashboard, annual, radar, openingBackendWork: opening };
  }

  const report = {
    generatedAt: new Date().toISOString(),
    kind: "perf-3.1-cash-flow-baseline",
    year: YEAR,
    warmup: WARMUP,
    runs: RUNS,
    percentileMethod: CASH_FLOW_PERF_PERCENTILE_METHOD,
    disclaimers: {
      dbMs: CASH_FLOW_PERF_DBMS_DISCLAIMER,
      serialize: CASH_FLOW_PERF_SERIALIZE_DISCLAIMER,
      openingBackendWork: CASH_FLOW_PERF_OPENING_DISCLAIMER,
      nestedPhases: CASH_FLOW_PERF_NESTED_PHASES_NOTE,
    },
    screenReadyMetric: "cf:ready (frontend; dashboard+annual+radar)",
    byProjectionSource: byMode,
    sampleCount: getDevPerfSamples().length,
  };

  const outDir = path.join(process.cwd(), "tmp-audits");
  mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outFile = path.join(outDir, `perf-cash-flow-baseline-${stamp}.json`);
  writeFileSync(outFile, JSON.stringify(report, null, 2), "utf8");
  console.info(`[perf-cash-flow] wrote ${outFile}`);
}

main().catch((err) => {
  console.error("[perf-cash-flow] falhou:", err);
  process.exit(1);
});
