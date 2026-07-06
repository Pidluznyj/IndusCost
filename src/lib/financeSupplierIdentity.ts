/**
 * Motor de identidade de fornecedores financeiros — extração e agrupamento a partir de AP.
 * Somente leitura: não persiste FinancialSupplier nem altera NomusAccountsPayable.
 */
import { normalizeCnpjDigits } from "@/src/lib/groupCompanyCustomer.js";
import { asString, toInt } from "@/src/lib/nomusAccountsPayableParser.js";
import { normalizeSearchString } from "@/src/lib/utils.js";

export type FinanceSupplierConfidenceLevel = "HIGH" | "MEDIUM" | "LOW";

export type FinanceSupplierIdentitySource =
  | "AP_FIELDS"
  | "RAW_PAYLOAD"
  | "FALLBACK";

export type AccountsPayableSupplierRecord = {
  externalId: number;
  personId?: number | null;
  personName?: string | null;
  personCnpj?: string | null;
  companyId?: number | null;
  companyName?: string | null;
  /** Payload Nomus integral (campo real em NomusAccountsPayable). */
  rawPayload?: unknown;
  /** Alias legado/teste; AP oficial usa rawPayload. */
  nomusRawResponse?: unknown;
};

export type ExtractedFinanceSupplier = {
  originalName: string | null;
  originalDocument: string | null;
  normalizedName: string | null;
  normalizedDocument: string | null;
  externalSupplierId: number | null;
  source: FinanceSupplierIdentitySource;
  confidence: FinanceSupplierConfidenceLevel;
  warnings: string[];
};

export type FinanceSupplierApGroup = {
  identityKey: string;
  aliasKey: string;
  confidence: FinanceSupplierConfidenceLevel;
  records: AccountsPayableSupplierRecord[];
  extracted: ExtractedFinanceSupplier;
  recordCount: number;
};

export type FinanceSupplierDuplicateKind =
  | "SAME_DOCUMENT_DIFFERENT_NAMES"
  | "SAME_NAME_DIFFERENT_DOCUMENTS"
  | "SAME_DOCUMENT_CONFLICTING_EXTERNAL_IDS";

export type FinanceSupplierDuplicateHint = {
  kind: FinanceSupplierDuplicateKind;
  normalizedDocument: string | null;
  normalizedName: string | null;
  names: string[];
  documents: string[];
  externalSupplierIds: number[];
  accountsPayableExternalIds: number[];
  identityKeys: string[];
};

const VALID_DOCUMENT_LENGTHS = new Set([11, 14]);

/** Remove máscara; vazio ou só zeros → null. */
export function normalizeSupplierDocument(
  input: string | null | undefined
): string | null {
  const digits = normalizeCnpjDigits(input);
  if (!digits || /^0+$/.test(digits)) return null;
  if (!VALID_DOCUMENT_LENGTHS.has(digits.length)) return digits;
  return digits;
}

/** Igualdade exata pós-normalização (acentos, caixa, espaços); vazio → null. */
export function normalizeSupplierName(input: string | null | undefined): string | null {
  const normalized = normalizeSearchString((input ?? "").trim()).replace(/\s+/g, " ").trim();
  return normalized.length > 0 ? normalized : null;
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function readPayload(record: AccountsPayableSupplierRecord): Record<string, unknown> | null {
  const candidate = record.rawPayload ?? record.nomusRawResponse;
  if (!isJsonObject(candidate)) return null;
  return candidate;
}

function pickPayloadInt(raw: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const parsed = toInt(raw[key]);
    if (parsed != null) return parsed;
  }
  return null;
}

function pickPayloadString(raw: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const parsed = asString(raw[key]);
    if (parsed) return parsed;
  }
  return null;
}

function coalesceString(...values: Array<string | null | undefined>): string | null {
  for (const value of values) {
    const trimmed = (value ?? "").trim();
    if (trimmed) return trimmed;
  }
  return null;
}

function coalesceInt(...values: Array<number | null | undefined>): number | null {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  }
  return null;
}

/**
 * Extrai identidade de fornecedor de um título AP.
 * Prioridade de leitura: campos materializados → rawPayload/nomusRawResponse → fallback seguro.
 */
