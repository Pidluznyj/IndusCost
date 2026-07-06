/** Filtros da tela Pagamentos de Comissões. */

export type CommissionsPaymentsFilters = {
  year: string;
  month: string;
  from: string;
  to: string;
  commissionPersonId: string;
  status: string;
  personType: string;
  paymentDateFrom: string;
  paymentDateTo: string;
  page: number;
  pageSize: number;
};

export const EMPTY_COMMISSIONS_PAYMENTS_FILTERS: CommissionsPaymentsFilters = {
  year: String(new Date().getFullYear()),
  month: "",
  from: "",
  to: "",
  commissionPersonId: "",
  status: "",
  personType: "",
  paymentDateFrom: "",
  paymentDateTo: "",
  page: 1,
  pageSize: 20,
};

export function buildCommissionsPaymentsQueryString(
  filters: CommissionsPaymentsFilters
): string {
  const q = new URLSearchParams();
  if (filters.year.trim()) q.set("year", filters.year.trim());
  if (filters.month.trim()) q.set("month", filters.month.trim());
  if (filters.from.trim()) q.set("from", filters.from.trim());
  if (filters.to.trim()) q.set("to", filters.to.trim());
  if (filters.commissionPersonId.trim()) {
    q.set("commissionPersonId", filters.commissionPersonId.trim());
  }
  if (filters.status.trim()) q.set("status", filters.status.trim());
  if (filters.personType.trim()) q.set("personType", filters.personType.trim());
  if (filters.paymentDateFrom.trim()) {
    q.set("paymentDateFrom", filters.paymentDateFrom.trim());
  }
  if (filters.paymentDateTo.trim()) {
    q.set("paymentDateTo", filters.paymentDateTo.trim());
  }
  q.set("page", String(filters.page));
  q.set("pageSize", String(filters.pageSize));
  return q.toString();
}

export function buildUnpaidReleasedQueryString(input: {
  commissionPersonId: string;
  from: string;
  to: string;
  year: string;
  month: string;
}): string {
  const q = new URLSearchParams();
  q.set("commissionPersonId", input.commissionPersonId);
  if (input.from.trim() && input.to.trim()) {
    q.set("from", input.from.trim());
    q.set("to", input.to.trim());
  } else {
    if (input.year.trim()) q.set("year", input.year.trim());
    if (input.month.trim()) q.set("month", input.month.trim());
  }
  return q.toString();
}

export function countActiveCommissionsPaymentsFilters(
  filters: CommissionsPaymentsFilters
): number {
  let count = 0;
  if (filters.month.trim()) count += 1;
  if (filters.from.trim()) count += 1;
  if (filters.to.trim()) count += 1;
  if (filters.commissionPersonId.trim()) count += 1;
  if (filters.status.trim()) count += 1;
  if (filters.personType.trim()) count += 1;
  if (filters.paymentDateFrom.trim()) count += 1;
  if (filters.paymentDateTo.trim()) count += 1;
  return count;
}

export function resolveCreateBatchPeriod(input: {
  from: string;
  to: string;
  year: string;
  month: string;
}): { periodStart: string; periodEnd: string } | null {
  if (input.from.trim() && input.to.trim()) {
    return {
      periodStart: new Date(`${input.from.trim()}T00:00:00`).toISOString(),
      periodEnd: new Date(`${input.to.trim()}T23:59:59`).toISOString(),
    };
  }
  const year = Number.parseInt(input.year.trim(), 10);
  if (!Number.isFinite(year)) return null;
  const month = input.month.trim() ? Number.parseInt(input.month.trim(), 10) : null;
  if (month != null && month >= 1 && month <= 12) {
    const from = new Date(Date.UTC(year, month - 1, 1));
    const to = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));
    return { periodStart: from.toISOString(), periodEnd: to.toISOString() };
  }
  const from = new Date(Date.UTC(year, 0, 1));
  const to = new Date(Date.UTC(year, 11, 31, 23, 59, 59, 999));
  return { periodStart: from.toISOString(), periodEnd: to.toISOString() };
}
