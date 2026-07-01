/** Filtros da tela Comissões Previstas — serialização para query string da API. */

export type CommissionsForecastFilters = {
  year: string;
  month: string;
  from: string;
  to: string;
  commissionPersonId: string;
  customer: string;
  orderCode: string;
  sellerId: string;
  representativeId: string;
  status: string;
  hasRule: string;
  includeSuperseded: boolean;
  page: number;
  pageSize: number;
};

export const EMPTY_COMMISSIONS_FORECAST_FILTERS: CommissionsForecastFilters = {
  year: "",
  month: "",
  from: "",
  to: "",
  commissionPersonId: "",
  customer: "",
  orderCode: "",
  sellerId: "",
  representativeId: "",
  status: "",
  hasRule: "",
  includeSuperseded: false,
  page: 1,
  pageSize: 20,
};

export const COMMISSION_FORECAST_STATUS_OPTIONS = [
  { value: "", label: "Ativos (previsão + aguardando NF-e)" },
  { value: "FORECAST_FROM_ORDER", label: "Previsão (pedido)" },
  { value: "WAITING_NFE", label: "Aguardando NF-e" },
  { value: "SUPERSEDED_BY_OUTPUT_DOCUMENT", label: "Substituída por doc. saída" },
] as const;

export const COMMISSION_HAS_RULE_OPTIONS = [
  { value: "", label: "Com ou sem regra" },
  { value: "true", label: "Com regra" },
  { value: "false", label: "Sem regra" },
] as const;

export function buildCommissionsForecastQueryString(
  filters: CommissionsForecastFilters
): string {
  const q = new URLSearchParams();
  if (filters.year.trim()) q.set("year", filters.year.trim());
  if (filters.month.trim()) q.set("month", filters.month.trim());
  if (filters.from.trim()) q.set("from", filters.from.trim());
  if (filters.to.trim()) q.set("to", filters.to.trim());
  if (filters.commissionPersonId.trim()) {
    q.set("commissionPersonId", filters.commissionPersonId.trim());
  }
  if (filters.customer.trim()) q.set("customer", filters.customer.trim());
  if (filters.orderCode.trim()) q.set("orderCode", filters.orderCode.trim());
  if (filters.sellerId.trim()) q.set("sellerId", filters.sellerId.trim());
  if (filters.representativeId.trim()) {
    q.set("representativeId", filters.representativeId.trim());
  }
  if (filters.status.trim()) q.set("status", filters.status.trim());
  if (filters.hasRule.trim()) q.set("hasRule", filters.hasRule.trim());
  if (filters.includeSuperseded) q.set("includeSuperseded", "true");
  q.set("page", String(filters.page));
  q.set("pageSize", String(filters.pageSize));
  return q.toString();
}

export function countActiveCommissionsForecastFilters(
  filters: CommissionsForecastFilters
): number {
  let count = 0;
  if (filters.year.trim()) count += 1;
  if (filters.month.trim()) count += 1;
  if (filters.from.trim()) count += 1;
  if (filters.to.trim()) count += 1;
  if (filters.commissionPersonId.trim()) count += 1;
  if (filters.customer.trim()) count += 1;
  if (filters.orderCode.trim()) count += 1;
  if (filters.sellerId.trim()) count += 1;
  if (filters.representativeId.trim()) count += 1;
  if (filters.status.trim()) count += 1;
  if (filters.hasRule.trim()) count += 1;
  if (filters.includeSuperseded) count += 1;
  return count;
}

export function resolveCommissionsForecastRecalculatePeriod(
  filters: CommissionsForecastFilters,
  orderDate: string | null
): { from: string; to: string } {
  if (orderDate) {
    const d = new Date(orderDate);
    if (!Number.isNaN(d.getTime())) {
      const y = d.getUTCFullYear();
      const m = d.getUTCMonth();
      const from = new Date(Date.UTC(y, m, 1));
      const to = new Date(Date.UTC(y, m + 1, 0));
      return {
        from: from.toISOString().slice(0, 10),
        to: to.toISOString().slice(0, 10),
      };
    }
  }
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
