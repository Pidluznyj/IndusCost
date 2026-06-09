/** Tipos do payload GET /api/finance/billing/dashboard */

import type { BillingDashboardTab } from "./executiveDashboardTypes.js";
import { EXECUTIVE_DASHBOARD_MIN_YEAR } from "./executiveDashboardYear.js";

export type FinanceBillingDashboardPayload = {
  generatedAt: string;
  selectedYear: number;
  previousYear: number;
  currentMonth: number;
  periodLabel: string;
  lastInvoicedAt: string | null;
  tab: BillingDashboardTab;
};

export function createDefaultFinanceBillingYear(referenceDate = new Date()): string {
  return String(referenceDate.getFullYear());
}

export function buildFinanceBillingYearOptions(referenceYear = new Date().getFullYear()) {
  const options: Array<{ value: string; label: string }> = [];
  for (let y = referenceYear + 1; y >= EXECUTIVE_DASHBOARD_MIN_YEAR; y -= 1) {
    options.push({ value: String(y), label: String(y) });
  }
  return options;
}

export function buildFinanceBillingDashboardQuery(year: string): string {
  const y = year.trim();
  if (!y) return "";
  return `year=${encodeURIComponent(y)}`;
}

export function hasPendingFinanceBillingYearChange(
  draftYear: string,
  appliedYear: string
): boolean {
  return draftYear.trim() !== appliedYear.trim();
}

export const FINANCE_BILLING_TABS = [
  { id: "overview", label: "Visão Geral" },
  { id: "accumulated", label: "Acumulado NF-e" },
  { id: "monthly", label: "Mês a Mês" },
  { id: "projection", label: "Projeção" },
  { id: "nfe-details", label: "Detalhado NF-e" },
  { id: "comparison", label: "Comparativo" },
] as const;

export type FinanceBillingTabId = (typeof FINANCE_BILLING_TABS)[number]["id"];
