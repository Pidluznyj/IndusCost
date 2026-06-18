/**
 * Formatação compacta para KPIs comerciais — display curto + title com valor completo.
 * Reutiliza regras de moeda do financeKpiFormat.
 */

import { formatFinanceKpiCurrency } from "./financeKpiFormat.js";

export type CommercialKpiFormattedValue = {
  display: string;
  /** Valor completo para title/tooltip; null quando o display já é completo. */
  title: string | null;
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

/** Moeda: completo até R$ 9.999,99; acima usa mil/Mi com title completo. */
export function formatCommercialCompactCurrency(
  value: number | null | undefined
): CommercialKpiFormattedValue {
  if (value == null || !Number.isFinite(value)) {
    return { display: "—", title: null };
  }
  const full = formatPtBrCurrencyFull(value);
  const abs = Math.abs(value);
  if (abs < 10_000) {
    return { display: full, title: null };
  }
  return { display: formatFinanceKpiCurrency(value), title: full };
}

/** Quantidade: completo até 9.999; acima usa mil/Mi com title completo. */
export function formatCommercialCompactNumber(
  value: number | null | undefined
): CommercialKpiFormattedValue {
  if (value == null || !Number.isFinite(value)) {
    return { display: "—", title: null };
  }
  const full = formatPtBrNumberFull(value);
  const abs = Math.abs(value);
  if (abs < 10_000) {
    return { display: full, title: null };
  }
  let display: string;
  if (abs >= 1_000_000) {
    display = `${formatPtBr(value / 1_000_000, 1)} Mi`;
  } else {
    display = `${formatPtBr(value / 1_000, 1)} mil`;
  }
  return { display, title: full };
}

/** Data curta pt-BR; title repete a data completa. */
export function formatCommercialShortDate(
  iso: string | null | undefined
): CommercialKpiFormattedValue {
  if (!iso?.trim()) return { display: "—", title: null };
  const raw = iso.trim().slice(0, 10);
  const d = new Date(`${raw}T12:00:00`);
  if (Number.isNaN(d.getTime())) return { display: "—", title: null };
  const full = d.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
  return { display: full, title: full };
}

export function formatCommercialKpiValueWithTitle(
  formatted: CommercialKpiFormattedValue,
  label?: string
): { value: string; valueTitle: string | undefined } {
  if (formatted.title == null) {
    return { value: formatted.display, valueTitle: undefined };
  }
  const prefix = label?.trim() ? `${label.trim()}: ` : "";
  return { value: formatted.display, valueTitle: `${prefix}${formatted.title}` };
}
