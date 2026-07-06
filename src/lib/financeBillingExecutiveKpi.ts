import {
  formatFinanceKpiCurrency,
  formatFinanceKpiVariationPercent,
} from "./financeKpiFormat.js";

const MONTH_SHORT_PT = [
  "Jan",
  "Fev",
  "Mar",
  "Abr",
  "Mai",
  "Jun",
  "Jul",
  "Ago",
  "Set",
  "Out",
  "Nov",
  "Dez",
] as const;

const MONTH_LONG_PT = [
  "Janeiro",
  "Fevereiro",
  "Março",
  "Abril",
  "Maio",
  "Junho",
  "Julho",
  "Agosto",
  "Setembro",
  "Outubro",
  "Novembro",
  "Dezembro",
] as const;

export type FinanceBillingComparisonDelta = {
  delta: number | null;
  variationPercent: number | null;
};

export function formatFinanceBillingShortMonthYear(month: number, year: number): string {
  if (!Number.isInteger(month) || month < 1 || month > 12) return String(year);
  return `${MONTH_SHORT_PT[month - 1]}/${year}`;
}

export function formatFinanceBillingLongMonthYear(month: number, year: number): string {
  if (!Number.isInteger(month) || month < 1 || month > 12) return String(year);
  return `${MONTH_LONG_PT[month - 1]}/${year}`;
}

/** Título do bloco do período de referência do dashboard executivo. */
export function buildFinanceBillingSelectedPeriodTitle(
  year: number,
  month: number | null | undefined
): string {
  if (month != null && month >= 1 && month <= 12) {
    return `Período selecionado — ${formatFinanceBillingLongMonthYear(month, year)}`;
  }
  return `Ano selecionado — ${year}`;
}

/** Título do bloco comparativo — mesmo mês do ano anterior. */
export function buildFinanceBillingComparisonPeriodTitle(
  month: number,
  previousYear: number
): string {
  return `Comparativo — ${formatFinanceBillingLongMonthYear(month, previousYear)}`;
}

export function computeFinanceBillingComparisonDelta(
  current: number | null | undefined,
  previous: number | null | undefined
): FinanceBillingComparisonDelta {
  if (
    current == null ||
    previous == null ||
    !Number.isFinite(current) ||
    !Number.isFinite(previous)
  ) {
    return { delta: null, variationPercent: null };
  }
  const delta = current - previous;
  const variationPercent = previous !== 0 ? (delta / previous) * 100 : null;
  if (!Number.isFinite(delta)) {
    return { delta: null, variationPercent: null };
  }
  if (variationPercent != null && !Number.isFinite(variationPercent)) {
    return { delta, variationPercent: null };
  }
  return { delta, variationPercent };
}

export function formatFinanceBillingDeltaValue(delta: number | null): string {
  return formatFinanceKpiCurrency(delta);
}

export function formatFinanceBillingVariationValue(variationPercent: number | null): string {
  return formatFinanceKpiVariationPercent(variationPercent);
}
