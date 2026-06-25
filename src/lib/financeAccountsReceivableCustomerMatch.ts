import { normalizeSearchString } from "@/src/lib/utils.js";
import { normalizeCnpjDigits } from "@/src/lib/groupCompanyCustomer.js";
import { safeTrim } from "@/src/lib/safeTrim.js";

/** Normaliza razão social para comparação tolerante (S/A, S.A., SA, pontuação, acentos). */
export function normalizeFinanceCustomerNameForMatch(value: string | null | undefined): string {
  return normalizeSearchString(value ?? "")
    .replace(/[./\\-]+/g, " ")
    .replace(/\bs\s*a\b/g, "sa")
    .replace(/\s+/g, " ")
    .trim();
}

export function financeCustomerNameMatches(
  rowName: string | null | undefined,
  filterName: string | null | undefined
): boolean {
  const filter = normalizeFinanceCustomerNameForMatch(filterName);
  if (!filter) return true;
  const field = normalizeFinanceCustomerNameForMatch(rowName);
  if (!field) return false;
  return field.includes(filter);
}

export function financeCustomerCnpjMatches(
  rowCnpj: string | null | undefined,
  filterCnpj: string | null | undefined
): boolean {
  const filterDigits = normalizeCnpjDigits(filterCnpj);
  if (filterDigits.length < 11) return false;
  return normalizeCnpjDigits(rowCnpj) === filterDigits;
}

/** ID Nomus (personId) — somente inteiros positivos; rejeita UUID/texto. */
export function parseNomusPersonIdCustomerParam(value: unknown): number | undefined {
  const raw = safeTrim(value);
  if (!raw || !/^\d+$/.test(raw)) return undefined;
  const personId = Number.parseInt(raw, 10);
  return Number.isFinite(personId) && personId > 0 ? personId : undefined;
}

export function isNomusPersonIdCustomerParam(value: unknown): boolean {
  return parseNomusPersonIdCustomerParam(value) != null;
}

export function parseFinanceCustomerNameParam(query: Record<string, unknown>): string | undefined {
  for (const key of ["customerName", "customer", "client", "cliente"] as const) {
    const raw = typeof query[key] === "string" ? query[key].trim() : "";
    if (raw) return raw;
  }
  return undefined;
}
