/**
 * PERFORMANCE 02 — linha de base server-side (serviços reais + Prisma).
 *
 * Uso:
 *   INDUSCOST_PERF_BASELINE=1 npx tsx scripts/perf-baseline-sales-finance.ts
 *
 * Saída: tmp-audits/perf-baseline-sales-finance-<timestamp>.json
 * Não altera dados. Não chama produção. Não imprime payloads.
 */

process.env.INDUSCOST_PERF_BASELINE = "1";
if (process.env.NODE_ENV === "production") {
  console.error("[perf-baseline] recusado em NODE_ENV=production");
  process.exit(1);
}

async function main() {
  // Imports dinâmicos DEPOIS da flag (prisma precisa emitir evento "query").
  const { mkdirSync, writeFileSync } = await import("node:fs");
  const path = await import("node:path");
  const { prisma } = await import("../src/lib/prisma.js");
  const { summarizeDevPerfSamples } = await import("../src/lib/devPerfBaseline.js");
  const { clearDevPerfSamples, getDevPerfSamples, measureDevPerfScenario } =
    await import("../src/lib/devPerfBaseline.server.js");
  const { getSalesOrderDetail } = await import(
    "../src/lib/sales-orders/salesOrderDetailService.server.js"
  );
  const {
    loadFinanceArManagementRowsFromPrisma,
    loadFinanceArOpenHorizonRowsFromPrisma,
  } = await import("../src/lib/financeAccountsReceivableManagement.server.js");
  const { buildOfficialAccountsReceivableDashboard } = await import(
    "../src/lib/financeAccountsReceivableRulesAdapter.js"
  );
  const { loadFinanceApManagementRowsFromPrisma } = await import(
    "../src/lib/financeAccountsPayableDashboard.js"
  );
  const { buildOfficialAccountsPayableDashboard } = await import(
    "../src/lib/financeAccountsPayableRulesAdapter.js"
  );
  const { buildFinanceBillingDashboard } = await import(
    "../src/lib/financeBillingDashboard.js"
  );
  const { buildFinanceBillingNfeList } = await import(
    "../src/lib/financeBillingNfeList.js"
  );
  const { buildFinanceDreReport } = await import(
    "../src/lib/financeDreService.server.js"
  );
  const { buildFinanceExecutiveReport } = await import(
    "../src/lib/financeExecutiveReport.js"
  );
  const { buildFinanceCostCenterDashboardDefault } = await import(
    "../src/lib/financeCostCenterDashboard.js"
  );
  const { buildFinanceSalesOrdersDashboard } = await import(
    "../src/lib/financeSalesOrdersDashboard.js"
  );
  const { buildExecutiveReportCostCenterDashboardFilters } = await import(
    "../src/lib/financeCostCenterAnnualSpendingChart.js"
  );
  const { SALES_ORDER_RULES_PRISMA_SELECT } = await import(
    "../src/lib/salesOrderRulesAdapter.js"
  );

  const YEAR = Number(process.env.PERF_BASELINE_YEAR ?? new Date().getFullYear());
  const MONTH = Number(process.env.PERF_BASELINE_MONTH ?? new Date().getMonth() + 1);
  const referenceNow = new Date();

  function kb(bytes: number | null | undefined): string {
    if (bytes == null) return "?";
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  clearDevPerfSamples();
  console.info(`[perf-baseline] year=${YEAR} month=${MONTH} starting…`);

  async function measureSalesOrderList(
    label: string,
    scenario: string,
    where: object
  ) {
    await measureDevPerfScenario({
      scenario,
      path: `service:sales-orders.list:${label}`,
      notes: "Simula page+count+summary full-scan (padrão do handler)",
      rowCountApprox: (r: { pageRows: number; summaryRows: number }) =>
        r.pageRows + r.summaryRows,
      run: async () => {
        const [pageRows, total, summaryRows] = await Promise.all([
          prisma.salesOrder.findMany({
            where,
            take: 20,
            skip: 0,
            orderBy: [{ createdAt: "desc" }, { issueDate: "desc" }],
            select: {
              id: true,
              orderCode: true,
              status: true,
              issueDate: true,
              createdAt: true,
              totalValue: true,
              Customer: { select: { id: true, name: true } },
            },
          }),
          prisma.salesOrder.count({ where }),
          prisma.salesOrder.findMany({
            where,
            select: SALES_ORDER_RULES_PRISMA_SELECT,
          }),
        ]);
        return {
          pageRows: pageRows.length,
          total,
          summaryRows: summaryRows.length,
        };
      },
    });
  }

  await measureSalesOrderList("default_year", "so_list_default", {
    status: { not: "CANCELLED" },
    issueDate: {
      gte: new Date(YEAR, 0, 1),
      lt: new Date(YEAR + 1, 0, 1),
    },
  });

  await measureSalesOrderList("filtered_month", "so_list_filtered", {
    status: { not: "CANCELLED" },
    issueDate: {
      gte: new Date(YEAR, MONTH - 1, 1),
      lt: new Date(YEAR, MONTH, 1),
    },
  });

  await measureDevPerfScenario({
    scenario: "so_list_page2",
    path: "service:sales-orders.list:page2",
    run: async () => {
      const where = {
        status: { not: "CANCELLED" as const },
        issueDate: {
          gte: new Date(YEAR, 0, 1),
          lt: new Date(YEAR + 1, 0, 1),
        },
      };
      const rows = await prisma.salesOrder.findMany({
        where,
        take: 20,
        skip: 20,
        orderBy: [{ createdAt: "desc" }],
        select: { id: true, orderCode: true },
      });
      return { rows: rows.length };
    },
    rowCountApprox: (r: { rows: number }) => r.rows,
  });

  const heavy = await prisma.salesOrder.findFirst({
    where: { status: { not: "CANCELLED" } },
    orderBy: { items: { _count: "desc" } },
    select: { id: true, orderCode: true, _count: { select: { items: true } } },
  });

  if (heavy) {
    await measureDevPerfScenario({
      scenario: "so_detail",
      path: `service:sales-orders.detail:${heavy.orderCode ?? heavy.id}`,
      notes: `itens=${heavy._count.items}; abas Geral/Tributos/Custos/Resultado compartilham este payload`,
      run: async () =>
        getSalesOrderDetail({
          salesOrderId: heavy.id,
          orderCode: heavy.orderCode,
          userContext: null,
        }),
      rowCountApprox: (r: { items?: unknown[] }) => r.items?.length ?? null,
    });
  } else {
    console.warn("[perf-baseline] nenhum SalesOrder para detalhe");
  }

  const arFilters = { status: "all" as const, year: YEAR, month: MONTH };
  await measureDevPerfScenario({
    scenario: "finance_ar_dashboard",
    path: "service:finance.ar.dashboard",
    notes: "management + open horizon (sequencial como na rota)",
    run: async () => {
      const { rows, syncCutoff } = await loadFinanceArManagementRowsFromPrisma(
        prisma,
        arFilters,
        referenceNow
      );
      const { rows: horizonSourceRows } = await loadFinanceArOpenHorizonRowsFromPrisma(
        prisma,
        referenceNow
      );
      return buildOfficialAccountsReceivableDashboard({
        rows,
        filters: arFilters,
        referenceDate: referenceNow,
        syncCutoff,
        horizonSourceRows,
      });
    },
  });

  await measureDevPerfScenario({
    scenario: "finance_ar_overdue_path",
    path: "service:finance.ar.overdue-reload",
    notes: "2ª carga típica da aba Atrasados",
    run: async () => {
      const { rows } = await loadFinanceArManagementRowsFromPrisma(
        prisma,
        { status: "overdue", year: YEAR },
        referenceNow
      );
      return { rowCount: rows.length };
    },
    rowCountApprox: (r: { rowCount: number }) => r.rowCount,
  });

  await measureDevPerfScenario({
    scenario: "finance_ar_titles",
    path: "service:finance.ar.titles",
    run: async () => {
      const { rows } = await loadFinanceArManagementRowsFromPrisma(
        prisma,
        { status: "all", year: YEAR },
        referenceNow
      );
      return { rowCount: rows.length };
    },
    rowCountApprox: (r: { rowCount: number }) => r.rowCount,
  });

  const apFilters = { status: "all" as const, year: YEAR, month: MONTH };
  await measureDevPerfScenario({
    scenario: "finance_ap_dashboard",
    path: "service:finance.ap.dashboard",
    run: async () => {
      const { rows, syncCutoff } = await loadFinanceApManagementRowsFromPrisma(
        prisma,
        apFilters
      );
      return buildOfficialAccountsPayableDashboard({
        rows,
        filters: apFilters,
        referenceDate: referenceNow,
        syncCutoff,
      });
    },
  });

  await measureDevPerfScenario({
    scenario: "finance_ap_titles",
    path: "service:finance.ap.titles-reload",
    notes: "2ª varredura típica da aba Títulos",
    run: async () => {
      const { rows } = await loadFinanceApManagementRowsFromPrisma(prisma, {
        status: "all",
        year: YEAR,
      });
      return { rowCount: rows.length };
    },
    rowCountApprox: (r: { rowCount: number }) => r.rowCount,
  });

  await measureDevPerfScenario({
    scenario: "finance_billing_dashboard",
    path: "service:finance.billing.dashboard",
    run: async () => buildFinanceBillingDashboard({ year: YEAR, month: MONTH }),
  });

  await measureDevPerfScenario({
    scenario: "finance_billing_nfes",
    path: "service:finance.billing.nfes",
    run: async () =>
      buildFinanceBillingNfeList({ year: YEAR, month: MONTH, page: 1, pageSize: 50 }),
    rowCountApprox: (r: { items?: unknown[] }) =>
      Array.isArray(r.items) ? r.items.length : null,
  });

  await measureDevPerfScenario({
    scenario: "finance_dre",
    path: "service:finance.dre",
    run: async () =>
      buildFinanceDreReport({ year: YEAR, month: MONTH, company: "all" }, referenceNow),
  });

  await measureDevPerfScenario({
    scenario: "finance_executive",
    path: "service:finance.executive-report",
    run: async () =>
      buildFinanceExecutiveReport({
        year: YEAR,
        month: MONTH,
        company: "all",
      }),
  });

  await measureDevPerfScenario({
    scenario: "finance_cost_centers",
    path: "service:finance.cost-centers.dashboard",
    run: async () =>
      buildFinanceCostCenterDashboardDefault(
        buildExecutiveReportCostCenterDashboardFilters({
          year: YEAR,
          month: MONTH,
          companyName: null,
        }),
        referenceNow
      ),
  });

  await measureDevPerfScenario({
    scenario: "finance_sales_orders",
    path: "service:finance.sales-orders.dashboard",
    run: async () => buildFinanceSalesOrdersDashboard({ year: YEAR, month: MONTH }),
  });

  const samples = getDevPerfSamples();
  const summary = summarizeDevPerfSamples(samples);
  const out = {
    generatedAt: new Date().toISOString(),
    mode: "server_script" as const,
    samples,
    ranking: summary,
    howToRerun: {
      serverScript:
        "INDUSCOST_PERF_BASELINE=1 npx tsx scripts/perf-baseline-sales-finance.ts",
      httpMiddleware:
        "INDUSCOST_PERF_BASELINE=1 npm run dev  →  headers X-IndusCost-Perf + logs [perf-baseline:http]",
      browser:
        'DEV: localStorage.setItem("induscost_perf_baseline","1"); location.reload(); console: window.__induscostPerfBaseline.getSamples()',
    },
  };

  const dir = path.join(process.cwd(), "tmp-audits");
  mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const file = path.join(dir, `perf-baseline-sales-finance-${stamp}.json`);
  writeFileSync(file, JSON.stringify(out, null, 2), "utf8");

  console.info("\n=== PERF BASELINE RANKING (totalMs) ===");
  for (const s of summary.byTotalMs.slice(0, 12)) {
    console.info(
      `${s.totalMs.toString().padStart(8)}ms  q=${String(s.queryCount).padStart(3)}  db=${String(s.dbMs).padStart(8)}ms  ${kb(s.payloadBytesApprox).padStart(10)}  ${s.scenario}`
    );
  }
  console.info("\n=== PERF BASELINE RANKING (payload) ===");
  for (const s of summary.byPayload.slice(0, 8)) {
    console.info(`${kb(s.payloadBytesApprox).padStart(10)}  ${s.scenario}  ${s.path}`);
  }
  console.info(`\n[perf-baseline] wrote ${file}`);
  console.info(`[perf-baseline] samples=${samples.length}`);

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("[perf-baseline] FAILED", err);
  process.exitCode = 1;
});
