/**
 * View-model do Relatório Presidencial (filtros UI, query string e helpers de exibição).
 * Cálculos financeiros permanecem no backend consolidado.
 */
import type { BillingMultiYearMonthlyPoint } from "./financeBillingChartData.js";
import { resolveFinanceBillingComparisonYears } from "./financeBillingChartTheme.js";
import { formatExecutiveReportCurrency } from "./financeExecutiveReportUtils.js";
import type { FinanceExecutiveReport } from "./financeExecutiveReportTypes.js";
import {
  formatExecutiveReportPresentationCurrency,
  formatExecutiveReportPresentationPercent,
} from "./financeExecutiveReportPresentation.js";

export {
  formatExecutiveReportPresentationCurrency,
  formatExecutiveReportPresentationPercent,
  EXECUTIVE_REPORT_EMPTY_MESSAGE,
  EXECUTIVE_REPORT_NO_TARGET_MESSAGE,
} from "./financeExecutiveReportPresentation.js";

export type FinanceExecutiveReportCompany = "all" | "lazarios" | "koppetel" | "sm";
export type FinanceExecutiveReportCustomerType = "external" | "all";
export type FinanceExecutiveReportNfeFilter = "all" | "with-nfe" | "without-nfe";
export type FinanceExecutiveReportTopN = "50" | "100" | "all";

export type FinanceExecutiveReportUiFilters = {
  year: string;
  month: string;
  asOfDate: string;
  company: FinanceExecutiveReportCompany;
  customerType: FinanceExecutiveReportCustomerType;
  nfeFilter: FinanceExecutiveReportNfeFilter;
  topN: FinanceExecutiveReportTopN;
};

export const FINANCE_EXECUTIVE_REPORT_COMPANY_OPTIONS: Array<{
  value: FinanceExecutiveReportCompany;
  label: string;
}> = [
  { value: "all", label: "Consolidado" },
  { value: "lazarios", label: "Lazarios" },
  { value: "koppetel", label: "Koppetel" },
  { value: "sm", label: "SM" },
];

export const FINANCE_EXECUTIVE_REPORT_CUSTOMER_TYPE_OPTIONS: Array<{
  value: FinanceExecutiveReportCustomerType;
  label: string;
}> = [
  { value: "external", label: "Mercado externo" },
  { value: "all", label: "Todos" },
];

export const FINANCE_EXECUTIVE_REPORT_NFE_OPTIONS: Array<{
  value: FinanceExecutiveReportNfeFilter;
  label: string;
}> = [
  { value: "all", label: "Todos" },
  { value: "with-nfe", label: "Com NF-e" },
  { value: "without-nfe", label: "Sem NF-e" },
];

export const FINANCE_EXECUTIVE_REPORT_TOP_N_OPTIONS: Array<{
  value: FinanceExecutiveReportTopN;
  label: string;
}> = [
  { value: "50", label: "Top 50" },
  { value: "100", label: "Top 100" },
  { value: "all", label: "Todos" },
];

export function formatLocalIsoDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function createDefaultFinanceExecutiveReportUiFilters(
  now = new Date()
): FinanceExecutiveReportUiFilters {
  return {
    year: String(now.getFullYear()),
    month: String(now.getMonth() + 1),
    asOfDate: formatLocalIsoDate(now),
    company: "all",
    customerType: "external",
    nfeFilter: "all",
    topN: "50",
  };
}

export function normalizeFinanceExecutiveReportUiFilters(
  filters: FinanceExecutiveReportUiFilters
): FinanceExecutiveReportUiFilters {
  const monthNum = Number(filters.month);
  const month =
    Number.isFinite(monthNum) && monthNum >= 1 && monthNum <= 12
      ? String(monthNum)
      : String(new Date().getMonth() + 1);

  const yearNum = Number(filters.year);
  const year =
    Number.isFinite(yearNum) && yearNum >= 2000 && yearNum <= 2100
      ? String(yearNum)
      : String(new Date().getFullYear());

  const asOfDate = /^\d{4}-\d{2}-\d{2}$/.test(filters.asOfDate.trim())
    ? filters.asOfDate.trim()
    : formatLocalIsoDate(new Date());

  const company = FINANCE_EXECUTIVE_REPORT_COMPANY_OPTIONS.some((o) => o.value === filters.company)
    ? filters.company
    : "all";

  const customerType = FINANCE_EXECUTIVE_REPORT_CUSTOMER_TYPE_OPTIONS.some(
    (o) => o.value === filters.customerType
  )
    ? filters.customerType
    : "external";

  const nfeFilter = FINANCE_EXECUTIVE_REPORT_NFE_OPTIONS.some((o) => o.value === filters.nfeFilter)
    ? filters.nfeFilter
    : "all";

  const topN = FINANCE_EXECUTIVE_REPORT_TOP_N_OPTIONS.some((o) => o.value === filters.topN)
    ? filters.topN
    : "50";

  return { year, month, asOfDate, company, customerType, nfeFilter, topN };
}

