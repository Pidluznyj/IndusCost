#!/usr/bin/env npx tsx
/**
 * Valida série "Gastos por Centro de Custo" vs dashboard gerencial oficial.
 *
 * Uso:
 *   npx tsx scripts/audit-cost-center-annual-spending-chart.ts --year=2026 --asOfDate=2026-06-29
 *   npx tsx scripts/audit-cost-center-annual-spending-chart.ts --year=2026 --month=6 --asOfDate=2026-06-29
 */
import { prisma } from "../src/lib/prisma.js";
import {
  buildFinanceCostCenterDashboardDefault,
  parseFinanceCostCenterDashboardFilters,
} from "../src/lib/financeCostCenterDashboard.js";
import { buildCostCenterAnnualSpendingChart } from "../src/lib/financeCostCenterAnnualSpendingChart.js";

function parseArg(name: string): string | undefined {
  const prefix = `--${name}=`;
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith(prefix)) return arg.slice(prefix.length);
  }
  return undefined;
}

function fmt(n: unknown): string {
  if (n == null) return "—";
  if (typeof n === "number" && Number.isFinite(n)) return n.toFixed(2);
  return "INVÁLIDO";
}

function nearlyEqual(a: number, b: number, epsilon = 0.02): boolean {
  return Math.abs(a - b) <= epsilon;
}

async function main() {
  const year = Number(parseArg("year") ?? "2026");
  const monthRaw = parseArg("month");
  const month = monthRaw != null && monthRaw !== "" ? Number(monthRaw) : undefined;
  const asOfDate = parseArg("asOfDate") ?? "2026-06-29";
  const referenceDate = new Date(`${asOfDate}T12:00:00.000Z`);

  const query: Record<string, unknown> = { year, status: "all", classification: "all" };
  if (month != null && Number.isFinite(month)) query.month = month;

  const filters = parseFinanceCostCenterDashboardFilters(query);
  const dashboard = await buildFinanceCostCenterDashboardDefault(filters, referenceDate);
  const chart = dashboard.annualSpendingChart;

  const sumRows = chart.rows.reduce((sum, row) => sum + row.totalAmount, 0);
  const sumByCostCenter = dashboard.byCostCenter.reduce((sum, row) => sum + row.amount, 0);
  const sumDisplay = chart.displayRows.reduce((sum, row) => sum + row.totalAmount, 0);
  const deltaVsByCc = Math.round((sumRows - sumByCostCenter) * 100) / 100;
  const deltaVsClassified = Math.round((sumRows - dashboard.summary.classifiedAmount) * 100) / 100;

  console.log(`Auditoria gráfico gastos por CC — year=${year} month=${month ?? "Todos"} asOfDate=${asOfDate}\n`);
  console.log("### Filtros");
  console.log(JSON.stringify(chart.filtersApplied, null, 2));
  console.log(`\n### Escopo`);
  console.log(`- periodScope: ${chart.periodScope}`);
  console.log(`- title: ${chart.title}`);
  console.log(`- metricsSource: ${chart.metricsSource}`);
  console.log(`- officialApSource: ${chart.officialApSource}`);

  console.log("\n### Totais");
  console.log(`- totalAmount (gráfico): ${fmt(chart.totalAmount)}`);
  console.log(`- soma rows: ${fmt(sumRows)}`);
  console.log(`- soma displayRows: ${fmt(sumDisplay)}`);
  console.log(`- soma byCostCenter (dashboard): ${fmt(sumByCostCenter)}`);
  console.log(`- classifiedAmount (summary): ${fmt(dashboard.summary.classifiedAmount)}`);
  console.log(`- delta rows vs byCostCenter: ${fmt(deltaVsByCc)}`);
  console.log(`- delta rows vs classifiedAmount: ${fmt(deltaVsClassified)}`);
  console.log(`- costCentersCount: ${chart.costCentersCount}`);

  console.log("\n### Top centros");
  for (const row of chart.rows.slice(0, 10)) {
    console.log(
      `- #${row.rank} ${row.displayName}: ${fmt(row.totalAmount)} (${fmt(row.percentageOfTotal)}%)`
    );
  }

  if (chart.othersIncludedCount > 0) {
    console.log("\n### Bucket Outros (display)");
    console.log(`- centros agrupados: ${chart.othersIncludedCount}`);
    console.log(`- valor Outros: ${fmt(chart.othersAmount)}`);
  }

  const okByCc = nearlyEqual(sumRows, sumByCostCenter);
  const okDisplay = nearlyEqual(sumDisplay, chart.totalAmount);
  console.log("\n### Resultado");
  console.log(`- bate com byCostCenter: ${okByCc ? "OK" : "FALHA"}`);
  console.log(`- displayRows bate total: ${okDisplay ? "OK" : "FALHA"}`);

  if (!okByCc || !okDisplay) {
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
