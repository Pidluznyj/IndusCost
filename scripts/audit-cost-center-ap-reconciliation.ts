#!/usr/bin/env npx tsx
/**
 * Reconcilia métricas financeiras AP entre Contas a Pagar e Centro de Custo.
 *
 * Uso:
 *   npx tsx scripts/audit-cost-center-ap-reconciliation.ts --year=2026 --month=6 --asOfDate=2026-06-29
 */
import { prisma } from "../src/lib/prisma.js";
import {
  buildFinanceApPrismaWhere,
  mapPrismaRowToFinanceApDashboardRow,
  parseFinanceApDashboardFilters,
} from "../src/lib/financeAccountsPayableDashboard.js";
import { FINANCE_AP_TITLE_SELECT } from "../src/lib/financeAccountsPayableTitles.js";
import {
  OFFICIAL_AP_RULES_SOURCE,
  resolveOfficialApPortfolioFinancialMetrics,
} from "../src/lib/financeAccountsPayableRulesAdapter.js";
import {
  buildFinanceCostCenterDashboard,
  parseFinanceCostCenterDashboardFilters,
} from "../src/lib/financeCostCenterDashboard.js";
import { resolveNomusApReportSyncCutoffFromPrisma } from "../src/lib/financeNomusApReportFreshness.js";

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

function nearlyEqual(a: number, b: number, epsilon = 0.01): boolean {
  return Math.abs(a - b) <= epsilon;
}

async function main() {
  const year = Number(parseArg("year") ?? "2026");
  const month = Number(parseArg("month") ?? "6");
  const asOfDate = parseArg("asOfDate") ?? "2026-06-29";
  const referenceDate = new Date(`${asOfDate}T12:00:00.000Z`);

  const apQuery = { year, month, status: "all" };
  const ccQuery = { year, month, status: "all", classification: "all" };
  const apFilters = parseFinanceApDashboardFilters(apQuery);
  const ccFilters = parseFinanceCostCenterDashboardFilters(ccQuery);

  const syncCutoff = await resolveNomusApReportSyncCutoffFromPrisma(prisma);
  const where = buildFinanceApPrismaWhere(apFilters, syncCutoff);
  const prismaRows =
    where.externalId === -1
      ? []
      : await prisma.nomusAccountsPayable.findMany({
          where,
          select: FINANCE_AP_TITLE_SELECT,
          orderBy: { dueDate: "asc" },
        });
  const rows = prismaRows.map(mapPrismaRowToFinanceApDashboardRow);

  const official = resolveOfficialApPortfolioFinancialMetrics({
    rows,
    filters: apFilters,
    referenceDate,
    syncCutoff,
  });

  const externalIds = rows.map((row) => row.externalId);
  const allocations =
    externalIds.length === 0
      ? []
      : await prisma.accountsPayableCostCenterAllocation.findMany({
          where: { accountsPayableId: { in: externalIds } },
          select: {
            id: true,
            accountsPayableId: true,
            supplierId: true,
            costCenterId: true,
            amount: true,
            percentage: true,
          },
        });
  const costCenters = await prisma.financialCostCenter.findMany({
    select: { id: true, code: true, name: true, status: true },
  });
  const suppliers = await prisma.financialSupplier.findMany({
    select: {
      id: true,
      displayName: true,
      status: true,
      normalizedDocument: true,
      normalizedName: true,
      aliases: {
        select: {
          externalSupplierId: true,
          normalizedDocument: true,
          normalizedName: true,
        },
      },
    },
  });
  const rules = await prisma.supplierCostCenterRule.findMany({
    where: { isActive: true },
    select: { supplierId: true },
    distinct: ["supplierId"],
  });
  const supplierIdsWithRules = new Set(rules.map((row) => row.supplierId));

  const ccDashboard = buildFinanceCostCenterDashboard(
    rows,
    allocations,
    costCenters,
    suppliers,
    supplierIdsWithRules,
    ccFilters,
    referenceDate,
    syncCutoff,
    rows,
    official
  );

  const diag = ccDashboard.audit.diagnostics;
  const summary = ccDashboard.summary;

  console.log("=== Reconciliação AP × Centro de Custo ===");
  console.log(`Filtros AP: year=${year} month=${month} status=all`);
  console.log(`Fonte oficial: ${OFFICIAL_AP_RULES_SOURCE}`);
  console.log(`Títulos no período: ${rows.length}`);
  console.log("");
  console.log("| Métrica | AP oficial | Centro de Custo | Δ | Status |");
  console.log("| --- | ---: | ---: | ---: | --- |");

  const lines: Array<[string, number, number]> = [
    ["Total a pagar / Total AP no filtro", official.totalPayable, summary.totalAmount],
    ["Em aberto", official.openAmount, summary.openAmount],
    ["Vencido gerencial", official.overdueAmount, summary.overdueAmount],
    ["Pago no mês / Pago liquidado", official.paidThisMonth, summary.paidAmount],
    [
      "Classificado + sem classificação (CC)",
      summary.classifiedAmount + summary.unclassifiedAmount,
      summary.totalAmount,
    ],
  ];

  let failures = 0;
  for (const [label, apVal, ccVal] of lines) {
    const delta = Math.round((apVal - ccVal) * 100) / 100;
    const ok =
      label.startsWith("Classificado") ||
      nearlyEqual(apVal, ccVal);
    if (!ok) failures += 1;
    console.log(
      `| ${label} | ${fmt(apVal)} | ${fmt(ccVal)} | ${fmt(delta)} | ${ok ? "OK" : "DIVERGENTE"} |`
    );
  }

  console.log("");
  console.log(`Total classificado (CC): ${fmt(summary.classifiedAmount)}`);
  console.log(`Total sem classificação (CC): ${fmt(summary.unclassifiedAmount)}`);
  console.log(`Partição CC (classificado + gap): ${fmt(diag.partitionTotal)}`);
  console.log(`Base CC (soma amountPayable): ${fmt(diag.totalAmountBase)}`);
  console.log(`Δ partição vs AP oficial: ${fmt(diag.reconciliationDelta)}`);

  const ccIds = new Set(
    ccDashboard.audit.titlesConsidered > 0
      ? rows.map((row) => row.externalId)
      : []
  );
  void ccIds;

  if (failures > 0 || Math.abs(diag.reconciliationDelta) > 0.01) {
    console.log("\nResultado: DIVERGÊNCIAS encontradas — revisar alocações ou filtros.");
    process.exitCode = 1;
  } else {
    console.log("\nResultado: OK — métricas financeiras reconciliadas.");
  }
}

main()
  .catch((error) => {
    console.error("Falha na reconciliação AP × Centro de Custo:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
