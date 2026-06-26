#!/usr/bin/env npx tsx
/**
 * Compara KPIs AR/AP do Relatório Executivo vs telas oficiais (mesmos filtros e asOfDate).
 *
 * Uso:
 *   npx tsx scripts/audit-executive-report-financial-sources.ts --year=2026 --month=6 --asOfDate=2026-06-26
 */
import { prisma } from "../src/lib/prisma.js";
import {
  buildExecutiveReportApPortfolioFilters,
  buildExecutiveReportArPortfolioFilters,
  parseFinanceExecutiveReportQuery,
  resolveExecutiveReportReferenceDate,
} from "../src/lib/financeExecutiveReport.js";
import {
  buildExecutiveReportPayablesSection,
  buildExecutiveReportReceivablesSection,
  buildOfficialAccountsPayableDashboardForReport,
  buildOfficialAccountsReceivableDashboardForReport,
  resolveExecutiveReportHighlightMonth,
} from "../src/lib/financeExecutiveReportDataSources.js";
import { loadFinanceArManagementRowsFromPrisma } from "../src/lib/financeAccountsReceivableManagement.js";
import { loadFinanceArOpenHorizonRowsFromPrisma } from "../src/lib/financeAccountsReceivableHorizon.js";
import {
  buildFinanceApPrismaWhere,
  mapPrismaRowToFinanceApDashboardRow,
} from "../src/lib/financeAccountsPayableDashboard.js";
import { FINANCE_AP_TITLE_SELECT } from "../src/lib/financeAccountsPayableTitles.js";
import { resolveNomusApReportSyncCutoffFromPrisma } from "../src/lib/financeNomusApReportFreshness.js";

function parseArg(name: string): string | undefined {
  const prefix = `--${name}=`;
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith(prefix)) return arg.slice(prefix.length);
  }
  return undefined;
}

function diff(label: string, report: number, official: number) {
  const delta = Math.round((report - official) * 100) / 100;
  console.log(`${label}:`);
  console.log(`  relatório: ${report.toFixed(2)}`);
  console.log(`  tela oficial: ${official.toFixed(2)}`);
  console.log(`  diferença: ${delta.toFixed(2)}`);
}

async function main() {
  const year = Number(parseArg("year") ?? "2026");
  const month = Number(parseArg("month") ?? "6");
  const asOfDate = parseArg("asOfDate") ?? "2026-06-26";

  const filters = parseFinanceExecutiveReportQuery({ year, month, asOfDate });
  const referenceDate = resolveExecutiveReportReferenceDate(filters);
  const arPortfolioFilters = buildExecutiveReportArPortfolioFilters(filters);
  const apPortfolioFilters = buildExecutiveReportApPortfolioFilters(filters);
  const highlightMonth = resolveExecutiveReportHighlightMonth(filters.month, referenceDate);

  const [arLoad, arHorizon, apSyncCutoff] = await Promise.all([
    loadFinanceArManagementRowsFromPrisma(prisma, arPortfolioFilters, referenceDate),
    loadFinanceArOpenHorizonRowsFromPrisma(prisma, referenceDate),
    resolveNomusApReportSyncCutoffFromPrisma(prisma),
  ]);

  const apWhere = buildFinanceApPrismaWhere(apPortfolioFilters, apSyncCutoff);
  const apPrisma = await prisma.nomusAccountsPayable.findMany({
    where: apWhere,
    select: FINANCE_AP_TITLE_SELECT,
    orderBy: { dueDate: "asc" },
  });
  const apRows = apPrisma.map(mapPrismaRowToFinanceApDashboardRow);

  const officialAr = buildOfficialAccountsReceivableDashboardForReport({
    rows: arLoad.rows,
    filters: arPortfolioFilters,
    referenceDate,
    syncCutoff: arLoad.syncCutoff,
    horizonSourceRows: arHorizon.rows,
  });

  const officialAp = buildOfficialAccountsPayableDashboardForReport({
    rows: apRows,
    filters: apPortfolioFilters,
    referenceDate,
    syncCutoff: apSyncCutoff,
  });

  const reportAr = buildExecutiveReportReceivablesSection({
    rows: arLoad.rows,
    filters: arPortfolioFilters,
    referenceDate,
    syncCutoff: arLoad.syncCutoff,
    year: filters.year,
    month: highlightMonth,
    cards: officialAr.cards,
  });

  const reportAp = buildExecutiveReportPayablesSection({
    rows: apRows,
    filters: apPortfolioFilters,
    referenceDate,
    syncCutoff: apSyncCutoff,
    year: filters.year,
    month: highlightMonth,
    cards: officialAp.cards,
    purchaseOrderScheduleAudit: officialAp.purchaseOrderScheduleAudit,
  });

  console.log(`Auditoria AR/AP — year=${year} month=${month} asOfDate=${asOfDate}\n`);

  console.log("Contas a Receber:");
  diff("AR aberto", reportAr.kpis.openAmount, officialAr.cards.totalOpenAmount);
  diff("AR atrasado", reportAr.kpis.overdueAmount, officialAr.cards.overdueAmount);
  diff("Recebido mês", reportAr.kpis.receivedMonthCurrent, officialAr.cards.receivedThisMonthAmount);
  diff("Recebido YTD", reportAr.kpis.receivedYtdCurrent, reportAr.kpis.receivedYtdCurrent);

  console.log("\nContas a Pagar:");
  diff("AP aberto", reportAp.kpis.openAmount, officialAp.cards.totalOpenAmount);
  diff("AP vencido", reportAp.kpis.overdueAmount, officialAp.cards.overdueAmount);
  diff("Pago mês", reportAp.kpis.paidMonthCurrent, officialAp.cards.paidThisMonthAmount);
  diff("Pago YTD", reportAp.kpis.paidYtdCurrent, reportAp.kpis.paidYtdCurrent);

  await prisma.$disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
