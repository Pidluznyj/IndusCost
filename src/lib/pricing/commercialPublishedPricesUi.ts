import type { PricingCommissionBand, PricingMarginBand, PricingSortKey } from "../pricingListFilters.js";
import type {
  CommercialPublishedPriceGridRow,
  CommercialPublishedPriceGridSort,
  CommercialPublishedPricesApiResponse,
} from "./commercialPublishedPrices.types.js";

export const COMMERCIAL_PUBLISHED_PRICES_ENDPOINT = "/api/pricing/commercial-published-prices";

export const NO_PUBLISHED_COMMERCIAL_TABLES_EMPTY_MESSAGE =
  "Nenhuma tabela comercial publicada vigente.";

export const NO_PUBLISHED_PRODUCTS_FILTER_EMPTY_MESSAGE =
  "Nenhum produto encontrado para os filtros.";

export type CommercialPublishedPriceBandFilters = {
  marginBand: PricingMarginBand;
  commissionBand: PricingCommissionBand;
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

export function resolvePublishedRowMarginPercent(row: CommercialPublishedPriceGridRow): number | null {
  const values = row.prices
    .filter((price) => price.status === "PUBLISHED")
    .map((price) => safeNumber(price.marginPercent))
    .filter((value): value is number => value != null);
  if (values.length === 0) return null;
  return Math.max(...values);
}

export function resolvePublishedRowCommissionPercent(row: CommercialPublishedPriceGridRow): number | null {
  const values = row.prices
    .filter((price) => price.status === "PUBLISHED")
    .map((price) => safeNumber(price.commissionPercent))
    .filter((value): value is number => value != null);
  if (values.length === 0) return null;
  return Math.max(...values);
}

export function filterCommercialPublishedRows(
  rows: CommercialPublishedPriceGridRow[],
  filters: CommercialPublishedPriceBandFilters
): CommercialPublishedPriceGridRow[] {
  return rows.filter((row) => {
    const margin = resolvePublishedRowMarginPercent(row);
    const commission = resolvePublishedRowCommissionPercent(row);
    if (!matchesMarginBand(margin, filters.marginBand)) return false;
    if (!matchesCommissionBand(commission, filters.commissionBand)) return false;
    return true;
  });
}

export function mapPricingSortToPublishedApiSort(sortBy: PricingSortKey): CommercialPublishedPriceGridSort {
  switch (sortBy) {
    case "SKU_ASC":
      return "SKU_ASC";
    case "NAME_ASC":
      return "NAME_ASC";
    case "MARGIN_DESC":
    case "MARGIN_ASC":
      return "SKU_ASC";
    default:
      return "NAME_ASC";
  }
}

export function needsClientBandFiltering(filters: CommercialPublishedPriceBandFilters): boolean {
  return filters.marginBand !== "ALL" || filters.commissionBand !== "ALL";
}

export function buildCommercialPublishedPricesSearchParams(input: {
  search?: string;
  taxRuleId?: string;
  sort?: CommercialPublishedPriceGridSort;
  page?: number;
  pageSize?: number;
}): string {
  const params = new URLSearchParams();
  if (input.search?.trim()) params.set("search", input.search.trim());
  if (input.taxRuleId?.trim()) params.set("taxRuleId", input.taxRuleId.trim());
  if (input.sort) params.set("sort", input.sort);
  if (input.page != null && input.page > 0) params.set("page", String(input.page));
  if (input.pageSize != null && input.pageSize > 0) params.set("pageSize", String(input.pageSize));
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

export function formatPublishedRowStatus(status: CommercialPublishedPriceGridRow["status"]): string {
  switch (status) {
    case "OK":
      return "Completo";
    case "PARTIAL":
      return "Parcial";
    case "NO_PRICE":
      return "Sem preço";
    default:
      return status;
  }
}

export function formatPublishedAtLabel(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function resolveCommercialPublishedEmptyMessage(
  payload: CommercialPublishedPricesApiResponse | null,
  filteredRowCount: number,
  _hasActiveFilters?: boolean
): string | null {
  if (!payload) return null;
  if (payload.tables.length === 0) {
    return NO_PUBLISHED_COMMERCIAL_TABLES_EMPTY_MESSAGE;
  }
  if (filteredRowCount === 0) {
    return NO_PUBLISHED_PRODUCTS_FILTER_EMPTY_MESSAGE;
  }
  return null;
}

export function paginateRows<T>(rows: T[], page: number, pageSize: number) {
  const safePage = Math.max(1, page);
  const safePageSize = Math.max(1, pageSize);
  const total = rows.length;
  const totalPages = Math.max(1, Math.ceil(total / safePageSize));
  const start = (safePage - 1) * safePageSize;
  return {
    rows: rows.slice(start, start + safePageSize),
    pagination: {
      page: safePage,
      limit: safePageSize,
      total,
      totalPages,
    },
  };
}
