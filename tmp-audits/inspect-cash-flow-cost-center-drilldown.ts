/**
 * Diagnóstico — centros de custo do drilldown do Fluxo de Caixa.
 *
 * Uso:
 *   npx tsx tmp-audits/inspect-cash-flow-cost-center-drilldown.ts \
 *     [--start=YYYY-MM-DD --end=YYYY-MM-DD] [--day=YYYY-MM-DD] [--search=texto]
 *
 * Sem DB, imprime só fixture com o cálculo puro.
 */
import "dotenv/config";
import {
  buildCashFlowCostCenterSummary,
  CASH_FLOW_COST_CENTER_UNCLASSIFIED_ID,
  extractPayableExternalId,
  type CashFlowCostCenterAllocationInput,
  type CashFlowCostCenterMetaInput,
} from "../src/lib/financeCashFlowDailyRadarCostCenters.js";
import {
  buildFinanceCashFlowDailyRadar,
  DAILY_RADAR_CUSTOM_RANGE_KEY,
  DAILY_RADAR_EXPORT_PAGE_SIZE,
  filterDailyRadarPortfolioRows,
  parseDailyRadarQuery,
  type DailyRadarPayableRow,
} from "../src/lib/financeCashFlowDailyRadar.js";

type Args = {
  start?: string;
  end?: string;
  day?: string;
  search?: string;
  range?: string;
};

function parseArgs(argv: string[]): Args {
  const args: Args = {};
  for (const raw of argv.slice(2)) {
    const m = /^--([a-zA-Z]+)=(.*)$/.exec(raw);
    if (!m) continue;
    (args as Record<string, string>)[m[1]!] = m[2]!;
  }
  return args;
}

