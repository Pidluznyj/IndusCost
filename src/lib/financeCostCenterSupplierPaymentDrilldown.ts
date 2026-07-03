/**
 * Análise de pagamentos por fornecedor — Centro de Custo / Fornecedores.
 * Deriva do motor oficial de AP; não recalcula regras de classificação.
 */
import {
  buildFinanceApPrismaWhere,
  classifyFinanceApTitle,
  decimalFieldToNumber,
  endOfLocalDay,
  mapPrismaRowToFinanceApDashboardRow,
  roundMoney,
  safeRatio,
  type FinanceApDashboardRow,
} from "@/src/lib/financeAccountsPayableDashboard.js";
import {
  isFinanceApCancelledTitle,
  resolveFinanceApEffectivePaymentDate,
  resolveFinanceApRealizedAmount,
} from "@/src/lib/financeAccountsPayableRules.js";
import { OFFICIAL_AP_RULES_SOURCE } from "@/src/lib/financeAccountsPayableRulesAdapter.js";
import {
  isTitleRealAllocated,
  resolveCostCenterTitleAmount,
  resolveTitleAllocatedAmount,
  resolveTitleUnallocatedGap,
} from "@/src/lib/financeCostCenterAllocationMetrics.js";
import {
  createDefaultFinanceCostCenterDashboardDeps,
  parseFinanceCostCenterDashboardFilters,
  type AllocationDashboardRow,
  type CostCenterMetaRow,
  type FinanceCostCenterDashboardFilters,
} from "@/src/lib/financeCostCenterDashboard.js";
import { FINANCE_AP_ALLOCATION_AMOUNT_TOLERANCE } from "@/src/lib/financeApAllocationShared.js";
import { toCivilDateKey } from "@/src/lib/financeCivilDate.js";
import {
  COST_CENTER_UNIDENTIFIED_SUPPLIER_LABEL,
  filterCostCenterSupplierScopeRows,
  resolveCostCenterSupplierConsolidationKey,
  resolveCostCenterSupplierDisplay,
  stripCostCenterDashboardPeriodFilters,
  type CostCenterSupplierClassificationFilter,
} from "@/src/lib/financeCostCenterSupplierConsolidation.js";
import {
  accountsPayableMatchesFinancialSupplier,
  type SupplierWithAliases,
} from "@/src/lib/financeSupplierCostCenterRules.js";
import type { NomusApReportSyncCutoff } from "@/src/lib/financeNomusApReportFreshness.js";
import {
  COST_CENTER_SUPPLIER_PAYMENT_DATE_RULE_NOTE,
  COST_CENTER_SUPPLIER_PAYMENT_METRICS_SOURCE,
  type CostCenterSupplierPaymentFiltersApplied,
  type CostCenterSupplierPaymentSummaryPayload,
  type CostCenterSupplierPaymentSummaryRow,
  type CostCenterSupplierPaymentTitleRow,
  type CostCenterSupplierPaymentTitlesPayload,
  type CostCenterSupplierPaymentYearRow,
  type CostCenterSupplierPaymentYearsPayload,
} from "@/src/lib/financeCostCenterSupplierPaymentDrilldown.shared.js";
import { formatAccountsPayableDescriptiveText } from "@/src/lib/financeAccountsPayableDescriptiveText.js";
import { prisma } from "@/src/lib/prisma.js";

export {
  COST_CENTER_SUPPLIER_PAYMENT_DATE_RULE_NOTE,
  COST_CENTER_SUPPLIER_PAYMENT_METRICS_SOURCE,
  type CostCenterSupplierPaymentFiltersApplied,
  type CostCenterSupplierPaymentSummaryPayload,
  type CostCenterSupplierPaymentSummaryRow,
  type CostCenterSupplierPaymentTitleRow,
  type CostCenterSupplierPaymentTitlesPayload,
  type CostCenterSupplierPaymentYearRow,
  type CostCenterSupplierPaymentYearsPayload,
};

