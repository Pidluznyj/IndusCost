import type { FinanceApDashboardFilters, FinanceApDashboardRow } from "@/src/lib/financeAccountsPayableDashboard.js";
import {
  isCostCenterTitleInScope,
  isTitleRealAllocated,
  resolveCostCenterTitleAmount,
  type FinanceCostCenterApScope,
} from "@/src/lib/financeCostCenterAllocationMetrics.js";
import { filterOfficialApTitlesForCostCenter } from "@/src/lib/financeAccountsPayableRulesAdapter.js";
import type { NomusApReportSyncCutoff } from "@/src/lib/financeNomusApReportFreshness.js";
import {
  accountsPayableMatchesFinancialSupplier,
  type SupplierWithAliases,
} from "@/src/lib/financeSupplierCostCenterRules.js";
import {
  buildSupplierIdentityKey,
  extractSupplierFromAccountsPayable,
  normalizeSupplierDocument,
} from "@/src/lib/financeSupplierIdentity.js";
import type { Prisma } from "@prisma/client";
import { decimalFieldToNumber, roundMoney } from "@/src/lib/financeAccountsPayableDashboard.js";

export type CostCenterSupplierClassificationFilter = "all" | "classified" | "unclassified";

export type CostCenterSupplierAllocationRow = {
  id: string;
  accountsPayableId: number;
  supplierId: string | null;
  costCenterId: string;
  amount: Prisma.Decimal | null;
  percentage: Prisma.Decimal;
};

export type CostCenterSupplierConsolidationFilters = FinanceApDashboardFilters & {
  costCenterId?: string;
  supplierId?: string;
  classification?: CostCenterSupplierClassificationFilter;
};

export const COST_CENTER_UNIDENTIFIED_SUPPLIER_LABEL = "Fornecedor não identificado";

export type CostCenterConsolidatedSupplierRow = {
  supplierId: string | null;
  name: string;
  document: string | null;
  amount: number;
  titleIds: Set<number>;
  costCenterShares: Map<string, number>;
};

/**
 * Remove ano/mês — uso legado restrito (ex.: metadados que não devem recortar por vencimento).
 * A aba Fornecedores e o drilldown de títulos usam filtros completos (eixo = data de vencimento).
 */
export function stripCostCenterDashboardPeriodFilters<
  T extends { year?: number; month?: number }
>(filters: T): Omit<T, "year" | "month"> & { year?: undefined; month?: undefined } {
  const { year: _year, month: _month, ...rest } = filters;
  return rest;
}

export function costCenterDashboardHasPeriodFilter(filters: {
  year?: number;
  month?: number;
}): boolean {
  return filters.year != null || filters.month != null;
}

export function filterCostCenterSupplierScopeRows(
  rows: FinanceApDashboardRow[],
  filters: CostCenterSupplierConsolidationFilters,
  referenceDate: Date,
  syncCutoff?: NomusApReportSyncCutoff | null,
  apScope: FinanceCostCenterApScope = "open_only"
): FinanceApDashboardRow[] {
  return filterOfficialApTitlesForCostCenter(rows, filters, referenceDate, syncCutoff).filter(
    (row) => isCostCenterTitleInScope(row, apScope)
  );
}

export function resolveCostCenterSupplierConsolidationKey(
  row: FinanceApDashboardRow,
  supplier: SupplierWithAliases | null
): string {
  if (supplier?.id) return `fs:${supplier.id}`;
  const extracted = extractSupplierFromAccountsPayable(row);
  return buildSupplierIdentityKey(extracted, row.externalId);
}

export function resolveCostCenterSupplierDisplay(
  row: FinanceApDashboardRow,
  supplier: SupplierWithAliases | null
): { name: string; document: string | null } {
  const extracted = extractSupplierFromAccountsPayable(row);
  const name =
    supplier?.displayName ??
    extracted.originalName?.trim() ??
    COST_CENTER_UNIDENTIFIED_SUPPLIER_LABEL;
  const document =
    supplier?.normalizedDocument ??
    normalizeSupplierDocument(extracted.originalDocument ?? row.personCnpj) ??
    null;
  return { name, document };
}