export function extractSupplierFromAccountsPayable(
  apRecord: AccountsPayableSupplierRecord
): ExtractedFinanceSupplier {
  const warnings: string[] = [];
  let source: FinanceSupplierIdentitySource = "AP_FIELDS";

  const payload = readPayload(apRecord);
  if (apRecord.rawPayload != null && !isJsonObject(apRecord.rawPayload)) {
    warnings.push("INVALID_RAW_PAYLOAD");
  }
  if (apRecord.nomusRawResponse != null && !isJsonObject(apRecord.nomusRawResponse)) {
    warnings.push("INVALID_NOMUS_RAW_RESPONSE");
  }

  let externalSupplierId = coalesceInt(apRecord.personId);
  let originalName = coalesceString(apRecord.personName);
  let originalDocument = coalesceString(apRecord.personCnpj);

  if (payload) {
    const payloadId = pickPayloadInt(payload, ["idPessoa", "idFornecedor"]);
    const payloadName = pickPayloadString(payload, ["nomePessoa", "nomeFornecedor"]);
    const payloadDocument = pickPayloadString(payload, [
      "cnpjPessoa",
      "cpfCnpj",
      "cnpjFornecedor",
    ]);

    if (externalSupplierId == null && payloadId != null) {
      externalSupplierId = payloadId;
      source = "RAW_PAYLOAD";
    }
    if (!originalName && payloadName) {
      originalName = payloadName;
      if (source === "AP_FIELDS") source = "RAW_PAYLOAD";
    }
    if (!originalDocument && payloadDocument) {
      originalDocument = payloadDocument;
      if (source === "AP_FIELDS") source = "RAW_PAYLOAD";
    }
  }

  const normalizedDocument = normalizeSupplierDocument(originalDocument);
  const normalizedName = normalizeSupplierName(originalName);

  if (
    externalSupplierId == null &&
    !normalizedDocument &&
    !normalizedName
  ) {
    source = "FALLBACK";
    warnings.push("MISSING_SUPPLIER_IDENTITY");
    if (Number.isFinite(apRecord.externalId)) {
      warnings.push(`FALLBACK_AP_EXTERNAL_ID:${apRecord.externalId}`);
    }
  }

  const extracted: ExtractedFinanceSupplier = {
    originalName,
    originalDocument,
    normalizedName,
    normalizedDocument,
    externalSupplierId,
    source,
    confidence: "LOW",
    warnings,
  };

  extracted.confidence = resolveSupplierConfidence(extracted);
  return extracted;
}

/**
 * Chave de agrupamento consolidado (prioridade: Nomus ID → documento → nome exato → fallback AP).
 */
export function buildSupplierIdentityKey(
  supplier: Pick<
    ExtractedFinanceSupplier,
    "externalSupplierId" | "normalizedDocument" | "normalizedName"
  >,
  accountsPayableExternalId?: number | null
): string {
  if (supplier.externalSupplierId != null) {
    return `nomus-id:${supplier.externalSupplierId}`;
  }
  if (supplier.normalizedDocument) {
    return `doc:${supplier.normalizedDocument}`;
  }
  if (supplier.normalizedName) {
    return `name:${supplier.normalizedName}`;
  }
  const apId =
    typeof accountsPayableExternalId === "number" && Number.isFinite(accountsPayableExternalId)
      ? Math.trunc(accountsPayableExternalId)
      : 0;
  return `ap-fallback:${apId}`;
}

/** Chave de alias (fragmento de identidade observado no AP). */
export function buildSupplierAliasKey(
  supplier: Pick<
    ExtractedFinanceSupplier,
    "externalSupplierId" | "normalizedDocument" | "normalizedName"
  >,
  accountsPayableExternalId?: number | null
): string {
  if (supplier.externalSupplierId != null) {
    return `alias:nomus-id:${supplier.externalSupplierId}`;
  }
  if (supplier.normalizedDocument) {
    return `alias:doc:${supplier.normalizedDocument}`;
  }
  if (supplier.normalizedName) {
    return `alias:name:${supplier.normalizedName}`;
  }
  const apId =
    typeof accountsPayableExternalId === "number" && Number.isFinite(accountsPayableExternalId)
      ? Math.trunc(accountsPayableExternalId)
      : 0;
  return `alias:ap-fallback:${apId}`;
}

export function resolveSupplierConfidence(
  supplier: Pick<
    ExtractedFinanceSupplier,
    | "externalSupplierId"
    | "normalizedDocument"
    | "normalizedName"
    | "source"
    | "warnings"
  >
): FinanceSupplierConfidenceLevel {
  const hasId = supplier.externalSupplierId != null;
  const hasDoc = Boolean(supplier.normalizedDocument);
  const hasName = Boolean(supplier.normalizedName);

  if (hasId && hasDoc) return "HIGH";
  if (hasId || hasDoc) return "MEDIUM";
  if (hasName) return "LOW";
  return "LOW";
}