const MONTH_LABELS = [
  "Jan",
  "Fev",
  "Mar",
  "Abr",
  "Mai",
  "Jun",
  "Jul",
  "Ago",
  "Set",
  "Out",
  "Nov",
  "Dez",
] as const;

export const SUPPLIER_PAYMENT_DRILLDOWN_AP_SELECT = {
  externalId: true,
  companyName: true,
  personName: true,
  personCnpj: true,
  personId: true,
  description: true,
  comments: true,
  rawPayload: true,
  dueDate: true,
  scheduleDate: true,
  type: true,
  settlementDate: true,
  paymentDate: true,
  competenceDate: true,
  createdAtNomus: true,
  amountPayable: true,
  amountPaid: true,
  balancePayable: true,
  paymentMethodName: true,
  bankAccountName: true,
  sourceInvoiceId: true,
  sourceInvoiceNumber: true,
  documentNumber: true,
  suspendPayment: true,
  status: true,
  classification: true,
  syncedAt: true,
} as const;

export type FinanceApPaymentDrilldownRow = FinanceApDashboardRow & {
  comments?: string | null;
  rawPayload?: unknown;
  competenceDate?: Date | null;
  createdAtNomus?: Date | null;
  sourceInvoiceNumber?: string | null;
  classification?: string | null;
  personId?: number | null;
};

export const SUPPLIER_PAYMENT_PERIOD_SCOPE_NOTE =
  "Lista somente títulos pagos no período selecionado (ano/mês), respeitando empresa, classificação e centro de custo dos filtros da tela." as const;

function mapPrismaRowToPaymentDrilldownRow(row: {
  externalId: number;
  companyName: string | null;
  personName: string | null;
  personCnpj: string | null;
  personId?: number | null;
  description: string | null;
  comments?: string | null;
  rawPayload?: unknown;
  dueDate: Date | null;
  scheduleDate?: Date | null;
  type?: number | null;
  settlementDate: Date | null;
  paymentDate: Date | null;
  competenceDate?: Date | null;
  createdAtNomus?: Date | null;
  amountPayable: import("@prisma/client").Prisma.Decimal | null;
  amountPaid: import("@prisma/client").Prisma.Decimal | null;
  balancePayable: import("@prisma/client").Prisma.Decimal | null;
  paymentMethodName: string | null;
  bankAccountName: string | null;
  sourceInvoiceId: number | null;
  sourceInvoiceNumber?: string | null;
  documentNumber: string | null;
  suspendPayment: boolean | null;
  status: boolean | null;
  classification?: string | null;
  syncedAt: Date;
}): FinanceApPaymentDrilldownRow {
  return {
    ...mapPrismaRowToFinanceApDashboardRow(row),
    comments: row.comments ?? null,
    rawPayload: row.rawPayload,
    competenceDate: row.competenceDate ?? null,
    createdAtNomus: row.createdAtNomus ?? null,
    sourceInvoiceNumber: row.sourceInvoiceNumber ?? null,
    classification: row.classification ?? null,
    personId: row.personId ?? null,
  };
}

function resolveTitleIssueDate(row: FinanceApPaymentDrilldownRow): string | null {
  return toCivilDateKey(row.competenceDate) ?? toCivilDateKey(row.createdAtNomus);
}

function resolveTitleDescriptiveText(row: FinanceApPaymentDrilldownRow): string {
  return formatAccountsPayableDescriptiveText({
    description: row.description,
    comments: row.comments,
    rawPayload: row.rawPayload,
  });
}

function toFiltersAppliedPayload(
  filters: FinanceCostCenterDashboardFilters
): CostCenterSupplierPaymentFiltersApplied {
  return {
    year: filters.year,
    month: filters.month,
    status: filters.status,
    companyName: filters.companyName,
    costCenterId: filters.costCenterId,
    supplierId: filters.supplierId,
    classification: filters.classification,
  };
}

function finiteMoney(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return roundMoney(value);
}

function resolveAllocationShareAmount(
  allocation: Pick<AllocationDashboardRow, "amount" | "percentage">,
  titleAmount: number
): number {
  const explicit = decimalFieldToNumber(allocation.amount);
  if (explicit > 0) return finiteMoney(explicit);
  return finiteMoney((titleAmount * decimalFieldToNumber(allocation.percentage)) / 100);
}