function finiteMoney(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return roundMoney(value);
}

function prorateByShare(total: number, sharePct: number): number {
  return finiteMoney((total * sharePct) / 100);
}

function resolveAllocationShareAmount(
  allocation: CostCenterSupplierAllocationRow,
  titleAmount: number
): number {
  const explicit = decimalFieldToNumber(allocation.amount);
  if (explicit > 0) return finiteMoney(explicit);
  return prorateByShare(titleAmount, decimalFieldToNumber(allocation.percentage));
}

function resolveFinancialSupplier(
  row: FinanceApDashboardRow,
  suppliers: SupplierWithAliases[]
): SupplierWithAliases | null {
  for (const supplier of suppliers) {
    if (supplier.status !== "ACTIVE") continue;
    if (accountsPayableMatchesFinancialSupplier(row, supplier)) return supplier;
  }
  return null;
}

function matchesSupplierFilter(
  row: FinanceApDashboardRow,
  allocations: CostCenterSupplierAllocationRow[],
  supplierId: string | undefined,
  suppliers: SupplierWithAliases[]
): boolean {
  if (!supplierId) return true;
  if (allocations.some((allocation) => allocation.supplierId === supplierId)) return true;
  const supplier = resolveFinancialSupplier(row, suppliers);
  return supplier?.id === supplierId;
}

function matchesClassificationFilter(
  classified: boolean,
  filter: CostCenterSupplierClassificationFilter | undefined
): boolean {
  const value = filter ?? "all";
  if (value === "classified") return classified;
  if (value === "unclassified") return !classified;
  return true;
}

export function buildCostCenterConsolidatedSuppliers(
  scopeRows: FinanceApDashboardRow[],
  allocationsByPayable: Map<number, CostCenterSupplierAllocationRow[]>,
  suppliers: SupplierWithAliases[],
  filters: CostCenterSupplierConsolidationFilters,
  apScope: FinanceCostCenterApScope
): Map<string, CostCenterConsolidatedSupplierRow> {
  const bySupplier = new Map<string, CostCenterConsolidatedSupplierRow>();
  const costCenterFilter = filters.costCenterId;

  for (const row of scopeRows) {
    const rowAllocations = allocationsByPayable.get(row.externalId) ?? [];
    const titleAmount = resolveCostCenterTitleAmount(row, apScope);
    if (titleAmount <= 0) continue;

    const fullyAllocated = isTitleRealAllocated(rowAllocations, titleAmount);
    if (!matchesSupplierFilter(row, rowAllocations, filters.supplierId, suppliers)) continue;
    if (!matchesClassificationFilter(fullyAllocated, filters.classification)) continue;
    if (
      costCenterFilter &&
      !rowAllocations.some((allocation) => allocation.costCenterId === costCenterFilter)
    ) {
      continue;
    }

    const supplier = resolveFinancialSupplier(row, suppliers);
    const key = resolveCostCenterSupplierConsolidationKey(row, supplier);
    const { name, document } = resolveCostCenterSupplierDisplay(row, supplier);

    const applicableAllocations = costCenterFilter
      ? rowAllocations.filter((allocation) => allocation.costCenterId === costCenterFilter)
      : rowAllocations;

    const supplierRow = bySupplier.get(key) ?? {
      supplierId: supplier?.id ?? null,
      name,
      document,
      amount: 0,
      titleIds: new Set<number>(),
      costCenterShares: new Map<string, number>(),
    };
    supplierRow.amount += titleAmount;
    supplierRow.titleIds.add(row.externalId);
    if (!supplierRow.supplierId && supplier?.id) supplierRow.supplierId = supplier.id;

    for (const allocation of applicableAllocations) {
      const lineAmount = resolveAllocationShareAmount(allocation, titleAmount);
      supplierRow.costCenterShares.set(
        allocation.costCenterId,
        (supplierRow.costCenterShares.get(allocation.costCenterId) ?? 0) + lineAmount
      );
    }
    bySupplier.set(key, supplierRow);
  }

  return bySupplier;
}
