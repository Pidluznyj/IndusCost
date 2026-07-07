#!/usr/bin/env npx tsx
/**
 * Auditoria: composição mensal do saldo AP "A pagar restante no ano" vs Saídas do período.
 *
 * Uso:
 *   npx tsx scripts/audit-cash-flow-ap-forward-breakdown.ts --year=2026 --month=9
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
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
} from "../src/lib/financeCashFlowDashboard.js";
import {
  buildCashFlowApPrismaWhere,
  buildCashFlowArPrismaWhere,
} from "../src/lib/financeCashFlowRowFilters.js";
import { resolveNomusApReportSyncCutoffFromPrisma } from "../src/lib/financeNomusApReportFreshness.js";
import { resolveNomusArReportSyncCutoffFromPrisma } from "../src/lib/financeNomusArReportFreshness.js";

const prisma = new PrismaClient();

function parseArg(name: string): string | null {
  const prefix = `--${name}=`;
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith(prefix)) return arg.slice(prefix.length).trim() || null;
  }
  return null;
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

async function main(): Promise<void> {
  const year = Number.parseInt(parseArg("year") ?? String(new Date().getFullYear()), 10);
  const monthRaw = parseArg("month");
  const asOfDate = parseArg("asOfDate");
  const referenceDate = asOfDate ? new Date(`${asOfDate}T23:59:59`) : new Date();
  const query: Record<string, string> = { year: String(year) };
  if (monthRaw != null) query.month = monthRaw;
  if (asOfDate != null) query.asOfDate = asOfDate;

  const filters = resolveFinanceCashFlowFiltersForLoad(
    query,
    parseFinanceCashFlowDashboardFilters(query),
    referenceDate
  );

  const load = await loadCashFlowRows(filters, referenceDate);
  const payload = buildFinanceCashFlowDashboard(
    load.arRows,
    load.apRows,
    filters,
    referenceDate,
    load.arSyncCutoff,
    load.apSyncCutoff
  );
  const { payable, period } = payload.executiveSummary;

  const forwardMonths = payable.openForwardByMonth.filter(
    (row) => row.includedInForwardRange && row.openAmount > 0
  );

  console.log(
    JSON.stringify(
      {
        year,
        month: filters.month ?? null,
        referenceDate: referenceDate.toISOString(),
        forwardRangeLabel: payload.executiveSummary.metadata.forwardRangeLabel,
        annualScopeIgnoresMonthFilter:
          payload.executiveSummary.metadata.annualScopeIgnoresMonthFilter,
        openFromTodayToYearEnd: payable.openFromTodayToYearEnd,
        periodOutflowAmount: period.outflowAmount,
        gap: payable.openFromTodayToYearEnd - period.outflowAmount,
        forwardMonths,
        forwardBreakdownTotal: forwardMonths.reduce((sum, row) => sum + row.openAmount, 0),
        periodVsForward: payable.periodVsForward,
      },
      null,
      2
    )
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
