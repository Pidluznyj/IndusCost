#!/usr/bin/env npx tsx
/**
 * Compara métricas do Fluxo de Caixa com motores oficiais AR e AP.
 *
 * Uso:
 *   npx tsx scripts/audit-cash-flow-rules-engine-consumption.ts --year=2026 --month=6 --asOfDate=2026-06-26
 */
import { prisma } from "../src/lib/prisma.js";
import {
  buildExecutiveReportCashFlowFilters,
  parseFinanceExecutiveReportQuery,
  resolveExecutiveReportReferenceDate,
} from "../src/lib/financeExecutiveReport.js";
import {
  buildOfficialAccountsReceivableRulesResult,
  OFFICIAL_AR_RULES_SOURCE,
  resolveOfficialArCashFlowExecutiveMetrics,
} from "../src/lib/financeAccountsReceivableRulesAdapter.js";
import {
  buildOfficialAccountsPayableRulesResult,
  OFFICIAL_AP_RULES_SOURCE,
  resolveOfficialApCashFlowExecutiveMetrics,
} from "../src/lib/financeAccountsPayableRulesAdapter.js";
import {
  buildFinanceCashFlowDashboard,
  FINANCE_CASH_FLOW_AP_SELECT,
  FINANCE_CASH_FLOW_AR_SELECT,
  mapPrismaRowToFinanceCashFlowApRow,
  mapPrismaRowToFinanceCashFlowArRow,
  parseFinanceCashFlowDashboardFilters,
  resolveFinanceCashFlowFiltersForLoad,
  toApLoadFilters,
  toArLoadFilters,
  toCashFlowPortfolioApFilters,
  toCashFlowPortfolioArFilters,
} from "../src/lib/financeCashFlowDashboard.js";
import {
  buildOfficialCashFlowArApDashboardBundle,
  computeCashFlowNetBalance,
  OFFICIAL_CF_RULES_SOURCE,
  resolveOfficialCashFlowExecutiveSideMetrics,
} from "../src/lib/financeCashFlowRulesAdapter.js";
import {
  buildCashFlowApPrismaWhere,
  buildCashFlowArPrismaWhere,
} from "../src/lib/financeCashFlowRowFilters.js";
import {
  buildFinanceCashFlowDailyRadar,
  createDailyRadarDashboardFilters,
} from "../src/lib/financeCashFlowDailyRadar.js";
import { filterDailyRadarPortfolioRows } from "../src/lib/financeCashFlowDailyRadar.js";
import { buildFinanceApPrismaWhere } from "../src/lib/financeAccountsPayableDashboard.js";
import { buildFinanceArPrismaWhere } from "../src/lib/financeAccountsReceivableDashboard.js";
import { resolveNomusArReportSyncCutoffFromPrisma } from "../src/lib/financeNomusArReportFreshness.js";
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
  motorAr: number | null;
  motorAp: number | null;
  cashFlow: number | null;
  delta: number;
  status: string;
};

function nearlyEqual(a: number | null, b: number | null, epsilon = 0.02): boolean {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  return Math.abs(a - b) <= epsilon;
}

function fmt(n: number | null): string {
  if (n == null) return "—";
  return n.toFixed(2);
}

