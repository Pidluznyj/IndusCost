/** Filtros do dashboard de comissões — serialização para query string da API. */

import {
  COMMISSION_STATUS_FILTER_OPTIONS,
} from "@/src/components/commissions/commissionsStatusLabels";

export { COMMISSION_STATUS_FILTER_OPTIONS };

export type CommissionsDashboardFilters = {
  year: string;
  month: string;
  from: string;
  to: string;
  commissionPersonId: string;
  personType: string;
  customer: string;
  orderCode: string;
  nfeNumber: string;
  status: string;
  ruleId: string;
};

export const EMPTY_COMMISSIONS_DASHBOARD_FILTERS: CommissionsDashboardFilters = {
  year: "",
  month: "",
  from: "",
  to: "",
  commissionPersonId: "",
  personType: "",
  customer: "",
  orderCode: "",
  nfeNumber: "",
  status: "",
  ruleId: "",
};

export const COMMISSION_PERSON_TYPE_OPTIONS = [
  { value: "", label: "Todos os tipos" },
  { value: "SELLER", label: "Vendedor" },
  { value: "REPRESENTATIVE", label: "Representante" },
  { value: "MANAGER", label: "Gerente" },
  { value: "OTHER", label: "Outro" },
] as const;

export function buildCommissionsDashboardQueryString(
  filters: CommissionsDashboardFilters
): string {
  const q = new URLSearchParams();
  if (filters.year.trim()) q.set("year", filters.year.trim());
  if (filters.month.trim()) q.set("month", filters.month.trim());
  if (filters.from.trim()) q.set("from", filters.from.trim());
  if (filters.to.trim()) q.set("to", filters.to.trim());
  if (filters.commissionPersonId.trim()) {
    q.set("commissionPersonId", filters.commissionPersonId.trim());
  }
  if (filters.personType.trim()) q.set("personType", filters.personType.trim());
  if (filters.customer.trim()) q.set("customer", filters.customer.trim());
  if (filters.orderCode.trim()) q.set("orderCode", filters.orderCode.trim());
  if (filters.nfeNumber.trim()) q.set("nfeNumber", filters.nfeNumber.trim());
  if (filters.status.trim()) q.set("status", filters.status.trim());
  if (filters.ruleId.trim()) q.set("ruleId", filters.ruleId.trim());
  return q.toString();
}

/** Período efetivo para recálculo com base nos filtros ativos. */
export function resolveCommissionsRecalculatePeriod(filters: CommissionsDashboardFilters): {
  from: string;
  to: string;
} {
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
    return {
      from: `${year}-01-01`,
      to: `${year}-12-31`,
    };
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

export function countActiveCommissionsDashboardFilters(
  filters: CommissionsDashboardFilters
): number {
  return Object.values(filters).filter((v) => typeof v === "string" && v.trim().length > 0).length;
}
