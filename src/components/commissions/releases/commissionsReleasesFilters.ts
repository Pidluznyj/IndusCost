/** Filtros da tela Liberação por Recebimento. */

import type { CommissionsReleaseItem } from "@/src/components/commissions/commissionsTypes";

export type CommissionsReleasesFilters = {
  year: string;
  month: string;
  dueFrom: string;
  dueTo: string;
  settlementFrom: string;
  settlementTo: string;
  commissionPersonId: string;
  customer: string;
  orderCode: string;
  nfeNumber: string;
  receivableId: string;
  accountStatus: string;
  releaseFilter: string;
  page: number;
  pageSize: number;
};

export const EMPTY_COMMISSIONS_RELEASES_FILTERS: CommissionsReleasesFilters = {
  year: "",
  month: "",
  dueFrom: "",
  dueTo: "",
  settlementFrom: "",
  settlementTo: "",
  commissionPersonId: "",
  customer: "",
  orderCode: "",
  nfeNumber: "",
  receivableId: "",
  accountStatus: "",
  releaseFilter: "",
  page: 1,
  pageSize: 20,
};

export const COMMISSION_RELEASE_FILTER_OPTIONS = [
  { value: "", label: "Todas as liberações" },
  { value: "not_released", label: "Não liberada" },
  { value: "partial", label: "Parcialmente liberada" },
  { value: "released", label: "Liberada total" },
] as const;

export const COMMISSION_ACCOUNT_STATUS_OPTIONS = [
  { value: "", label: "Todos os status" },
  { value: "ACTIVE", label: "Ativa" },
  { value: "PARTIALLY_PAID", label: "Parcialmente paga" },
  { value: "PAID", label: "Paga" },
  { value: "REVIEW", label: "Em revisão" },
  { value: "CANCELLED", label: "Cancelada" },
] as const;

export function buildCommissionsReleasesQueryString(
  filters: CommissionsReleasesFilters
): string {
  const q = new URLSearchParams();
  if (filters.year.trim()) q.set("year", filters.year.trim());
  if (filters.month.trim()) q.set("month", filters.month.trim());
  if (filters.dueFrom.trim()) q.set("dueFrom", filters.dueFrom.trim());
  if (filters.dueTo.trim()) q.set("dueTo", filters.dueTo.trim());
  if (filters.settlementFrom.trim()) {
    q.set("settlementFrom", filters.settlementFrom.trim());
  }
  if (filters.settlementTo.trim()) q.set("settlementTo", filters.settlementTo.trim());
  if (filters.commissionPersonId.trim()) {
    q.set("commissionPersonId", filters.commissionPersonId.trim());
  }
  if (filters.customer.trim()) q.set("customer", filters.customer.trim());
  if (filters.orderCode.trim()) q.set("orderCode", filters.orderCode.trim());
  if (filters.nfeNumber.trim()) q.set("nfeNumber", filters.nfeNumber.trim());
  if (filters.receivableId.trim()) q.set("receivableId", filters.receivableId.trim());
  if (filters.accountStatus.trim()) q.set("accountStatus", filters.accountStatus.trim());
  if (filters.releaseFilter.trim()) q.set("releaseFilter", filters.releaseFilter.trim());
  q.set("page", String(filters.page));
  q.set("pageSize", String(filters.pageSize));
  return q.toString();
}

export function countActiveCommissionsReleasesFilters(
  filters: CommissionsReleasesFilters
): number {
  let count = 0;
  if (filters.year.trim()) count += 1;
  if (filters.month.trim()) count += 1;
  if (filters.dueFrom.trim()) count += 1;
  if (filters.dueTo.trim()) count += 1;
  if (filters.settlementFrom.trim()) count += 1;
  if (filters.settlementTo.trim()) count += 1;
  if (filters.commissionPersonId.trim()) count += 1;
  if (filters.customer.trim()) count += 1;
  if (filters.orderCode.trim()) count += 1;
  if (filters.nfeNumber.trim()) count += 1;
  if (filters.receivableId.trim()) count += 1;
  if (filters.accountStatus.trim()) count += 1;
  if (filters.releaseFilter.trim()) count += 1;
  return count;
}

export function releaseRowClassName(
  highlight: CommissionsReleaseItem["highlight"]
): string {
  switch (highlight) {
    case "overdue":
      return "bg-red-50/70 border-l-4 border-l-red-500";
    case "received":
      return "bg-emerald-50/50 border-l-4 border-l-emerald-500";
    case "partial_release":
      return "bg-blue-50/60 border-l-4 border-l-blue-500";
    case "released":
      return "bg-slate-50/80 border-l-4 border-l-slate-400";
    case "open":
    default:
      return "border-l-4 border-l-transparent";
  }
}

export function resolveCommissionsReleasesRecalculatePeriod(
  filters: CommissionsReleasesFilters
): { from: string; to: string } {
  if (filters.dueFrom.trim() && filters.dueTo.trim()) {
    return { from: filters.dueFrom.trim(), to: filters.dueTo.trim() };
  }
  if (filters.settlementFrom.trim() && filters.settlementTo.trim()) {
    return {
      from: filters.settlementFrom.trim(),
      to: filters.settlementTo.trim(),
    };
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
