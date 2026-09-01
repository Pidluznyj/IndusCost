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

/** Abas inferiores executivas — grid, clientes, comparativos e auditoria. */
export const FINANCE_BILLING_EXECUTIVE_TABS = [
  { id: "documents", label: "NF-e / Documentos" },
  { id: "customers", label: "Clientes" },
  { id: "comparison", label: "Comparativos" },
  { id: "audit", label: "Auditoria" },
] as const;

export type FinanceBillingExecutiveTabId =
  (typeof FINANCE_BILLING_EXECUTIVE_TABS)[number]["id"];

/**
 * Visões da página de Faturamento (mesmo padrão de Contas a Receber:
 * `FINANCE_AR_PAGE_VIEWS`). "overview" é o conteúdo executivo já existente.
 */
export const FINANCE_BILLING_PAGE_VIEWS = [
  { id: "overview", label: "Visão Geral" },
  { id: "detail", label: "Detalhamento" },
] as const;

export type FinanceBillingPageViewId =
  (typeof FINANCE_BILLING_PAGE_VIEWS)[number]["id"];

/** Abas de análise gráfica — mesma fonte NF-e fiscal. */
export const FINANCE_BILLING_ANALYSIS_TABS = [
  { id: "overview", label: "Visão Geral" },
  { id: "accumulated", label: "Acumulado" },
  { id: "monthly", label: "Mês a Mês" },
  { id: "projection", label: "Projeção" },
  { id: "forecast", label: "Carteira Prevista" },
] as const;

export type FinanceBillingAnalysisTabId =
  (typeof FINANCE_BILLING_ANALYSIS_TABS)[number]["id"];

/** União legada para testes e rotas que referenciam ids antigos. */
export const FINANCE_BILLING_TABS = [
  ...FINANCE_BILLING_ANALYSIS_TABS,
  ...FINANCE_BILLING_EXECUTIVE_TABS,
  { id: "nfe-details", label: "Detalhado NF-e" },
] as const;

export type FinanceBillingTabId =
  | FinanceBillingExecutiveTabId
  | FinanceBillingAnalysisTabId
  | "nfe-details";
