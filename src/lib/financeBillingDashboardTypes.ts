/** Tipos do payload GET /api/finance/billing/dashboard */

import type { BillingDashboardTab } from "./executiveDashboardTypes.js";
import { EXECUTIVE_DASHBOARD_MIN_YEAR } from "./executiveDashboardYear.js";
import {
  buildFinanceBillingDashboardQuery,
  type FinanceBillingDateBase,
  type FinanceBillingSource,
} from "./financeBillingSourceTypes.js";

export type { FinanceBillingDateBase, FinanceBillingSource };
export { buildFinanceBillingDashboardQuery };

export type FinanceBillingDashboardPayload = {
  generatedAt: string;
  selectedYear: number;
  previousYear: number;
  currentMonth: number;
  periodLabel: string;
  lastInvoicedAt: string | null;
  billingSource: FinanceBillingSource;
  dateBase: FinanceBillingDateBase;
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
  { id: "forecast", label: "Carteira Prevista" },
  { id: "nfe-details", label: "Detalhado NF-e" },
  { id: "comparison", label: "Comparativo" },
  { id: "audit", label: "Composição / Auditoria" },
] as const;

export type FinanceBillingTabId = (typeof FINANCE_BILLING_TABS)[number]["id"];
