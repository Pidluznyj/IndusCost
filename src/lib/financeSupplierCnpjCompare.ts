import type { NormalizedCnpjSummary } from "./companyCnpjNormalize.js";
import { normalizeCnpj } from "./companyCnpjFormat.js";
import {
  COMPARE_FIELD_KIND_LABELS,
  type CompareFieldKind,
  type CompareFieldStatus,
  type CustomerCompareField,
  type CustomerCompareResult,
  type PublicContactField,
} from "./companyCnpjCompare.js";

export const SUPPLIER_INTELLIGENCE_WRITABLE_FIELDS = [
  "legalName",
  "tradeName",
  "document",
] as const;

export type WritableSupplierField = (typeof SUPPLIER_INTELLIGENCE_WRITABLE_FIELDS)[number];

type SupplierLike = {
  displayName?: string | null;
  legalName?: string | null;
  tradeName?: string | null;
  document?: string | null;
};

const FIELD_META: Record<
  string,
  { label: string; kind: CompareFieldKind; applyable: boolean }
> = {
  legalName: { label: "Razão social", kind: "OFFICIAL_SAFE_TO_APPLY", applyable: true },
  tradeName: { label: "Nome fantasia", kind: "OFFICIAL_SAFE_TO_APPLY", applyable: true },
  document: { label: "CNPJ", kind: "OFFICIAL_SAFE_TO_APPLY", applyable: true },
  displayName: { label: "Nome exibido", kind: "NOT_APPLICABLE", applyable: false },
  stateTaxId: { label: "Inscrição estadual", kind: "FISCAL_SAFE_TO_APPLY", applyable: false },
  address: { label: "Endereço", kind: "ADDRESS_SAFE_TO_APPLY", applyable: false },
  city: { label: "Cidade", kind: "ADDRESS_SAFE_TO_APPLY", applyable: false },
  state: { label: "UF", kind: "ADDRESS_SAFE_TO_APPLY", applyable: false },
  zipCode: { label: "CEP", kind: "ADDRESS_SAFE_TO_APPLY", applyable: false },
  registrationStatus: {
    label: "Situação cadastral",
    kind: "OFFICIAL_SAFE_TO_APPLY",
    applyable: false,
  },
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
  erpValue: string | null | undefined,
  apiValue: string | null | undefined,
  options?: { forceNotSelectable?: boolean }
): CustomerCompareField {
  const meta = FIELD_META[field] ?? {
    label: field,
    kind: "NOT_APPLICABLE" as CompareFieldKind,
    applyable: false,
  };
  const erp = erpValue?.trim() || null;
  const api = apiValue?.trim() || null;
  const status = compareValues(erp, api);
  const documentEmpty = field === "document" && !normDigits(erp);
  const applyable =
    meta.applyable &&
    (field !== "document" || documentEmpty) &&
    !options?.forceNotSelectable;
  const suggestedValue =
    applyable && (status === "DIFFERENT" || status === "EMPTY_ERP") ? api : null;
  const selectable = applyable && (status === "DIFFERENT" || status === "EMPTY_ERP") && Boolean(api);
  return {
    field,
    label: meta.label,
    kind: meta.kind,
    kindLabel: COMPARE_FIELD_KIND_LABELS[meta.kind],
    erpValue: erp,
    apiValue: api,
    status,
    suggestedValue,
    selectable,
  };
}

export function compareSupplierWithCnpjData(
  supplier: SupplierLike,
  summary: NormalizedCnpjSummary
): CustomerCompareResult {
  const primaryIe = summary.stateTaxIds[0]?.number;
  const officialFields: CustomerCompareField[] = [
    fieldRow("legalName", supplier.legalName ?? supplier.displayName, summary.companyName),
    fieldRow("tradeName", supplier.tradeName, summary.tradeName),
    fieldRow("document", supplier.document, summary.cnpj),
    fieldRow(
      "displayName",
      supplier.displayName,
      summary.tradeName ?? summary.companyName,
      { forceNotSelectable: true }
    ),
    fieldRow(
      "stateTaxId",
      null,
      primaryIe && primaryIe !== "—" ? primaryIe : null
    ),
    fieldRow("address", null, summary.address),
    fieldRow("city", null, summary.city),
    fieldRow("state", null, summary.state),
    fieldRow("zipCode", null, summary.zipCode?.replace(/\D/g, "") ?? null),
    fieldRow("registrationStatus", null, summary.registrationStatus),
  ];

  if (normalizeCnpj(supplier.document) && normalizeCnpj(supplier.document) !== summary.cnpj) {
    const taxField = officialFields.find((f) => f.field === "document");
    if (taxField && normDigits(supplier.document) !== summary.cnpj) {
      taxField.status = "DIFFERENT";
      taxField.selectable = false;
      taxField.suggestedValue = null;
    }
  }

  const publicContacts: PublicContactField[] = [
    {
      field: "phone",
      label: "Telefone público",
      apiValue: summary.phone?.trim() || null,
      erpValue: null,
      kind: "PUBLIC_CONTACT_REVIEW_ONLY",
      disclaimer:
        "Contato público da Receita — não persistido no cadastro consolidado de fornecedor.",
    },
    {
      field: "email",
      label: "E-mail público",
      apiValue: summary.email?.trim() || null,
      erpValue: null,
      kind: "PUBLIC_CONTACT_REVIEW_ONLY",
      disclaimer:
        "Contato público da Receita — não persistido no cadastro consolidado de fornecedor.",
    },
  ];

  return {
    fields: officialFields,
    publicContacts,
    erpCommercialFields: [],
    equalCount: officialFields.filter((f) => f.status === "EQUAL").length,
    differentCount: officialFields.filter((f) => f.status === "DIFFERENT").length,
    suggestedUpdates: officialFields.filter((f) => f.selectable).length,
  };
}

export function buildSupplierApplyPatch(
  supplier: SupplierLike,
  summary: NormalizedCnpjSummary,
  selectedFields: string[]
): Record<string, string> {
  const compare = compareSupplierWithCnpjData(supplier, summary);
  const patch: Record<string, string> = {};

  for (const field of selectedFields) {
    if (!SUPPLIER_INTELLIGENCE_WRITABLE_FIELDS.includes(field as WritableSupplierField)) {
      continue;
    }
    const row = compare.fields.find((f) => f.field === field);
    if (!row?.selectable || !row.suggestedValue) continue;

    if (field === "document") {
      if (normDigits(supplier.document)) continue;
      patch.document = normalizeCnpj(row.suggestedValue);
      continue;
    }

    patch[field] = row.suggestedValue;
  }

  if (patch.legalName || patch.tradeName) {
    patch.displayName = patch.tradeName || patch.legalName || supplier.displayName?.trim() || "";
  }

  return patch;
}
