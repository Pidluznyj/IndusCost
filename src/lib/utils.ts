import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(value: number | string, decimals = 2) {
  const amount = typeof value === "string" ? parseFloat(value) : value;
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 2,
    maximumFractionDigits: 6,
  }).format(amount);
}

export function formatNumber(value: number | string, decimals = 2) {
  const amount = typeof value === "string" ? parseFloat(value) : value;
  // Se o valor tiver muitas casas decimais significativas, mostramos até 6
  return new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: 6,
  }).format(amount);
}

/**
 * Regra de apresentação analítica: 2 casas para valores “normais” (|x| ≥ 1 ou zero);
 * até 6 casas quando 0 < |x| < 1 (ex.: frações/pequenas taxas por unidade).
 */
export function formatNumberAdaptive(value: number | string): string {
  const n = typeof value === "string" ? parseFloat(value) : value;
  if (!Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs === 0) {
    return new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(0);
  }
  if (abs >= 1) {
    return new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
  }
  return new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 6 }).format(n);
}

/** Mesma regra que {@link formatNumberAdaptive}, em BRL. */
export function formatCurrencyAdaptive(value: number | string): string {
  const n = typeof value === "string" ? parseFloat(value) : value;
  if (!Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  const base = { style: "currency" as const, currency: "BRL" };
  if (abs === 0) {
    return new Intl.NumberFormat("pt-BR", { ...base, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(0);
  }
  if (abs >= 1) {
    return new Intl.NumberFormat("pt-BR", { ...base, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
  }
  return new Intl.NumberFormat("pt-BR", { ...base, minimumFractionDigits: 2, maximumFractionDigits: 6 }).format(n);
}

/** Minúsculas e sem acentos — para busca em selects pesquisáveis */
export function normalizeSearchString(input: string): string {
  return input
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase();
}
