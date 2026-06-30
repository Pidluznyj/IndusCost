#!/usr/bin/env npx tsx
/**
 * Compara métricas AP entre motor oficial, tela, fluxo de caixa e relatório executivo.
 *
 * Uso:
 *   npx tsx scripts/audit-accounts-payable-rules-consumption.ts --year=2026 --month=6 --asOfDate=2026-06-26
 */
import { prisma } from "../src/lib/prisma.js";
import {
  buildExecutiveReportApPortfolioFilters,
  buildExecutiveReportCashFlowFilters,
  parseFinanceExecutiveReportQuery,
  resolveExecutiveReportReferenceDate,
} from "../src/lib/financeExecutiveReport.js";
import {
  buildExecutiveReportPayablesSection,
  buildOfficialAccountsPayableDashboardForReport,
  resolveExecutiveReportHighlightMonth,
} from "../src/lib/financeExecutiveReportDataSources.js";
import {
  buildOfficialAccountsPayableRulesResult,
  buildOfficialApDueRadarPayload,
  OFFICIAL_AP_RULES_SOURCE,
  resolveOfficialApCashFlowExecutiveMetrics,
} from "../src/lib/financeAccountsPayableRulesAdapter.js";
import type { DueRadarPayload } from "../src/lib/financeDueRadar.js";
import {
  buildFinanceApPrismaWhere,
  mapPrismaRowToFinanceApDashboardRow,
} from "../src/lib/financeAccountsPayableDashboard.js";
import { FINANCE_AP_TITLE_SELECT } from "../src/lib/financeAccountsPayableTitles.js";
import {
  buildFinanceCashFlowDashboard,
  FINANCE_CASH_FLOW_AP_SELECT,
  FINANCE_CASH_FLOW_AR_SELECT,
  mapPrismaRowToFinanceCashFlowApRow,
  mapPrismaRowToFinanceCashFlowArRow,
  toApLoadFilters,
} from "../src/lib/financeCashFlowDashboard.js";
import {
  buildCashFlowApPrismaWhere,
  buildCashFlowArPrismaWhere,
} from "../src/lib/financeCashFlowRowFilters.js";
import { loadFinanceArManagementRowsFromPrisma } from "../src/lib/financeAccountsReceivableManagement.js";
import {
  resolveNomusApReportSyncCutoffFromPrisma,
} from "../src/lib/financeNomusApReportFreshness.js";
import { resolveNomusArReportSyncCutoffFromPrisma } from "../src/lib/financeNomusArReportFreshness.js";

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
  apScreen: number;
  cashFlow: number | null;
  executiveReport: number | null;
  delta: number;
  status: string;
};

function nearlyEqual(a: number, b: number, epsilon = 0.01): boolean {
  return Math.abs(a - b) <= epsilon;
}

function fmt(n: unknown): string {
  if (n == null) return "—";
  if (typeof n === "number" && Number.isFinite(n)) return n.toFixed(2);
  if (typeof n === "string" && n.trim() !== "") {
    const parsed = Number(n);
    if (Number.isFinite(parsed)) return parsed.toFixed(2);
  }
  return "INVÁLIDO";
}

function resolveDueRadarApRangesTotal(payload: DueRadarPayload): number | null {
  if (!Array.isArray(payload.ranges)) return null;
  return payload.ranges.reduce(
    (sum, range) => sum + (Number.isFinite(range.totalAmount) ? range.totalAmount : 0),
    0
  );
}

