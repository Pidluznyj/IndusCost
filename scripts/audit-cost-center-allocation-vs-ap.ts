#!/usr/bin/env npx tsx
/**
 * Auditoria: alocações de centro de custo vs títulos AP atuais (Nomus).
 *
 * Uso:
 *   npx tsx scripts/audit-cost-center-allocation-vs-ap.ts --cost-center-code=CC_ADMINISTRATIVO_INVESTIMENTO_SOCIOS --json
 *   npx tsx scripts/audit-cost-center-allocation-vs-ap.ts --cost-center-code=CC_ADMINISTRATIVO_INVESTIMENTO_SOCIOS --csv
 */
import "dotenv/config";
import { writeFileSync } from "node:fs";
import {
  mapPrismaRowToFinanceApDashboardRow,
  parseFinanceApDashboardFilters,
} from "../src/lib/financeAccountsPayableDashboard.ts";
import { FINANCE_AP_TITLE_SELECT } from "../src/lib/financeAccountsPayableTitles.ts";
import {
  buildCostCenterAllocationVsApAuditReport,
} from "../src/lib/financeCostCenterExpenseDetail.ts";
import {
  buildCostCenterExpenseDetailSnapshot,
  loadCostCenterDetailEntries,
  loadCostCenterDetailOrphanAllocations,
  parseCostCenterDetailListQuery,
} from "../src/lib/financeCostCenterDetail.ts";
import {
  resolveCostCenterTitleAmount,
  resolveCappedCostCenterAllocationAmount,
  resolveCostCenterApScopeFromStatus,
} from "../src/lib/financeCostCenterAllocationMetrics.ts";
import { prisma } from "../src/lib/prisma.ts";
import {
  formatCliMoney,
  parseFlag,
  parseStringArg,
  requireDatabaseUrl,
} from "../src/lib/financeCostCenterScriptsCli.ts";

const LOG_PREFIX = "[audit-cost-center-allocation-vs-ap]";

