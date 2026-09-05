/**
 * Agregador multi-source de inteligência CNPJ.
 * - Fontes em paralelo (Promise.allSettled)
 * - Precedência determinística por campo
 * - Fallback parcial (uma fonte ok basta)
 * - Proveniência por campo
 * - BCB marcado not_applicable (sem chamada artificial)
 */
import { CompanyIntelligenceError } from "./companyCnpjErrors.js";
import { fetchBrasilApiCnpj, normalizeBrasilApiCnpjPayload } from "./companyCnpjBrasilApi.js";
import { fetchPublicCnpj } from "./companyCnpjPublicaWs.js";
import { normalizePublicCnpjPayload, type NormalizedCnpjSummary } from "./companyCnpjNormalize.js";
import { formatCnpj, isValidCnpj, normalizeCnpj } from "./companyCnpjFormat.js";
import {
  BCB_CNPJ_NOT_APPLICABLE_REASON,
  CNPJ_FIELD_PRECEDENCE,
  CNPJ_SOURCE_BCB,
  CNPJ_SOURCE_BRASIL_API,
  CNPJ_SOURCE_LABELS,
  CNPJ_SOURCE_PUBLICA_CNPJ_WS,
  formatCnpjAggregateSourceLabel,
  type CnpjSourceId,
  type CnpjSourceReport,
  type CnpjSourceStatus,
} from "./companyCnpjSources.js";

export type CnpjFieldProvenance = Partial<Record<keyof NormalizedCnpjSummary, string>>;

export type AggregatedCnpjIntelligence = {
  summary: NormalizedCnpjSummary;
  fieldProvenance: CnpjFieldProvenance;
  sources: CnpjSourceReport[];
  warnings: string[];
  partialSuccess: boolean;
  rawBySource: Partial<Record<CnpjSourceId, unknown>>;
  /** Envelope persistido em CustomerCnpjLookup.rawJson */
  rawEnvelope: {
    aggregateVersion: 1;
    sources: Partial<Record<CnpjSourceId, unknown>>;
    reports: CnpjSourceReport[];
  };
};

type SourceAttempt = {
  id: typeof CNPJ_SOURCE_BRASIL_API | typeof CNPJ_SOURCE_PUBLICA_CNPJ_WS;
  summary: NormalizedCnpjSummary | null;
  raw: unknown | null;
  status: CnpjSourceStatus;
  message?: string;
};

function isEmptyValue(value: unknown): boolean {
  if (value == null) return true;
  if (typeof value === "string") {
    const t = value.trim();
    return !t || t === "—";
  }
  if (typeof value === "number") return !Number.isFinite(value);
  if (typeof value === "boolean") return false;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "object") {
    return Object.keys(value as object).length === 0;
  }
  return false;
}

function mapErrorToStatus(error: unknown): { status: CnpjSourceStatus; message: string } {
  if (error instanceof CompanyIntelligenceError) {
    if (error.code === "CNPJ_NOT_FOUND") return { status: "not_found", message: error.message };
    if (error.code === "RATE_LIMIT") return { status: "rate_limited", message: error.message };
    if (error.code === "TIMEOUT") return { status: "timeout", message: error.message };
    return { status: "error", message: error.message };
  }
  if (error instanceof Error) return { status: "error", message: error.message };
  return { status: "error", message: "Falha desconhecida na fonte." };
}

function pickScalarField<K extends keyof NormalizedCnpjSummary>(
  field: K,
  bySource: Partial<Record<CnpjSourceId, NormalizedCnpjSummary>>,
  provenance: CnpjFieldProvenance
): NormalizedCnpjSummary[K] | undefined {
  const order = CNPJ_FIELD_PRECEDENCE[field as string] ?? [
    CNPJ_SOURCE_BRASIL_API,
    CNPJ_SOURCE_PUBLICA_CNPJ_WS,
  ];
  for (const sourceId of order) {
    const summary = bySource[sourceId];
    if (!summary) continue;
    const value = summary[field];
    if (!isEmptyValue(value)) {
      provenance[field] = sourceId;
      return value;
    }
  }
  return undefined;
}