export function financeExecutiveReportFiltersEqual(
  a: FinanceExecutiveReportUiFilters,
  b: FinanceExecutiveReportUiFilters
): boolean {
  const na = normalizeFinanceExecutiveReportUiFilters(a);
  const nb = normalizeFinanceExecutiveReportUiFilters(b);
  return (
    na.year === nb.year &&
    na.month === nb.month &&
    na.asOfDate === nb.asOfDate &&
    na.company === nb.company &&
    na.customerType === nb.customerType &&
    na.nfeFilter === nb.nfeFilter &&
    na.topN === nb.topN
  );
}

export function buildFinanceExecutiveReportQuery(
  filters: FinanceExecutiveReportUiFilters
): string {
  const f = normalizeFinanceExecutiveReportUiFilters(filters);
  const params = new URLSearchParams();
  params.set("year", f.year);
  params.set("month", f.month);
  params.set("asOfDate", f.asOfDate);
  params.set("company", f.company);
  params.set("customerType", f.customerType);
  params.set("nfeFilter", f.nfeFilter);
  params.set("topN", f.topN);
  return params.toString();
}

export function getFinanceExecutiveReportApiPath(queryString: string): string {
  return queryString
    ? `/api/finance/executive-report?${queryString}`
    : "/api/finance/executive-report";
}

export function formatExecutiveReportCompanyLabel(
  company: FinanceExecutiveReportCompany | string | null | undefined
): string {
  const match = FINANCE_EXECUTIVE_REPORT_COMPANY_OPTIONS.find((o) => o.value === company);
  return match?.label ?? "Consolidado";
}

export function buildExecutiveReportYearOptions(
  centerYear = new Date().getFullYear(),
  span = 3
): number[] {
  const years: number[] = [];
  for (let y = centerYear - span + 1; y <= centerYear + 1; y += 1) {
    years.push(y);
  }
  return years;
}

export function buildExecutiveReportMonthOptions(): Array<{ value: string; label: string }> {
  return [
    { value: "1", label: "Janeiro" },
    { value: "2", label: "Fevereiro" },
    { value: "3", label: "Março" },
    { value: "4", label: "Abril" },
    { value: "5", label: "Maio" },
    { value: "6", label: "Junho" },
    { value: "7", label: "Julho" },
    { value: "8", label: "Agosto" },
    { value: "9", label: "Setembro" },
    { value: "10", label: "Outubro" },
    { value: "11", label: "Novembro" },
    { value: "12", label: "Dezembro" },
  ];
}

export type ExecutiveSummaryBillingYearRow = {
  year: number;
  value: number | null;
  formatted: string;
};

/** Faturamento do mês corrente por ano comparativo (para bloco Resumo Executivo). */
export function resolveExecutiveSummaryBillingByYear(
  points: BillingMultiYearMonthlyPoint[],
  month: number,
  selectedYear: number
): ExecutiveSummaryBillingYearRow[] {
  const years = resolveFinanceBillingComparisonYears(selectedYear, 3);
  const point = points.find((p) => p.month === month);
  return years.map((year) => {
    const value = point?.values[year] ?? null;
    return {
      year,
      value,
      formatted: formatExecutiveReportPresentationCurrency(value),
    };
  });
}

export function resolveExecutiveReportCriticalMonths(
  report: FinanceExecutiveReport
): string[] {
  const timeline = report.calendarAgenda.executiveSummary?.monthlyTimeline ?? [];
  return timeline
    .filter((row) => row.netFlow < 0)
    .map((row) => row.monthLabel);
}

export function hasExecutiveReportDataQualityAlerts(
  report: FinanceExecutiveReport | null
): boolean {
  if (!report) return false;
  const dq = report.dataQuality;
  return (
    dq.warnings.length > 0 ||
    dq.unavailableSections.length > 0 ||
    dq.targetsDerived ||
    dq.freshness.arStaleExcluded ||
    dq.freshness.apStaleExcluded
  );
}
