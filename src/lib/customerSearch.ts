import type { Prisma } from "@prisma/client";
import type { Customer } from "@prisma/client";
import { buildCustomerSearchWhere } from "./customerListQuery.js";
import { safeTrim } from "./safeTrim.js";

export const CUSTOMER_SEARCH_DEFAULT_LIMIT = 20;
export const CUSTOMER_SEARCH_MAX_LIMIT = 50;
export const CUSTOMER_SEARCH_MIN_CHARS = 2;
export const CUSTOMER_SEARCH_DEBOUNCE_MS = 300;

export type CustomerSearchItemSource = "induscost";

export type CustomerSearchItem = {
  id: string;
  code: string | null;
  name: string;
  tradeName: string | null;
  taxId: string | null;
  city: string | null;
  state: string | null;
  source: CustomerSearchItemSource;
};

export type EntityAutocompleteSelection = {
  id?: string;
  code?: string | null;
  name: string;
  tradeName?: string | null;
  taxId?: string | null;
  city?: string | null;
  state?: string | null;
  source: "nomus" | "induscost";
};

export function normalizeCustomerSearchQuery(raw: unknown): string {
  return String(raw ?? "").trim();
}

export function parseCustomerSearchLimit(raw: unknown): number {
  const n = typeof raw === "string" ? Number(raw) : typeof raw === "number" ? raw : NaN;
  if (!Number.isFinite(n) || n <= 0) return CUSTOMER_SEARCH_DEFAULT_LIMIT;
  return Math.min(Math.floor(n), CUSTOMER_SEARCH_MAX_LIMIT);
}

/** Busca ampliada: razão social, fantasia, CNPJ, e-mail, telefone, cidade, UF. */
export function buildCustomerSearchWhereEnhanced(search: string): Prisma.CustomerWhereInput | undefined {
  const searchRaw = search.trim();
  if (!searchRaw) return undefined;

  const base = buildCustomerSearchWhere(searchRaw);
  const digits = searchRaw.replace(/\D/g, "");
  const extra: Prisma.CustomerWhereInput[] = [
    { email: { contains: searchRaw, mode: "insensitive" } },
    { phone: { contains: searchRaw, mode: "insensitive" } },
    { city: { contains: searchRaw, mode: "insensitive" } },
    { state: { contains: searchRaw, mode: "insensitive" } },
  ];

  if (digits.length >= 2) {
    extra.push({ phone: { contains: digits, mode: "insensitive" } });
  }

  if (base?.OR) {
    return { OR: [...base.OR, ...extra] };
  }
  return { OR: extra };
}

export function formatCustomerPrimaryName(
  customer: Pick<Customer, "companyName" | "tradeName">
): string {
  return customer.companyName?.trim() || customer.tradeName?.trim() || "Cliente";
}

export function serializeCustomerSearchItem(
  customer: Pick<
    Customer,
    "id" | "companyName" | "tradeName" | "taxId" | "city" | "state" | "email" | "phone"
  >
): CustomerSearchItem {
  return {
    id: customer.id,
    code: null,
    name: formatCustomerPrimaryName(customer),
    tradeName: customer.tradeName?.trim() || null,
    taxId: customer.taxId?.trim() || null,
    city: customer.city?.trim() || null,
    state: customer.state?.trim() || null,
    source: "induscost",
  };
}

export function customerSearchItemToSelection(item: CustomerSearchItem): EntityAutocompleteSelection {
  return {
    id: item.id,
    code: item.code,
    name: item.name,
    tradeName: item.tradeName,
    taxId: item.taxId,
    city: item.city,
    state: item.state,
    source: item.source,
  };
}

export function formatCustomerSearchSecondaryLine(item: CustomerSearchItem): string {
  const parts: string[] = [];
  if (item.taxId) parts.push(item.taxId);
  if (item.city || item.state) {
    parts.push([item.city, item.state].filter(Boolean).join("/"));
  }
  if (item.code) parts.push(`Cód. ${item.code}`);
  return parts.join(" · ") || "—";
}

function normalizeMatchText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function customerSearchRankScore(item: CustomerSearchItem, query: string): number {
  const q = normalizeMatchText(query);
  const qDigits = query.replace(/\D/g, "");
  const name = normalizeMatchText(item.name);
  const trade = normalizeMatchText(item.tradeName ?? "");
  const taxDigits = (item.taxId ?? "").replace(/\D/g, "");

  if (qDigits.length >= 11 && taxDigits === qDigits) return 1000;
  if (name.startsWith(q)) return 900;
  if (trade.startsWith(q)) return 850;
  if (name.includes(q)) return 700;
  if (trade.includes(q)) return 650;
  if (item.taxId?.includes(query)) return 600;
  if (item.city && normalizeMatchText(item.city).includes(q)) return 400;
  return 100;
}

export function rankCustomerSearchResults(
  items: CustomerSearchItem[],
  query: string
): CustomerSearchItem[] {
  return [...items].sort((a, b) => {
    const diff = customerSearchRankScore(b, query) - customerSearchRankScore(a, query);
    if (diff !== 0) return diff;
    return a.name.localeCompare(b.name, "pt-BR");
  });
}

export function selectionFromFinancePersonFields(
  personName: string,
  personCnpj: string,
  customerId?: string
): EntityAutocompleteSelection | null {
  const name = safeTrim(personName);
  const cnpj = safeTrim(personCnpj);
  const id = safeTrim(customerId);
  if (!name && !cnpj && !id) return null;
  return {
    id: id || undefined,
    name: name || cnpj || "Cliente",
    taxId: cnpj || null,
    source: "induscost",
  };
}

export function financeArCustomerFieldsFromSelection(
  selection: EntityAutocompleteSelection | null
): {
  personName: string;
  personCnpj: string;
  customerId: string;
  customerName: string;
} {
  if (!selection) {
    return { personName: "", personCnpj: "", customerId: "", customerName: "" };
  }
  const name = safeTrim(selection.name);
  const taxId = safeTrim(selection.taxId);
  const rawId = safeTrim(selection.id);
  const isNomusPersonId = /^\d+$/.test(rawId) && Number.parseInt(rawId, 10) > 0;
  return {
    personName: name,
    personCnpj: taxId,
    customerId: isNomusPersonId ? rawId : "",
    customerName: name,
  };
}

export function financePersonFieldsFromSelection(
  selection: EntityAutocompleteSelection | null
): { personName: string; personCnpj: string; customerId: string } {
  if (!selection) return { personName: "", personCnpj: "", customerId: "" };
  return {
    personName: safeTrim(selection.name),
    personCnpj: safeTrim(selection.taxId),
    customerId: safeTrim(selection.id),
  };
}

export function financeCashFlowCustomerFieldsFromSelection(
  selection: EntityAutocompleteSelection | null
): { customerName: string; personCnpj: string } {
  if (!selection) return { customerName: "", personCnpj: "" };
  return {
    customerName: selection.name.trim(),
    personCnpj: selection.taxId?.trim() ?? "",
  };
}

export function customerIdFromSelection(
  selection: EntityAutocompleteSelection | null
): string {
  return selection?.id?.trim() ?? "";
}