function mergePartners(
  bySource: Partial<Record<CnpjSourceId, NormalizedCnpjSummary>>,
  provenance: CnpjFieldProvenance
): NormalizedCnpjSummary["partners"] {
  const order = CNPJ_FIELD_PRECEDENCE.partners ?? [
    CNPJ_SOURCE_PUBLICA_CNPJ_WS,
    CNPJ_SOURCE_BRASIL_API,
  ];
  const seen = new Map<string, { name: string; role: string | null }>();
  let firstSource: string | null = null;
  for (const sourceId of order) {
    const partners = bySource[sourceId]?.partners ?? [];
    for (const p of partners) {
      const key = p.name.trim().toUpperCase();
      if (!key || key === "—") continue;
      if (!seen.has(key)) {
        seen.set(key, p);
        if (!firstSource) firstSource = sourceId;
      } else {
        const cur = seen.get(key)!;
        if (!cur.role && p.role) seen.set(key, { ...cur, role: p.role });
      }
    }
  }
  if (firstSource) provenance.partners = firstSource;
  return [...seen.values()];
}

function mergeSecondaryCnaes(
  bySource: Partial<Record<CnpjSourceId, NormalizedCnpjSummary>>,
  provenance: CnpjFieldProvenance
): NormalizedCnpjSummary["secondaryCnaes"] {
  const order = CNPJ_FIELD_PRECEDENCE.secondaryCnaes ?? [
    CNPJ_SOURCE_BRASIL_API,
    CNPJ_SOURCE_PUBLICA_CNPJ_WS,
  ];
  const seen = new Map<string, { code: string; description: string }>();
  let firstSource: string | null = null;
  for (const sourceId of order) {
    for (const c of bySource[sourceId]?.secondaryCnaes ?? []) {
      const key = c.code !== "—" ? c.code : c.description;
      if (!key) continue;
      if (!seen.has(key)) {
        seen.set(key, c);
        if (!firstSource) firstSource = sourceId;
      }
    }
  }
  if (firstSource) provenance.secondaryCnaes = firstSource;
  return [...seen.values()];
}

function mergeStateTaxIds(
  bySource: Partial<Record<CnpjSourceId, NormalizedCnpjSummary>>,
  provenance: CnpjFieldProvenance
): NormalizedCnpjSummary["stateTaxIds"] {
  const order = CNPJ_FIELD_PRECEDENCE.stateTaxIds ?? [CNPJ_SOURCE_PUBLICA_CNPJ_WS];
  for (const sourceId of order) {
    const list = bySource[sourceId]?.stateTaxIds ?? [];
    if (list.length > 0) {
      provenance.stateTaxIds = sourceId;
      return list;
    }
  }
  return [];
}