async function loadCashFlowRowsForAudit(
  filters: ReturnType<typeof buildExecutiveReportCashFlowFilters>,
  referenceDate: Date
) {
  const [arSyncCutoff, apSyncCutoff] = await Promise.all([
    resolveNomusArReportSyncCutoffFromPrisma(prisma),
    resolveNomusApReportSyncCutoffFromPrisma(prisma),
  ]);
  const arFilters = toApLoadFilters(filters);
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
  const apPortfolioFilters = buildExecutiveReportApPortfolioFilters(filters);
  const cashFlowFilters = buildExecutiveReportCashFlowFilters(filters);
  const highlightMonth = resolveExecutiveReportHighlightMonth(filters.month, referenceDate);

  const [apSyncCutoff, cashFlowLoad] = await Promise.all([
    resolveNomusApReportSyncCutoffFromPrisma(prisma),
    loadCashFlowRowsForAudit(cashFlowFilters, referenceDate),
  ]);

  const apWhere = buildFinanceApPrismaWhere(apPortfolioFilters, apSyncCutoff);
  const apPrisma = await prisma.nomusAccountsPayable.findMany({
    where: apWhere,
    select: FINANCE_AP_TITLE_SELECT,
    orderBy: { dueDate: "asc" },
  });
  const apRows = apPrisma.map(mapPrismaRowToFinanceApDashboardRow);

  const engine = buildOfficialAccountsPayableRulesResult({
    rows: apRows,
    filters: apPortfolioFilters,
    referenceDate,
    syncCutoff: apSyncCutoff,
    year,
    month: highlightMonth,
  });

  const apScreen = buildOfficialAccountsPayableDashboardForReport({
    rows: apRows,
    filters: apPortfolioFilters,
    referenceDate,
    syncCutoff: apSyncCutoff,
  });

  const cashFlowPayload = buildFinanceCashFlowDashboard(
    cashFlowLoad.arRows,
    cashFlowLoad.apRows,
    cashFlowFilters,
    referenceDate,
    cashFlowLoad.arSyncCutoff,
    cashFlowLoad.apSyncCutoff
  );

  const cfApExecutive = resolveOfficialApCashFlowExecutiveMetrics(
    cashFlowLoad.apRows,
    toApLoadFilters(cashFlowFilters),
    referenceDate,
    cashFlowLoad.apSyncCutoff,
    year
  );

  const executiveSection = buildExecutiveReportPayablesSection({
    rows: apRows,
    filters: apPortfolioFilters,
    referenceDate,
    syncCutoff: apSyncCutoff,
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
      apScreen: screenVal,
      cashFlow: cfVal,
      executiveReport: reportVal,
      delta,
      status,
    });
  }

  addRow(
    "Em aberto",
    engine.metrics.openAmount,
    apScreen.cards.totalOpenAmount,
    cashFlowPayload.cards.totalPayableOpen,
    executiveSection.kpis.openAmount
  );
  addRow(
    "Vencido gerencial",
    engine.metrics.overdueAmount,
    apScreen.cards.overdueAmount,
    null,
    executiveSection.kpis.overdueAmount
  );
  addRow(
    "Pago no mês",
    engine.metrics.paidThisMonth,
    apScreen.cards.paidThisMonthAmount,
    null,
    executiveSection.kpis.paidMonthCurrent,
    "mês calendário da data-base vs mês destacado no relatório"
  );
  addRow(
    "Pago YTD",
    engine.metrics.paidYtd,
    engine.metrics.paidYtd,
    cfApExecutive.paidYtd,
    executiveSection.kpis.paidYtdCurrent
  );
  addRow(
    "A pagar até 31/12",
    engine.metrics.openUntilYearEnd,
    engine.metrics.openUntilYearEnd,
    cfApExecutive.openUntilYearEnd,
    null
  );
  addRow(
    "Estimativa AP do ano",
    engine.metrics.estimatedYearTotal,
    engine.metrics.estimatedYearTotal,
    cfApExecutive.estimatedYearTotal,
    null
  );
  addRow(
    "Agendados",
    engine.metrics.scheduledOpenAmount,
    engine.purchaseOrderScheduleAudit.rescheduledOpenAmount,
    null,
    executiveSection.kpis.scheduledOpenAmount
  );
  addRow(
    "Próx. 7 dias",
    engine.metrics.dueNext7DaysAmount,
    apScreen.cards.dueNext7DaysAmount,
    null,
    null
  );
  addRow(
    "Próx. 30 dias",
    engine.metrics.dueNext30DaysAmount,
    apScreen.cards.dueNext30DaysAmount,
    null,
    null
  );

  const dueRadarPayload = buildOfficialApDueRadarPayload(
    apRows,
    { baseDate: referenceDate, page: 1, pageSize: 5000, exportAll: true },
    referenceDate
  );
  const dueRadarRangesTotal = resolveDueRadarApRangesTotal(dueRadarPayload);
  addRow(
    "Due-radar AP (total faixas)",
    engine.metrics.openAmount,
    apScreen.cards.totalOpenAmount,
    null,
    dueRadarRangesTotal,
    dueRadarRangesTotal == null
      ? "due-radar sem faixas — métrica ausente no payload oficial"
      : "soma das faixas do radar (escopo vencimento operacional, não carteira AP)"
  );

  console.log(
    `Auditoria consumo AP — year=${year} month=${month} asOfDate=${asOfDate} source=${OFFICIAL_AP_RULES_SOURCE}\n`
  );
  console.log(
    "| Indicador | Motor | Tela AP | Fluxo | Relatório | Diferença | Status |"
  );
  console.log("| --- | ---: | ---: | ---: | ---: | ---: | --- |");
  for (const r of rows) {
    console.log(
      `| ${r.indicator} | ${fmt(r.engine)} | ${fmt(r.apScreen)} | ${fmt(r.cashFlow)} | ${fmt(r.executiveReport)} | ${fmt(r.delta)} | ${r.status} |`
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
