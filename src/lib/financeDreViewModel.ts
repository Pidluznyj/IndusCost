import type { FinanceDreCompany } from "@/src/lib/financeDreTypes.js";

export type FinanceDreUiFilters = {
  year: string;
  month: string;
  company: FinanceDreCompany;
};

export function createDefaultFinanceDreUiFilters(now: Date = new Date()): FinanceDreUiFilters {
  return {
    year: String(now.getFullYear()),
    month: String(now.getMonth() + 1),
    company: "all",
  };
}

export function normalizeFinanceDreUiFilters(filters: FinanceDreUiFilters): FinanceDreUiFilters {
  const yearNum = Number.parseInt(filters.year, 10);
  const monthNum = Number.parseInt(filters.month, 10);
  const company =
    filters.company === "lazarios" ||
    filters.company === "koppetel" ||
    filters.company === "sm"
      ? filters.company
      : "all";
  return {
    year: Number.isFinite(yearNum) ? String(yearNum) : String(new Date().getFullYear()),
    month:
      Number.isFinite(monthNum) && monthNum >= 1 && monthNum <= 12
        ? String(monthNum)
        : String(new Date().getMonth() + 1),
    company,
  };
}

export function financeDreFiltersEqual(a: FinanceDreUiFilters, b: FinanceDreUiFilters): boolean {
  const na = normalizeFinanceDreUiFilters(a);
  const nb = normalizeFinanceDreUiFilters(b);
  return na.year === nb.year && na.month === nb.month && na.company === nb.company;
}

export function buildFinanceDreQuery(filters: FinanceDreUiFilters): string {
  const n = normalizeFinanceDreUiFilters(filters);
  const params = new URLSearchParams();
  params.set("year", n.year);
  params.set("month", n.month);
  if (n.company !== "all") params.set("company", n.company);
  return params.toString();
}

export function getFinanceDreApiPath(queryString: string): string {
  return queryString ? `/api/finance/dre?${queryString}` : "/api/finance/dre";
}

export function getFinanceDreExportPath(queryString: string): string {
  return queryString ? `/api/finance/dre/export?${queryString}` : "/api/finance/dre/export";
}
