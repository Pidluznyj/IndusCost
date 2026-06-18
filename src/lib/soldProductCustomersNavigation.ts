/** Navegação — Clientes compradores do produto vendido. */

import { buildSoldProductsDashboardQuery } from "./salesProductRankingFilters.js";
import type { SoldProductsUiFilters } from "./salesProductRankingTypes.js";

export const SOLD_PRODUCT_CUSTOMERS_ROUTE = "/sales-orders/sold-products/:productId/customers";

export function buildSoldProductCustomersPath(
  productId: string,
  filters?: Partial<SoldProductsUiFilters> & Record<string, string>
): string {
  const base = `/sales-orders/sold-products/${encodeURIComponent(productId)}/customers`;
  if (!filters || Object.keys(filters).length === 0) return base;
  const qs = buildSoldProductsDashboardQuery({
    startDate: filters.startDate ?? "",
    endDate: filters.endDate ?? "",
    year: filters.year ?? "",
    month: filters.month ?? "",
    dateBasis: (filters.dateBasis as SoldProductsUiFilters["dateBasis"]) ?? "issueDate",
    customerName: filters.customerName ?? "",
    customerTaxId: filters.customerTaxId ?? "",
    customerId: filters.customerId ?? "",
    productId: filters.productId ?? "",
    productCode: filters.productCode ?? "",
    productName: filters.productName ?? "",
    sellerKey: filters.sellerKey ?? "",
    company: (filters.company as SoldProductsUiFilters["company"]) ?? "all",
    orderStatus: (filters.orderStatus as SoldProductsUiFilters["orderStatus"]) ?? "valid",
    customerScope: (filters.customerScope as SoldProductsUiFilters["customerScope"]) ?? "external",
    sortBy: (filters.sortBy as SoldProductsUiFilters["sortBy"]) ?? "quantity",
    topN: (filters.topN as SoldProductsUiFilters["topN"]) ?? "50",
  });
  const extra = new URLSearchParams(qs);
  for (const [key, value] of Object.entries(filters)) {
    if (
      [
        "startDate",
        "endDate",
        "year",
        "month",
        "dateBasis",
        "customerName",
        "customerTaxId",
        "customerId",
        "productId",
        "productCode",
        "productName",
        "sellerKey",
        "company",
        "orderStatus",
        "customerScope",
        "sortBy",
        "topN",
      ].includes(key)
    ) {
      continue;
    }
    if (value.trim()) extra.set(key, value.trim());
  }
  const query = extra.toString();
  return query ? `${base}?${query}` : base;
}

export function buildSoldProductCustomersApiPath(
  productId: string,
  query?: string
): string {
  const base = `/api/commercial/sold-products/${encodeURIComponent(productId)}/customers`;
  if (!query || query === "") return base;
  return `${base}?${query.startsWith("?") ? query.slice(1) : query}`;
}

export function buildCustomerRegistrationPath(customerId: string): string {
  return `/customers?edit=${encodeURIComponent(customerId)}`;
}
