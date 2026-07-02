/** Filtros da auditoria visual — serialização para API. */

export type VisualAuditFilters = {
  year: string;
  month: string;
  commissionPersonId: string;
  customer: string;
  orderCode: string;
  nfeNumber: string;
  nomusReceivableId: string;
  onlySettled: boolean;
  onlyOpen: boolean;
  onlyDivergences: boolean;
  onlyZeroCommission: boolean;
  onlyMissingReceivableLink: boolean;
  nomusReferenceBase: string;
  nomusReferenceCommission: string;
  page: number;
  pageSize: number;
};

export const EMPTY_VISUAL_AUDIT_FILTERS: VisualAuditFilters = {
  year: String(new Date().getFullYear()),
  month: String(new Date().getMonth() + 1),
  commissionPersonId: "",
  customer: "",
  orderCode: "",
  nfeNumber: "",
  nomusReceivableId: "",
  onlySettled: false,
  onlyOpen: false,
  onlyDivergences: false,
  onlyZeroCommission: false,
  onlyMissingReceivableLink: false,
  nomusReferenceBase: "",
  nomusReferenceCommission: "",
  page: 1,
  pageSize: 50,
};

export function buildVisualAuditQueryString(filters: VisualAuditFilters): string {
  const q = new URLSearchParams();
  if (filters.year.trim()) q.set("year", filters.year.trim());
  if (filters.month.trim()) q.set("month", filters.month.trim());
  if (filters.commissionPersonId.trim()) q.set("commissionPersonId", filters.commissionPersonId.trim());
  if (filters.customer.trim()) q.set("customer", filters.customer.trim());
  if (filters.orderCode.trim()) q.set("orderCode", filters.orderCode.trim());
  if (filters.nfeNumber.trim()) q.set("nfeNumber", filters.nfeNumber.trim());
  if (filters.nomusReceivableId.trim()) q.set("nomusReceivableId", filters.nomusReceivableId.trim());
  if (filters.onlySettled) q.set("onlySettled", "true");
  if (filters.onlyOpen) q.set("onlyOpen", "true");
  if (filters.onlyDivergences) q.set("onlyDivergences", "true");
  if (filters.onlyZeroCommission) q.set("onlyZeroCommission", "true");
  if (filters.onlyMissingReceivableLink) q.set("onlyMissingReceivableLink", "true");
  if (filters.nomusReferenceBase.trim()) q.set("nomusReferenceBase", filters.nomusReferenceBase.trim());
  if (filters.nomusReferenceCommission.trim()) {
    q.set("nomusReferenceCommission", filters.nomusReferenceCommission.trim());
  }
  q.set("page", String(filters.page));
  q.set("pageSize", String(filters.pageSize));
  return q.toString();
}
