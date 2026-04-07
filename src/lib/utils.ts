import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(value: number | string) {
  const amount = typeof value === "string" ? parseFloat(value) : value;
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(amount);
}

export function formatNumber(value: number | string, decimals = 2) {
  const amount = typeof value === "string" ? parseFloat(value) : value;
  return new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(amount);
}
