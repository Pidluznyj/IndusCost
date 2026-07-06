import { formatFinanceKpiCurrency } from "./financeKpiFormat.js";

/** Formatação numérica da Visão Executiva — sem dependências de servidor. */

export function formatExecutiveInteger(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "Não disponível";
  return new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(Math.round(value));
}

export function formatExecutiveCurrency(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "Não disponível";
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

export function formatExecutiveDecimal(value: number | null, decimals = 2): string {
  if (value == null || !Number.isFinite(value)) return "Não disponível";
  const d = Math.min(Math.max(0, decimals), 2);
  return new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  }).format(value);
}

export function formatExecutivePercent(value: number | null, decimals: 1 | 2 = 1): string {
  if (value == null || !Number.isFinite(value)) return "Não disponível";
  const formatted = new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
  return `${formatted}%`;
}

/** Valores grandes abreviados para cards executivos. */
export function formatExecutiveCompactCurrency(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "Não disponível";
  return formatFinanceKpiCurrency(value);
}

export function formatMetricCount(value: number | null): string {
  return formatExecutiveInteger(value);
}

export function formatMetricCurrency(value: number | null): string {
  return formatExecutiveCurrency(value);
}
