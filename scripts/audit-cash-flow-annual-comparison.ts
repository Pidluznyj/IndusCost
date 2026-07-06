#!/usr/bin/env npx tsx
/**
 * Audita equivalência entre Fluxo anual e Fluxo de caixa planejado (mesmo ano).
 *
 * Uso:
 *   npx tsx scripts/audit-cash-flow-annual-comparison.ts --year=2026
 */
import { prisma } from "../src/lib/prisma.js";
import {
  buildCashFlowAnnualComparison,
  createAnnualComparisonBaseFilters,
} from "../src/lib/financeCashFlowAnnualComparison.js";
import { loadAnnualComparisonPortfolioRows } from "../src/lib/financeExecutiveReportAnnualLoad.js";
import { buildFinanceCashFlowDashboard } from "../src/lib/financeCashFlowDashboard.js";
import { buildExecutiveMonthlyPlannedChartRows } from "../src/lib/financeCashFlowExecutiveChart.js";
import { formatFinanceCurrency } from "../src/lib/financeAccountsReceivableFormat.js";

function parseArg(name: string): string | undefined {
  const prefix = `--${name}=`;
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith(prefix)) return arg.slice(prefix.length);
  }
  return undefined;
}

function fmt(value: number): string {
  return formatFinanceCurrency(value);
}

async function main() {
  const year = Number(parseArg("year") ?? "2026");
  const referenceDate = new Date();

  const portfolio = await loadAnnualComparisonPortfolioRows(prisma, referenceDate);
  const annual = buildCashFlowAnnualComparison(
    portfolio.arRows,
    portfolio.apRows,
    year,
    referenceDate,
    portfolio.arSyncCutoff,
    portfolio.apSyncCutoff
  );

  const dashboard = buildFinanceCashFlowDashboard(
    portfolio.arRows,
    portfolio.apRows,
    { ...createAnnualComparisonBaseFilters(), year },
    referenceDate,
    portfolio.arSyncCutoff,
    portfolio.apSyncCutoff
  );
  const planned = buildExecutiveMonthlyPlannedChartRows(
    dashboard.executiveSummary.monthlyTimeline
  );

  console.log(`Auditoria Fluxo anual vs planejado — ${year}`);
  console.log(`Fonte anual: ${annual.source}`);
  console.log("");

  let maxDiff = 0;

  for (let i = 0; i < 12; i += 1) {
    const month = annual.months[i]!;
    const plan = planned[i]!;
    const diff = Math.round((month.netCashAmount - plan.netBalance) * 100) / 100;
    maxDiff = Math.max(maxDiff, Math.abs(diff));

    const label = month.monthLabel;
    console.log(`${label.charAt(0).toUpperCase()}${label.slice(1)}:`);
    console.log(`  Entradas: ${fmt(month.cashInTotalAmount)} (planejado: ${fmt(plan.estimatedInflow)})`);
    console.log(`  Saídas: ${fmt(month.cashOutTotalAmount)} (planejado: ${fmt(plan.estimatedOutflow)})`);
    console.log(`  Saldo novo: ${fmt(month.netCashAmount)}`);
    console.log(`  Saldo planejado: ${fmt(plan.netBalance)}`);
    console.log(`  Diferença: ${fmt(diff)}`);
    console.log("");
  }

  console.log(`Máxima diferença absoluta de saldo: ${fmt(maxDiff)}`);
  if (maxDiff > 0.01) {
    console.error("FALHA: diferença acima de 1 centavo.");
    process.exitCode = 1;
  } else {
    console.log("OK: todas as diferenças são zero ou centavos por arredondamento.");
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