/** Merge campo a campo — payload incompleto de uma fonte NÃO apaga valor válido de outra. */
export function mergeCnpjSummaries(
  bySource: Partial<Record<CnpjSourceId, NormalizedCnpjSummary>>,
  cnpjDigits: string
): { summary: NormalizedCnpjSummary; fieldProvenance: CnpjFieldProvenance } {
  const provenance: CnpjFieldProvenance = {};
  const companyName =
    (pickScalarField("companyName", bySource, provenance) as string | undefined) ?? "—";
  const partners = mergePartners(bySource, provenance);
  const secondaryCnaes = mergeSecondaryCnaes(bySource, provenance);
  const stateTaxIds = mergeStateTaxIds(bySource, provenance);

  const summary: NormalizedCnpjSummary = {
    cnpj: cnpjDigits,
    cnpjFormatted: formatCnpj(cnpjDigits),
    companyName,
    tradeName: (pickScalarField("tradeName", bySource, provenance) as string | null | undefined) ?? null,
    registrationStatus:
      (pickScalarField("registrationStatus", bySource, provenance) as string | null | undefined) ??
      null,
    registrationStatusNormalized:
      (pickScalarField(
        "registrationStatusNormalized",
        bySource,
        provenance
      ) as string | null | undefined) ?? null,
    openedAt: (pickScalarField("openedAt", bySource, provenance) as string | null | undefined) ?? null,
    companySize:
      (pickScalarField("companySize", bySource, provenance) as string | null | undefined) ?? null,
    legalNature:
      (pickScalarField("legalNature", bySource, provenance) as string | null | undefined) ?? null,
    shareCapital:
      (pickScalarField("shareCapital", bySource, provenance) as number | null | undefined) ?? null,
    mainCnae:
      (pickScalarField("mainCnae", bySource, provenance) as NormalizedCnpjSummary["mainCnae"]) ??
      null,
    secondaryCnaes,
    address: (pickScalarField("address", bySource, provenance) as string | null | undefined) ?? null,
    addressNumber:
      (pickScalarField("addressNumber", bySource, provenance) as string | null | undefined) ?? null,
    addressComplement:
      (pickScalarField("addressComplement", bySource, provenance) as string | null | undefined) ??
      null,
    district: (pickScalarField("district", bySource, provenance) as string | null | undefined) ?? null,
    city: (pickScalarField("city", bySource, provenance) as string | null | undefined) ?? null,
    state: (pickScalarField("state", bySource, provenance) as string | null | undefined) ?? null,
    zipCode: (pickScalarField("zipCode", bySource, provenance) as string | null | undefined) ?? null,
    phone: (pickScalarField("phone", bySource, provenance) as string | null | undefined) ?? null,
    email: (pickScalarField("email", bySource, provenance) as string | null | undefined) ?? null,
    stateTaxIds,
    partners,
    isMei: Boolean(bySource[CNPJ_SOURCE_BRASIL_API]?.isMei || bySource[CNPJ_SOURCE_PUBLICA_CNPJ_WS]?.isMei),
    hasPartners: partners.length > 0,
    sourceUpdatedAt:
      (pickScalarField("sourceUpdatedAt", bySource, provenance) as string | null | undefined) ?? null,
  };

  if (summary.isMei) {
    const order = CNPJ_FIELD_PRECEDENCE.isMei;
    for (const sourceId of order) {
      if (bySource[sourceId]?.isMei) {
        provenance.isMei = sourceId;
        break;
      }
    }
  }
  provenance.hasPartners = provenance.partners;
  provenance.cnpj = provenance.companyName ?? CNPJ_SOURCE_BRASIL_API;
  provenance.cnpjFormatted = provenance.cnpj;

  return { summary, fieldProvenance: provenance };
}

async function attemptBrasilApi(
  cnpj: string,
  fetchImpl: typeof fetch
): Promise<SourceAttempt> {
  try {
    const raw = await fetchBrasilApiCnpj(cnpj, fetchImpl);
    const summary = normalizeBrasilApiCnpjPayload(raw);
    return { id: CNPJ_SOURCE_BRASIL_API, summary, raw, status: "ok" };
  } catch (e) {
    const mapped = mapErrorToStatus(e);
    return {
      id: CNPJ_SOURCE_BRASIL_API,
      summary: null,
      raw: null,
      status: mapped.status,
      message: mapped.message,
    };
  }
}

async function attemptPublicaCnpjWs(
  cnpj: string,
  fetchImpl: typeof fetch
): Promise<SourceAttempt> {
  try {
    const raw = await fetchPublicCnpj(cnpj, fetchImpl);
    const summary = normalizePublicCnpjPayload(raw);
    return { id: CNPJ_SOURCE_PUBLICA_CNPJ_WS, summary, raw, status: "ok" };
  } catch (e) {
    const mapped = mapErrorToStatus(e);
    return {
      id: CNPJ_SOURCE_PUBLICA_CNPJ_WS,
      summary: null,
      raw: null,
      status: mapped.status,
      message: mapped.message,
    };
  }
}

/**
 * Consulta BrasilAPI + publica.cnpj.ws em paralelo.
 * BCB entra apenas como relatório `not_applicable` (sem HTTP).
 */