function matchesClassificationFilter(
  fullyAllocated: boolean,
  filter: CostCenterSupplierClassificationFilter | undefined
): boolean {
  const value = filter ?? "all";
  if (value === "classified") return fullyAllocated;
  if (value === "unclassified") return !fullyAllocated;
  return true;
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

export function resolveSupplierPaymentPeriodBounds(
  filters: FinanceCostCenterDashboardFilters,
  referenceDate: Date = new Date()
): { periodStart: Date; periodEnd: Date; periodLabel: string } {
  const year = filters.year ?? referenceDate.getFullYear();
  if (filters.month != null && filters.month >= 1 && filters.month <= 12) {
    const periodStart = new Date(year, filters.month - 1, 1, 0, 0, 0, 0);
    const periodEnd = endOfLocalDay(new Date(year, filters.month, 0));
    const monthName = MONTH_LABELS[filters.month - 1] ?? String(filters.month).padStart(2, "0");
    return {
      periodStart,
      periodEnd,
      periodLabel: `${monthName}/${year}`,
    };
  }
  const periodStart = new Date(year, 0, 1, 0, 0, 0, 0);
  const periodEnd = endOfLocalDay(new Date(year, 11, 31));
  return { periodStart, periodEnd, periodLabel: String(year) };
}

export function isTitlePaidInPeriod(
  row: FinanceApDashboardRow,
  periodStart: Date,
  periodEnd: Date
): boolean {
  if (isFinanceApCancelledTitle(row)) return false;
  const paidAt = resolveFinanceApEffectivePaymentDate(row);
  const realized = resolveFinanceApRealizedAmount(row);
  if (!paidAt || realized <= 0) return false;
  const startMs = periodStart.getTime();
  const endMs = periodEnd.getTime();
  const paidMs = paidAt.getTime();
  return paidMs >= startMs && paidMs <= endMs;
}

export function resolveSupplierPaidAttributionAmount(
  row: FinanceApDashboardRow,
  rowAllocations: AllocationDashboardRow[],
  filters: FinanceCostCenterDashboardFilters
): number {
  const realized = resolveFinanceApRealizedAmount(row);
  if (realized <= 0) return 0;
  const titleAmount = resolveCostCenterTitleAmount(row, "all_in_filter");
  if (titleAmount <= 0) return 0;

  const fullyAllocated = isTitleRealAllocated(rowAllocations, titleAmount);
  if (!matchesClassificationFilter(fullyAllocated, filters.classification)) return 0;

  const costCenterFilter = filters.costCenterId;
  if (costCenterFilter) {
    const applicable = rowAllocations.filter((a) => a.costCenterId === costCenterFilter);
    if (applicable.length === 0) return 0;
    const shareAmount = applicable.reduce(
      (sum, allocation) => sum + resolveAllocationShareAmount(allocation, titleAmount),
      0
    );
    return finiteMoney(realized * safeRatio(shareAmount, titleAmount));
  }

  if (filters.classification === "unclassified") {
    const gap = resolveTitleUnallocatedGap(rowAllocations, titleAmount);
    if (gap <= FINANCE_AP_ALLOCATION_AMOUNT_TOLERANCE) return 0;
    return finiteMoney(realized * safeRatio(gap, titleAmount));
  }

  if (filters.classification === "classified") {
    const allocated = resolveTitleAllocatedAmount(rowAllocations, titleAmount);
    const capped = finiteMoney(Math.min(allocated, titleAmount));
    if (capped <= 0) return 0;
    return finiteMoney(realized * safeRatio(capped, titleAmount));
  }

  return finiteMoney(realized);
}

function resolveCostCenterLabels(
  rowAllocations: AllocationDashboardRow[],
  ccMeta: Map<string, CostCenterMetaRow>,
  costCenterFilter?: string
): { name: string; code: string | null } {
  const applicable = costCenterFilter
    ? rowAllocations.filter((a) => a.costCenterId === costCenterFilter)
    : rowAllocations;
  if (applicable.length === 0) {
    return { name: "Sem centro de custo classificado", code: null };
  }
  const names = [
    ...new Set(
      applicable.map((a) => ccMeta.get(a.costCenterId)?.name ?? a.costCenterId)
    ),
  ];
  const codes = [
    ...new Set(
      applicable.map((a) => ccMeta.get(a.costCenterId)?.code ?? null).filter(Boolean)
    ),
  ] as string[];
  return {
    name: names.join(" · "),
    code: codes.length === 1 ? codes[0]! : codes.length > 1 ? codes.join(" · ") : null,
  };
}

type SupplierPaymentContext = {
  rows: FinanceApPaymentDrilldownRow[];
  allocationsByPayable: Map<number, AllocationDashboardRow[]>;
  suppliers: SupplierWithAliases[];
  ccMeta: Map<string, CostCenterMetaRow>;
  filters: FinanceCostCenterDashboardFilters;
  referenceDate: Date;
  syncCutoff: NomusApReportSyncCutoff | null;
};

function isPaidInWindow(
  paidAt: Date | null,
  options: { periodStart?: Date; periodEnd?: Date; year?: number }
): boolean {
  if (!paidAt) return false;
  if (options.periodStart && options.periodEnd) {
    const startMs = options.periodStart.getTime();
    const endMs = options.periodEnd.getTime();
    const paidMs = paidAt.getTime();
    return paidMs >= startMs && paidMs <= endMs;
  }
  if (options.year != null && paidAt.getFullYear() !== options.year) return false;
  return true;
}

function resolvePaidTitlesWindow(
  ctx: SupplierPaymentContext,
  year: number
): { periodStart?: Date; periodEnd?: Date; year?: number; periodLabel: string } {
  const filterYear = ctx.filters.year ?? year;
  const { periodStart, periodEnd, periodLabel } = resolveSupplierPaymentPeriodBounds(
    { ...ctx.filters, year: filterYear },
    ctx.referenceDate
  );
  if (ctx.filters.month != null && ctx.filters.month >= 1 && ctx.filters.month <= 12) {
    return { periodStart, periodEnd, periodLabel };
  }
  if (filterYear === year) {
    return {
      year,
      periodLabel: String(year),
    };
  }
  const annualStart = new Date(year, 0, 1, 0, 0, 0, 0);
  const annualEnd = endOfLocalDay(new Date(year, 11, 31));
  return {
    periodStart: annualStart,
    periodEnd: annualEnd,
    periodLabel: String(year),
  };
}

function iterateSupplierPaidRows(
  ctx: SupplierPaymentContext,
  options: {
    supplierKey?: string;
    periodStart?: Date;
    periodEnd?: Date;
    year?: number;
  },
  onMatch: (input: {
    row: FinanceApDashboardRow;
    supplierKey: string;
    supplier: SupplierWithAliases | null;
    display: { name: string; document: string | null };
    paidAmount: number;
    paidAt: Date;
    rowAllocations: AllocationDashboardRow[];
  }) => void
): void {
  const scopeFilters = stripCostCenterDashboardPeriodFilters(ctx.filters);
  const scopeRows = filterCostCenterSupplierScopeRows(
    ctx.rows,
    scopeFilters,
    ctx.referenceDate,
    ctx.syncCutoff,
    "all_in_filter"
  );

  for (const row of scopeRows) {
    const rowAllocations = ctx.allocationsByPayable.get(row.externalId) ?? [];
    const supplier = resolveFinancialSupplier(row, ctx.suppliers);
    if (!matchesSupplierFilter(row, rowAllocations, ctx.filters.supplierId, ctx.suppliers)) {
      continue;
    }

    const key = resolveCostCenterSupplierConsolidationKey(row, supplier);
    if (options.supplierKey && key !== options.supplierKey) continue;

    const paidAt = resolveFinanceApEffectivePaymentDate(row);
    if (!isPaidInWindow(paidAt, options)) continue;

    const paidAmount = resolveSupplierPaidAttributionAmount(row, rowAllocations, ctx.filters);
    if (paidAmount <= 0) continue;

    const display = resolveCostCenterSupplierDisplay(row, supplier);
    onMatch({
      row,
      supplierKey: key,
      supplier,
      display,
      paidAmount,
      paidAt: paidAt!,
      rowAllocations,
    });
  }
}

export function buildCostCenterSupplierPaymentSummary(
  ctx: SupplierPaymentContext
): CostCenterSupplierPaymentSummaryPayload {
  const { periodStart, periodEnd, periodLabel } = resolveSupplierPaymentPeriodBounds(
    ctx.filters,
    ctx.referenceDate
  );

  const acc = new Map<
    string,
    CostCenterSupplierPaymentSummaryRow & {
      titleIds: Set<number>;
      costCenterIds: Set<string>;
      lastPaymentMs: number;
    }
  >();

  iterateSupplierPaidRows(ctx, { periodStart, periodEnd }, (match) => {
    const existing = acc.get(match.supplierKey) ?? {
      supplierKey: match.supplierKey,
      supplierId: match.supplier?.id ?? null,
      supplierName: match.display.name,
      supplierDocument: match.display.document,
      supplierDisplayName: match.display.name,
      totalPaidAmount: 0,
      paidTitlesCount: 0,
      costCentersCount: 0,
      lastPaymentDate: null,
      percentageOfTotalPaid: 0,
      drilldownAvailable: true,
      titleIds: new Set<number>(),
      costCenterIds: new Set<string>(),
      lastPaymentMs: 0,
    };
    existing.totalPaidAmount = finiteMoney(existing.totalPaidAmount + match.paidAmount);
    existing.titleIds.add(match.row.externalId);
    for (const allocation of match.rowAllocations) {
      existing.costCenterIds.add(allocation.costCenterId);
    }
    if (match.paidAt.getTime() > existing.lastPaymentMs) {
      existing.lastPaymentMs = match.paidAt.getTime();
      existing.lastPaymentDate = toCivilDateKey(match.paidAt);
    }
    if (!existing.supplierId && match.supplier?.id) existing.supplierId = match.supplier.id;
    acc.set(match.supplierKey, existing);
  });

  const totalPaidAmountAllSuppliers = finiteMoney(
    [...acc.values()].reduce((sum, row) => sum + row.totalPaidAmount, 0)
  );

  const supplierPaymentSummary = [...acc.values()]
    .map((row) => ({
      supplierKey: row.supplierKey,
      supplierId: row.supplierId,
      supplierName: row.supplierName,
      supplierDocument: row.supplierDocument,
      supplierDisplayName: row.supplierDisplayName,
      totalPaidAmount: row.totalPaidAmount,
      paidTitlesCount: row.titleIds.size,
      costCentersCount: row.costCenterIds.size,
      lastPaymentDate: row.lastPaymentDate,
      percentageOfTotalPaid: finiteMoney(
        safeRatio(row.totalPaidAmount, totalPaidAmountAllSuppliers) * 100
      ),
      drilldownAvailable: true,
    }))
    .sort((a, b) => b.totalPaidAmount - a.totalPaidAmount);

  return {
    supplierPaymentSummary,
    totalPaidAmountAllSuppliers,
    suppliersCount: supplierPaymentSummary.length,
    periodLabel,
    paymentDateRuleNote: COST_CENTER_SUPPLIER_PAYMENT_DATE_RULE_NOTE,
    filtersApplied: toFiltersAppliedPayload(ctx.filters),
    metricsSource: COST_CENTER_SUPPLIER_PAYMENT_METRICS_SOURCE,
    officialApSource: OFFICIAL_AP_RULES_SOURCE,
  };
}

export function buildCostCenterSupplierPaymentYears(
  ctx: SupplierPaymentContext,
  supplierKey: string,
  supplierDisplayName: string
): CostCenterSupplierPaymentYearsPayload {
  const byYear = new Map<
    number,
    { totalPaidAmount: number; titleIds: Set<number>; monthly: Map<number, number> }
  >();

  iterateSupplierPaidRows(ctx, { supplierKey }, (match) => {
    const year = match.paidAt.getFullYear();
    const bucket = byYear.get(year) ?? {
      totalPaidAmount: 0,
      titleIds: new Set<number>(),
      monthly: new Map<number, number>(),
    };
    bucket.totalPaidAmount = finiteMoney(bucket.totalPaidAmount + match.paidAmount);
    bucket.titleIds.add(match.row.externalId);
    const month = match.paidAt.getMonth() + 1;
    bucket.monthly.set(month, finiteMoney((bucket.monthly.get(month) ?? 0) + match.paidAmount));
    byYear.set(year, bucket);
  });

  const years = [...byYear.entries()]
    .map(([year, bucket]) => {
      let peakMonthLabel: string | null = null;
      let peakMonthAmount: number | null = null;
      for (const [month, amount] of bucket.monthly.entries()) {
        if (peakMonthAmount == null || amount > peakMonthAmount) {
          peakMonthAmount = amount;
          peakMonthLabel = MONTH_LABELS[month - 1] ?? String(month);
        }
      }
      const monthsWithValue = bucket.monthly.size;
      return {
        year,
        totalPaidAmount: bucket.totalPaidAmount,
        paidTitlesCount: bucket.titleIds.size,
        averageMonthlyPaidAmount:
          monthsWithValue > 0
            ? finiteMoney(bucket.totalPaidAmount / monthsWithValue)
            : null,
        peakMonthLabel,
        peakMonthAmount,
      };
    })
    .sort((a, b) => b.year - a.year);

  const totalPaidAmount = finiteMoney(years.reduce((sum, row) => sum + row.totalPaidAmount, 0));
  const paidTitlesCount = years.reduce((sum, row) => sum + row.paidTitlesCount, 0);

  return {
    supplierKey,
    supplierDisplayName,
    years,
    totalPaidAmount,
    paidTitlesCount,
    filtersApplied: toFiltersAppliedPayload(ctx.filters),
    note: "Histórico anual do fornecedor com os filtros gerenciais aplicáveis (centro de custo, classificação, empresa e fornecedor).",
  };
}

export function buildCostCenterSupplierPaymentTitles(
  ctx: SupplierPaymentContext,
  supplierKey: string,
  supplierDisplayName: string,
  year: number,
  page = 1,
  pageSize = 50,
  search = ""
): CostCenterSupplierPaymentTitlesPayload {
  const paidWindow = resolvePaidTitlesWindow(ctx, year);
  const matches: CostCenterSupplierPaymentTitleRow[] = [];
  const supplierDocument =
    ctx.suppliers.find((supplier) => `fs:${supplier.id}` === supplierKey)?.normalizedDocument ?? null;

  iterateSupplierPaidRows(
    ctx,
    {
      supplierKey,
      periodStart: paidWindow.periodStart,
      periodEnd: paidWindow.periodEnd,
      year: paidWindow.year,
    },
    (match) => {
    const cc = resolveCostCenterLabels(
      match.rowAllocations,
      ctx.ccMeta,
      ctx.filters.costCenterId
    );
    const status = classifyFinanceApTitle(match.row, ctx.referenceDate);
    const operational =
      toCivilDateKey(match.row.paymentDate) ??
      toCivilDateKey(match.row.settlementDate);
    const drilldownRow = match.row as FinanceApPaymentDrilldownRow;
    matches.push({
      accountsPayableId: match.row.externalId,
      paymentDate: toCivilDateKey(match.paidAt),
      operationalPaymentDate: operational,
      dueDate: toCivilDateKey(match.row.dueDate),
      issueDate: resolveTitleIssueDate(drilldownRow),
      documentNumber: match.row.documentNumber,
      sourceInvoiceId: match.row.sourceInvoiceId,
      sourceInvoiceNumber: drilldownRow.sourceInvoiceNumber ?? null,
      description: match.row.description,
      descriptiveText: resolveTitleDescriptiveText(drilldownRow),
      costCenterName: cc.name,
      costCenterCode: cc.code,
      amountPayable: finiteMoney(Math.abs(match.row.amountPayable)),
      paidAmount: match.paidAmount,
      statusLabel: status,
      companyName: match.row.companyName,
      nomusClassification: drilldownRow.classification ?? null,
    });
  });

  const normalizedSearch = search.trim().toLowerCase();
  const filtered = normalizedSearch
    ? matches.filter((row) =>
        [
          row.documentNumber,
          row.description,
          row.descriptiveText,
          row.costCenterName,
          row.companyName,
          String(row.accountsPayableId),
          row.sourceInvoiceId != null ? String(row.sourceInvoiceId) : null,
          row.sourceInvoiceNumber,
        ]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(normalizedSearch))
      )
    : matches;

  filtered.sort((a, b) => {
    const dateCmp = (b.paymentDate ?? "").localeCompare(a.paymentDate ?? "");
    if (dateCmp !== 0) return dateCmp;
    return b.accountsPayableId - a.accountsPayableId;
  });

  const totalPaidAmount = finiteMoney(filtered.reduce((sum, row) => sum + row.paidAmount, 0));
  const safePageSize = Math.min(Math.max(pageSize, 1), 200);
  const totalPages = Math.max(1, Math.ceil(filtered.length / safePageSize));
  const safePage = Math.min(Math.max(page, 1), totalPages);
  const start = (safePage - 1) * safePageSize;
  const items = filtered.slice(start, start + safePageSize);

  return {
    supplierKey,
    supplierDisplayName,
    supplierDocument: supplierDocument ?? matchSupplierDocument(ctx, supplierKey),
    year,
    periodLabel: paidWindow.periodLabel,
    periodScopeNote: SUPPLIER_PAYMENT_PERIOD_SCOPE_NOTE,
    items,
    totalPaidAmount,
    paidTitlesCount: filtered.length,
    page: safePage,
    pageSize: safePageSize,
    totalPages,
    filtersApplied: toFiltersAppliedPayload(ctx.filters),
  };
}