async function main(): Promise<void> {
  requireDatabaseUrl(LOG_PREFIX);

  const costCenterCode = parseStringArg(process.argv, "cost-center-code");
  if (!costCenterCode) {
    throw new Error("Informe --cost-center-code=CODIGO_DO_CENTRO");
  }

  const yearRaw = parseStringArg(process.argv, "year");
  const monthRaw = parseStringArg(process.argv, "month");
  const supplier = parseStringArg(process.argv, "supplier");
  const asJson = parseFlag(process.argv, "json");
  const asCsv = parseFlag(process.argv, "csv");

  const center = await prisma.financialCostCenter.findUnique({
    where: { code: costCenterCode },
    select: { id: true, code: true, name: true },
  });
  if (!center) {
    throw new Error(`Centro de custo não encontrado: ${costCenterCode}`);
  }

  const query: Record<string, unknown> = { status: "all" };
  if (yearRaw) query.year = yearRaw;
  if (monthRaw) query.month = monthRaw;
  if (supplier) query.search = supplier;

  const filters = parseCostCenterDetailListQuery(query);
  const entries = await loadCostCenterDetailEntries(center.id);
  const orphanAllocations = await loadCostCenterDetailOrphanAllocations(center.id);
  const snapshot = buildCostCenterExpenseDetailSnapshot({
    entries,
    filters,
    referenceDate: new Date(),
  });

  const apScope = resolveCostCenterApScopeFromStatus(filters.status);
  const rawLinesByAllocationId = new Map<string, { raw: number; titleAmount: number }>();
  for (const entry of entries) {
    const titleAmount = resolveCostCenterTitleAmount(entry.ap, apScope);
    const capped = resolveCappedCostCenterAllocationAmount(entry.allocation, titleAmount);
    rawLinesByAllocationId.set(entry.allocation.id, {
      raw: capped.rawAllocatedAmount,
      titleAmount,
    });
  }

  const allocatedApIds = new Set(entries.map((row) => row.ap.externalId));
  const apFilters = parseFinanceApDashboardFilters(query);
  const prismaWhere: Record<string, unknown> = {};
  if (apFilters.year) {
    prismaWhere.dueDate = {
      gte: new Date(apFilters.year, (apFilters.month ?? 1) - 1, 1),
      lte: new Date(apFilters.year, apFilters.month ?? 12, 0, 23, 59, 59, 999),
    };
  }
  const allApRows = await prisma.nomusAccountsPayable.findMany({
    where: prismaWhere,
    select: FINANCE_AP_TITLE_SELECT,
    take: 5000,
  });
  const apWithoutAllocation = allApRows
    .map(mapPrismaRowToFinanceApDashboardRow)
    .filter((row) => !allocatedApIds.has(row.externalId) && Math.abs(row.balancePayable) > 0)
    .slice(0, 50)
    .map((row) => ({
      accountsPayableId: row.externalId,
      personName: row.personName,
      description: row.description,
      amountPayable: Math.abs(row.amountPayable),
      balancePayable: Math.abs(row.balancePayable),
    }));

  const duplicateGroups = await prisma.accountsPayableCostCenterAllocation.groupBy({
    by: ["accountsPayableId", "costCenterId"],
    where: { costCenterId: center.id },
    _count: { _all: true },
  });
  const duplicateAllocations = duplicateGroups
    .filter((row) => row._count._all > 1)
    .map((row) => ({
      accountsPayableId: row.accountsPayableId,
      costCenterId: row.costCenterId,
      count: row._count._all,
    }));

  const uncappedHeaderTotal = finiteMoney(
    entries.reduce((sum, entry) => {
      const titleAmount = resolveCostCenterTitleAmount(entry.ap, apScope);
      return (
        sum +
        resolveCappedCostCenterAllocationAmount(entry.allocation, titleAmount).rawAllocatedAmount
      );
    }, 0)
  );

  const report = buildCostCenterAllocationVsApAuditReport({
    costCenterCode: center.code,
    costCenterName: center.name,
    filters: query,
    snapshot: {
      ...snapshot,
      audit: {
        ...snapshot.audit,
        headerAllocatedTotal: uncappedHeaderTotal,
        difference: finiteMoney(uncappedHeaderTotal - snapshot.audit.linesAllocatedSum),
      },
    },
    orphanAllocations,
    apWithoutAllocation,
    duplicateAllocations,
    rawLinesByAllocationId,
  });

  const outputBase = `audit-cost-center-allocation-vs-ap-${center.code}`;

  if (asCsv) {
    const header = [
      "accountsPayableId",
      "personName",
      "description",
      "allocatedAmount",
      "rawAllocatedAmount",
      "currentTitleAmount",
      "balancePayable",
      "status",
      "exclusionReason",
    ].join(",");
    const lines = report.displayLines.map((line) =>
      [
        line.accountsPayableId,
        JSON.stringify(line.personName ?? ""),
        JSON.stringify(line.description ?? ""),
        line.allocatedAmount.toFixed(2),
        line.rawAllocatedAmount.toFixed(2),
        line.currentTitleAmount.toFixed(2),
        line.balancePayable.toFixed(2),
        JSON.stringify(line.status),
        JSON.stringify(line.exclusionReason ?? ""),
      ].join(",")
    );
    const csv = [header, ...lines].join("\n");
    writeFileSync(`${outputBase}.csv`, csv, "utf8");
    console.log(csv);
    return;
  }

  if (asJson) {
    writeFileSync(`${outputBase}.json`, JSON.stringify(report, null, 2), "utf8");
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log(`${LOG_PREFIX} Centro: ${center.code} — ${center.name}`);
  console.log(`Total cabeçalho (raw alocações): ${formatCliMoney(report.headerAllocatedTotal)}`);
  console.log(`Soma linhas exibíveis: ${formatCliMoney(report.linesAllocatedSum)}`);
  console.log(`Diferença: ${formatCliMoney(report.difference)}`);
  console.log(`Títulos exibíveis: ${report.titlesCount}`);
  console.log(`Órfãs sem AP: ${report.orphanAllocations.length}`);
  console.log(`Stale excluído: ${formatCliMoney(report.staleAllocationAmountExcluded)}`);
  console.log(`AP cancelados excluídos: ${report.cancelledApLines.length}`);
  console.log(`Duplicidades AP+CC: ${report.duplicateAllocations.length}`);
  if (report.topDivergences.length > 0) {
    console.log("\nTop divergências:");
    for (const line of report.topDivergences.slice(0, 10)) {
      console.log(
        `  AP ${line.accountsPayableId} | raw ${formatCliMoney(line.rawAllocatedAmount)} | atual ${formatCliMoney(line.allocatedAmount)} | ${line.exclusionReason ?? "exibível"}`
      );
    }
  }
}

function finiteMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
