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
  /**
   * Identidade CONSOLIDADA de todos os títulos do grupo (ver
   * reconcileSupplierGroupIdentity). Independe da ordem de leitura do AP:
   * o primeiro título lido não decide o documento do fornecedor.
   */
  extracted: ExtractedFinanceSupplier;
  recordCount: number;
  /** Documentos normalizados distintos observados nos títulos do grupo (ordenados). */
  documentCandidates: string[];
  /** true quando o grupo observa mais de um documento distinto — nenhum é adotado. */
  documentConflict: boolean;
};

export const FINANCE_SUPPLIER_IDENTITY_WARNINGS = {
  CONFLICTING_DOCUMENTS: "CONFLICTING_DOCUMENTS",
  CONFLICTING_EXTERNAL_IDS: "CONFLICTING_EXTERNAL_IDS",
} as const;

export type ReconciledSupplierGroupIdentity = {
  extracted: ExtractedFinanceSupplier;
  documentCandidates: string[];
  documentConflict: boolean;
  externalIdCandidates: number[];
  externalIdConflict: boolean;
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

/** Grafia canônica entre as observadas de um mesmo documento: a mais curta (dígitos puros vencem a máscara), depois lexicográfica. */
function pickCanonicalDocumentSpelling(spellings: Iterable<string>): string | null {
  let best: string | null = null;
  for (const spelling of spellings) {
    const trimmed = spelling.trim();
    if (!trimmed) continue;
    if (
      best == null ||
      trimmed.length < best.length ||
      (trimmed.length === best.length && trimmed < best)
    ) {
      best = trimmed;
    }
  }
  return best;
}

/** Nome de exibição determinístico: o mais longo, depois lexicográfico. */
function pickCanonicalName(names: Iterable<string>): string | null {
  let best: string | null = null;
  for (const name of names) {
    const trimmed = name.trim();
    if (!trimmed) continue;
    if (
      best == null ||
      trimmed.length > best.length ||
      (trimmed.length === best.length && trimmed < best)
    ) {
      best = trimmed;
    }
  }
  return best;
}

/**
 * Reconcilia a identidade de UM grupo de títulos AP a partir de TODOS os
 * títulos — nunca só do primeiro lido. Regras (determinísticas, independentes
 * da ordem de entrada):
 *
 * - externalSupplierId: o único valor não nulo observado; mais de um distinto →
 *   null + CONFLICTING_EXTERNAL_IDS (não acontece em grupos `nomus-id:*`, mas o
 *   contrato é defensivo).
 * - documento: exatamente UM documento normalizado distinto → adotado (grafia
 *   canônica entre as observadas); mais de um → null + CONFLICTING_DOCUMENTS e
 *   `documentCandidates` para diagnóstico. Nunca se inventa documento.
 * - nome: o mais longo observado (empate: lexicográfico).
 * - source: melhor origem observada (AP_FIELDS > RAW_PAYLOAD > FALLBACK).
 * - warnings: união (sem duplicatas) + conflitos.
 * - confidence: recalculada sobre a identidade consolidada.
 */
export function reconcileSupplierGroupIdentity(
  records: AccountsPayableSupplierRecord[]
): ReconciledSupplierGroupIdentity {
  const ordered = [...records].sort((a, b) => {
    const left = Number.isFinite(a.externalId) ? a.externalId : Number.MAX_SAFE_INTEGER;
    const right = Number.isFinite(b.externalId) ? b.externalId : Number.MAX_SAFE_INTEGER;
    return left - right;
  });
  const extractions = ordered.map(extractSupplierFromAccountsPayable);

  const externalIds = new Set<number>();
  const spellingsByDocument = new Map<string, Set<string>>();
  const names = new Set<string>();
  const warnings: string[] = [];
  const sources = new Set<FinanceSupplierIdentitySource>();

  for (const extracted of extractions) {
    if (extracted.externalSupplierId != null) externalIds.add(extracted.externalSupplierId);
    if (extracted.normalizedDocument) {
      const spellings = spellingsByDocument.get(extracted.normalizedDocument) ?? new Set<string>();
      if (extracted.originalDocument) spellings.add(extracted.originalDocument.trim());
      spellingsByDocument.set(extracted.normalizedDocument, spellings);
    }
    if (extracted.originalName) names.add(extracted.originalName.trim());
    for (const warning of extracted.warnings) {
      if (!warnings.includes(warning)) warnings.push(warning);
    }
    sources.add(extracted.source);
  }

  const externalIdCandidates = [...externalIds].sort((a, b) => a - b);
  const externalIdConflict = externalIdCandidates.length > 1;
  const externalSupplierId = externalIdConflict ? null : externalIdCandidates[0] ?? null;

  const documentCandidates = [...spellingsByDocument.keys()].sort();
  const documentConflict = documentCandidates.length > 1;
  const normalizedDocument = documentConflict ? null : documentCandidates[0] ?? null;
  const originalDocument = normalizedDocument
    ? pickCanonicalDocumentSpelling(spellingsByDocument.get(normalizedDocument) ?? []) ??
      normalizedDocument
    : null;

  const originalName = pickCanonicalName(names);
  const normalizedName = normalizeSupplierName(originalName);

  let source: FinanceSupplierIdentitySource = sources.has("AP_FIELDS")
    ? "AP_FIELDS"
    : sources.has("RAW_PAYLOAD")
      ? "RAW_PAYLOAD"
      : "FALLBACK";

  if (externalIdConflict) {
    warnings.push(FINANCE_SUPPLIER_IDENTITY_WARNINGS.CONFLICTING_EXTERNAL_IDS);
  }
  if (documentConflict) {
    warnings.push(FINANCE_SUPPLIER_IDENTITY_WARNINGS.CONFLICTING_DOCUMENTS);
  }
  if (externalSupplierId == null && !normalizedDocument && !normalizedName) {
    source = "FALLBACK";
    if (!warnings.includes("MISSING_SUPPLIER_IDENTITY")) warnings.push("MISSING_SUPPLIER_IDENTITY");
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

  return {
    extracted,
    documentCandidates,
    documentConflict,
    externalIdCandidates,
    externalIdConflict,
  };
}

/**
 * Agrupa títulos AP por identidade (Nomus ID → documento → nome → fallback) e
 * consolida a identidade de cada grupo com reconcileSupplierGroupIdentity.
 * Resultado idêntico para qualquer permutação da entrada.
 */
export function groupAccountsPayableSuppliers(
  apRecords: AccountsPayableSupplierRecord[]
): FinanceSupplierApGroup[] {
  const buckets = new Map<string, { aliasKey: string; records: AccountsPayableSupplierRecord[] }>();

  for (const record of apRecords) {
    if (!Number.isFinite(record.externalId)) continue;

    const extracted = extractSupplierFromAccountsPayable(record);
    const identityKey = buildSupplierIdentityKey(extracted, record.externalId);
    const aliasKey = buildSupplierAliasKey(extracted, record.externalId);

    const bucket = buckets.get(identityKey);
    if (bucket) {
      bucket.records.push(record);
      continue;
    }
    buckets.set(identityKey, { aliasKey, records: [record] });
  }

  const groups: FinanceSupplierApGroup[] = [];
  for (const [identityKey, bucket] of buckets) {
    const reconciled = reconcileSupplierGroupIdentity(bucket.records);
    groups.push({
      identityKey,
      aliasKey: bucket.aliasKey,
      confidence: reconciled.extracted.confidence,
      records: bucket.records,
      extracted: reconciled.extracted,
      recordCount: bucket.records.length,
      documentCandidates: reconciled.documentCandidates,
      documentConflict: reconciled.documentConflict,
    });
  }

  return groups.sort((a, b) => a.identityKey.localeCompare(b.identityKey));
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
