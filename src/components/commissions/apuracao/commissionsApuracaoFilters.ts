/** Filtros — Relatório de Apuração de Comissão. */

export type CommissionsApuracaoFilters = {
  year: string;
  month: string;
  from: string;
  to: string;
  commissionPersonId: string;
  customer: string;
  orderCode: string;
  nfeNumber: string;
  receivableCode: string;
  apuracaoStatus: string;
  onlyDivergences: boolean;
  onlyPayable: boolean;
  nomusReferenceBase: string;
  nomusReferenceCommission: string;
  page: number;
  pageSize: number;
};

const currentYear = String(new Date().getFullYear());

export const EMPTY_COMMISSIONS_APURACAO_FILTERS: CommissionsApuracaoFilters = {
  year: currentYear,
  month: "",
  from: "",
  to: "",
  commissionPersonId: "",
  customer: "",
  orderCode: "",
  nfeNumber: "",
  receivableCode: "",
  apuracaoStatus: "",
  onlyDivergences: false,
  onlyPayable: false,
  nomusReferenceBase: "808107.32",
  nomusReferenceCommission: "20926.56",
  page: 1,
  pageSize: 50,
};

export const COMMISSION_APURACAO_STATUS_OPTIONS = [
  { value: "", label: "Todos os status" },
  { value: "CALCULADA", label: "Calculada" },
  { value: "PENDENTE_RECEBIMENTO", label: "Pendente recebimento" },
  { value: "LIBERADA", label: "Liberada" },
  { value: "PAGA", label: "Paga" },
  { value: "DIVERGENTE", label: "Divergente" },
  { value: "BLOQUEADA", label: "Bloqueada" },
] as const;

export function buildCommissionsApuracaoQueryString(
  filters: CommissionsApuracaoFilters
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
  if (filters.receivableCode.trim()) {
    q.set("receivableCode", filters.receivableCode.trim());
  }
  if (filters.apuracaoStatus.trim()) q.set("apuracaoStatus", filters.apuracaoStatus.trim());
  if (filters.onlyDivergences) q.set("onlyDivergences", "true");
  if (filters.onlyPayable) q.set("onlyPayable", "true");
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

export function countActiveCommissionsApuracaoFilters(
  filters: CommissionsApuracaoFilters
): number {
  let count = 0;
  if (filters.commissionPersonId.trim()) count += 1;
  if (filters.customer.trim()) count += 1;
  if (filters.orderCode.trim()) count += 1;
  if (filters.nfeNumber.trim()) count += 1;
  if (filters.receivableCode.trim()) count += 1;
  if (filters.apuracaoStatus.trim()) count += 1;
  if (filters.onlyDivergences) count += 1;
  if (filters.onlyPayable) count += 1;
  if (filters.from.trim() || filters.to.trim()) count += 1;
  if (filters.month.trim()) count += 1;
  return count;
}
