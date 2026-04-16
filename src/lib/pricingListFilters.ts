import { normalizeSearchString } from "@/src/lib/utils";

export type PricingListRow = {
  id: string;
  taxRuleId?: string | null;
  desiredMargin?: unknown;
  commission?: unknown;
  Product?: {
    name?: string | null;
    sku?: string | null;
  } | null;
  TaxRule?: {
    name?: string | null;
  } | null;
};

export type PricingMarginBand = "ALL" | "NEGATIVE" | "UP_TO_10" | "FROM_10_TO_20" | "ABOVE_20";
export type PricingCommissionBand = "ALL" | "ZERO" | "UP_TO_5" | "FROM_5_TO_10" | "ABOVE_10";
export type PricingSortKey = "NAME_ASC" | "SKU_ASC" | "MARGIN_DESC" | "MARGIN_ASC";

export type PricingListFilters = {
  search: string;
  taxRuleId: string;
  marginBand: PricingMarginBand;
  commissionBand: PricingCommissionBand;
  sortBy: PricingSortKey;
};

function safeNumber(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(n) ? n : null;
}

function matchesMarginBand(value: number | null, band: PricingMarginBand): boolean {
  if (band === "ALL") return true;
  if (value == null) return false;
  if (band === "NEGATIVE") return value < 0;
  if (band === "UP_TO_10") return value >= 0 && value < 10;
  if (band === "FROM_10_TO_20") return value >= 10 && value <= 20;
  return value > 20;
}

function matchesCommissionBand(value: number | null, band: PricingCommissionBand): boolean {
  if (band === "ALL") return true;
  if (value == null) return false;
  if (band === "ZERO") return value === 0;
  if (band === "UP_TO_5") return value > 0 && value <= 5;
  if (band === "FROM_5_TO_10") return value > 5 && value <= 10;
  return value > 10;
}

export function filterAndSortPricingRows(rows: PricingListRow[], filters: PricingListFilters): PricingListRow[] {
  const search = normalizeSearchString(filters.search.trim());

  const filtered = rows.filter((row) => {
    const name = row.Product?.name?.trim() ?? "";
    const sku = row.Product?.sku?.trim() ?? "";
    const taxRuleId = row.taxRuleId ?? "";
    const haystack = normalizeSearchString(`${name} ${sku}`);
    const margin = safeNumber(row.desiredMargin);
    const commission = safeNumber(row.commission);

    if (search && !haystack.includes(search)) return false;
    if (filters.taxRuleId && taxRuleId !== filters.taxRuleId) return false;
    if (!matchesMarginBand(margin, filters.marginBand)) return false;
    if (!matchesCommissionBand(commission, filters.commissionBand)) return false;
    return true;
  });

  return [...filtered].sort((a, b) => {
    const nameA = normalizeSearchString(a.Product?.name ?? "");
    const nameB = normalizeSearchString(b.Product?.name ?? "");
    const skuA = normalizeSearchString(a.Product?.sku ?? "");
    const skuB = normalizeSearchString(b.Product?.sku ?? "");
    const marginA = safeNumber(a.desiredMargin) ?? Number.NEGATIVE_INFINITY;
    const marginB = safeNumber(b.desiredMargin) ?? Number.NEGATIVE_INFINITY;

    switch (filters.sortBy) {
      case "SKU_ASC":
        return skuA.localeCompare(skuB) || nameA.localeCompare(nameB);
      case "MARGIN_DESC":
        return marginB - marginA || nameA.localeCompare(nameB);
      case "MARGIN_ASC":
        return marginA - marginB || nameA.localeCompare(nameB);
      case "NAME_ASC":
      default:
        return nameA.localeCompare(nameB) || skuA.localeCompare(skuB);
    }
  });
}

export function pricingListSafeNumber(value: unknown): number | null {
  return safeNumber(value);
}
