import {
  parseFinanceArDashboardFilters,
  type FinanceArDashboardFilters,
} from "./financeAccountsReceivableDashboard.js";
import {
  parseFinanceApDashboardFilters,
  type FinanceApDashboardFilters,
} from "./financeAccountsPayableDashboard.js";

export type DueRadarMode = "receivable" | "payable";

export function stripDueRadarPeriodFilters<T extends { year?: number; month?: number }>(
  filters: T
): T {
  return { ...filters, year: undefined, month: undefined };
}

export function parseDueRadarPageFilters(
  query: Record<string, unknown>,
  mode: DueRadarMode
): FinanceArDashboardFilters | FinanceApDashboardFilters {
  const parsed =
    mode === "receivable"
      ? parseFinanceArDashboardFilters(query)
      : parseFinanceApDashboardFilters(query);
  return stripDueRadarPeriodFilters(parsed);
}

export function mergeDueRadarQueryString(
  dashboardQuery: string,
  radarQuery: string
): string {
  const merged = new URLSearchParams(dashboardQuery);
  const radar = new URLSearchParams(radarQuery);
  for (const [key, value] of radar.entries()) {
    merged.set(key, value);
  }
  return merged.toString();
}