function money(n: number): string {
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);
  console.log("=== inspect-cash-flow-cost-center-drilldown ===\n");

  const url = process.env.DATABASE_URL ?? "";
  if (!url || /localhost|127\.0\.0\.1|dummy/i.test(url)) {
    console.log("Sem DATABASE_URL real — usando fixture.");
    const summary = buildCashFlowCostCenterSummary({
      payables: [
        { id: "ap-101", supplier: "Fornecedor A", company: "Empresa X", description: null, document: "101", operationalDate: "2026-07-15", dueDate: "2026-07-15", scheduleDate: null, amount: 1500, status: "OPEN", paymentMethod: null, rescheduled: false, vencimentoOficial: "2026-07-15", dataAgendada: null, dataPagamento: null, dataUsadaNoFluxo: "2026-07-15", fonteDataFluxo: "vencimento" },
        { id: "ap-102", supplier: "Fornecedor B", company: "Empresa X", description: null, document: "102", operationalDate: "2026-07-16", dueDate: "2026-07-16", scheduleDate: null, amount: 500, status: "OPEN", paymentMethod: null, rescheduled: false, vencimentoOficial: "2026-07-16", dataAgendada: null, dataPagamento: null, dataUsadaNoFluxo: "2026-07-16", fonteDataFluxo: "vencimento" },
      ] satisfies DailyRadarPayableRow[],
      allocations: [
        { accountsPayableExternalId: 101, costCenterId: "cc-a", amount: 1500, percentage: 100 },
      ],
      costCenters: [{ id: "cc-a", code: "A", name: "Operações", status: "ACTIVE" }],
      scope: {
        level: "custom",
        rangeKey: DAILY_RADAR_CUSTOM_RANGE_KEY,
        rangeLabel: "Período personalizado (fixture)",
        dateFrom: "2026-07-15",
        dateTo: "2026-07-16",
        day: null,
        search: null,
      },
    });
    console.log("Total de saídas:", money(summary.totalAmount));
    console.log("Títulos:", summary.totalTitles);
    console.log("Sem centro de custo:", money(summary.unclassifiedAmount), `(${summary.unclassifiedTitles} título[s])`);
    console.log("\nTop 20 centros:");
    for (const item of summary.items.slice(0, 20)) {
      console.log(
        `  ${item.code ?? "—"} · ${item.name} · ${money(item.amount)} · ${item.titlesCount} título(s) · ${item.sharePercentage.toFixed(2)}%${item.unclassified ? " · (AUDITORIA)" : ""}`
      );
    }
    return;
  }

  const { prisma } = await import("../src/lib/prisma.js");
  const {
    resolveNomusApReportSyncCutoffFromPrisma,
  } = await import("../src/lib/financeNomusApReportFreshness.js");
  const {
    resolveNomusArReportSyncCutoffFromPrisma,
  } = await import("../src/lib/financeNomusArReportFreshness.js");
  const {
    FINANCE_CASH_FLOW_AR_SELECT,
    FINANCE_CASH_FLOW_AP_SELECT,
    mapPrismaRowToFinanceCashFlowArRow,
    mapPrismaRowToFinanceCashFlowApRow,
    toCashFlowPortfolioArFilters,
    toCashFlowPortfolioApFilters,
  } = await import("../src/lib/financeCashFlowDashboard.js");
  const { buildFinanceApPrismaWhere } = await import(
    "../src/lib/financeAccountsPayableDashboard.js"
  );
  const { buildFinanceArPrismaWhere } = await import(
    "../src/lib/financeAccountsReceivableDashboard.js"
  );
  const { createDailyRadarDashboardFilters } = await import(
    "../src/lib/financeCashFlowDailyRadar.js"
  );

  const filters = createDailyRadarDashboardFilters();
  const referenceDate = new Date();
  const [arSync, apSync] = await Promise.all([
    resolveNomusArReportSyncCutoffFromPrisma(prisma),
    resolveNomusApReportSyncCutoffFromPrisma(prisma),
  ]);
  const arWhere = buildFinanceArPrismaWhere(
    toCashFlowPortfolioArFilters(filters),
    referenceDate,
    arSync
  );
  const apWhere = buildFinanceApPrismaWhere(
    toCashFlowPortfolioApFilters(filters),
    apSync
  );
  const [arPrisma, apPrisma] = await Promise.all([
    prisma.nomusAccountsReceivable.findMany({ where: arWhere, select: FINANCE_CASH_FLOW_AR_SELECT, orderBy: { dueDate: "asc" } }),
    prisma.nomusAccountsPayable.findMany({ where: apWhere, select: FINANCE_CASH_FLOW_AP_SELECT, orderBy: { dueDate: "asc" } }),
  ]);
  const portfolio = filterDailyRadarPortfolioRows(
    arPrisma.map(mapPrismaRowToFinanceCashFlowArRow),
    apPrisma.map(mapPrismaRowToFinanceCashFlowApRow),
    referenceDate,
    arSync,
    apSync
  );

  const query = parseDailyRadarQuery({
    range: args.range ?? (args.start && args.end ? DAILY_RADAR_CUSTOM_RANGE_KEY : "0-7"),
    customStartDate: args.start,
    customEndDate: args.end,
    day: args.day,
    search: args.search,
    pageSize: DAILY_RADAR_EXPORT_PAGE_SIZE,
  } as Record<string, unknown>);
  const scopedQuery = { ...query, exportAll: true } as typeof query;
  const radar = buildFinanceCashFlowDailyRadar(
    portfolio.arRows,
    portfolio.apRows,
    scopedQuery,
    referenceDate
  );
  const detail = radar.selectedDetail;
  if (!detail) {
    console.log("Sem escopo — informe range/customStart/end/day.");
    await prisma.$disconnect();
    return;
  }

  const externalIds = [
    ...new Set(
      detail.payables.rows
        .map((row) => extractPayableExternalId(row.id))
        .filter((n): n is number => n != null)
    ),
  ];
  const [allocRows, ccRows] = await Promise.all([
    externalIds.length > 0
      ? prisma.accountsPayableCostCenterAllocation.findMany({
          where: { accountsPayableId: { in: externalIds } },
          select: { accountsPayableId: true, costCenterId: true, amount: true, percentage: true },
        })
      : Promise.resolve([]),
    prisma.financialCostCenter.findMany({
      select: { id: true, code: true, name: true, status: true },
    }),
  ]);

  const allocations: CashFlowCostCenterAllocationInput[] = allocRows.map((r) => ({
    accountsPayableExternalId: r.accountsPayableId,
    costCenterId: r.costCenterId,
    amount:
      r.amount == null
        ? null
        : Number((r.amount as unknown as { toNumber: () => number }).toNumber()),
    percentage: Number((r.percentage as unknown as { toNumber: () => number }).toNumber()),
  }));
  const costCenters: CashFlowCostCenterMetaInput[] = ccRows.map((cc) => ({
    id: cc.id,
    code: cc.code,
    name: cc.name,
    status: cc.status ?? null,
  }));

  const summary = buildCashFlowCostCenterSummary({
    payables: detail.payables.rows,
    allocations,
    costCenters,
    scope: {
      level: detail.level === "day" ? "day" : detail.rangeKey === DAILY_RADAR_CUSTOM_RANGE_KEY ? "custom" : "range",
      rangeKey: detail.rangeKey ?? null,
      rangeLabel: detail.rangeLabel ?? null,
      dateFrom: radar.customRange?.dateFrom ?? null,
      dateTo: radar.customRange?.dateTo ?? null,
      day: detail.date ?? null,
      search: args.search ?? null,
    },
  });

  const cardsTotal = summary.items.reduce((s, i) => s + i.amount, 0);
  const diff = detail.exitsTotal - cardsTotal;

  console.log("Período analisado:");
  console.log("  faixa:", detail.rangeLabel);
  console.log("  dia:", detail.date ?? "—");
  console.log("  busca:", args.search ?? "—");
  console.log("\nSaídas do drilldown:", money(detail.exitsTotal));
  console.log("Soma dos cards:", money(cardsTotal));
  console.log("Diferença:", money(diff), "(deve ser ~0)");
  console.log(
    "Sem centro de custo:",
    money(summary.unclassifiedAmount),
    `(${summary.unclassifiedTitles} título[s])`
  );
  console.log("\nTop 20 centros:");
  for (const item of summary.items.slice(0, 20)) {
    console.log(
      `  ${item.code ?? "—"} · ${item.name} · ${money(item.amount)} · ${item.titlesCount} título(s) · ${item.sharePercentage.toFixed(2)}%${item.unclassified ? " · (AUDITORIA)" : ""}`
    );
  }
  void CASH_FLOW_COST_CENTER_UNCLASSIFIED_ID;
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