async function loadCashFlowRows(
  filters: ReturnType<typeof parseFinanceCashFlowDashboardFilters>,
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

async function loadRadarPortfolio(referenceDate: Date) {
  const filters = createDailyRadarDashboardFilters();
  const [arSyncCutoff, apSyncCutoff] = await Promise.all([
    resolveNomusArReportSyncCutoffFromPrisma(prisma),
    resolveNomusApReportSyncCutoffFromPrisma(prisma),
  ]);
  const arWhere = buildFinanceArPrismaWhere(toCashFlowPortfolioArFilters(filters), referenceDate, arSyncCutoff);
  const apWhere = buildFinanceApPrismaWhere(toCashFlowPortfolioApFilters(filters), apSyncCutoff);

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

  return filterDailyRadarPortfolioRows(
    arPrisma.map(mapPrismaRowToFinanceCashFlowArRow),
    apPrisma.map(mapPrismaRowToFinanceCashFlowApRow),
    referenceDate,
    arSyncCutoff,
    apSyncCutoff
  );
}

async function main() {
  const year = Number(parseArg("year") ?? "2026");
  const month = Number(parseArg("month") ?? "6");
  const asOfDate = parseArg("asOfDate") ?? "2026-06-26";
  const referenceDate = new Date(asOfDate + "T23:59:59");

  const execFilters = parseFinanceExecutiveReportQuery({ year, month, asOfDate });
  const cfFilters = resolveFinanceCashFlowFiltersForLoad(
    { year: String(year), month: String(month), asOfDate },
    parseFinanceCashFlowDashboardFilters({ year: String(year), month: String(month), asOfDate }),
    referenceDate
  );

  const load = await loadCashFlowRows(cfFilters, referenceDate);
  const cfPayload = buildFinanceCashFlowDashboard(
    load.arRows,
    load.apRows,
    cfFilters,
    referenceDate,
    load.arSyncCutoff,
    load.apSyncCutoff
  );

  const arEngine = buildOfficialAccountsReceivableRulesResult({
    rows: load.arRows,
    filters: toCashFlowPortfolioArFilters(cfFilters),
    referenceDate,
    syncCutoff: load.arSyncCutoff,
    year,
    month,
  });
  const apEngine = buildOfficialAccountsPayableRulesResult({
    rows: load.apRows,
    filters: toCashFlowPortfolioApFilters(cfFilters),
    referenceDate,
    syncCutoff: load.apSyncCutoff,
    year,
    month,
  });

  const officialDash = buildOfficialCashFlowArApDashboardBundle({
    arRows: load.arRows,
    apRows: load.apRows,
    filters: cfFilters,
    referenceDate,
    arSyncCutoff: load.arSyncCutoff,
    apSyncCutoff: load.apSyncCutoff,
  });

  const executiveSide = resolveOfficialCashFlowExecutiveSideMetrics({
    arRows: load.arRows,
    apRows: load.apRows,
    filters: cfFilters,
    referenceDate,
    arSyncCutoff: load.arSyncCutoff,
    apSyncCutoff: load.apSyncCutoff,
    year,
  });

  const radarPortfolio = await loadRadarPortfolio(referenceDate);
  const radar = buildFinanceCashFlowDailyRadar(
    radarPortfolio.arRows,
    radarPortfolio.apRows,
    { baseDate: referenceDate },
    referenceDate
  );

  const radarArTotal = radar.ranges.reduce((sum, r) => sum + r.receivableTotal, 0);
  const radarApTotal = radar.ranges.reduce((sum, r) => sum + r.payableTotal, 0);

  const rows: AuditRow[] = [];

  function addRow(
    indicator: string,
    arVal: number | null,
    apVal: number | null,
    cfVal: number | null,
    scopeNote?: string
  ) {
    const ref =
      cfVal ??
      (arVal != null && apVal != null ? computeCashFlowNetBalance(arVal, apVal) : arVal ?? apVal);
    const engineRef =
      arVal != null && apVal == null
        ? arVal
        : apVal != null && arVal == null
          ? apVal
          : arVal != null && apVal != null
            ? computeCashFlowNetBalance(arVal, apVal)
            : null;
    const delta =
      engineRef != null && ref != null ? Math.round((engineRef - ref) * 100) / 100 : 0;
    let status =
      engineRef == null || ref == null
        ? "NÃO APLICÁVEL"
        : nearlyEqual(engineRef, ref)
          ? "OK"
          : "DIFERENÇA";
    if (scopeNote) status = `ESCOPO DIFERENTE — ${scopeNote}`;
    rows.push({
      indicator,
      motorAr: arVal,
      motorAp: apVal,
      cashFlow: cfVal,
      delta,
      status,
    });
  }

  addRow(
    "Carteira AR em aberto (portfólio)",
    arEngine.metrics.openAmount,
    null,
    cfPayload.cards.totalReceivableOpen
  );
  addRow(
    "Carteira AP em aberto (portfólio)",
    null,
    apEngine.metrics.openAmount,
    cfPayload.cards.totalPayableOpen
  );
  addRow(
    "Recebido YTD",
    executiveSide.receivable.receivedYtd,
    null,
    cfPayload.executiveSummary.receivable.receivedYtd
  );
  addRow(
    "Pago YTD",
    null,
    executiveSide.payable.paidYtd,
    cfPayload.executiveSummary.payable.paidYtd
  );
  addRow(
    "A receber até 31/12",
    executiveSide.receivable.openUntilYearEnd,
    null,
    cfPayload.executiveSummary.receivable.openFromTodayToYearEnd
  );
  addRow(
    "A pagar até 31/12",
    null,
    executiveSide.payable.openUntilYearEnd,
    cfPayload.executiveSummary.payable.openFromTodayToYearEnd
  );
  addRow(
    "Saldo líquido YTD (AR − AP)",
    executiveSide.receivable.receivedYtd,
    executiveSide.payable.paidYtd,
    cfPayload.executiveSummary.net.realizedYtd
  );
  addRow(
    "Saldo projetado restante (AR − AP)",
    executiveSide.receivable.openUntilYearEnd,
    executiveSide.payable.openUntilYearEnd,
    cfPayload.executiveSummary.net.projectedRemaining
  );
  addRow(
    "Entradas do período",
    officialDash.arPeriod.metrics.receivedThisMonth,
    null,
    cfPayload.cards.inflowAmount,
    "Fluxo aloca por vencimento/visão; AR recebido usa settlement"
  );
  addRow(
    "Saídas do período",
    null,
    officialDash.apPeriod.metrics.paidThisMonth,
    cfPayload.cards.outflowAmount,
    "Fluxo aloca por vencimento/visão; AP pago usa data efetiva"
  );
  addRow(
    "Saldo líquido do período",
    cfPayload.cards.inflowAmount,
    cfPayload.cards.outflowAmount,
    cfPayload.cards.netFlowAmount
  );
  addRow(
    "Saldo acumulado do período",
    null,
    null,
    cfPayload.cards.accumulatedBalance
  );
  addRow(
    "Radar — total entradas (faixas)",
    radarArTotal,
    null,
    radarArTotal,
    "Radar usa portfólio aberto independente dos filtros globais"
  );
  addRow(
    "Radar — total saídas (faixas)",
    null,
    radarApTotal,
    radarApTotal,
    "Radar usa portfólio aberto independente dos filtros globais"
  );

  console.log(
    `Auditoria Fluxo de Caixa — year=${year} month=${month} asOfDate=${asOfDate}\n` +
      `AR=${OFFICIAL_AR_RULES_SOURCE} AP=${OFFICIAL_AP_RULES_SOURCE} CF=${OFFICIAL_CF_RULES_SOURCE}\n`
  );
  console.log(
    "| Indicador | Motor AR | Motor AP | Fluxo de Caixa | Diferença | Status |"
  );
  console.log("| --- | ---: | ---: | ---: | ---: | --- |");
  for (const r of rows) {
    console.log(
      `| ${r.indicator} | ${fmt(r.motorAr)} | ${fmt(r.motorAp)} | ${fmt(r.cashFlow)} | ${fmt(r.delta)} | ${r.status} |`
    );
  }

  const failures = rows.filter((r) => r.status === "DIFERENÇA");
  if (failures.length > 0) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
