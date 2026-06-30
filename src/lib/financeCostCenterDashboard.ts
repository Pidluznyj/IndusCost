import type { Prisma } from "@prisma/client";
import {
  buildFinanceApPrismaWhere,
  classifyFinanceApTitle,
  decimalFieldToNumber,
  mapPrismaRowToFinanceApDashboardRow,
  parseFinanceApDashboardFilters,
  roundMoney,
  safeRatio,
  type FinanceApDashboardFilters,
  type FinanceApDashboardRow,
} from "@/src/lib/financeAccountsPayableDashboard.js";
import {
  filterOfficialApTitlesForCostCenter,
  OFFICIAL_AP_RULES_SOURCE,
  resolveOfficialApPortfolioFinancialMetrics,
  type OfficialApPortfolioFinancialMetrics,
} from "@/src/lib/financeAccountsPayableRulesAdapter.js";
import { FINANCE_AP_ALLOCATION_AMOUNT_TOLERANCE } from "@/src/lib/financeApAllocationShared.js";
import {
  isCostCenterTitleInScope,
  isTitleRealAllocated,
  parseFinanceCostCenterApScope,
  resolveCostCenterApScopeFromStatus,
  resolveCostCenterTitleAmount,
  resolveTitleAllocatedAmount,
  resolveTitleUnallocatedGap,
  type FinanceCostCenterApScope,
} from "@/src/lib/financeCostCenterAllocationMetrics.js";
import {
  accountsPayableMatchesFinancialSupplier,
  type SupplierWithAliases,
} from "@/src/lib/financeSupplierCostCenterRules.js";
import {
  resolveNomusApReportSyncCutoffFromPrisma,
  type NomusApReportSyncCutoff,
} from "@/src/lib/financeNomusApReportFreshness.js";
import { normalizeAccountsPayableTitle } from "@/src/lib/financeAccountsPayableRules.js";
import {
  buildCostCenterConsolidatedSuppliers,
  costCenterDashboardHasPeriodFilter,
  filterCostCenterSupplierScopeRows,
  resolveCostCenterSupplierConsolidationKey,
  resolveCostCenterSupplierDisplay,
  stripCostCenterDashboardPeriodFilters,
} from "@/src/lib/financeCostCenterSupplierConsolidation.js";
import {
  buildCostCenterAnnualSpendingChart,
  type CostCenterAnnualSpendingChartPayload,
} from "@/src/lib/financeCostCenterAnnualSpendingChart.js";
import { prisma } from "@/src/lib/prisma.js";

export class FinanceCostCenterDashboardError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "FinanceCostCenterDashboardError";
    this.code = code;
  }
}

export type FinanceCostCenterDashboardClassificationFilter =
  | "all"
  | "classified"
  | "unclassified";

export type FinanceCostCenterDashboardFilters = FinanceApDashboardFilters & {
  costCenterId?: string;
  supplierId?: string;
  classification?: FinanceCostCenterDashboardClassificationFilter;
  apScope?: FinanceCostCenterApScope;
};

export type AllocationDashboardRow = {
  id: string;
  accountsPayableId: number;
  supplierId: string | null;
  costCenterId: string;
  amount: Prisma.Decimal | null;
  percentage: Prisma.Decimal;
};

export type CostCenterMetaRow = {
  id: string;
  code: string;
  name: string;
  status: string;
};

export type SupplierRuleCountRow = {
  supplierId: string;
};

export type FinanceCostCenterDashboardSummary = {
  totalAmount: number;
  classifiedAmount: number;
  unclassifiedAmount: number;
  classifiedPercentage: number;
  openAmount: number;
  overdueAmount: number;
  paidAmount: number;
  costCentersCount: number;
  suppliersWithRules: number;
  suppliersWithoutRules: number;
};

export type FinanceCostCenterDashboardByCostCenterRow = {
  costCenterId: string;
  code: string;
  name: string;
  amount: number;
  openAmount: number;
  overdueAmount: number;
  paidAmount: number;
  titlesCount: number;
  sharePercentage: number;
};

export type FinanceCostCenterDashboardBySupplierRow = {
  supplierId: string | null;
  name: string;
  document: string | null;
  amount: number;
  titlesCount: number;
  costCenterName: string;
};

export type FinanceCostCenterDashboardUnclassified = {
  suppliersCount: number;
  titlesCount: number;
  amount: number;
  topUnclassifiedSuppliers: Array<{
    supplierKey: string;
    name: string;
    document: string | null;
    titlesCount: number;
    amount: number;
  }>;
};

