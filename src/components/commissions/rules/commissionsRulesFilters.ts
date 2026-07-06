/** Filtros da tela Regras de Comissão. */

export type CommissionsRulesFilters = {
  search: string;
  active: string;
  beneficiaryType: string;
  baseType: string;
  releaseRule: string;
  fixedCommissionPersonId: string;
  page: number;
  pageSize: number;
};

export const EMPTY_COMMISSIONS_RULES_FILTERS: CommissionsRulesFilters = {
  search: "",
  active: "",
  beneficiaryType: "",
  baseType: "",
  releaseRule: "",
  fixedCommissionPersonId: "",
  page: 1,
  pageSize: 20,
};

export const COMMISSION_RULE_ACTIVE_FILTER_OPTIONS = [
  { value: "", label: "Ativas e inativas" },
  { value: "true", label: "Somente ativas" },
  { value: "false", label: "Somente inativas" },
] as const;

export function buildCommissionsRulesQueryString(filters: CommissionsRulesFilters): string {
  const q = new URLSearchParams();
  if (filters.search.trim()) q.set("search", filters.search.trim());
  if (filters.active.trim()) q.set("active", filters.active.trim());
  if (filters.beneficiaryType.trim()) q.set("beneficiaryType", filters.beneficiaryType.trim());
  if (filters.baseType.trim()) q.set("baseType", filters.baseType.trim());
  if (filters.releaseRule.trim()) q.set("releaseRule", filters.releaseRule.trim());
  if (filters.fixedCommissionPersonId.trim()) {
    q.set("fixedCommissionPersonId", filters.fixedCommissionPersonId.trim());
  }
  q.set("page", String(filters.page));
  q.set("pageSize", String(filters.pageSize));
  return q.toString();
}

export function countActiveCommissionsRulesFilters(filters: CommissionsRulesFilters): number {
  let count = 0;
  if (filters.search.trim()) count += 1;
  if (filters.active.trim()) count += 1;
  if (filters.beneficiaryType.trim()) count += 1;
  if (filters.baseType.trim()) count += 1;
  if (filters.releaseRule.trim()) count += 1;
  if (filters.fixedCommissionPersonId.trim()) count += 1;
  return count;
}

export function buildRuleUsageDashboardLink(ruleId: string): string {
  return `/commissions?ruleId=${encodeURIComponent(ruleId)}`;
}
