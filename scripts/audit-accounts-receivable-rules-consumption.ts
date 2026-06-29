#!/usr/bin/env npx tsx
/**
 * Compara métricas AR entre motor oficial, tela, fluxo de caixa e relatório executivo.
 *
 * Uso:
 *   npx tsx scripts/audit-accounts-receivable-rules-consumption.ts --year=2026 --month=6 --asOfDate=2026-06-26
 */
import { prisma } from "../src/lib/prisma.js";
import {
  buildExecutiveReportArPortfolioFilters,
  buildExecutiveReportCashFlowFilters,
  parseFinanceExecutiveReportQuery,
  resolveExecutiveReportReferenceDate,
} from "../src/lib/financeExecutiveReport.js";
import {
  buildExecutiveReportReceivablesSection,
  buildOfficialAccountsReceivableDashboardForReport,
  resolveExecutiveReportHighlightMonth,
} from "../src/lib/financeExecutiveReportDataSources.js";
import {
  buildOfficialAccountsReceivableOverduePayload,
  buildOfficialAccountsReceivableRulesResult,
  OFFICIAL_AR_RULES_SOURCE,
  resolveOfficialArCashFlowExecutiveMetrics,
} from "../src/lib/financeAccountsReceivableRulesAdapter.js";
import { loadFinanceArManagementRowsFromPrisma } from "../src/lib/financeAccountsReceivableManagement.js";
import { loadFinanceArOpenHorizonRowsFromPrisma } from "../src/lib/financeAccountsReceivableHorizon.js";
import {
  buildFinanceCashFlowDashboard,
  FINANCE_CASH_FLOW_AP_SELECT,
  FINANCE_CASH_FLOW_AR_SELECT,
  mapPrismaRowToFinanceCashFlowApRow,
  mapPrismaRowToFinanceCashFlowArRow,
  toApLoadFilters,
  toArLoadFilters,
} from "../src/lib/financeCashFlowDashboard.js";
import {
  buildCashFlowApPrismaWhere,
  buildCashFlowArPrismaWhere,
} from "../src/lib/financeCashFlowRowFilters.js";
import {
  resolveNomusArReportSyncCutoffFromPrisma,
} from "../src/lib/financeNomusArReportFreshness.js";
import { resolveNomusApReportSyncCutoffFromPrisma } from "../src/lib/financeNomusApReportFreshness.js";

function parseArg(name: string): string | undefined {
  const prefix = `--${name}=`;
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith(prefix)) return arg.slice(prefix.length);
  }
  return undefined;
}

type AuditRow = {
  indicator: string;
  engine: number;
  arScreen: number;
  cashFlow: number | null;
  executiveReport: number | null;
  delta: number;
  status: string;
};

function nearlyEqual(a: number, b: number, epsilon = 0.01): boolean {
  return Math.abs(a - b) <= epsilon;
}

function fmt(n: number | null): string {
  if (n == null) return "—";
  return n.toFixed(2);
}

async function loadCashFlowRowsForAudit(
  filters: ReturnType<typeof buildExecutiveReportCashFlowFilters>,
  referenceDate: Date
) {
  const [arSyncCutoff, apSyncCutoff] = await Promise.all([
    resolveNomusArReportSyncCutoffFromPrisma(prisma),
    resolveNomusApReportSyncCutoffFromPrisma(prisma),
  ]);
  const arFilters = toArLoadFilters(filters);
  const apFilters = toApLoadFilters(filters);
  const arWhere = buildCashFlowArPrismaWhere(filters, arFilters, referenceDate, arSyncCutoff);
  const apWhere = buildCashFlowApPrismaWhere(filters, apFilters, referenceDate, apSyncCutoff);

  const [arPrisma, apPrisma] = await Promise.all([
    prisma.nomusAccountsReceivable.findMany({
      where: arWhere,
      select: FINANCE_CASH_FLOW_AR_SELECT,
      orderBy: { dueDate: "asc" },
    }),
    prisma.nomusAccountsPayable.findMany({
      where: apWhere,
      select: FINANCE_CASH_FLOW_AP_SELECT,
      orderBy: { dueDate: "asc" },
    }),
  ]);

  return {
    arRows: arPrisma.map(mapPrismaRowToFinanceCashFlowArRow),
    apRows: apPrisma.map(mapPrismaRowToFinanceCashFlowApRow),
    arSyncCutoff,
    apSyncCutoff,
  };
}

