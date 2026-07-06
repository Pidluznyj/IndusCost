/**
 * IndusCost Design System — formatação de métricas financeiras para cards KPI.
 *
 * Padrão:
 * - Valor principal: compacto quando grande (mil / Mi), completo quando pequeno.
 * - Valor completo: disponível em `title` / tooltip via `resolveMetricDisplay`.
 * - Nunca truncar com reticências — usar abreviação inteligente.
 */

import { formatFinanceCurrency } from "./financeAccountsReceivableFormat.js";
import {
  formatKpiCompactCurrency,
  formatKpiCompactNumber,
  formatKpiCompactPercent,
  formatKpiDisplayValue,
  type KpiDisplayValue,
} from "./kpiDisplayFormat.js";

export type FinancialMetricFormat = "currency" | "number" | "percent";

/** Valor monetário completo (pt-BR). */
export function formatFullCurrency(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return formatFinanceCurrency(value);
}

/** Moeda compacta para cards — ex.: R$ 12,4 Mi, R$ 850,2 mil, R$ 9.850,00. */
export function formatCompactCurrency(value: number | null | undefined): string {
  return formatKpiCompactCurrency(value).display;
}

/** Número compacto para cards — ex.: 12,4 mil, 1,2 Mi. */
export function formatCompactNumber(value: number | null | undefined): string {
  return formatKpiCompactNumber(value).display;
}

function formatByKind(
  value: number | null | undefined,
  format: FinancialMetricFormat
): KpiDisplayValue {
  if (format === "currency") return formatKpiCompactCurrency(value);
  if (format === "percent") return formatKpiCompactPercent(value);
  return formatKpiCompactNumber(value);
}

export function resolveMetricDisplay(input: {
  label?: string;
  value?: string | number;
  formattedValue?: string;
  fullValue?: string;
  amount?: number | null;
  amountFormat?: FinancialMetricFormat;
}): { display: string; title?: string; fullValue?: string } {
  if (input.formattedValue != null && input.formattedValue !== "") {
    return {
      display: input.formattedValue,
      title: input.fullValue?.trim() || undefined,
      fullValue: input.fullValue?.trim() || undefined,
    };
  }

  if (typeof input.value === "string" && input.value.trim()) {
    return {
      display: input.value.trim(),
      title: input.fullValue?.trim() || undefined,
      fullValue: input.fullValue?.trim() || undefined,
    };
  }

  if (typeof input.value === "number" && Number.isFinite(input.value)) {
    const format = input.amountFormat ?? "number";
    const formatted = formatByKind(input.value, format);
    const display = formatKpiDisplayValue(formatted, input.label);
    return {
      display: display.value,
      title: display.valueTitle,
      fullValue: formatted.title ?? undefined,
    };
  }

  if (input.amount != null && input.amountFormat) {
    const formatted = formatByKind(input.amount, input.amountFormat);
    const display = formatKpiDisplayValue(formatted, input.label);
    return {
      display: display.value,
      title: display.valueTitle,
      fullValue: formatted.title ?? undefined,
    };
  }

  if (typeof input.value === "number") {
    return { display: "—" };
  }

  return { display: "—" };
}
