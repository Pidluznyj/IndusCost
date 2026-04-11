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

/** Minúsculas e sem acentos — para busca em selects pesquisáveis */
export function normalizeSearchString(input: string): string {
  return input
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase();
}
