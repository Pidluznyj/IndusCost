import type { NormalizedCnpjSummary } from "./companyCnpjNormalize.js";
import { normalizeCnpj } from "./companyCnpjFormat.js";

export type CompareFieldStatus =
  | "EQUAL"
  | "DIFFERENT"
  | "EMPTY_ERP"
  | "EMPTY_API"
  | "SUGGESTED";

export type CompareFieldKind =
  | "OFFICIAL_SAFE_TO_APPLY"
  | "FISCAL_SAFE_TO_APPLY"
  | "ADDRESS_SAFE_TO_APPLY"
  | "PUBLIC_CONTACT_REVIEW_ONLY"
  | "INTERNAL_COMMERCIAL_PROTECTED"
  | "NOT_APPLICABLE";

export const COMPARE_FIELD_KIND_LABELS: Record<CompareFieldKind, string> = {
  OFFICIAL_SAFE_TO_APPLY: "Oficial",
  FISCAL_SAFE_TO_APPLY: "Fiscal",
  ADDRESS_SAFE_TO_APPLY: "Endereço fiscal",
  PUBLIC_CONTACT_REVIEW_ONLY: "Contato público",
  INTERNAL_COMMERCIAL_PROTECTED: "Comercial protegido",
  NOT_APPLICABLE: "—",
};

export type CustomerCompareField = {
  field: string;
  label: string;
  kind: CompareFieldKind;
  kindLabel: string;
  erpValue: string | null;
  apiValue: string | null;
  status: CompareFieldStatus;
  suggestedValue: string | null;
  selectable: boolean;
};

export type PublicContactField = {
  field: "phone" | "email";
  label: string;
  apiValue: string | null;
  erpValue: string | null;
  kind: "PUBLIC_CONTACT_REVIEW_ONLY";
  disclaimer: string;
};

export type ErpCommercialField = {
  field: string;
  label: string;
  erpValue: string | null;
  kind: "INTERNAL_COMMERCIAL_PROTECTED";
  kindLabel: string;
};

export type CustomerCompareResult = {
  fields: CustomerCompareField[];
  publicContacts: PublicContactField[];
  erpCommercialFields: ErpCommercialField[];
  equalCount: number;
  differentCount: number;
  suggestedUpdates: number;
};

export const PUBLIC_CONTACT_DISCLAIMER =
  "Estes contatos vêm da base pública do CNPJ e podem pertencer ao contador, escritório fiscal ou responsável cadastral. Valide antes de usar como contato comercial.";

export const PROTECTED_CONTACT_FIELDS = ["phone", "email"] as const;
export type ProtectedContactField = (typeof PROTECTED_CONTACT_FIELDS)[number];

export const CUSTOMER_INTELLIGENCE_WRITABLE_FIELDS = [
  "companyName",
  "tradeName",
  "stateTaxId",
  "address",
  "city",
  "state",
  "zipCode",
  "segment",
] as const;

export type WritableCustomerField = (typeof CUSTOMER_INTELLIGENCE_WRITABLE_FIELDS)[number];

const FIELD_META: Record<
  string,
  { label: string; kind: CompareFieldKind; applyable: boolean }
