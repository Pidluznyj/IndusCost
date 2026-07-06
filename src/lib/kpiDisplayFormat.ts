/**
 * Formatação padronizada de valores em cards KPI — display compacto + title completo.
 */

import { formatFinanceKpiCurrency } from "./financeKpiFormat.js";

export type KpiDisplayValue = {
  display: string;
  title: string | null;
  isCompact: boolean;
};

function formatPtBr(value: number, decimals: number): string {
  return new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
}

function formatPtBrCurrencyFull(value: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatPtBrNumberFull(value: number): string {
  if (Number.isInteger(value)) {
    return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 }).format(value);
  }
  return formatPtBr(value, 2);
}

function formatPtBrPercentFull(value: number): string {
  return `${formatPtBr(value, 2)}%`;
}

function emptyDisplay(): KpiDisplayValue {
  return { display: "—", title: null, isCompact: false };
}

/** Moeda: completo até R$ 9.999,99; acima usa mil/Mi. */
export function formatKpiCompactCurrency(
  value: number | null | undefined
): KpiDisplayValue {
  if (value == null || !Number.isFinite(value)) return emptyDisplay();
  const full = formatPtBrCurrencyFull(value);
  const abs = Math.abs(value);
  if (abs < 10_000) {
    return { display: full, title: null, isCompact: false };
  }
  return {
    display: formatFinanceKpiCurrency(value),
    title: full,
    isCompact: true,
  };
}

/** Quantidade: completo até 9.999; acima usa mil/Mi. */
export function formatKpiCompactNumber(
  value: number | null | undefined
): KpiDisplayValue {
  if (value == null || !Number.isFinite(value)) return emptyDisplay();
  const full = formatPtBrNumberFull(value);
  const abs = Math.abs(value);
  if (abs < 10_000) {
    return { display: full, title: null, isCompact: false };
  }
  const display =
    abs >= 1_000_000
      ? `${formatPtBr(value / 1_000_000, 1)} Mi`
      : `${formatPtBr(value / 1_000, 1)} mil`;
  return { display, title: full, isCompact: true };
}

/** Percentual — mantém até 2 casas; compacta apenas valores muito longos. */
export function formatKpiCompactPercent(
  value: number | null | undefined
): KpiDisplayValue {
  if (value == null || !Number.isFinite(value)) return emptyDisplay();
  const full = formatPtBrPercentFull(value);
  if (full.length <= 12) {
    return { display: full, title: null, isCompact: false };
  }
  return { display: `${formatPtBr(value, 1)}%`, title: full, isCompact: true };
}

/** Data pt-BR completa. */
export function formatKpiShortDate(iso: string | null | undefined): KpiDisplayValue {
  if (!iso?.trim()) return emptyDisplay();
  const raw = iso.trim().slice(0, 10);
  const d = new Date(`${raw}T12:00:00`);
  if (Number.isNaN(d.getTime())) return emptyDisplay();
  const full = d.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
  return { display: full, title: full, isCompact: false };
}

/** Monta value + valueTitle para props de card. */
export function formatKpiDisplayValue(
  formatted: KpiDisplayValue,
  label?: string
): { value: string; valueTitle: string | undefined; isCompact: boolean } {
  if (formatted.title == null) {
    return { value: formatted.display, valueTitle: undefined, isCompact: false };
  }
  const prefix = label?.trim() ? `${label.trim()}: ` : "";
  return {
    value: formatted.display,
    valueTitle: `${prefix}${formatted.title}`,
    isCompact: formatted.isCompact,
  };
}

/** Alias semânticos (compatibilidade comercial). */
export const formatKpiDisplayCurrency = formatKpiCompactCurrency;
export const formatKpiDisplayNumber = formatKpiCompactNumber;
export const formatKpiDisplayPercent = formatKpiCompactPercent;
