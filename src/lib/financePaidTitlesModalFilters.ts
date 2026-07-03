import type { CostCenterSupplierPaymentTitleRow } from "@/src/lib/financeCostCenterSupplierPaymentDrilldown.shared";

export const PAID_TITLE_UNCLASSIFIED_LABEL = "Sem centro de custo classificado";

export type PaidTitleCostCenterFilter = "all" | "unclassified" | (string & {});

export type PaidTitleClassificationStatusFilter = "all" | "pending" | "manual" | "auto";

export type PaidTitleListFilters = {
  search: string;
  costCenterFilter: PaidTitleCostCenterFilter;
  classificationStatus: PaidTitleClassificationStatusFilter;
};

export function createDefaultPaidTitleListFilters(input?: {
  prioritizePending?: boolean;
}): PaidTitleListFilters {
  const prioritizePending = input?.prioritizePending ?? false;
  return {
    search: "",
    costCenterFilter: prioritizePending ? "unclassified" : "all",
    classificationStatus: prioritizePending ? "pending" : "all",
  };
}

export function resolvePaidTitleListDefaultFilters(supplier: {
  hasActiveRule: boolean;
}): PaidTitleListFilters {
  return createDefaultPaidTitleListFilters({ prioritizePending: !supplier.hasActiveRule });
}

export function parsePaidTitleListFilters(
  query: Record<string, unknown>,
  defaults?: PaidTitleListFilters
): PaidTitleListFilters {
  const base = defaults ?? createDefaultPaidTitleListFilters();
  const search = typeof query.search === "string" ? query.search : base.search;
  const costCenterRaw =
    typeof query.costCenterFilter === "string"
      ? query.costCenterFilter.trim()
      : typeof query.costCenterId === "string"
        ? query.costCenterId.trim()
        : base.costCenterFilter;
  const costCenterFilter: PaidTitleCostCenterFilter =
    costCenterRaw === "all" || costCenterRaw === "unclassified" || costCenterRaw
      ? (costCenterRaw as PaidTitleCostCenterFilter)
      : base.costCenterFilter;
  const classificationRaw =
    typeof query.classificationStatus === "string"
      ? query.classificationStatus.trim()
      : base.classificationStatus;
  const classificationStatus: PaidTitleClassificationStatusFilter =
    classificationRaw === "all" ||
    classificationRaw === "pending" ||
    classificationRaw === "manual" ||
    classificationRaw === "auto"
      ? classificationRaw
      : base.classificationStatus;
  return { search, costCenterFilter, classificationStatus };
}

export function isPaidTitlePendingClassification(input: {
  isManualClassification: boolean;
  hasCostCenterClassification: boolean;
}): boolean {
  return !input.isManualClassification && !input.hasCostCenterClassification;
}

export function isPaidTitleAutoClassification(input: {
  isManualClassification: boolean;
  hasCostCenterClassification: boolean;
}): boolean {
  return input.hasCostCenterClassification && !input.isManualClassification;
}

export function matchesPaidTitleCostCenterFilter(
  row: Pick<
    CostCenterSupplierPaymentTitleRow,
    "primaryCostCenterId" | "costCenterName" | "costCenterIds"
  >,
  filter: PaidTitleCostCenterFilter
): boolean {
  if (filter === "all") return true;
  if (filter === "unclassified") {
    return row.costCenterIds.length === 0 || row.costCenterName === PAID_TITLE_UNCLASSIFIED_LABEL;
  }
  return row.costCenterIds.includes(filter);
}

export function matchesPaidTitleClassificationStatusFilter(
  row: Pick<
    CostCenterSupplierPaymentTitleRow,
    "isManualClassification" | "hasCostCenterClassification"
  >,
  filter: PaidTitleClassificationStatusFilter
): boolean {
  if (filter === "all") return true;
  if (filter === "manual") return row.isManualClassification;
  if (filter === "auto") {
    return isPaidTitleAutoClassification(row);
  }
  return isPaidTitlePendingClassification(row);
}

export function matchesPaidTitleListFilters(
  row: CostCenterSupplierPaymentTitleRow,
  filters: Pick<PaidTitleListFilters, "costCenterFilter" | "classificationStatus">
): boolean {
  return (
    matchesPaidTitleCostCenterFilter(row, filters.costCenterFilter) &&
    matchesPaidTitleClassificationStatusFilter(row, filters.classificationStatus)
  );
}

export function matchesPaidTitleSearch(
  row: CostCenterSupplierPaymentTitleRow,
  search: string
): boolean {
  const normalizedSearch = search.trim().toLowerCase();
  if (!normalizedSearch) return true;
  return [
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
    .some((value) => String(value).toLowerCase().includes(normalizedSearch));
}
