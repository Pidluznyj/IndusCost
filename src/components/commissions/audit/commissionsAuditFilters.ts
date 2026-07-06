/** Filtros da tela Auditoria de Comissões. */

export type CommissionsAuditFilters = {
  year: string;
  month: string;
  from: string;
  to: string;
  severity: string;
  type: string;
  resolved: string;
  commissionPersonId: string;
  orderCode: string;
  nfeNumber: string;
  customer: string;
  page: number;
  pageSize: number;
};

export const EMPTY_COMMISSIONS_AUDIT_FILTERS: CommissionsAuditFilters = {
  year: String(new Date().getFullYear()),
  month: "",
  from: "",
  to: "",
  severity: "",
  type: "",
  resolved: "",
  commissionPersonId: "",
  orderCode: "",
  nfeNumber: "",
  customer: "",
  page: 1,
  pageSize: 20,
};

export function buildCommissionsAuditQueryString(filters: CommissionsAuditFilters): string {
  const q = new URLSearchParams();
  if (filters.year.trim()) q.set("year", filters.year.trim());
  if (filters.month.trim()) q.set("month", filters.month.trim());
  if (filters.from.trim()) q.set("from", filters.from.trim());
  if (filters.to.trim()) q.set("to", filters.to.trim());
  if (filters.severity.trim()) q.set("severity", filters.severity.trim());
  if (filters.type.trim()) q.set("type", filters.type.trim());
  if (filters.resolved.trim()) q.set("resolved", filters.resolved.trim());
  if (filters.commissionPersonId.trim()) {
    q.set("commissionPersonId", filters.commissionPersonId.trim());
  }
  if (filters.orderCode.trim()) q.set("orderCode", filters.orderCode.trim());
  if (filters.nfeNumber.trim()) q.set("nfeNumber", filters.nfeNumber.trim());
  if (filters.customer.trim()) q.set("customer", filters.customer.trim());
  q.set("page", String(filters.page));
  q.set("pageSize", String(filters.pageSize));
  return q.toString();
}

export function countActiveCommissionsAuditFilters(filters: CommissionsAuditFilters): number {
  let count = 0;
  if (filters.month.trim()) count += 1;
  if (filters.from.trim()) count += 1;
  if (filters.to.trim()) count += 1;
  if (filters.severity.trim()) count += 1;
  if (filters.type.trim()) count += 1;
  if (filters.resolved.trim()) count += 1;
  if (filters.commissionPersonId.trim()) count += 1;
  if (filters.orderCode.trim()) count += 1;
  if (filters.nfeNumber.trim()) count += 1;
  if (filters.customer.trim()) count += 1;
  return count;
}

export function resolveCommissionsAuditRerunPeriod(
  filters: CommissionsAuditFilters
): { from: string; to: string } {
  if (filters.from.trim() && filters.to.trim()) {
    return { from: filters.from.trim(), to: filters.to.trim() };
  }
  const year = Number(filters.year.trim());
  const month = Number(filters.month.trim());
  if (Number.isFinite(year) && Number.isFinite(month) && month >= 1 && month <= 12) {
    const from = new Date(Date.UTC(year, month - 1, 1));
    const to = new Date(Date.UTC(year, month, 0));
    return {
      from: from.toISOString().slice(0, 10),
      to: to.toISOString().slice(0, 10),
    };
  }
  if (Number.isFinite(year)) {
    return { from: `${year}-01-01`, to: `${year}-12-31` };
  }
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const from = new Date(Date.UTC(y, m, 1));
  const to = new Date(Date.UTC(y, m + 1, 0));
  return {
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
  };
}

export function buildAuditConfirmedLink(input: {
  orderCode?: string | null;
  nfeNumber?: string | null;
  commissionPersonId?: string | null;
  year?: string;
}): string {
  const q = new URLSearchParams();
  if (input.orderCode) q.set("orderCode", input.orderCode);
  if (input.nfeNumber) q.set("nfeNumber", input.nfeNumber);
  if (input.commissionPersonId) q.set("commissionPersonId", input.commissionPersonId);
  if (input.year?.trim()) q.set("year", input.year.trim());
  return `/commissions/confirmed?${q.toString()}`;
}

export function buildAuditRulesLink(type?: string): string {
  if (type === "NO_COMMISSION_RULE") return "/commissions/rules?active=true";
  return "/commissions/rules";
}

export function buildAuditPersonLink(commissionPersonId?: string | null): string {
  if (!commissionPersonId) return "/commissions/persons";
  const q = new URLSearchParams();
  q.set("search", commissionPersonId);
  return `/commissions/persons?${q.toString()}`;
}
