/**
 * Drilldown de títulos AP por fornecedor — aba Fornecedores (Centro de Custo).
 * Reutiliza a mesma base do grid: vencimento, apScope e chave de consolidação.
 */
import {
  classifyFinanceApTitle,
  roundMoney,
  type FinanceApDashboardRow,
} from "@/src/lib/financeAccountsPayableDashboard.js";
import { resolveFinanceApEffectivePaymentDate } from "@/src/lib/financeAccountsPayableRules.js";
import {
  isTitleFullyClassified,
  isTitleRealAllocated,
  resolveCostCenterTitleAmount,
} from "@/src/lib/financeCostCenterAllocationMetrics.js";
import {
  resolveFinanceCostCenterDashboardApScope,
  type FinanceCostCenterDashboardFilters,
} from "@/src/lib/financeCostCenterDashboard.js";
import { toCivilDateKey } from "@/src/lib/financeCivilDate.js";
import {
  filterCostCenterSupplierScopeRows,
  resolveCostCenterSupplierConsolidationKey,
  resolveCostCenterSupplierDisplay,
  buildCostCenterConsolidatedSuppliers,
  type CostCenterSupplierClassificationFilter,
} from "@/src/lib/financeCostCenterSupplierConsolidation.js";
import type { FinanceApPaymentDrilldownRow } from "@/src/lib/financeCostCenterSupplierPaymentDrilldown.js";
import {
  loadCostCenterSupplierPaymentContext,
  type PaymentDrilldownAllocationRow,
} from "@/src/lib/financeCostCenterSupplierPaymentDrilldown.js";
import type { CostCenterSupplierPaymentTitleRow } from "@/src/lib/financeCostCenterSupplierPaymentDrilldown.shared.js";
import {
  COST_CENTER_SUPPLIER_TITLES_DATE_RULE_NOTE,
  COST_CENTER_SUPPLIER_TITLES_METRICS_SOURCE,
  COST_CENTER_SUPPLIER_TITLES_PERIOD_SCOPE_NOTE,
  type CostCenterSupplierTitlesPayload,
} from "@/src/lib/financeCostCenterSupplierTitlesDrilldown.shared.js";
import { formatAccountsPayableDescriptiveText } from "@/src/lib/financeAccountsPayableDescriptiveText.js";
import { resolveApClassificationOriginLabel } from "@/src/lib/financeAccountsPayableCostCenterIntegration.js";
import {
  accountsPayableMatchesFinancialSupplier,
  type SupplierWithAliases,
} from "@/src/lib/financeSupplierCostCenterRules.js";
import {
  matchesPaidTitleListFilters,
  matchesPaidTitleSearch,
  PAID_TITLE_UNCLASSIFIED_LABEL,
  type PaidTitleListFilters,
} from "@/src/lib/financePaidTitlesModalFilters.js";
import type { CostCenterMetaRow } from "@/src/lib/financeCostCenterDashboard.js";

export {
  COST_CENTER_SUPPLIER_TITLES_DATE_RULE_NOTE,
  COST_CENTER_SUPPLIER_TITLES_METRICS_SOURCE,
  type CostCenterSupplierTitlesPayload,
};

export { loadCostCenterSupplierPaymentContext };

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

type SupplierTitlesContext = Awaited<ReturnType<typeof loadCostCenterSupplierPaymentContext>>;

