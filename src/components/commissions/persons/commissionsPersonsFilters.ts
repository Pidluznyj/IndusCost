/** Filtros da tela Pessoas Comissionadas. */

export type CommissionsPersonsFilters = {
  search: string;
  type: string;
  source: string;
  active: string;
  year: string;
  month: string;
  from: string;
  to: string;
  page: number;
  pageSize: number;
};

export const EMPTY_COMMISSIONS_PERSONS_FILTERS: CommissionsPersonsFilters = {
  search: "",
  type: "",
  source: "",
  active: "true",
  year: String(new Date().getFullYear()),
  month: "",
  from: "",
  to: "",
  page: 1,
  pageSize: 20,
};

export const COMMISSION_PERSON_TYPE_FILTER_OPTIONS = [
  { value: "", label: "Todos os tipos" },
  { value: "SELLER", label: "Vendedor" },
  { value: "REPRESENTATIVE", label: "Representante" },
  { value: "MANAGER", label: "Gerente" },
  { value: "OTHER", label: "Outro" },
] as const;

export const COMMISSION_PERSON_SOURCE_FILTER_OPTIONS = [
  { value: "", label: "Todas as origens" },
  { value: "NOMUS", label: "Nomus" },
  { value: "MANUAL", label: "Manual" },
] as const;

export const COMMISSION_PERSON_ACTIVE_FILTER_OPTIONS = [
  { value: "", label: "Ativos e inativos" },
  { value: "true", label: "Somente ativos" },
  { value: "false", label: "Somente inativos" },
] as const;

export function buildCommissionsPersonsQueryString(filters: CommissionsPersonsFilters): string {
  const q = new URLSearchParams();
  if (filters.search.trim()) q.set("search", filters.search.trim());
  if (filters.type.trim()) q.set("type", filters.type.trim());
  if (filters.source.trim()) q.set("source", filters.source.trim());
  if (filters.active.trim()) q.set("active", filters.active.trim());
  if (filters.year.trim()) q.set("year", filters.year.trim());
  if (filters.month.trim()) q.set("month", filters.month.trim());
  if (filters.from.trim()) q.set("from", filters.from.trim());
  if (filters.to.trim()) q.set("to", filters.to.trim());
  q.set("page", String(filters.page));
  q.set("pageSize", String(filters.pageSize));
  return q.toString();
}

export function countActiveCommissionsPersonsFilters(filters: CommissionsPersonsFilters): number {
  let count = 0;
  if (filters.search.trim()) count += 1;
  if (filters.type.trim()) count += 1;
  if (filters.source.trim()) count += 1;
  if (filters.active.trim()) count += 1;
  if (filters.month.trim()) count += 1;
  if (filters.from.trim()) count += 1;
  if (filters.to.trim()) count += 1;
  return count;
}

export function buildPersonCommissionsLink(personId: string, year: string): string {
  const q = new URLSearchParams();
  q.set("commissionPersonId", personId);
  if (year.trim()) q.set("year", year.trim());
  return `/commissions/confirmed?${q.toString()}`;
}

export function buildPersonRulesLink(personId: string, personType: string): string {
  const q = new URLSearchParams();
  q.set("fixedCommissionPersonId", personId);
  if (personType === "SELLER") q.set("beneficiaryType", "SELLER");
  if (personType === "REPRESENTATIVE") q.set("beneficiaryType", "REPRESENTATIVE");
  return `/commissions/rules?${q.toString()}`;
}
