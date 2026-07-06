#!/usr/bin/env npx tsx
/**
 * Auditoria drilldown Pagamentos por Fornecedor (Centro de Custo).
 *
 * Uso:
 *   npx tsx scripts/audit-cost-center-supplier-payment-drilldown.ts --year=2026 --month=6 --asOfDate=2026-06-29
 *   npx tsx scripts/audit-cost-center-supplier-payment-drilldown.ts --year=2026 --month=6 --supplierId=... --asOfDate=2026-06-29
 */
import { prisma } from "../src/lib/prisma.js";
import { parseFinanceCostCenterDashboardFilters } from "../src/lib/financeCostCenterDashboard.js";
import {
  buildCostCenterSupplierPaymentSummary,
  buildCostCenterSupplierPaymentTitles,
  buildCostCenterSupplierPaymentYears,
  loadCostCenterSupplierPaymentContext,
  resolveSupplierPaymentPeriodBounds,
} from "../src/lib/financeCostCenterSupplierPaymentDrilldown.js";
import { sumOfficialApPaidInPaymentPeriod } from "../src/lib/financeAccountsPayableRulesAdapter.js";
import { toApPortfolioFiltersFromCostCenter } from "../src/lib/financeCostCenterDashboard.js";

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

type AuditStatus = "OK" | "ALERTA" | "BLOQUEANTE";

function mainStatus(items: AuditStatus[]): AuditStatus {
  if (items.includes("BLOQUEANTE")) return "BLOQUEANTE";
  if (items.includes("ALERTA")) return "ALERTA";
  return "OK";
}

async function main() {
  const year = Number(parseArg("year") ?? "2026");
  const monthRaw = parseArg("month");
  const month = monthRaw != null && monthRaw !== "" ? Number(monthRaw) : undefined;
  const supplierId = parseArg("supplierId");
  const asOfDate = parseArg("asOfDate") ?? "2026-06-29";
  const referenceDate = new Date(`${asOfDate}T12:00:00.000Z`);

  const query: Record<string, unknown> = { year, status: "all", classification: "all" };
  if (month != null && Number.isFinite(month)) query.month = month;
  if (supplierId) query.supplierId = supplierId;

  const filters = parseFinanceCostCenterDashboardFilters(query);
  const ctx = await loadCostCenterSupplierPaymentContext(filters, referenceDate);
  const summary = buildCostCenterSupplierPaymentSummary(ctx);

  const sumCards = summary.supplierPaymentSummary.reduce((sum, row) => sum + row.totalPaidAmount, 0);
  const { periodStart, periodEnd } = resolveSupplierPaymentPeriodBounds(filters, referenceDate);
  const apFilters = toApPortfolioFiltersFromCostCenter(filters);
  const officialPaidTotal = sumOfficialApPaidInPaymentPeriod(
    ctx.rows,
    apFilters,
    referenceDate,
    null,
    periodStart,
    periodEnd
  );

  const statuses: AuditStatus[] = [];
  const notes: string[] = [];

  if (!nearlyEqual(sumCards, summary.totalPaidAmountAllSuppliers)) {
    statuses.push("BLOQUEANTE");
    notes.push("Soma dos cards difere de totalPaidAmountAllSuppliers.");
  }

  const deltaOfficial = Math.abs(sumCards - officialPaidTotal);
  if (deltaOfficial > 0.02) {
    statuses.push("ALERTA");
    notes.push(
      `Total cards (${fmt(sumCards)}) difere do AP oficial no período (${fmt(officialPaidTotal)}) — esperado quando filtros de centro/classificação restringem o escopo.`
    );
  } else {
    statuses.push("OK");
  }

  for (const row of summary.supplierPaymentSummary) {
    if (!row.supplierDisplayName?.trim()) {
      statuses.push("BLOQUEANTE");
      notes.push(`Fornecedor ${row.supplierKey} sem supplierDisplayName.`);
    }
    if (row.supplierDisplayName.startsWith("fs:") || row.supplierDisplayName.startsWith("CC_")) {
      statuses.push("ALERTA");
      notes.push(`Label técnico em ${row.supplierDisplayName}.`);
    }
  }

  console.log(
    `Auditoria pagamentos por fornecedor — year=${year} month=${month ?? "Todos"} asOfDate=${asOfDate}\n`
  );
  console.log("### Resumo");
  console.log(`- periodLabel: ${summary.periodLabel}`);
  console.log(`- suppliersCount: ${summary.suppliersCount}`);
  console.log(`- totalPaidAmountAllSuppliers: ${fmt(summary.totalPaidAmountAllSuppliers)}`);
  console.log(`- soma cards: ${fmt(sumCards)}`);
  console.log(`- AP oficial pago no período (sem filtros CC): ${fmt(officialPaidTotal)}`);
  console.log(`- metricsSource: ${summary.metricsSource}`);

  console.log("\n### Top fornecedores");
  for (const row of summary.supplierPaymentSummary.slice(0, 10)) {
    console.log(
      `- ${row.supplierDisplayName} (${row.supplierDocument ?? "sem doc"}): ${fmt(row.totalPaidAmount)} · ${row.paidTitlesCount} título(s)`
    );
  }

  const sample = summary.supplierPaymentSummary[0];
  if (sample) {
    console.log("\n### Drilldown amostra");
    const years = buildCostCenterSupplierPaymentYears(ctx, sample.supplierKey, sample.supplierDisplayName);
    console.log(`- fornecedor: ${sample.supplierDisplayName}`);
    console.log(`- anos: ${years.years.map((y) => `${y.year}=${fmt(y.totalPaidAmount)}`).join(", ") || "—"}`);
    const yearRow = years.years[0];
    if (yearRow) {
      const titles = buildCostCenterSupplierPaymentTitles(
        ctx,
        sample.supplierKey,
        sample.supplierDisplayName,
        yearRow.year
      );
      const sumTitles = titles.items.reduce((sum, item) => sum + item.paidAmount, 0);
      const okYear = nearlyEqual(sumTitles, yearRow.totalPaidAmount, 0.05);
      console.log(`- ano ${yearRow.year}: card=${fmt(yearRow.totalPaidAmount)} grid(page1)=${fmt(sumTitles)}`);
      if (!okYear && titles.totalPages === 1) {
        statuses.push("BLOQUEANTE");
        notes.push(`Grid anual ${yearRow.year} não bate com card do ano.`);
      } else {
        statuses.push("OK");
      }
    }
  }

  if (notes.length > 0) {
    console.log("\n### Observações");
    for (const note of notes) console.log(`- ${note}`);
  }

  const result = mainStatus(statuses);
  console.log(`\n### Resultado: ${result}`);
  if (result === "BLOQUEANTE") process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