export async function aggregateCnpjIntelligence(input: {
  cnpj: string;
  fetchImpl?: typeof fetch;
}): Promise<AggregatedCnpjIntelligence> {
  const cnpj = normalizeCnpj(input.cnpj);
  if (!isValidCnpj(cnpj)) {
    throw new CompanyIntelligenceError("CNPJ inválido.", "INVALID_CNPJ", 422);
  }

  const fetchImpl = input.fetchImpl ?? fetch;
  const settled = await Promise.allSettled([
    attemptBrasilApi(cnpj, fetchImpl),
    attemptPublicaCnpjWs(cnpj, fetchImpl),
  ]);

  const attempts: SourceAttempt[] = settled.map((r, idx) => {
    if (r.status === "fulfilled") return r.value;
    const id = idx === 0 ? CNPJ_SOURCE_BRASIL_API : CNPJ_SOURCE_PUBLICA_CNPJ_WS;
    const mapped = mapErrorToStatus(r.reason);
    return {
      id,
      summary: null,
      raw: null,
      status: mapped.status,
      message: mapped.message,
    };
  });

  const bySource: Partial<Record<CnpjSourceId, NormalizedCnpjSummary>> = {};
  const rawBySource: Partial<Record<CnpjSourceId, unknown>> = {};
  const sources: CnpjSourceReport[] = [];
  const warnings: string[] = [];

  for (const attempt of attempts) {
    sources.push({
      id: attempt.id,
      label: CNPJ_SOURCE_LABELS[attempt.id],
      status: attempt.status,
      message: attempt.message,
    });
    if (attempt.status === "ok" && attempt.summary) {
      bySource[attempt.id] = attempt.summary;
      if (attempt.raw != null) rawBySource[attempt.id] = attempt.raw;
    } else {
      warnings.push(
        `${CNPJ_SOURCE_LABELS[attempt.id]} indisponível` +
          (attempt.message ? `: ${attempt.message}` : ".")
      );
    }
  }

  sources.push({
    id: CNPJ_SOURCE_BCB,
    label: CNPJ_SOURCE_LABELS[CNPJ_SOURCE_BCB],
    status: "not_applicable",
    message: BCB_CNPJ_NOT_APPLICABLE_REASON,
  });

  const okCount = attempts.filter((a) => a.status === "ok" && a.summary).length;
  if (okCount === 0) {
    const rateLimited = attempts.some((a) => a.status === "rate_limited");
    if (rateLimited) {
      throw new CompanyIntelligenceError(
        "Limite de consultas das APIs públicas atingido. Tente novamente em alguns minutos.",
        "RATE_LIMIT",
        429
      );
    }
    const notFound = attempts.every(
      (a) => a.status === "not_found" || a.status === "error" || a.status === "timeout"
    );
    const allNotFound = attempts.every((a) => a.status === "not_found");
    if (allNotFound) {
      throw new CompanyIntelligenceError("CNPJ não encontrado na base pública.", "CNPJ_NOT_FOUND", 404);
    }
    const timedOut = attempts.every((a) => a.status === "timeout");
    if (timedOut) {
      throw new CompanyIntelligenceError("Tempo esgotado na consulta pública.", "TIMEOUT", 504);
    }
    void notFound;
    throw new CompanyIntelligenceError(
      "Serviço de consulta CNPJ indisponível no momento.",
      "UPSTREAM_UNAVAILABLE",
      502
    );
  }

  const { summary, fieldProvenance } = mergeCnpjSummaries(bySource, cnpj);
  const partialSuccess = okCount < attempts.length;
  if (partialSuccess) {
    warnings.unshift(
      "Consulta parcial: pelo menos uma fonte pública falhou; os dados disponíveis foram combinados."
    );
  }

  const reports = sources;
  return {
    summary,
    fieldProvenance,
    sources: reports,
    warnings,
    partialSuccess,
    rawBySource,
    rawEnvelope: {
      aggregateVersion: 1,
      sources: rawBySource,
      reports,
    },
  };
}

export function resolveAggregateSourceLabel(sources: CnpjSourceReport[]): string {
  return formatCnpjAggregateSourceLabel(sources);
}