export function groupAccountsPayableSuppliers(
  apRecords: AccountsPayableSupplierRecord[]
): FinanceSupplierApGroup[] {
  const map = new Map<string, FinanceSupplierApGroup>();

  for (const record of apRecords) {
    if (!Number.isFinite(record.externalId)) continue;

    const extracted = extractSupplierFromAccountsPayable(record);
    const identityKey = buildSupplierIdentityKey(extracted, record.externalId);
    const aliasKey = buildSupplierAliasKey(extracted, record.externalId);

    const existing = map.get(identityKey);
    if (existing) {
      existing.records.push(record);
      existing.recordCount += 1;
      continue;
    }

    map.set(identityKey, {
      identityKey,
      aliasKey,
      confidence: extracted.confidence,
      records: [record],
      extracted,
      recordCount: 1,
    });
  }

  return [...map.values()].sort((a, b) => a.identityKey.localeCompare(b.identityKey));
}

export function detectPotentialSupplierDuplicates(
  groups: FinanceSupplierApGroup[]
): FinanceSupplierDuplicateHint[] {
  const hints: FinanceSupplierDuplicateHint[] = [];

  const byDocument = new Map<string, FinanceSupplierApGroup[]>();
  const byName = new Map<string, FinanceSupplierApGroup[]>();

  for (const group of groups) {
    const doc = group.extracted.normalizedDocument;
    const name = group.extracted.normalizedName;

    if (doc) {
      const list = byDocument.get(doc) ?? [];
      list.push(group);
      byDocument.set(doc, list);
    }
    if (name) {
      const list = byName.get(name) ?? [];
      list.push(group);
      byName.set(name, list);
    }
  }

  for (const [normalizedDocument, docGroups] of byDocument) {
    const names = new Set<string>();
    const externalIds = new Set<number>();
    const apIds: number[] = [];
    const identityKeys: string[] = [];

    for (const group of docGroups) {
      identityKeys.push(group.identityKey);
      if (group.extracted.normalizedName) names.add(group.extracted.normalizedName);
      if (group.extracted.originalName) names.add(group.extracted.originalName.trim());
      if (group.extracted.externalSupplierId != null) {
        externalIds.add(group.extracted.externalSupplierId);
      }
      for (const row of group.records) apIds.push(row.externalId);
    }

    if (names.size > 1) {
      hints.push({
        kind: "SAME_DOCUMENT_DIFFERENT_NAMES",
        normalizedDocument,
        normalizedName: null,
        names: [...names].sort(),
        documents: [normalizedDocument],
        externalSupplierIds: [...externalIds].sort((a, b) => a - b),
        accountsPayableExternalIds: [...new Set(apIds)].sort((a, b) => a - b),
        identityKeys: [...new Set(identityKeys)].sort(),
      });
    }

    if (externalIds.size > 1) {
      hints.push({
        kind: "SAME_DOCUMENT_CONFLICTING_EXTERNAL_IDS",
        normalizedDocument,
        normalizedName: null,
        names: [...names].sort(),
        documents: [normalizedDocument],
        externalSupplierIds: [...externalIds].sort((a, b) => a - b),
        accountsPayableExternalIds: [...new Set(apIds)].sort((a, b) => a - b),
        identityKeys: [...new Set(identityKeys)].sort(),
      });
    }
  }

  for (const [normalizedName, nameGroups] of byName) {
    const documents = new Set<string>();
    const apIds: number[] = [];
    const identityKeys: string[] = [];
    const displayNames = new Set<string>();

    for (const group of nameGroups) {
      identityKeys.push(group.identityKey);
      if (group.extracted.normalizedDocument) documents.add(group.extracted.normalizedDocument);
      if (group.extracted.originalDocument) {
        const doc = normalizeSupplierDocument(group.extracted.originalDocument);
        if (doc) documents.add(doc);
      }
      if (group.extracted.originalName) displayNames.add(group.extracted.originalName.trim());
      for (const row of group.records) apIds.push(row.externalId);
    }

    if (documents.size > 1) {
      hints.push({
        kind: "SAME_NAME_DIFFERENT_DOCUMENTS",
        normalizedDocument: null,
        normalizedName,
        names: [...displayNames].sort(),
        documents: [...documents].sort(),
        externalSupplierIds: [],
        accountsPayableExternalIds: [...new Set(apIds)].sort((a, b) => a - b),
        identityKeys: [...new Set(identityKeys)].sort(),
      });
    }
  }

  return hints;
}
