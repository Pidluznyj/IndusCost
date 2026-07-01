/** Filtros da tela Comissões Confirmadas. */

import type { CommissionsConfirmedRow } from "@/src/components/commissions/commissionsTypes";

export type CommissionsConfirmedFilters = {
  year: string;
  month: string;
  from: string;
  to: string;
  commissionPersonId: string;
  customer: string;
  orderCode: string;
  nfeNumber: string;
  outputDocument: string;
  status: string;
  includeCancelled: boolean;
  page: number;
  pageSize: number;
};

export const EMPTY_COMMISSIONS_CONFIRMED_FILTERS: CommissionsConfirmedFilters = {
  year: "",
  month: "",
  from: "",
  to: "",
  commissionPersonId: "",
  customer: "",
  orderCode: "",
  nfeNumber: "",
  outputDocument: "",
  status: "",
  includeCancelled: false,
  page: 1,
  pageSize: 20,
};

export const COMMISSION_CONFIRMED_STATUS_OPTIONS = [
  { value: "", label: "Ativos (confirmados e liberação)" },
  { value: "CONFIRMED_BY_OUTPUT_DOCUMENT", label: "Confirmada" },
  { value: "WAITING_RECEIVABLE", label: "Aguardando recebimento" },
  { value: "WAITING_PAYMENT", label: "Aguardando pagamento" },
  { value: "PARTIALLY_RELEASED", label: "Parcialmente liberada" },
  { value: "RELEASED", label: "Liberada total" },
  { value: "PAID_PARTIAL", label: "Paga parcial" },
  { value: "PAID_TOTAL", label: "Paga total" },
  { value: "CANCELLED", label: "Cancelada" },
  { value: "REVERSED", label: "Estornada" },
] as const;

export function buildCommissionsConfirmedQueryString(
  filters: CommissionsConfirmedFilters
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
  if (filters.nfeNumber.trim()) q.set("nfeNumber", filters.nfeNumber.trim());
  if (filters.outputDocument.trim()) {
    q.set("outputDocument", filters.outputDocument.trim());
  }
  if (filters.status.trim()) q.set("status", filters.status.trim());
  if (filters.includeCancelled) q.set("includeCancelled", "true");
  q.set("page", String(filters.page));
  q.set("pageSize", String(filters.pageSize));
  return q.toString();
}

export function countActiveCommissionsConfirmedFilters(
  filters: CommissionsConfirmedFilters
): number {
  let count = 0;
  if (filters.year.trim()) count += 1;
  if (filters.month.trim()) count += 1;
  if (filters.from.trim()) count += 1;
  if (filters.to.trim()) count += 1;
  if (filters.commissionPersonId.trim()) count += 1;
  if (filters.customer.trim()) count += 1;
  if (filters.orderCode.trim()) count += 1;
  if (filters.nfeNumber.trim()) count += 1;
  if (filters.outputDocument.trim()) count += 1;
  if (filters.status.trim()) count += 1;
  if (filters.includeCancelled) count += 1;
  return count;
}

export function confirmedRowClassName(
  highlight: CommissionsConfirmedRow["highlight"]
): string {
  switch (highlight) {
    case "divergence":
      return "bg-red-50/80 border-l-4 border-l-red-400";
    case "cancelled":
      return "bg-muted/40 opacity-75 border-l-4 border-l-gray-400";
    case "waiting_receivable":
      return "bg-amber-50/60 border-l-4 border-l-amber-400";
    case "confirmed":
    default:
      return "bg-emerald-50/40 border-l-4 border-l-emerald-400";
  }
}
