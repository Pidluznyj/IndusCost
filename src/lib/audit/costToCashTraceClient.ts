import { fetchJsonOk } from "../http.js";
import type { CostToCashTraceApiResponse } from "./costToCashTraceApi.js";
import type { CostToCashTracePageSections } from "./costToCashTracePageView.js";

export type CostToCashTraceSearchFilters = {
  sku?: string;
  productId?: string;
  orderNumber?: string;
  salesOrderId?: string;
  nfeNumber?: string;
  receivableCode?: string;
  customer?: string;
  seller?: string;
  year?: string;
  month?: string;
  tableCode?: string;
};

export type CostToCashTraceApiPayload = CostToCashTraceApiResponse<CostToCashTracePageSections>;

export const EMPTY_COST_TO_CASH_FILTERS: CostToCashTraceSearchFilters = {
  sku: "",
  productId: "",
  orderNumber: "",
  salesOrderId: "",
  nfeNumber: "",
  receivableCode: "",
  customer: "",
  seller: "",
  year: "",
  month: "",
  tableCode: "",
};

function appendParam(params: URLSearchParams, key: string, value: string | undefined): void {
  const trimmed = value?.trim();
  if (trimmed) params.set(key, trimmed);
}

export function buildCostToCashTraceSearchParams(
  filters: CostToCashTraceSearchFilters
): URLSearchParams {
  const params = new URLSearchParams();
  appendParam(params, "sku", filters.sku);
  appendParam(params, "productId", filters.productId);
  appendParam(params, "orderNumber", filters.orderNumber);
  appendParam(params, "salesOrderId", filters.salesOrderId);
  appendParam(params, "nfeNumber", filters.nfeNumber);
  appendParam(params, "receivableCode", filters.receivableCode);
  appendParam(params, "customer", filters.customer);
  appendParam(params, "seller", filters.seller);
  appendParam(params, "year", filters.year);
  appendParam(params, "month", filters.month);
  appendParam(params, "tableCode", filters.tableCode);
  return params;
}

export function buildCostToCashTraceApiUrl(filters: CostToCashTraceSearchFilters): string {
  const qs = buildCostToCashTraceSearchParams(filters).toString();
  return qs ? `/api/audit/cost-to-cash-trace?${qs}` : "/api/audit/cost-to-cash-trace";
}

export function hasCostToCashSearchCriteria(filters: CostToCashTraceSearchFilters): boolean {
  return Boolean(
    filters.sku?.trim() ||
      filters.productId?.trim() ||
      filters.orderNumber?.trim() ||
      filters.salesOrderId?.trim() ||
      filters.nfeNumber?.trim() ||
      filters.receivableCode?.trim() ||
      (filters.customer?.trim() && filters.year?.trim())
  );
}

export async function fetchCostToCashTrace(
  filters: CostToCashTraceSearchFilters
): Promise<CostToCashTraceApiPayload> {
  return fetchJsonOk<CostToCashTraceApiPayload>(buildCostToCashTraceApiUrl(filters));
}