export type FinanceCostCenterDashboardMonthlyTotalRow = {
  year: number;
  month: number;
  totalAmount: number;
  classifiedAmount: number;
  unclassifiedAmount: number;
};

export type FinanceCostCenterDashboardMonthlyByCostCenterRow = {
  year: number;
  month: number;
  costCenterId: string;
  code: string;
  name: string;
  amount: number;
};

export type FinanceCostCenterDashboardMonthlySeries = {
  mode: "byCostCenter" | "totalsOnly";
  totals: FinanceCostCenterDashboardMonthlyTotalRow[];
  byCostCenter: FinanceCostCenterDashboardMonthlyByCostCenterRow[];
};

export type FinanceCostCenterDashboardDiagnostics = {
  scopeUsed: FinanceCostCenterApScope;
  titlesInFilter: number;
  titlesOpen: number;
  titlesSettledInPeriod: number;
  totalAmountBase: number;
  totalAllocatedReal: number;
  totalUnallocatedGap: number;
  titlesWithUnallocatedGap: number;
  titlesSupplierNoRule: number;
  titlesNoSupplier: number;
  amountSupplierNoRuleGap: number;
  amountNoSupplierGap: number;
  officialApTotalPayable: number | null;
  officialApSource: string | null;
  partitionTotal: number;
  reconciliationDelta: number;
};

export type FinanceCostCenterDashboardAudit = {
  dataSources: string[];
  filtersApplied: FinanceCostCenterDashboardFilters;
  titlesConsidered: number;
  allocationsConsidered: number;
  lastApSyncAt: string | null;
  diagnostics: FinanceCostCenterDashboardDiagnostics;
};

export type FinanceCostCenterDashboardPayload = {
  summary: FinanceCostCenterDashboardSummary;
  byCostCenter: FinanceCostCenterDashboardByCostCenterRow[];
  bySupplier: FinanceCostCenterDashboardBySupplierRow[];
  unclassified: FinanceCostCenterDashboardUnclassified;
  monthlySeries: FinanceCostCenterDashboardMonthlySeries;
  /** Série oficial para gráfico de gastos por centro de custo (Visão Gerencial / Relatório). */
  annualSpendingChart: CostCenterAnnualSpendingChartPayload;
  audit: FinanceCostCenterDashboardAudit;
};

export type FinanceCostCenterDashboardDeps = {
  loadApRows: (
    where: Prisma.NomusAccountsPayableWhereInput
  ) => Promise<FinanceApDashboardRow[]>;
  loadAllocations: (externalIds: number[]) => Promise<AllocationDashboardRow[]>;
  loadCostCenters: () => Promise<CostCenterMetaRow[]>;
  loadSuppliers: () => Promise<SupplierWithAliases[]>;
  loadSupplierIdsWithActiveRules: () => Promise<SupplierRuleCountRow[]>;
  resolveSyncCutoff: () => Promise<NomusApReportSyncCutoff | null>;
};

type TitleMetrics = {
  titleAmount: number;
  openAmount: number;
  overdueAmount: number;
  paidAmount: number;
};

type MutableCcRow = {
  costCenterId: string;
  code: string;
  name: string;
  amount: number;
  openAmount: number;
  overdueAmount: number;
  paidAmount: number;
  titleIds: Set<number>;
};

const AP_DASHBOARD_SELECT = {
  externalId: true,
  companyName: true,
  personName: true,
  personCnpj: true,
  description: true,
  dueDate: true,
  scheduleDate: true,
  type: true,
  settlementDate: true,
  paymentDate: true,
  amountPayable: true,
  amountPaid: true,
  balancePayable: true,
  paymentMethodName: true,
  bankAccountName: true,
  sourceInvoiceId: true,
  documentNumber: true,
  suspendPayment: true,
  status: true,
  syncedAt: true,
} as const;

function finiteMoney(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return roundMoney(value);
}

function safePercent(part: number, total: number): number {
  const pct = safeRatio(part, total) * 100;
  return finiteMoney(pct);
}

function parseClassificationFilter(
  value: unknown
): FinanceCostCenterDashboardClassificationFilter {
  const raw = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (raw === "classified" || raw === "classificado" || raw === "classificados") {
    return "classified";
  }
  if (raw === "unclassified" || raw === "sem_classificacao" || raw === "nao_classificado") {
    return "unclassified";
  }
  return "all";
}

