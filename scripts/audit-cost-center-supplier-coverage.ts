#!/usr/bin/env npx tsx
/**
 * Reconcilia cobertura de fornecedores consolidados vs títulos sem classificação (Centro de Custo).
 *
 * Uso:
 *   npx tsx scripts/audit-cost-center-supplier-coverage.ts
 *   npx tsx scripts/audit-cost-center-supplier-coverage.ts --status=all
 */
import { prisma } from "../src/lib/prisma.js";
import {
  buildFinanceCostCenterDashboard,
  createDefaultFinanceCostCenterDashboardDeps,
  parseFinanceCostCenterDashboardFilters,
} from "../src/lib/financeCostCenterDashboard.js";
import {
  listUnclassifiedAccountsPayableDefault,
  resolveSupplierForAccountsPayable,
} from "../src/lib/financeAccountsPayableCostCenterAllocation.js";
import {
  resolveCostCenterSupplierDisplay,
  stripCostCenterDashboardPeriodFilters,
} from "../src/lib/financeCostCenterSupplierConsolidation.js";
import { buildFinanceApPrismaWhere } from "../src/lib/financeAccountsPayableDashboard.js";
import { resolveOpenOnlyFromApStatus } from "../src/lib/financeCostCenterAllocationMetrics.js";
import { resolveNomusApReportSyncCutoffFromPrisma } from "../src/lib/financeNomusApReportFreshness.js";
import { groupUnclassifiedPayablesBySupplier } from "../src/lib/financeUnclassifiedPayablesGrouping.js";
import { searchOfficialFinancialSuppliersDefault } from "../src/lib/financeSupplierEngine.js";

function parseArg(name: string): string | undefined {
  const prefix = `--${name}=`;
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith(prefix)) return arg.slice(prefix.length);
  }
  return undefined;
}

function fmt(n: number): string {
  return Number.isFinite(n) ? n.toFixed(2) : "—";
}

async function main() {
  const status = parseArg("status") ?? "all";
  const filters = parseFinanceCostCenterDashboardFilters({ status });
  const syncCutoff = await resolveNomusApReportSyncCutoffFromPrisma(prisma);
  const deps = createDefaultFinanceCostCenterDashboardDeps();
  const where = buildFinanceApPrismaWhere(filters, syncCutoff);
  const supplierWhere = buildFinanceApPrismaWhere(
    stripCostCenterDashboardPeriodFilters(filters),
    syncCutoff
  );

  const rows = where.externalId === -1 ? [] : await deps.loadApRows(where);
  const supplierScopeSourceRows =
    supplierWhere.externalId === -1 ? [] : await deps.loadApRows(supplierWhere);
  const allocationIds = [
    ...new Set([...rows, ...supplierScopeSourceRows].map((row) => row.externalId)),
  ];
  const allocations = await deps.loadAllocations(allocationIds);
  const costCenters = await deps.loadCostCenters();
  const suppliers = await deps.loadSuppliers();
  const supplierIdsWithRules = new Set(
    (await deps.loadSupplierIdsWithActiveRules()).map((row) => row.supplierId)
  );

  const dashboard = buildFinanceCostCenterDashboard(
    rows,
    allocations,
    costCenters,
    suppliers,
    supplierIdsWithRules,
    filters,
    new Date(),
    syncCutoff,
    supplierScopeSourceRows
  );

  const unclassified = await listUnclassifiedAccountsPayableDefault({
    openOnly: resolveOpenOnlyFromApStatus(status),
  });

  const suppliersFromUnclassified = groupUnclassifiedPayablesBySupplier(unclassified.items);
  const missing: Array<{
    name: string;
    titlesCount: number;
    amount: number;
    supplierId: string | null;
  }> = [];

  for (const grouped of suppliersFromUnclassified) {
    const sampleItem = unclassified.items.find(
      (item) => (item.personName ?? `Título ${item.externalId}`) === grouped.name
    );
    if (!sampleItem) continue;

    const apRow = supplierScopeSourceRows.find((row) => row.externalId === sampleItem.externalId);
    const supplier = apRow
      ? resolveSupplierForAccountsPayable(
          {
            externalId: apRow.externalId,
            personId: null,
            personName: apRow.personName,
            personCnpj: apRow.personCnpj,
            companyId: null,
            companyName: apRow.companyName,
            classification: null,
            description: apRow.description,
            comments: null,
            documentNumber: apRow.documentNumber,
            status: apRow.nomusStatus,
            rawPayload: null,
            balancePayable: apRow.balancePayable,
            amountPayable: apRow.amountPayable,
            suspendPayment: apRow.suspendPayment,
            competenceDate: null,
            dueDate: apRow.dueDate,
          },
          suppliers
        )
      : null;

    const inDashboard = dashboard.bySupplier.some((row) => {
      if (grouped.supplierId && row.supplierId === grouped.supplierId) return true;
      if (apRow) {
        const display = resolveCostCenterSupplierDisplay(apRow, supplier);
        return row.name === display.name;
      }
      return row.name === grouped.name;
    });

    if (!inDashboard) {
      missing.push({
        name: grouped.name,
        titlesCount: grouped.titlesCount,
        amount: grouped.amount,
        supplierId: grouped.supplierId,
      });
    }
  }

  console.log("=== Auditoria: Cobertura Fornecedores × Títulos sem Classificação ===");
  console.log(`Status AP: ${status}`);
  console.log(`Fornecedores consolidados (aba Fornecedores): ${dashboard.bySupplier.length}`);
  console.log(`Fornecedores em títulos sem classificação: ${suppliersFromUnclassified.length}`);
  console.log(`Títulos sem classificação: ${unclassified.items.length}`);
  console.log(`Fornecedores ausentes na aba Fornecedores: ${missing.length}`);

  if (missing.length > 0) {
    console.log("\nTop exemplos ausentes:");
    for (const row of missing.slice(0, 10)) {
      console.log(
        `- ${row.name} | títulos=${row.titlesCount} | valor=${fmt(row.amount)} | supplierId=${row.supplierId ?? "—"}`
      );
    }
    process.exitCode = 1;
  } else {
    console.log("\nOK: todos os fornecedores de títulos sem classificação aparecem na aba Fornecedores.");
  }

  let searchGaps = 0;
  for (const row of dashboard.bySupplier.slice(0, 50)) {
    const term = row.name.trim().slice(0, Math.min(6, row.name.trim().length));
    if (term.length < 2) continue;
    const { suppliers } = await searchOfficialFinancialSuppliersDefault({ search: term, limit: 30 });
    const hit = suppliers.some((s) => s.name.toLowerCase().includes(term.toLowerCase()));
    if (!hit) {
      searchGaps += 1;
      console.warn(`Busca oficial não encontrou: ${row.name} (termo "${term}")`);
    }
  }
  console.log(`\nMotor oficial — amostra aba vs busca: ${searchGaps} divergência(s) em ${Math.min(50, dashboard.bySupplier.length)} fornecedores.`);
  if (searchGaps > 0) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error("Falha na auditoria de cobertura de fornecedores:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
