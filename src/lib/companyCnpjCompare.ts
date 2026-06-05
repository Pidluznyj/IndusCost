import type { NormalizedCnpjSummary } from "./companyCnpjNormalize.js";
import { normalizeCnpj } from "./companyCnpjFormat.js";

export type CompareFieldStatus =
  | "EQUAL"
  | "DIFFERENT"
  | "EMPTY_ERP"
  | "EMPTY_API"
  | "SUGGESTED";

export type CustomerCompareField = {
  field: string;
  label: string;
  erpValue: string | null;
  apiValue: string | null;
  status: CompareFieldStatus;
  suggestedValue: string | null;
  selectable: boolean;
};

export type CustomerCompareResult = {
  fields: CustomerCompareField[];
  equalCount: number;
  differentCount: number;
  suggestedUpdates: number;
};

type CustomerLike = {
  companyName?: string | null;
  tradeName?: string | null;
  taxId?: string | null;
  stateTaxId?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  zipCode?: string | null;
  phone?: string | null;
  email?: string | null;
};

function norm(value: string | null | undefined): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function normDigits(value: string | null | undefined): string {
  return String(value ?? "").replace(/\D/g, "");
}

function compareValues(erp: string | null, api: string | null): CompareFieldStatus {
  const e = norm(erp);
  const a = norm(api);
  if (!e && !a) return "EQUAL";
  if (!e && a) return "EMPTY_ERP";
  if (e && !a) return "EMPTY_API";
  if (e === a) return "EQUAL";
  if (normDigits(erp) && normDigits(api) && normDigits(erp) === normDigits(api)) return "EQUAL";
  return "DIFFERENT";
}

function fieldRow(
  field: string,
  label: string,
  erpValue: string | null | undefined,
  apiValue: string | null | undefined
): CustomerCompareField {
  const erp = erpValue?.trim() || null;
  const api = apiValue?.trim() || null;
  const status = compareValues(erp, api);
  const suggestedValue =
    status === "DIFFERENT" || status === "EMPTY_ERP" ? api : null;
  return {
    field,
    label,
    erpValue: erp,
    apiValue: api,
    status,
    suggestedValue,
    selectable: status === "DIFFERENT" || status === "EMPTY_ERP",
  };
}

export function compareCustomerWithCnpjData(
  customer: CustomerLike,
  summary: NormalizedCnpjSummary
): CustomerCompareResult {
  const primaryIe = summary.stateTaxIds[0]?.number;
  const fields: CustomerCompareField[] = [
    fieldRow("companyName", "Razão social", customer.companyName, summary.companyName),
    fieldRow("tradeName", "Nome fantasia", customer.tradeName, summary.tradeName),
    fieldRow("taxId", "CNPJ", customer.taxId, summary.cnpj),
    fieldRow(
      "stateTaxId",
      "Inscrição estadual",
      customer.stateTaxId,
      primaryIe && primaryIe !== "—" ? primaryIe : null
    ),
    fieldRow("address", "Endereço", customer.address, summary.address),
    fieldRow("city", "Cidade", customer.city, summary.city),
    fieldRow("state", "UF", customer.state, summary.state),
    fieldRow(
      "zipCode",
      "CEP",
      customer.zipCode,
      summary.zipCode?.replace(/\D/g, "") ?? null
    ),
    fieldRow("phone", "Telefone", customer.phone, summary.phone),
    fieldRow("email", "E-mail", customer.email, summary.email),
  ];

  if (normalizeCnpj(customer.taxId) !== summary.cnpj) {
    const taxField = fields.find((f) => f.field === "taxId");
    if (taxField) taxField.status = "DIFFERENT";
  }

  return {
    fields,
    equalCount: fields.filter((f) => f.status === "EQUAL").length,
    differentCount: fields.filter((f) => f.status === "DIFFERENT").length,
    suggestedUpdates: fields.filter((f) => f.selectable).length,
  };
}

export const CUSTOMER_INTELLIGENCE_WRITABLE_FIELDS = [
  "companyName",
  "tradeName",
  "stateTaxId",
  "address",
  "city",
  "state",
  "zipCode",
  "phone",
  "email",
  "segment",
] as const;

export type WritableCustomerField = (typeof CUSTOMER_INTELLIGENCE_WRITABLE_FIELDS)[number];

export function buildApplyPatch(
  customer: CustomerLike,
  summary: NormalizedCnpjSummary,
  selectedFields: string[]
): Record<string, string> {
  const compare = compareCustomerWithCnpjData(customer, summary);
  const patch: Record<string, string> = {};

  for (const field of selectedFields) {
    if (!CUSTOMER_INTELLIGENCE_WRITABLE_FIELDS.includes(field as WritableCustomerField)) {
      continue;
    }
    const row = compare.fields.find((f) => f.field === field);
    if (!row?.selectable || !row.suggestedValue) continue;
    const current = String((customer as Record<string, unknown>)[field] ?? "").trim();
    if (current && row.status !== "DIFFERENT" && row.status !== "EMPTY_ERP") continue;
    patch[field] = row.suggestedValue;
  }

  if (selectedFields.includes("segment") && summary.mainCnae?.description) {
    patch.segment = summary.mainCnae.description;
  }

  return patch;
}

export function shouldBlockApplyWhenApiEmpty(
  field: string,
  apiValue: string | null
): boolean {
  return !apiValue?.trim() && field !== "tradeName";
}