function matchSupplierDocument(ctx: SupplierPaymentContext, supplierKey: string): string | null {
  let found: string | null = null;
  iterateSupplierPaidRows(ctx, { supplierKey }, (match) => {
    if (!found) {
      found = resolveCostCenterSupplierDisplay(match.row, match.supplier).document;
    }
  });
  return found;
}

export async function loadCostCenterSupplierPaymentContext(
  filters: FinanceCostCenterDashboardFilters,
  referenceDate: Date = new Date()
): Promise<SupplierPaymentContext> {
  const deps = createDefaultFinanceCostCenterDashboardDeps();
  const syncCutoff = await deps.resolveSyncCutoff();
  const scopeFilters = stripCostCenterDashboardPeriodFilters(filters);
  const where = buildFinanceApPrismaWhere(scopeFilters, syncCutoff);
  const rows =
    where.externalId === -1
      ? []
      : (
          await prisma.nomusAccountsPayable.findMany({
            where,
            select: SUPPLIER_PAYMENT_DRILLDOWN_AP_SELECT,
            orderBy: { dueDate: "asc" },
          })
        ).map(mapPrismaRowToPaymentDrilldownRow);
  const allocationIds = rows.map((row) => row.externalId);
  const allocations = await deps.loadAllocations(allocationIds);
  const allocationsByPayable = new Map<number, AllocationDashboardRow[]>();
  for (const allocation of allocations) {
    const list = allocationsByPayable.get(allocation.accountsPayableId) ?? [];
    list.push(allocation);
    allocationsByPayable.set(allocation.accountsPayableId, list);
  }
  const costCenters = await deps.loadCostCenters();
  const suppliers = await deps.loadSuppliers();
  const ccMeta = new Map(costCenters.map((row) => [row.id, row]));

  return {
    rows,
    allocationsByPayable,
    suppliers,
    ccMeta,
    filters,
    referenceDate,
    syncCutoff,
  };
}

export {
  parseFinanceCostCenterDashboardFilters,
  COST_CENTER_UNIDENTIFIED_SUPPLIER_LABEL,
};