export function parseFinanceCostCenterDashboardFilters(
  query: Record<string, unknown>
): FinanceCostCenterDashboardFilters {
  const base = parseFinanceApDashboardFilters(query);
  const costCenterId =
    typeof query.costCenterId === "string" && query.costCenterId.trim()
      ? query.costCenterId.trim()
      : undefined;
  const supplierId =
    typeof query.supplierId === "string" && query.supplierId.trim()
      ? query.supplierId.trim()
      : undefined;
  const hasExplicitApScope =
    typeof query.apScope === "string" && query.apScope.trim().length > 0;
  const apScope = hasExplicitApScope
    ? parseFinanceCostCenterApScope(query.apScope)
    : resolveCostCenterApScopeFromStatus(base.status);

  return {
    ...base,
    costCenterId,
    supplierId,
    classification: parseClassificationFilter(query.classification),
    apScope,
  };
}

export function resolveFinanceCostCenterDashboardApScope(
  filters: FinanceCostCenterDashboardFilters
): FinanceCostCenterApScope {
  return filters.apScope ?? resolveCostCenterApScopeFromStatus(filters.status);
}

export function filterCostCenterDashboardRows(
  rows: FinanceApDashboardRow[],
  filters: FinanceCostCenterDashboardFilters,
  referenceDate: Date = new Date(),
  syncCutoff?: NomusApReportSyncCutoff | null
): FinanceApDashboardRow[] {
  const apScope = resolveFinanceCostCenterDashboardApScope(filters);
  return filterOfficialApTitlesForCostCenter(rows, filters, referenceDate, syncCutoff).filter((row) =>
    isCostCenterTitleInScope(row, apScope)
  );
}

export { isTitleFullyClassified } from "@/src/lib/financeCostCenterAllocationMetrics.js";

export function resolveTitleDashboardAmount(row: FinanceApDashboardRow): number {
  return resolveCostCenterTitleAmount(row, "all_in_filter");
}

export function computeTitleMetrics(
  row: FinanceApDashboardRow,
  referenceDate: Date,
  apScope: FinanceCostCenterApScope = "open_only"
): TitleMetrics {
  const normalized = normalizeAccountsPayableTitle(row);
  const titleAmount = resolveCostCenterTitleAmount(row, apScope);
  const status = classifyFinanceApTitle(row, referenceDate);
  const openAmount = finiteMoney(normalized.openAmount);
  const paidAmount = finiteMoney(normalized.isSettled ? normalized.realizedAmount : 0);
  const overdueAmount = status === "overdue" ? openAmount : 0;
  return { titleAmount, openAmount, overdueAmount, paidAmount };
}

function prorateByShare(total: number, sharePct: number): number {
  return finiteMoney((total * sharePct) / 100);
}

function resolveAllocationShareAmount(
  allocation: AllocationDashboardRow,
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
  allocations: AllocationDashboardRow[],
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
  filter: FinanceCostCenterDashboardClassificationFilter | undefined
): boolean {
  const value = filter ?? "all";
  if (value === "classified") return classified;
  if (value === "unclassified") return !classified;
  return true;
}