> = {
  companyName: { label: "Razão social", kind: "OFFICIAL_SAFE_TO_APPLY", applyable: true },
  tradeName: { label: "Nome fantasia", kind: "OFFICIAL_SAFE_TO_APPLY", applyable: true },
  taxId: { label: "CNPJ", kind: "OFFICIAL_SAFE_TO_APPLY", applyable: false },
  stateTaxId: { label: "Inscrição estadual", kind: "FISCAL_SAFE_TO_APPLY", applyable: true },
  address: { label: "Endereço", kind: "ADDRESS_SAFE_TO_APPLY", applyable: true },
  city: { label: "Cidade", kind: "ADDRESS_SAFE_TO_APPLY", applyable: true },
  state: { label: "UF", kind: "ADDRESS_SAFE_TO_APPLY", applyable: true },
  zipCode: { label: "CEP", kind: "ADDRESS_SAFE_TO_APPLY", applyable: true },
  segment: { label: "Segmento (CNAE)", kind: "OFFICIAL_SAFE_TO_APPLY", applyable: true },
  phone: { label: "Telefone", kind: "PUBLIC_CONTACT_REVIEW_ONLY", applyable: false },
  email: { label: "E-mail", kind: "PUBLIC_CONTACT_REVIEW_ONLY", applyable: false },
  contactName: {
    label: "Comprador / contato",
    kind: "INTERNAL_COMMERCIAL_PROTECTED",
    applyable: false,
  },
  accountOwner: {
    label: "Responsável comercial",
    kind: "INTERNAL_COMMERCIAL_PROTECTED",
    applyable: false,
  },
  commercialNotes: {
    label: "Observações comerciais",
    kind: "INTERNAL_COMMERCIAL_PROTECTED",
    applyable: false,
  },
  relationshipStatus: {
    label: "Status de relacionamento",
    kind: "INTERNAL_COMMERCIAL_PROTECTED",
    applyable: false,
  },
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
  contactName?: string | null;
  accountOwner?: string | null;
  commercialNotes?: string | null;
  relationshipStatus?: string | null;
  segment?: string | null;
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
  apiValue: string | null | undefined
): CustomerCompareField {
  const meta = FIELD_META[field] ?? {
    label: field,
    kind: "NOT_APPLICABLE" as CompareFieldKind,
    applyable: false,
  };
  const erp = erpValue?.trim() || null;
  const api = apiValue?.trim() || null;
  const status = compareValues(erp, api);
  const suggestedValue =
    meta.applyable && (status === "DIFFERENT" || status === "EMPTY_ERP") ? api : null;
  const selectable =
    meta.applyable && (status === "DIFFERENT" || status === "EMPTY_ERP") && Boolean(api);
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

function erpCommercialRow(field: string, erpValue: string | null | undefined): ErpCommercialField {
  const meta = FIELD_META[field] ?? {
    label: field,
    kind: "INTERNAL_COMMERCIAL_PROTECTED" as CompareFieldKind,
  };
  return {
    field,
    label: meta.label,
    erpValue: erpValue?.trim() || null,
    kind: "INTERNAL_COMMERCIAL_PROTECTED",
    kindLabel: COMPARE_FIELD_KIND_LABELS.INTERNAL_COMMERCIAL_PROTECTED,
  };
}

export function compareCustomerWithCnpjData(
  customer: CustomerLike,
  summary: NormalizedCnpjSummary
): CustomerCompareResult {
  const primaryIe = summary.stateTaxIds[0]?.number;
  const officialFields: CustomerCompareField[] = [
    fieldRow("companyName", customer.companyName, summary.companyName),
    fieldRow("tradeName", customer.tradeName, summary.tradeName),
    fieldRow("taxId", customer.taxId, summary.cnpj),
    fieldRow(
      "stateTaxId",
      customer.stateTaxId,
      primaryIe && primaryIe !== "—" ? primaryIe : null
    ),
    fieldRow("address", customer.address, summary.address),
    fieldRow("city", customer.city, summary.city),
    fieldRow("state", customer.state, summary.state),
    fieldRow(
      "zipCode",
      customer.zipCode,
      summary.zipCode?.replace(/\D/g, "") ?? null
    ),
    fieldRow("segment", customer.segment, summary.mainCnae?.description ?? null),
  ];

  if (normalizeCnpj(customer.taxId) !== summary.cnpj) {
    const taxField = officialFields.find((f) => f.field === "taxId");
    if (taxField) taxField.status = "DIFFERENT";
  }

  const publicContacts: PublicContactField[] = [
    {
      field: "phone",
      label: "Telefone público",
      apiValue: summary.phone?.trim() || null,
      erpValue: customer.phone?.trim() || null,
      kind: "PUBLIC_CONTACT_REVIEW_ONLY",
      disclaimer: PUBLIC_CONTACT_DISCLAIMER,
    },
    {
      field: "email",
      label: "E-mail público",
      apiValue: summary.email?.trim() || null,
      erpValue: customer.email?.trim() || null,
      kind: "PUBLIC_CONTACT_REVIEW_ONLY",
      disclaimer: PUBLIC_CONTACT_DISCLAIMER,
    },
  ];

  const erpCommercialFields: ErpCommercialField[] = [
    erpCommercialRow("contactName", customer.contactName),
    erpCommercialRow("phone", customer.phone),
    erpCommercialRow("email", customer.email),
    erpCommercialRow("accountOwner", customer.accountOwner),
    erpCommercialRow("commercialNotes", customer.commercialNotes),
    erpCommercialRow("relationshipStatus", customer.relationshipStatus),
  ];

  return {
    fields: officialFields,
    publicContacts,
    erpCommercialFields,
    equalCount: officialFields.filter((f) => f.status === "EQUAL").length,
    differentCount: officialFields.filter((f) => f.status === "DIFFERENT").length,
    suggestedUpdates: officialFields.filter((f) => f.selectable).length,
  };
}

export function validateApplyFieldSelection(
  selectedFields: string[],
  confirmPublicContactOverwrite = false
): { blockedFields: string[] } {
  const blockedFields = selectedFields.filter(
    (field) =>
      PROTECTED_CONTACT_FIELDS.includes(field as ProtectedContactField) &&
      !confirmPublicContactOverwrite
  );
  return { blockedFields };
}

export function assertApplyFieldSelectionAllowed(
  selectedFields: string[],
  confirmPublicContactOverwrite = false
): void {
  const { blockedFields } = validateApplyFieldSelection(
    selectedFields,
    confirmPublicContactOverwrite
  );
  if (blockedFields.length > 0) {
    throw new ApplyFieldSelectionError(
      "Telefone/e-mail público do CNPJ não pode sobrescrever contato comercial sem confirmação explícita.",
      blockedFields
    );
  }
}

export class ApplyFieldSelectionError extends Error {
  readonly code = "PROTECTED_CONTACT_APPLY";
  readonly blockedFields: string[];

  constructor(message: string, blockedFields: string[]) {
    super(message);
    this.name = "ApplyFieldSelectionError";
    this.blockedFields = blockedFields;
  }
}

export function buildApplyPatch(
  customer: CustomerLike,
  summary: NormalizedCnpjSummary,
  selectedFields: string[],
  options?: { confirmPublicContactOverwrite?: boolean }
): Record<string, string> {
  assertApplyFieldSelectionAllowed(
    selectedFields,
    options?.confirmPublicContactOverwrite ?? false
  );

  const compare = compareCustomerWithCnpjData(customer, summary);
  const patch: Record<string, string> = {};

  for (const field of selectedFields) {
    if (PROTECTED_CONTACT_FIELDS.includes(field as ProtectedContactField)) {
      if (!options?.confirmPublicContactOverwrite) continue;
      const contact = compare.publicContacts.find((c) => c.field === field);
      if (!contact?.apiValue) continue;
      patch[field] = contact.apiValue;
      continue;
    }

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
