/** Filtros do fechamento mensal — serialização para API. */
export type MonthlyClosingFilters = {
  year: string;
  month: string;
  commissionPersonId: string;
  customer: string;
  orderCode: string;
  nfeNumber: string;
  nomusReceivableId: string;
  receivableTitleStatus: string;
  commissionStatus: string;
  onlyDivergences: boolean;
  nomusReferenceBase: string;
  nomusReferenceCommission: string;
  page: number;
  pageSize: number;
};

export const EMPTY_MONTHLY_CLOSING_FILTERS: MonthlyClosingFilters = {
  year: String(new Date().getFullYear()),
  month: String(new Date().getMonth() + 1),
  commissionPersonId: "",
  customer: "",
  orderCode: "",
  nfeNumber: "",
  nomusReceivableId: "",
  receivableTitleStatus: "",
  commissionStatus: "",
  onlyDivergences: false,
  nomusReferenceBase: "",
  nomusReferenceCommission: "",
  page: 1,
  pageSize: 50,
};

export function buildMonthlyClosingQueryString(filters: MonthlyClosingFilters): string {
  const q = new URLSearchParams();
  if (filters.year.trim()) q.set("year", filters.year.trim());
  if (filters.month.trim()) q.set("month", filters.month.trim());
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
  if (filters.onlyDivergences) q.set("onlyDivergences", "true");
  if (filters.nomusReferenceBase.trim()) {
    q.set("nomusReferenceBase", filters.nomusReferenceBase.trim());
  }
  if (filters.nomusReferenceCommission.trim()) {
    q.set("nomusReferenceCommission", filters.nomusReferenceCommission.trim());
  }
  q.set("page", String(filters.page));
  q.set("pageSize", String(filters.pageSize));
  return q.toString();
}

export function buildMonthlyClosingExportQueryString(
  filters: MonthlyClosingFilters,
  format: "summary" | "detail" | "full" | "official"
): string {
  const base = buildMonthlyClosingQueryString({ ...filters, page: 1, pageSize: 100000 });
  const q = new URLSearchParams(base);
  q.set("format", format);
  return q.toString();
}
