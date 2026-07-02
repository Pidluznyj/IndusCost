/**
 * Filtro de período (Ano/Mês) compartilhado — Comercial > Comissões.
 * Reutiliza opções de mês do módulo de pedidos; sem regra de negócio de comissão.
 */

import { SALES_ORDER_MONTH_OPTIONS } from "./salesOrderPeriodFilter.js";

export const COMMISSIONS_FILTER_FIELD_CLASS =
  "h-9 w-full rounded-lg border border-[#E5E7EB] bg-white px-3 text-sm text-[#111827] placeholder:text-[#9CA3AF] focus:outline-none focus:ring-2 focus:ring-[#2563EB]/30";

export const COMMISSIONS_FILTER_LABEL_CLASS = "text-xs font-medium text-[#6B7280]";

/** Anos para select: de `minYear` até ano de referência + 1 (descendente). */
export function buildCommissionsYearOptions(
  referenceYear = new Date().getFullYear(),
  minYear = 2023
): number[] {
  const maxYear = referenceYear + 1;
  const years: number[] = [];
  for (let y = maxYear; y >= minYear; y -= 1) {
    years.push(y);
  }
  return years;
}

export const COMMISSIONS_MONTH_SELECT_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "", label: "Todos os meses" },
  ...SALES_ORDER_MONTH_OPTIONS.map((m) => ({
    value: String(m.value),
    label: m.label,
  })),
];