async function main() {
  const year = Number(parseArg("year") ?? "2026");
  const month = Number(parseArg("month") ?? "6");
  const asOfDate = parseArg("asOfDate") ?? "2026-06-26";

  const filters = parseFinanceExecutiveReportQuery({ year, month, asOfDate });
  const referenceDate = resolveExecutiveReportReferenceDate(filters);
  const arPortfolioFilters = buildExecutiveReportArPortfolioFilters(filters);
  const cashFlowFilters = buildExecutiveReportCashFlowFilters(filters);
  const highlightMonth = resolveExecutiveReportHighlightMonth(filters.month, referenceDate);

  const [arLoad, arHorizon, cashFlowLoad] = await Promise.all([
    loadFinanceArManagementRowsFromPrisma(prisma, arPortfolioFilters, referenceDate),
    loadFinanceArOpenHorizonRowsFromPrisma(prisma, referenceDate),
    loadCashFlowRowsForAudit(cashFlowFilters, referenceDate),
  ]);

  const engine = buildOfficialAccountsReceivableRulesResult({
    rows: arLoad.rows,
    filters: arPortfolioFilters,
    referenceDate,
    syncCutoff: arLoad.syncCutoff,
    horizonSourceRows: arHorizon.rows,
    year,
    month: highlightMonth,
  });

  const arScreen = buildOfficialAccountsReceivableDashboardForReport({
    rows: arLoad.rows,
    filters: arPortfolioFilters,
    referenceDate,
    syncCutoff: arLoad.syncCutoff,
    horizonSourceRows: arHorizon.rows,
  });

  const cashFlowPayload = buildFinanceCashFlowDashboard(
    cashFlowLoad.arRows,
    cashFlowLoad.apRows,
    cashFlowFilters,
    referenceDate,
    cashFlowLoad.arSyncCutoff,
    cashFlowLoad.apSyncCutoff
  );

  const cfArExecutive = resolveOfficialArCashFlowExecutiveMetrics(
    cashFlowLoad.arRows,
    toArLoadFilters(cashFlowFilters),
    referenceDate,
    cashFlowLoad.arSyncCutoff,
    year
  );

  const executiveSection = buildExecutiveReportReceivablesSection({
    rows: arLoad.rows,
    filters: arPortfolioFilters,
    referenceDate,
    syncCutoff: arLoad.syncCutoff,
    year,
    month: highlightMonth,
  });

  const rows: AuditRow[] = [];

  function addRow(
    indicator: string,
    engineVal: number,
    screenVal: number,
    cfVal: number | null,
    reportVal: number | null,
    scopeNote?: string
  ) {
    const ref = screenVal;
    const delta = Math.round((engineVal - ref) * 100) / 100;
    let status = nearlyEqual(engineVal, ref) ? "OK" : "DIVERGENTE";
    if (scopeNote) status = `ESCOPO DIFERENTE — ${scopeNote}`;
    rows.push({
      indicator,
      engine: engineVal,
      arScreen: screenVal,
      cashFlow: cfVal,
      executiveReport: reportVal,
      delta,
      status,
    });
  }

  addRow(
    "Em aberto",
    engine.metrics.openAmount,
    arScreen.cards.totalOpenAmount,
    cashFlowPayload.cards.totalReceivableOpen,
    executiveSection.kpis.openAmount
  );
  addRow(
    "Vencido / atrasado gerencial",
    engine.metrics.overdueAmount,
    arScreen.cards.overdueAmount,
    null,
    executiveSection.kpis.overdueAmount
  );
  addRow(
    "Recebido no mês",
    engine.metrics.receivedThisMonth,
    arScreen.cards.receivedThisMonthAmount,
    null,
    executiveSection.kpis.receivedMonthCurrent,
    "mês calendário da data-base vs mês destacado no relatório"
  );
  addRow(
    "Recebido YTD",
    engine.metrics.receivedYtd,
    engine.metrics.receivedYtd,
    cfArExecutive.receivedYtd,
    executiveSection.kpis.receivedYtdCurrent
  );
  addRow(
    "A receber até 31/12",
    engine.metrics.openUntilYearEnd,
    engine.metrics.openUntilYearEnd,
    cfArExecutive.openUntilYearEnd,
    null
  );
  addRow(
    "Estimativa AR do ano",
    engine.metrics.estimatedYearTotal,
    engine.metrics.estimatedYearTotal,
    cfArExecutive.estimatedYearTotal,
    null
  );
  addRow(
    "Próx. 7 dias",
    engine.metrics.dueNext7DaysAmount,
    arScreen.cards.dueNext7DaysAmount,
    null,
    null
  );
  addRow(
    "Próx. 30 dias",
    engine.metrics.dueNext30DaysAmount,
    arScreen.cards.dueNext30DaysAmount,
    null,
    null
  );
  addRow(
    "Com NF (aberto)",
    engine.metrics.openWithInvoiceAmount,
    arScreen.cards.openWithInvoiceAmount,
    null,
    null
  );
  addRow(
    "Sem NF (aberto)",
    engine.metrics.openWithoutInvoiceAmount,
    arScreen.cards.openWithoutInvoiceAmount,
    null,
    null
  );

  const overduePayload = buildOfficialAccountsReceivableOverduePayload(
    arLoad.rows,
    { status: "all" },
    referenceDate,
    arLoad.syncCutoff,
    { paginate: false }
  );
  addRow(
    "Overdue detalhado (total)",
    engine.metrics.overdueAmount,
    arScreen.cards.overdueAmount,
    null,
    overduePayload.summary.totalOverdueAmount
  );

  console.log(
    `Auditoria consumo AR — year=${year} month=${month} asOfDate=${asOfDate} source=${OFFICIAL_AR_RULES_SOURCE}\n`
  );
  console.log(
    "| Indicador | Motor | Tela AR | Fluxo | Relatório | Diferença | Status |"
  );
  console.log("| --- | ---: | ---: | ---: | ---: | ---: | --- |");
  for (const r of rows) {
    console.log(
      `| ${r.indicator} | ${fmt(r.engine)} | ${fmt(r.arScreen)} | ${fmt(r.cashFlow)} | ${fmt(r.executiveReport)} | ${fmt(r.delta)} | ${r.status} |`
    );
  }

  const failures = rows.filter((r) => r.status === "DIVERGENTE");
  if (failures.length > 0) {
    process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
