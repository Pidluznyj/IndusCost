/** Filtros da previsão por vencimento — serialização para API. */
export type ReceivableForecastFilters = {
  commissionPersonId: string;
  customer: string;
  orderCode: string;
  nfeNumber: string;
  nomusReceivableId: string;
  receivableTitleStatus: string;
  commissionStatus: string;
  dueDateFrom: string;
  dueDateTo: string;
  horizonMonths: string;
  onlyDivergences: boolean;
  page: number;
  pageSize: number;
};

export const EMPTY_RECEIVABLE_FORECAST_FILTERS: ReceivableForecastFilters = {
  commissionPersonId: "",
  customer: "",
  orderCode: "",
  nfeNumber: "",
  nomusReceivableId: "",
  receivableTitleStatus: "",
  commissionStatus: "",
  dueDateFrom: "",
  dueDateTo: "",
  horizonMonths: "12",
  onlyDivergences: false,
  page: 1,
  pageSize: 50,
};

export function buildReceivableForecastQueryString(filters: ReceivableForecastFilters): string {
  const q = new URLSearchParams();
  if (filters.commissionPersonId.trim()) {
    q.set("commissionPersonId", filters.commissionPersonId.trim());
  }
  if (filters.customer.trim()) q.set("customer", filters.customer.trim());
  if (filters.orderCode.trim()) q.set("orderCode", filters.orderCode.trim());
  if (filters.nfeNumber.trim()) q.set("nfeNumber", filters.nfeNumber.trim());
  if (filters.nomusReceivableId.trim()) {
    q.set("nomusReceivableId", filters.nomusReceivableId.trim());
  }
  if (filters.receivableTitleStatus.trim()) {
    q.set("receivableTitleStatus", filters.receivableTitleStatus.trim());
  }
  if (filters.commissionStatus.trim()) {
    q.set("commissionStatus", filters.commissionStatus.trim());
  }
  if (filters.dueDateFrom.trim()) q.set("dueDateFrom", filters.dueDateFrom.trim());
  if (filters.dueDateTo.trim()) q.set("dueDateTo", filters.dueDateTo.trim());
  if (filters.horizonMonths.trim()) q.set("horizonMonths", filters.horizonMonths.trim());
  if (filters.onlyDivergences) q.set("onlyDivergences", "true");
  q.set("page", String(filters.page));
  q.set("pageSize", String(filters.pageSize));
  return q.toString();
}

export function buildReceivableForecastExportQueryString(
  filters: ReceivableForecastFilters,
  format: "monthly" | "detail" | "full"
): string {
  const base = buildReceivableForecastQueryString({ ...filters, page: 1, pageSize: 100000 });
  const q = new URLSearchParams(base);
  q.set("format", format);
  return q.toString();
}
