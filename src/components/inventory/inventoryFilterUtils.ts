/**
 * Helpers de filtros do módulo Estoque — frontend puro.
 */
import { safeTrim } from "@/src/lib/safeTrim.js";

/** Adiciona parâmetro à query apenas se o valor trimado não for vazio. */
export function appendQueryIfPresent(q: URLSearchParams, key: string, value: unknown): void {
  const trimmed = safeTrim(value);
  if (trimmed) q.set(key, trimmed);
}

export function hasAnyFilter(values: readonly unknown[]): boolean {
  return values.some((v) => {
    if (typeof v === "boolean") return v;
    return safeTrim(v).length > 0;
  });
}
