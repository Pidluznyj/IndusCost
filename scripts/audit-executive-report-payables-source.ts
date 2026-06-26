#!/usr/bin/env npx tsx
/**
 * Compara cards de Contas a Pagar: tela oficial vs Relatório Executivo.
 *
 * Uso:
 *   npx tsx scripts/audit-executive-report-payables-source.ts --year=2026 --month=6 --asOfDate=2026-06-26
 */
import { prisma } from "../src/lib/prisma.js";
import {
  buildExecutiveReportApPortfolioFilters,
  parseFinanceExecutiveReportQuery,
  resolveExecutiveReportReferenceDate,
} from "../src/lib/financeExecutiveReport.js";
import {
  buildExecutiveReportPayablesSection,
  buildOfficialAccountsPayableDashboardForReport,
  resolveExecutiveReportHighlightMonth,
} from "../src/lib/financeExecutiveReportDataSources.js";
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

type CompareField = {
  label: string;
  official: number;
  report: number | null;
};

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function printSection(title: string, fields: Array<{ label: string; value: number }>) {
  console.log(title);
  for (const field of fields) {
    console.log(`  ${field.label}: ${field.value.toFixed(2)}`);
  }
  console.log("");
}

function compareFields(fields: CompareField[]) {
  console.log("Diferenças:");
  let hasDiff = false;
  for (const field of fields) {
    if (field.report == null) continue;
    const delta = round2(field.report - field.official);
    if (Math.abs(delta) > 0.01) {
      hasDiff = true;
      console.log(`  ${field.label}:`);
      console.log(`    tela oficial: ${field.official.toFixed(2)}`);
      console.log(`    relatório:    ${field.report.toFixed(2)}`);
      console.log(`    diferença:    ${delta.toFixed(2)}`);
    }
  }
  if (!hasDiff) {
    console.log("  Nenhuma diferença material (≤ R$ 0,01).");
  }
}

async function main() {
  const year = Number(parseArg("year") ?? "2026");
  const month = Number(parseArg("month") ?? "6");
  const asOfDate = parseArg("asOfDate") ?? "2026-06-26";

  const filters = parseFinanceExecutiveReportQuery({ year, month, asOfDate });
  const referenceDate = resolveExecutiveReportReferenceDate(filters);
  const apPortfolioFilters = buildExecutiveReportApPortfolioFilters(filters);
  const highlightMonth = resolveExecutiveReportHighlightMonth(filters.month, referenceDate);

  const apSyncCutoff = await resolveNomusApReportSyncCutoffFromPrisma(prisma);
  const apWhere = buildFinanceApPrismaWhere(apPortfolioFilters, apSyncCutoff);
  const apPrisma = await prisma.nomusAccountsPayable.findMany({
    where: apWhere,
    select: FINANCE_AP_TITLE_SELECT,
    orderBy: { dueDate: "asc" },
  });
  const apRows = apPrisma.map(mapPrismaRowToFinanceApDashboardRow);

  const officialAp = buildOfficialAccountsPayableDashboardForReport({
    rows: apRows,
    filters: apPortfolioFilters,
    referenceDate,
    syncCutoff: apSyncCutoff,
  });

  const reportAp = buildExecutiveReportPayablesSection({
    rows: apRows,
    filters: apPortfolioFilters,
    referenceDate,
    syncCutoff: apSyncCutoff,
    year: filters.year,
    month: highlightMonth,
  });

  console.log(
    `Auditoria Contas a Pagar — year=${year} month=${month} asOfDate=${asOfDate}\n`
  );

  printSection("Tela oficial Contas a Pagar:", [
    { label: "Total a pagar", value: officialAp.cards.totalPayableAmount },
    { label: "Pago no mês", value: officialAp.cards.paidThisMonthAmount },
    { label: "Em aberto", value: officialAp.cards.totalOpenAmount },
    { label: "Vencido gerencial", value: officialAp.cards.overdueAmount },
    { label: "Vence hoje", value: officialAp.cards.dueTodayAmount },
    { label: "Próx. 7 dias", value: officialAp.cards.dueNext7DaysAmount },
    { label: "Próx. 30 dias", value: officialAp.cards.dueNext30DaysAmount },
    {
      label: "Agendados",
      value: officialAp.purchaseOrderScheduleAudit.rescheduledOpenAmount,
    },
  ]);

  printSection("Relatório Executivo:", [
    { label: "Total a pagar", value: reportAp.kpis.totalPayableAmount },
    { label: "Pago no mês", value: reportAp.kpis.paidThisMonthAmount },
    { label: "Em aberto", value: reportAp.kpis.openAmount },
    { label: "Vencido gerencial", value: reportAp.kpis.overdueAmount },
    { label: "Vence hoje", value: reportAp.kpis.dueTodayAmount },
    { label: "Próx. 7 dias", value: reportAp.kpis.dueNext7DaysAmount },
    { label: "Próx. 30 dias", value: reportAp.kpis.dueNext30DaysAmount },
    { label: "Agendados", value: reportAp.kpis.scheduledOpenAmount },
  ]);

  compareFields([
    {
      label: "Total a pagar",
      official: officialAp.cards.totalPayableAmount,
      report: reportAp.kpis.totalPayableAmount,
    },
    {
      label: "Pago no mês",
      official: officialAp.cards.paidThisMonthAmount,
      report: reportAp.kpis.paidThisMonthAmount,
    },
    {
      label: "Em aberto",
      official: officialAp.cards.totalOpenAmount,
      report: reportAp.kpis.openAmount,
    },
    {
      label: "Vencido gerencial",
      official: officialAp.cards.overdueAmount,
      report: reportAp.kpis.overdueAmount,
    },
    {
      label: "Vence hoje",
      official: officialAp.cards.dueTodayAmount,
      report: reportAp.kpis.dueTodayAmount,
    },
    {
      label: "Próx. 7 dias",
      official: officialAp.cards.dueNext7DaysAmount,
      report: reportAp.kpis.dueNext7DaysAmount,
    },
    {
      label: "Próx. 30 dias",
      official: officialAp.cards.dueNext30DaysAmount,
      report: reportAp.kpis.dueNext30DaysAmount,
    },
    {
      label: "Agendados",
      official: officialAp.purchaseOrderScheduleAudit.rescheduledOpenAmount,
      report: reportAp.kpis.scheduledOpenAmount,
    },
  ]);

  await prisma.$disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