function monthKey(date: Date | null): string | null {
  if (!date) return null;
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function primaryCostCenterName(shares: Map<string, number>, ccMeta: Map<string, CostCenterMetaRow>): string {
  if (shares.size === 0) return "—";
  if (shares.size > 1) return "Rateio";
  const [costCenterId] = [...shares.entries()].sort((a, b) => b[1] - a[1])[0] ?? [];
  if (!costCenterId) return "—";
  return ccMeta.get(costCenterId)?.name ?? costCenterId;
}

/** Filtros exclusivos da visão CC (não existem na tela Contas a Pagar). */
export function hasCostCenterClassificationViewFilters(
  filters: FinanceCostCenterDashboardFilters
): boolean {
  return Boolean(
    filters.costCenterId ||
      filters.supplierId ||
      (filters.classification && filters.classification !== "all")
  );
}

export function toApPortfolioFiltersFromCostCenter(
  filters: FinanceCostCenterDashboardFilters
): FinanceApDashboardFilters {
  const { costCenterId: _cc, supplierId: _sup, classification: _cls, apScope: _scope, ...apFilters } =
    filters;
  return apFilters;
}

export function buildFinanceCostCenterDashboard(
  rows: FinanceApDashboardRow[],
  allocations: AllocationDashboardRow[],
  costCenters: CostCenterMetaRow[],
  suppliers: SupplierWithAliases[],
  supplierIdsWithRules: Set<string>,
  filters: FinanceCostCenterDashboardFilters,
  referenceDate: Date = new Date(),
  syncCutoff?: NomusApReportSyncCutoff | null,
  supplierScopeSourceRows?: FinanceApDashboardRow[],
  officialApFinancial?: OfficialApPortfolioFinancialMetrics | null
): FinanceCostCenterDashboardPayload {
  const apScope = resolveFinanceCostCenterDashboardApScope(filters);
  const filteredRows = filterCostCenterDashboardRows(rows, filters, referenceDate, syncCutoff);
  const allInFilterRows = filterOfficialApTitlesForCostCenter(rows, filters, referenceDate, syncCutoff);
  const ccMeta = new Map(costCenters.map((row) => [row.id, row]));

  const allocationsByPayable = new Map<number, AllocationDashboardRow[]>();
  for (const allocation of allocations) {
    const list = allocationsByPayable.get(allocation.accountsPayableId) ?? [];
    list.push(allocation);
    allocationsByPayable.set(allocation.accountsPayableId, list);
  }

  const byCostCenter = new Map<string, MutableCcRow>();
  const unclassifiedSuppliers = new Map<
    string,
    { name: string; document: string | null; titlesCount: number; amount: number }
  >();
  const monthlyTotals = new Map<string, FinanceCostCenterDashboardMonthlyTotalRow>();
  const monthlyByCc = new Map<string, FinanceCostCenterDashboardMonthlyByCostCenterRow>();

  let classifiedAmount = 0;
  let unclassifiedAmount = 0;
  let openAmount = 0;
  let overdueAmount = 0;
  let paidAmount = 0;
  let unclassifiedTitlesCount = 0;
  let unclassifiedAmountTotal = 0;
  let allocationsConsidered = 0;
  let diagTitlesOpen = 0;
  let diagTitlesSettled = 0;
  let diagTotalAmountBase = 0;
  let diagTotalAllocatedReal = 0;
  let diagTotalUnallocatedGap = 0;
  let diagTitlesSupplierNoRule = 0;
  let diagTitlesNoSupplier = 0;
  let diagAmountSupplierNoRuleGap = 0;
  let diagAmountNoSupplierGap = 0;

  for (const row of filteredRows) {
    const rowAllocations = allocationsByPayable.get(row.externalId) ?? [];
    const titleAmount = resolveCostCenterTitleAmount(row, apScope);
    if (titleAmount <= 0) continue;

    const allocatedAmount = resolveTitleAllocatedAmount(rowAllocations, titleAmount);
    const cappedClassified = finiteMoney(Math.min(allocatedAmount, titleAmount));
    const unallocatedGap = finiteMoney(Math.max(0, titleAmount - cappedClassified));
    const fullyAllocated = unallocatedGap <= FINANCE_AP_ALLOCATION_AMOUNT_TOLERANCE;

    if (!matchesSupplierFilter(row, rowAllocations, filters.supplierId, suppliers)) continue;
    if (!matchesClassificationFilter(fullyAllocated, filters.classification)) continue;

    const costCenterFilter = filters.costCenterId;
    if (
      costCenterFilter &&
      !rowAllocations.some((allocation) => allocation.costCenterId === costCenterFilter)
    ) {
      continue;
    }

    const metrics = computeTitleMetrics(row, referenceDate, apScope);
    const supplier = resolveFinancialSupplier(row, suppliers);

    diagTotalAmountBase += titleAmount;
    diagTotalAllocatedReal += allocatedAmount;
    diagTotalUnallocatedGap += unallocatedGap;
    if (row.balancePayable > 0) diagTitlesOpen += 1;

    classifiedAmount += cappedClassified;
    if (unallocatedGap > 0) {
      unclassifiedAmount += unallocatedGap;
      unclassifiedTitlesCount += 1;
      unclassifiedAmountTotal += unallocatedGap;

      const { name: supplierName, document: supplierDocument } = resolveCostCenterSupplierDisplay(
        row,
        supplier
      );
      const unclassifiedKey = resolveCostCenterSupplierConsolidationKey(row, supplier);
      const unclassifiedRow = unclassifiedSuppliers.get(unclassifiedKey) ?? {
        name: supplierName,
        document: supplierDocument,
        titlesCount: 0,
        amount: 0,
      };
      unclassifiedRow.titlesCount += 1;
      unclassifiedRow.amount += unallocatedGap;
      unclassifiedSuppliers.set(unclassifiedKey, unclassifiedRow);

      if (!supplier) {
        diagTitlesNoSupplier += 1;
        diagAmountNoSupplierGap += unallocatedGap;
      } else if (!supplierIdsWithRules.has(supplier.id)) {
        diagTitlesSupplierNoRule += 1;
        diagAmountSupplierNoRuleGap += unallocatedGap;
      }
    }

    openAmount += metrics.openAmount;
    overdueAmount += metrics.overdueAmount;
    paidAmount += metrics.paidAmount;

    const month = monthKey(row.dueDate);
    const applicableAllocations = costCenterFilter
      ? rowAllocations.filter((allocation) => allocation.costCenterId === costCenterFilter)
      : rowAllocations;

    for (const allocation of applicableAllocations) {
      allocationsConsidered += 1;
      const sharePct = decimalFieldToNumber(allocation.percentage);
      const lineAmount = resolveAllocationShareAmount(allocation, titleAmount);
      const lineOpen = prorateByShare(metrics.openAmount, sharePct);
      const lineOverdue = prorateByShare(metrics.overdueAmount, sharePct);
      const linePaid = prorateByShare(metrics.paidAmount, sharePct);
      const meta = ccMeta.get(allocation.costCenterId);

      const ccRow = byCostCenter.get(allocation.costCenterId) ?? {
        costCenterId: allocation.costCenterId,
        code: meta?.code ?? allocation.costCenterId,
        name: meta?.name ?? allocation.costCenterId,
        amount: 0,
        openAmount: 0,
        overdueAmount: 0,
        paidAmount: 0,
        titleIds: new Set<number>(),
      };
      ccRow.amount += lineAmount;
      ccRow.openAmount += lineOpen;
      ccRow.overdueAmount += lineOverdue;
      ccRow.paidAmount += linePaid;
      ccRow.titleIds.add(row.externalId);
      byCostCenter.set(allocation.costCenterId, ccRow);

      if (month) {
        const monthlyCcKey = `${month}:${allocation.costCenterId}`;
        const monthlyCc = monthlyByCc.get(monthlyCcKey) ?? {
          year: row.dueDate!.getFullYear(),
          month: row.dueDate!.getMonth() + 1,
          costCenterId: allocation.costCenterId,
          code: meta?.code ?? allocation.costCenterId,
          name: meta?.name ?? allocation.costCenterId,
          amount: 0,
        };
        monthlyCc.amount += lineAmount;
        monthlyByCc.set(monthlyCcKey, monthlyCc);
      }
    }

    if (month) {
      const monthly = monthlyTotals.get(month) ?? {
        year: row.dueDate!.getFullYear(),
        month: row.dueDate!.getMonth() + 1,
        totalAmount: 0,
        classifiedAmount: 0,
        unclassifiedAmount: 0,
      };
      monthly.totalAmount += titleAmount;
      monthly.classifiedAmount += cappedClassified;
      monthly.unclassifiedAmount += unallocatedGap;
      monthlyTotals.set(month, monthly);
    }
  }

  for (const row of allInFilterRows) {
    if (row.balancePayable > FINANCE_AP_ALLOCATION_AMOUNT_TOLERANCE) {
      continue;
    }
    if (resolveCostCenterTitleAmount(row, "all_in_filter") > 0) {
      diagTitlesSettled += 1;
    }
  }

  const partitionTotal = finiteMoney(classifiedAmount + unclassifiedAmount);
  let totalAmount = finiteMoney(diagTotalAmountBase);
  let summaryOpenAmount = finiteMoney(openAmount);
  let summaryOverdueAmount = finiteMoney(overdueAmount);
  let summaryPaidAmount = finiteMoney(paidAmount);

  if (hasCostCenterClassificationViewFilters(filters)) {
    totalAmount = partitionTotal;
  } else if (officialApFinancial) {
    totalAmount = officialApFinancial.totalPayable;
    summaryOpenAmount = officialApFinancial.openAmount;
    summaryOverdueAmount = officialApFinancial.overdueAmount;
    summaryPaidAmount = officialApFinancial.paidThisMonth;
  }

  const reconciliationDelta = officialApFinancial
    ? finiteMoney(partitionTotal - officialApFinancial.totalPayable)
    : finiteMoney(diagTotalAmountBase - partitionTotal);
  const activeSuppliers = suppliers.filter((supplier) => supplier.status === "ACTIVE");
  const withRules = activeSuppliers.filter((supplier) => supplierIdsWithRules.has(supplier.id)).length;
  const withoutRules = Math.max(0, activeSuppliers.length - withRules);

  const byCostCenterRows = [...byCostCenter.values()]
    .map((row) => ({
      costCenterId: row.costCenterId,
      code: row.code,
      name: row.name,
      amount: finiteMoney(row.amount),
      openAmount: finiteMoney(row.openAmount),
      overdueAmount: finiteMoney(row.overdueAmount),
      paidAmount: finiteMoney(row.paidAmount),
      titlesCount: row.titleIds.size,
      sharePercentage: safePercent(row.amount, totalAmount),
    }))
    .sort((a, b) => b.amount - a.amount);

  const supplierScopeRows = filterCostCenterSupplierScopeRows(
    supplierScopeSourceRows ?? rows,
    filters,
    referenceDate,
    syncCutoff,
    apScope
  );
  const consolidatedSuppliers = buildCostCenterConsolidatedSuppliers(
    supplierScopeRows,
    allocationsByPayable,
    suppliers,
    filters,
    apScope
  );

  const bySupplierRows = [...consolidatedSuppliers.values()]
    .map((row) => ({
      supplierId: row.supplierId,
      name: row.name,
      document: row.document,
      amount: finiteMoney(row.amount),
      titlesCount: row.titleIds.size,
      costCenterName: primaryCostCenterName(row.costCenterShares, ccMeta),
    }))
    .sort((a, b) => b.amount - a.amount);

  const topUnclassifiedSuppliers = [...unclassifiedSuppliers.entries()]
    .map(([supplierKey, row]) => ({
      supplierKey,
      name: row.name,
      document: row.document,
      titlesCount: row.titlesCount,
      amount: finiteMoney(row.amount),
    }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 10);

  const monthlyTotalsRows = [...monthlyTotals.values()].sort((a, b) =>
    a.year === b.year ? a.month - b.month : a.year - b.year
  );
  const monthlyByCcRows = [...monthlyByCc.values()].sort((a, b) => {
    if (a.year !== b.year) return a.year - b.year;
    if (a.month !== b.month) return a.month - b.month;
    return a.code.localeCompare(b.code);
  });

  let lastApSyncAt: string | null = null;
  for (const row of filteredRows) {
    if (!lastApSyncAt || row.syncedAt.toISOString() > lastApSyncAt) {
      lastApSyncAt = row.syncedAt.toISOString();
    }
  }
  if (!lastApSyncAt && syncCutoff?.maxSyncedAt) {
    lastApSyncAt = syncCutoff.maxSyncedAt.toISOString();
  }

  const annualSpendingChart = buildCostCenterAnnualSpendingChart(byCostCenterRows, filters);

  return {
    summary: {
      totalAmount,
      classifiedAmount: finiteMoney(classifiedAmount),
      unclassifiedAmount: finiteMoney(unclassifiedAmount),
      classifiedPercentage: safePercent(classifiedAmount, totalAmount),
      openAmount: summaryOpenAmount,
      overdueAmount: summaryOverdueAmount,
      paidAmount: summaryPaidAmount,
      costCentersCount: byCostCenterRows.length,
      suppliersWithRules: withRules,
      suppliersWithoutRules: withoutRules,
    },
    byCostCenter: byCostCenterRows,
    annualSpendingChart,
    bySupplier: bySupplierRows,
    unclassified: {
      suppliersCount: unclassifiedSuppliers.size,
      titlesCount: unclassifiedTitlesCount,
      amount: finiteMoney(unclassifiedAmountTotal),
      topUnclassifiedSuppliers,
    },
    monthlySeries: {
      mode: monthlyByCcRows.length > 0 ? "byCostCenter" : "totalsOnly",
      totals: monthlyTotalsRows.map((row) => ({
        year: row.year,
        month: row.month,
        totalAmount: finiteMoney(row.totalAmount),
        classifiedAmount: finiteMoney(row.classifiedAmount),
        unclassifiedAmount: finiteMoney(row.unclassifiedAmount),
      })),
      byCostCenter: monthlyByCcRows.map((row) => ({
        ...row,
        amount: finiteMoney(row.amount),
      })),
    },
    audit: {
      dataSources: officialApFinancial
        ? ["NomusAccountsPayable", "AccountsPayableCostCenterAllocation", OFFICIAL_AP_RULES_SOURCE]
        : ["NomusAccountsPayable", "AccountsPayableCostCenterAllocation"],
      filtersApplied: filters,
      titlesConsidered: filteredRows.length,
      allocationsConsidered,
      lastApSyncAt,
      diagnostics: {
        scopeUsed: apScope,
        titlesInFilter: allInFilterRows.length,
        titlesOpen: diagTitlesOpen,
        titlesSettledInPeriod: diagTitlesSettled,
        totalAmountBase: finiteMoney(diagTotalAmountBase),
        totalAllocatedReal: finiteMoney(diagTotalAllocatedReal),
        totalUnallocatedGap: finiteMoney(diagTotalUnallocatedGap),
        titlesWithUnallocatedGap: unclassifiedTitlesCount,
        titlesSupplierNoRule: diagTitlesSupplierNoRule,
        titlesNoSupplier: diagTitlesNoSupplier,
        amountSupplierNoRuleGap: finiteMoney(diagAmountSupplierNoRuleGap),
        amountNoSupplierGap: finiteMoney(diagAmountNoSupplierGap),
        officialApTotalPayable: officialApFinancial?.totalPayable ?? null,
        officialApSource: officialApFinancial?.source ?? null,
        partitionTotal,
        reconciliationDelta,
      },
    },
  };
}

export function createDefaultFinanceCostCenterDashboardDeps(): FinanceCostCenterDashboardDeps {
  return {
    loadApRows: async (where) => {
      const rows = await prisma.nomusAccountsPayable.findMany({
        where,
        select: AP_DASHBOARD_SELECT,
        orderBy: { dueDate: "asc" },
      });
      return rows.map(mapPrismaRowToFinanceApDashboardRow);
    },
    loadAllocations: async (externalIds) => {
      if (externalIds.length === 0) return [];
      return prisma.accountsPayableCostCenterAllocation.findMany({
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
    },
    loadCostCenters: async () =>
      prisma.financialCostCenter.findMany({
        select: { id: true, code: true, name: true, status: true },
      }),
    loadSuppliers: async () =>
      prisma.financialSupplier.findMany({
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
      }),
    loadSupplierIdsWithActiveRules: async () =>
      prisma.supplierCostCenterRule.findMany({
        where: { isActive: true },
        select: { supplierId: true },
        distinct: ["supplierId"],
      }),
    resolveSyncCutoff: async () => resolveNomusApReportSyncCutoffFromPrisma(prisma),
  };
}

export async function buildFinanceCostCenterDashboardDefault(
  filters: FinanceCostCenterDashboardFilters,
  referenceDate: Date = new Date()
): Promise<FinanceCostCenterDashboardPayload> {
  const deps = createDefaultFinanceCostCenterDashboardDeps();
  const syncCutoff = await deps.resolveSyncCutoff();
  const where = buildFinanceApPrismaWhere(filters, syncCutoff);
  const rows = await deps.loadApRows(where);
  const supplierFilters = stripCostCenterDashboardPeriodFilters(filters);
  const supplierWhere = buildFinanceApPrismaWhere(supplierFilters, syncCutoff);
  const supplierScopeSourceRows = !costCenterDashboardHasPeriodFilter(filters)
    ? rows
    : supplierWhere.externalId === -1
      ? []
      : await deps.loadApRows(supplierWhere);
  const allocationIds = [
    ...new Set([...rows, ...supplierScopeSourceRows].map((row) => row.externalId)),
  ];
  const allocations = await deps.loadAllocations(allocationIds);
  const costCenters = await deps.loadCostCenters();
  const suppliers = await deps.loadSuppliers();
  const supplierIdsWithRules = new Set(
    (await deps.loadSupplierIdsWithActiveRules()).map((row) => row.supplierId)
  );
  const officialApFinancial = resolveOfficialApPortfolioFinancialMetrics({
    rows,
    filters: toApPortfolioFiltersFromCostCenter(filters),
    referenceDate,
    syncCutoff,
  });
  return buildFinanceCostCenterDashboard(
    rows,
    allocations,
    costCenters,
    suppliers,
    supplierIdsWithRules,
    filters,
    referenceDate,
    syncCutoff,
    supplierScopeSourceRows,
    officialApFinancial
  );
}