function finiteMoney(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return roundMoney(value);
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
  allocations: PaymentDrilldownAllocationRow[],
  supplierId: string | undefined,
  suppliers: SupplierWithAliases[]
): boolean {
  if (!supplierId) return true;
  if (allocations.some((allocation) => allocation.supplierId === supplierId)) return true;
  const supplier = resolveFinancialSupplier(row, suppliers);
  return supplier?.id === supplierId;
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

function resolveSupplierTitlesPeriodLabel(
  filters: FinanceCostCenterDashboardFilters,
  referenceDate: Date
): string {
  const year = filters.year ?? referenceDate.getFullYear();
  if (filters.month != null && filters.month >= 1 && filters.month <= 12) {
    const monthName = MONTH_LABELS[filters.month - 1] ?? String(filters.month).padStart(2, "0");
    return `${monthName}/${year}`;
  }
  return String(year);
}

function resolveCostCenterLabels(
  rowAllocations: PaymentDrilldownAllocationRow[],
  ccMeta: Map<string, CostCenterMetaRow>,
  costCenterFilter?: string
): { name: string; code: string | null } {
  const applicable = costCenterFilter
    ? rowAllocations.filter((a) => a.costCenterId === costCenterFilter)
    : rowAllocations;
  if (applicable.length === 0) {
    return { name: PAID_TITLE_UNCLASSIFIED_LABEL, code: null };
  }
  const names = [
    ...new Set(applicable.map((a) => ccMeta.get(a.costCenterId)?.name ?? a.costCenterId)),
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

function resolveTitleClassificationMeta(allocations: PaymentDrilldownAllocationRow[]) {
  const primary = allocations[0];
  const primaryCostCenterId = primary?.costCenterId ?? null;
  const isManualClassification = allocations.some(
    (allocation) => allocation.source === "MANUAL" || allocation.lockedManual
  );
  return {
    primaryCostCenterId,
    isManualClassification,
    classificationOriginLabel: resolveApClassificationOriginLabel(
      allocations as Parameters<typeof resolveApClassificationOriginLabel>[0]
    ),
  };
}

function toFiltersAppliedPayload(filters: FinanceCostCenterDashboardFilters) {
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

export function iterateSupplierScopeTitleRows(
  ctx: SupplierTitlesContext,
  options: { supplierKey: string },
  onMatch: (input: {
    row: FinanceApDashboardRow;
    supplierKey: string;
    supplier: SupplierWithAliases | null;
    display: { name: string; document: string | null };
    titleAmount: number;
    rowAllocations: PaymentDrilldownAllocationRow[];
  }) => void
): void {
  const apScope = resolveFinanceCostCenterDashboardApScope(ctx.filters);
  const scopeRows = filterCostCenterSupplierScopeRows(
    ctx.rows,
    ctx.filters,
    ctx.referenceDate,
    ctx.syncCutoff,
    apScope
  );

  for (const row of scopeRows) {
    const rowAllocations = ctx.allocationsByPayable.get(row.externalId) ?? [];
    const titleAmount = resolveCostCenterTitleAmount(row, apScope);
    if (titleAmount <= 0) continue;

    const fullyAllocated = isTitleRealAllocated(rowAllocations, titleAmount);
    if (!matchesSupplierFilter(row, rowAllocations, ctx.filters.supplierId, ctx.suppliers)) {
      continue;
    }
    if (!matchesClassificationFilter(fullyAllocated, ctx.filters.classification)) continue;

    const costCenterFilter = ctx.filters.costCenterId;
    if (
      costCenterFilter &&
      !rowAllocations.some((allocation) => allocation.costCenterId === costCenterFilter)
    ) {
      continue;
    }

    const supplier = resolveFinancialSupplier(row, ctx.suppliers);
    const key = resolveCostCenterSupplierConsolidationKey(row, supplier);
    if (key !== options.supplierKey) continue;

    const display = resolveCostCenterSupplierDisplay(row, supplier);
    onMatch({
      row,
      supplierKey: key,
      supplier,
      display,
      titleAmount,
      rowAllocations,
    });
  }
}

export function buildCostCenterSupplierTitles(
  ctx: SupplierTitlesContext,
  supplierKey: string,
  supplierDisplayName: string,
  page = 1,
  pageSize = 50,
  listFilters: PaidTitleListFilters = {
    search: "",
    costCenterFilter: "all",
    classificationStatus: "all",
  }
): CostCenterSupplierTitlesPayload {
  const apScope = resolveFinanceCostCenterDashboardApScope(ctx.filters);
  const periodLabel = resolveSupplierTitlesPeriodLabel(ctx.filters, ctx.referenceDate);
  const matches: CostCenterSupplierPaymentTitleRow[] = [];
  const supplierDocument =
    ctx.suppliers.find((supplier) => `fs:${supplier.id}` === supplierKey)?.normalizedDocument ?? null;

  iterateSupplierScopeTitleRows(ctx, { supplierKey }, (match) => {
    const cc = resolveCostCenterLabels(match.rowAllocations, ctx.ccMeta, ctx.filters.costCenterId);
    const status = classifyFinanceApTitle(match.row, ctx.referenceDate);
    const paidAt = resolveFinanceApEffectivePaymentDate(match.row);
    const operational =
      toCivilDateKey(match.row.paymentDate) ?? toCivilDateKey(match.row.settlementDate);
    const drilldownRow = match.row as FinanceApPaymentDrilldownRow;
    const classificationMeta = resolveTitleClassificationMeta(match.rowAllocations);
    const hasCostCenterClassification = isTitleFullyClassified(match.rowAllocations, match.titleAmount);
    const costCenterIds = [
      ...new Set(match.rowAllocations.map((allocation) => allocation.costCenterId)),
    ];
    matches.push({
      accountsPayableId: match.row.externalId,
      paymentDate: paidAt ? toCivilDateKey(paidAt) : null,
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
      amountPayable: finiteMoney(Math.abs(match.row.amountPayable ?? 0)),
      paidAmount: match.titleAmount,
      statusLabel: status,
      companyName: match.row.companyName,
      nomusClassification: drilldownRow.classification ?? null,
      classificationOriginLabel: classificationMeta.classificationOriginLabel,
      isManualClassification: classificationMeta.isManualClassification,
      primaryCostCenterId: classificationMeta.primaryCostCenterId,
      hasCostCenterClassification,
      costCenterIds,
    });
  });

  const filtered = matches
    .filter((row) => matchesPaidTitleListFilters(row, listFilters))
    .filter((row) => matchesPaidTitleSearch(row, listFilters.search));

  filtered.sort((a, b) => {
    const dateCmp = (b.dueDate ?? "").localeCompare(a.dueDate ?? "");
    if (dateCmp !== 0) return dateCmp;
    return b.accountsPayableId - a.accountsPayableId;
  });

  const totalTitleAmount = finiteMoney(filtered.reduce((sum, row) => sum + row.paidAmount, 0));
  const safePageSize = Math.min(Math.max(pageSize, 1), 200);
  const totalPages = Math.max(1, Math.ceil(filtered.length / safePageSize));
  const safePage = Math.min(Math.max(page, 1), totalPages);
  const start = (safePage - 1) * safePageSize;
  const items = filtered.slice(start, start + safePageSize);
  const costCenterOptions = [...ctx.ccMeta.values()]
    .filter((center) => center.status === "ACTIVE")
    .map((center) => ({ id: center.id, code: center.code, name: center.name }))
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));

  return {
    supplierKey,
    supplierDisplayName,
    supplierDocument: supplierDocument ?? resolveSupplierDocumentFromScope(ctx, supplierKey),
    periodLabel,
    periodScopeNote: COST_CENTER_SUPPLIER_TITLES_PERIOD_SCOPE_NOTE,
    items,
    totalTitleAmount,
    titlesCount: filtered.length,
    page: safePage,
    pageSize: safePageSize,
    totalPages,
    filtersApplied: toFiltersAppliedPayload(ctx.filters),
    listFiltersApplied: {
      search: listFilters.search,
      costCenterFilter: listFilters.costCenterFilter,
      classificationStatus: listFilters.classificationStatus,
    },
    costCenterOptions,
    dateRuleNote: COST_CENTER_SUPPLIER_TITLES_DATE_RULE_NOTE,
    metricsSource: COST_CENTER_SUPPLIER_TITLES_METRICS_SOURCE,
  };
}

function resolveSupplierDocumentFromScope(
  ctx: SupplierTitlesContext,
  supplierKey: string
): string | null {
  let found: string | null = null;
  iterateSupplierScopeTitleRows(ctx, { supplierKey }, (match) => {
    if (!found) found = match.display.document;
  });
  return found;
}

/** Valida que o drilldown bate com a consolidação do grid para um fornecedor. */
export function resolveSupplierGridDrilldownTotals(
  ctx: SupplierTitlesContext,
  supplierKey: string
): { titlesCount: number; totalTitleAmount: number } {
  const apScope = resolveFinanceCostCenterDashboardApScope(ctx.filters);
  const scopeRows = filterCostCenterSupplierScopeRows(
    ctx.rows,
    ctx.filters,
    ctx.referenceDate,
    ctx.syncCutoff,
    apScope
  );
  const consolidated = buildCostCenterConsolidatedSuppliers(
    scopeRows,
    ctx.allocationsByPayable,
    ctx.suppliers,
    ctx.filters,
    apScope
  );
  const row = consolidated.get(supplierKey);
  return {
    titlesCount: row?.titleIds.size ?? 0,
    totalTitleAmount: finiteMoney(row?.amount ?? 0),
  };
}
