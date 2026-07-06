#!/usr/bin/env npx tsx
/**
 * Auditoria read-only do motor oficial de fornecedores (Centro de Custo).
 *
 * Uso:
 *   npx tsx scripts/audit-finance-supplier-engine-coverage.ts
 *   npx tsx scripts/audit-finance-supplier-engine-coverage.ts --year=2026 --month=6
 */
import { prisma } from "../src/lib/prisma.js";
import {
  buildFinanceCostCenterDashboard,
  createDefaultFinanceCostCenterDashboardDeps,
  parseFinanceCostCenterDashboardFilters,
} from "../src/lib/financeCostCenterDashboard.js";
import { listUnclassifiedAccountsPayableDefault } from "../src/lib/financeAccountsPayableCostCenterAllocation.js";
import { stripCostCenterDashboardPeriodFilters } from "../src/lib/financeCostCenterSupplierConsolidation.js";
import { buildFinanceApPrismaWhere } from "../src/lib/financeAccountsPayableDashboard.js";
import { resolveOpenOnlyFromApStatus } from "../src/lib/financeCostCenterAllocationMetrics.js";
import { resolveNomusApReportSyncCutoffFromPrisma } from "../src/lib/financeNomusApReportFreshness.js";
import { groupUnclassifiedPayablesBySupplier } from "../src/lib/financeUnclassifiedPayablesGrouping.js";
import { buildOfficialSupplierEngineAuditSnapshot } from "../src/lib/financeSupplierEngine.js";

function parseArg(name: string): string | undefined {
  const prefix = `--${name}=`;
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith(prefix)) return arg.slice(prefix.length);
  }
  return undefined;
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
  const grouped = groupUnclassifiedPayablesBySupplier(unclassified.items);

  const snapshot = await buildOfficialSupplierEngineAuditSnapshot({
    dashboardSupplierNames: dashboard.bySupplier.map((row) => row.name),
    unclassifiedSupplierNames: grouped.map((row) => ({
      name: row.name,
      cause: row.cause,
    })),
  });

  console.log("=== Auditoria motor oficial de fornecedores ===");
  console.log(JSON.stringify(snapshot, null, 2));

  if (snapshot.missingFromSearch.length > 0) {
    console.error("\nFornecedores na aba Fornecedores ausentes na busca oficial (amostra):");
    for (const row of snapshot.missingFromSearch.slice(0, 10)) {
      console.error(`  - ${row.name} (${row.identityKey})`);
    }
    process.exitCode = 1;
  }

  if (snapshot.unclassifiedNotSearchable.length > 0) {
    console.warn("\nFornecedores em títulos sem classificação não encontrados na busca (amostra):");
    for (const row of snapshot.unclassifiedNotSearchable.slice(0, 10)) {
      console.warn(`  - ${row.name} [${row.cause ?? "—"}]`);
    }
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
