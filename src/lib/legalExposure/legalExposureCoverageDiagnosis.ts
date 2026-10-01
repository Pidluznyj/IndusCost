/**
 * Diagnóstico de cobertura por campo e por fonte.
 * Nunca reduz lacuna a "não identificado" sem causa.
 */

import {
  COVERAGE_FIELD_LABELS,
  COVERAGE_GAP_CAUSE_LABELS,
  PARTY_ROLE_CONFLICT_COPY,
  SOURCE_ATTEMPT_IDENTIFIER,
  SOURCE_KIND_LABELS,
  SOURCE_LABELS,
  type CaseCoverageStatus,
  type CoverageFieldDiagnosis,
  type CoverageFieldKey,
  type CoverageGapCause,
  type CoveragePublicCompare,
  type CoverageSourceFact,
  type CoverageSourceMatrixRow,
  type LegalExposureSource,
} from "./legalExposureContracts.js";
import { isComplementarySource, isLocatorSource, sourceKindOf } from "./legalExposureAuthority.js";
import { SOURCE_FRESHNESS_POLICY } from "./legalExposureHealth.js";
import {
  TRIBUNAL_PUBLIC_MANUAL_ACCESS,
  tribunalPublicLookup,
} from "./legalTribunalPublicRegistry.js";

export const COVERAGE_MATRIX_SOURCES: LegalExposureSource[] = [
  "DATAJUD",
  "DJEN",
  "TRIBUNAL_PUBLIC",
  "ESCAVADOR",
  "JUSBRASIL",
  "WEB_DISCOVERY",
];

const FIELD_KEYS: CoverageFieldKey[] = [
  "claimant",
  "defendants",
  "groupPoles",
  "class",
  "subjects",
  "claimValue",
  "movements",
  "attorneys",
  "hearings",
  "status",
];

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

export function shortCoverageSourceLabel(source: LegalExposureSource, tribunal?: string | null): string {
  if (source === "TRIBUNAL_PUBLIC") {
    const alias = (tribunal ?? "").toUpperCase();
    if (alias.includes("TRT9") || alias === "TRT-9") return "TRT9";
    if (alias.includes("TJPR")) return "TJPR";
    return "Portal do tribunal";
  }
  return SOURCE_LABELS[source] ?? source;
}

export function parseSourceAttemptMetadata(raw: unknown): {
  outcome: string | null;
  errorCode: string | null;
  message: string | null;
  publicUrl: string | null;
  capabilities: string[];
} | null {
  const record = asRecord(raw);
  if (!record || record.kind !== SOURCE_ATTEMPT_IDENTIFIER) return null;
  const capabilities = Array.isArray(record.capabilities)
    ? record.capabilities.filter((row): row is string => typeof row === "string")
    : [];
  return {
    outcome: typeof record.outcome === "string" ? record.outcome : null,
    errorCode: typeof record.errorCode === "string" ? record.errorCode : null,
    message: typeof record.message === "string" ? record.message : null,
    publicUrl: typeof record.publicUrl === "string" ? record.publicUrl : null,
    capabilities,
  };
}

export function isPersistedSourceFresh(input: {
  source: LegalExposureSource;
  lastSeenAt: string | null | undefined;
  now?: Date;
}): boolean {
  if (!input.lastSeenAt) return false;
  const time = Date.parse(input.lastSeenAt);
  if (!Number.isFinite(time)) return false;
  const now = input.now ?? new Date();
  return now.getTime() - time < SOURCE_FRESHNESS_POLICY[input.source].staleAfterMs;
}

function emptyFact(source: LegalExposureSource): CoverageSourceFact {
  return {
    source,
    claimantCount: 0,
    defendantCount: 0,
    classFound: false,
    subjectCount: 0,
    claimValueFound: false,
    movementCount: 0,
    attorneyCount: 0,
    hearingCount: 0,
    publicationCount: 0,
    statusFound: false,
    lastSeenAt: null,
    attemptOutcome: null,
    attemptErrorCode: null,
    attemptMessage: null,
    publicUrl: null,
    capabilities: [],
  };
}

export function emptySourceFacts(): CoverageSourceFact[] {
  return COVERAGE_MATRIX_SOURCES.map(emptyFact);
}

function laterIso(left: string | null, right: string | null): string | null {
  if (!left) return right;
  if (!right) return left;
  return Date.parse(left) >= Date.parse(right) ? left : right;
}

export function sourceFactsFromRecords(input: {
  className: string | null;
  claimValueFormatted: string | null;
  currentStatus: string | null;
  groupCnpjs?: string[];
  groupNames?: string[];
  parties?: Array<{
    source: LegalExposureSource;
    pole: string;
    documentNormalized?: string | null;
    normalizedName?: string;
    name?: string;
  }>;
  movements?: Array<{ source: LegalExposureSource }>;
  attorneys?: Array<{ source: LegalExposureSource }>;
  hearings?: Array<{ source: LegalExposureSource }>;
  subjects?: Array<{ source: LegalExposureSource }>;
  evidences?: Array<{
    source: LegalExposureSource;
    lastSeenAt: string;
    sourceIdentifier?: string | null;
    rawMetadata?: unknown;
  }>;
  communications?: Array<{ source: LegalExposureSource }>;
}): CoverageSourceFact[] {
  const facts = new Map<LegalExposureSource, CoverageSourceFact>(emptySourceFacts().map((row) => [row.source, row]));
  const groupCnpjs = new Set((input.groupCnpjs ?? []).map((row) => row.replace(/\D/g, "")).filter(Boolean));
  const groupNames = new Set((input.groupNames ?? []).map((row) => row.trim().toUpperCase()).filter(Boolean));
  const isGroupParty = (party: { documentNormalized?: string | null; normalizedName?: string; name?: string }) => {
    const document = (party.documentNormalized ?? "").replace(/\D/g, "");
    if (document && groupCnpjs.has(document)) return true;
    const name = (party.normalizedName ?? party.name ?? "").trim().toUpperCase();
    return Boolean(name && groupNames.has(name));
  };

  for (const party of input.parties ?? []) {
    if (isLocatorSource(party.source)) continue;
    const fact = facts.get(party.source) ?? emptyFact(party.source);
    if (party.pole === "ACTIVE" && !isGroupParty(party)) fact.claimantCount += 1;
    if (party.pole === "PASSIVE") fact.defendantCount += 1;
    facts.set(party.source, fact);
  }
  for (const row of input.movements ?? []) {
    const fact = facts.get(row.source) ?? emptyFact(row.source);
    fact.movementCount += 1;
    facts.set(row.source, fact);
  }
  for (const row of input.attorneys ?? []) {
    const fact = facts.get(row.source) ?? emptyFact(row.source);
    fact.attorneyCount += 1;
    facts.set(row.source, fact);
  }
  for (const row of input.hearings ?? []) {
    const fact = facts.get(row.source) ?? emptyFact(row.source);
    fact.hearingCount += 1;
    facts.set(row.source, fact);
  }
  for (const row of input.subjects ?? []) {
    const fact = facts.get(row.source) ?? emptyFact(row.source);
    fact.subjectCount += 1;
    facts.set(row.source, fact);
  }
  for (const row of input.communications ?? []) {
    if (row.source !== "DJEN") continue;
    const fact = facts.get(row.source) ?? emptyFact(row.source);
    fact.publicationCount += 1;
    facts.set(row.source, fact);
  }
  for (const evidence of input.evidences ?? []) {
    const fact = facts.get(evidence.source) ?? emptyFact(evidence.source);
    fact.lastSeenAt = laterIso(fact.lastSeenAt, evidence.lastSeenAt);
    const attempt = parseSourceAttemptMetadata(evidence.rawMetadata);
    if (attempt) {
      fact.attemptOutcome = attempt.outcome;
      fact.attemptErrorCode = attempt.errorCode;
      fact.attemptMessage = attempt.message;
      fact.publicUrl = attempt.publicUrl;
      fact.capabilities = attempt.capabilities;
    } else if (!fact.attemptOutcome) {
      fact.attemptOutcome = "SUCCESS";
    }
    if (evidence.source === "DJEN" && fact.publicationCount === 0) fact.publicationCount = 1;
    facts.set(evidence.source, fact);
  }
  const datajud = facts.get("DATAJUD");
  if (datajud && (datajud.lastSeenAt || datajud.attemptOutcome === "SUCCESS")) {
    datajud.classFound = Boolean(input.className);
    datajud.statusFound = Boolean(input.currentStatus);
    datajud.claimValueFound = Boolean(input.claimValueFormatted) && datajud.claimValueFound;
  }
  const complementaryClaim = Boolean(input.claimValueFormatted);
  for (const source of ["ESCAVADOR", "JUSBRASIL", "TRIBUNAL_PUBLIC"] as const) {
    const fact = facts.get(source);
    if (fact && complementaryClaim && (fact.lastSeenAt || fact.attemptOutcome === "SUCCESS")) {
      fact.claimValueFound = true;
    }
  }
  if (datajud && complementaryClaim && datajud.movementCount > 0 && datajud.claimantCount + datajud.defendantCount > 0) {
    datajud.claimValueFound = Boolean(input.claimValueFormatted);
  }
  return COVERAGE_MATRIX_SOURCES.map((source) => facts.get(source) ?? emptyFact(source));
}

function mark(value: boolean): "found" | "missing" {
  return value ? "found" : "missing";
}

function authorityOf(source: LegalExposureSource): CoverageSourceMatrixRow["authority"] {
  const kind = sourceKindOf(source);
  if (kind === "OFFICIAL_PROCESS" || kind === "OFFICIAL_PUBLICATION") return "oficial";
  if (kind === "COMPLEMENTARY") return "complementar";
  if (kind === "LOCATOR") return "localizador";
  return "outro";
}

export function matrixOutcomeOf(fact: CoverageSourceFact): string {
  if (fact.attemptErrorCode === "CACHE_HIT") return "CACHE";
  if (fact.attemptErrorCode === TRIBUNAL_PUBLIC_MANUAL_ACCESS || fact.attemptErrorCode === "CAPTCHA") {
    return "CAPTCHA";
  }
  if (fact.attemptErrorCode === "NOT_CONFIGURED" || fact.attemptOutcome === "CONFIGURATION_ERROR") {
    return "NOT_CONFIGURED";
  }
  if (fact.attemptErrorCode === "RATE_LIMITED" || fact.attemptOutcome === "RATE_LIMITED") return "RATE_LIMITED";
  if (fact.attemptOutcome === "AUTH_ERROR") return "AUTH_ERROR";
  if (fact.attemptOutcome === "SOURCE_ERROR" || fact.attemptOutcome === "TIMEOUT" || fact.attemptOutcome === "INVALID_RESPONSE") {
    return "SOURCE_ERROR";
  }
  if (fact.lastSeenAt || fact.attemptOutcome === "SUCCESS" || fact.attemptOutcome === "PARTIAL" || fact.attemptOutcome === "NO_RESULTS") {
    return fact.attemptOutcome === "NO_RESULTS" ? "NO_RESULTS" : "SUCCESS";
  }
  return "NOT_CONSULTED";
}

export function buildCoverageSourceMatrix(facts: CoverageSourceFact[]): CoverageSourceMatrixRow[] {
  const bySource = new Map(facts.map((row) => [row.source, row]));
  return COVERAGE_MATRIX_SOURCES.map((source) => {
    const fact = bySource.get(source) ?? emptyFact(source);
    const consulted = matrixOutcomeOf(fact) !== "NOT_CONSULTED" && matrixOutcomeOf(fact) !== "NOT_CONFIGURED";
    const partyCapable = source !== "WEB_DISCOVERY";
    return {
      source,
      label: SOURCE_KIND_LABELS[source] ?? SOURCE_LABELS[source],
      outcome: matrixOutcomeOf(fact),
      authority: authorityOf(source),
      claimant: partyCapable ? mark(fact.claimantCount > 0) : "n/a",
      defendants: partyCapable ? mark(fact.defendantCount > 0) : "n/a",
      class: source === "DJEN" || source === "WEB_DISCOVERY" ? "n/a" : mark(fact.classFound),
      subjects: source === "DJEN" || source === "WEB_DISCOVERY" ? "n/a" : mark(fact.subjectCount > 0),
      claimValue: source === "DJEN" || source === "WEB_DISCOVERY" ? "n/a" : mark(fact.claimValueFound),
      movements: fact.movementCount,
      attorneys: source === "DJEN" || source === "WEB_DISCOVERY" ? "n/a" : mark(fact.attorneyCount > 0),
      hearings: source === "DJEN" || source === "WEB_DISCOVERY" ? "n/a" : mark(fact.hearingCount > 0),
      publication: source === "DJEN" ? mark(fact.publicationCount > 0) : consulted && source === "DATAJUD" ? "n/a" : "n/a",
      errorCode: fact.attemptErrorCode,
      message: fact.attemptMessage,
      publicUrl: fact.publicUrl,
    };
  });
}

export function buildPublicCoverageCompare(input: {
  processNumber: string;
  tribunal?: string | null;
  system?: string | null;
  datajud?: CoverageSourceFact | null;
}): CoveragePublicCompare {
  const lookup = tribunalPublicLookup({
    processNumber: input.processNumber,
    tribunal: input.tribunal,
    system: input.system,
  });
  const datajudPresent: string[] = [];
  const datajud = input.datajud;
  if (datajud) {
    if (datajud.claimantCount > 0 || datajud.defendantCount > 0) datajudPresent.push("PARTIES");
    if (datajud.movementCount > 0) datajudPresent.push("MOVEMENTS");
    if (datajud.attorneyCount > 0) datajudPresent.push("ATTORNEYS");
    if (datajud.hearingCount > 0) datajudPresent.push("HEARINGS");
    if (datajud.claimValueFound) datajudPresent.push("CLAIM_VALUE");
    if (datajud.subjectCount > 0) datajudPresent.push("SUBJECTS");
    if (datajud.statusFound) datajudPresent.push("STATUS");
  }
  const portalCapabilities = lookup.capabilities.slice();
  return {
    tribunal: lookup.adapter?.tribunal ?? input.tribunal ?? null,
    adapterId: lookup.adapter?.id ?? null,
    adapterLabel: lookup.adapter?.label ?? null,
    publicUrl: lookup.publicUrl,
    automated: false,
    reason: lookup.errorCode,
    portalCapabilities,
    datajudPresent,
    additionalOnPortal: portalCapabilities.filter((cap) => !datajudPresent.includes(cap)),
  };
}

function factBySource(facts: CoverageSourceFact[], source: LegalExposureSource): CoverageSourceFact | undefined {
  return facts.find((row) => row.source === source);
}

function winningSourcesFor(
  field: CoverageFieldKey,
  status: CaseCoverageStatus,
  itemSources: LegalExposureSource[],
  facts: CoverageSourceFact[]
): LegalExposureSource[] {
  if (status !== "FOUND") return [];
  if (itemSources.length > 0) {
    const official = itemSources.filter((source) => !isComplementarySource(source) && !isLocatorSource(source));
    return official.length ? official : itemSources;
  }
  return facts
    .filter((fact) => {
      if (field === "claimant") return fact.claimantCount > 0;
      if (field === "defendants" || field === "groupPoles") return fact.defendantCount > 0;
      if (field === "class") return fact.classFound;
      if (field === "subjects") return fact.subjectCount > 0;
      if (field === "claimValue") return fact.claimValueFound;
      if (field === "movements") return fact.movementCount > 0;
      if (field === "attorneys") return fact.attorneyCount > 0;
      if (field === "hearings") return fact.hearingCount > 0;
      if (field === "status") return fact.statusFound;
      return false;
    })
    .map((fact) => fact.source);
}

function diagnoseCause(input: {
  field: CoverageFieldKey;
  status: CaseCoverageStatus;
  facts: CoverageSourceFact[];
  secrecy: boolean | null;
  tribunal?: string | null;
}): { cause: CoverageGapCause; causeLabel: string } {
  if (input.status === "FOUND") return { cause: "FOUND", causeLabel: COVERAGE_GAP_CAUSE_LABELS.FOUND };
  if (input.status === "CONFLICT") return { cause: "CONFLICT", causeLabel: PARTY_ROLE_CONFLICT_COPY };

  const datajud = factBySource(input.facts, "DATAJUD");
  const tribunal = factBySource(input.facts, "TRIBUNAL_PUBLIC");
  const escavador = factBySource(input.facts, "ESCAVADOR");
  const jusbrasil = factBySource(input.facts, "JUSBRASIL");
  const datajudOutcome = datajud ? matrixOutcomeOf(datajud) : "NOT_CONSULTED";
  const tribunalOutcome = tribunal ? matrixOutcomeOf(tribunal) : "NOT_CONSULTED";

  if (input.secrecy && (input.field === "claimant" || input.field === "attorneys" || input.field === "claimValue")) {
    return { cause: "SEALED_PROCESS", causeLabel: COVERAGE_GAP_CAUSE_LABELS.SEALED_PROCESS };
  }

  if (datajudOutcome === "RATE_LIMITED") {
    return { cause: "RATE_LIMIT", causeLabel: COVERAGE_GAP_CAUSE_LABELS.RATE_LIMIT };
  }
  if (datajudOutcome === "SOURCE_ERROR" || datajudOutcome === "AUTH_ERROR") {
    return { cause: "TECHNICAL_ERROR", causeLabel: datajud?.attemptMessage || COVERAGE_GAP_CAUSE_LABELS.TECHNICAL_ERROR };
  }

  if (
    (input.field === "claimant" || input.field === "defendants" || input.field === "attorneys") &&
    datajudOutcome === "SUCCESS" &&
    (datajud?.claimantCount ?? 0) === 0 &&
    (input.field !== "defendants" || (datajud?.defendantCount ?? 0) === 0) &&
    (input.field !== "attorneys" || (datajud?.attorneyCount ?? 0) === 0)
  ) {
    const portalCan =
      tribunal?.capabilities.includes(input.field === "attorneys" ? "ATTORNEYS" : "PARTIES") ||
      tribunalOutcome === "CAPTCHA";
    if (tribunalOutcome === "CAPTCHA" || tribunal?.attemptErrorCode === TRIBUNAL_PUBLIC_MANUAL_ACCESS) {
      const alias = shortCoverageSourceLabel("TRIBUNAL_PUBLIC", input.tribunal);
      return {
        cause: "CAPTCHA",
        causeLabel: `DataJud consultado sem devolver ${
          input.field === "attorneys" ? "advogados" : "partes"
        }. Portal ${alias} exige acesso manual (CAPTCHA/anti-bot).`,
      };
    }
    if (input.field === "claimant") {
      return {
        cause: "ENDPOINT_WITHOUT_PARTIES",
        causeLabel: portalCan
          ? COVERAGE_GAP_CAUSE_LABELS.ENDPOINT_WITHOUT_PARTIES
          : "DataJud consultado sem devolver partes neste endpoint.",
      };
    }
  }

  if (tribunalOutcome === "CAPTCHA" && (input.field === "claimant" || input.field === "attorneys" || input.field === "hearings")) {
    return { cause: "CAPTCHA", causeLabel: COVERAGE_GAP_CAUSE_LABELS.CAPTCHA };
  }

  if (datajudOutcome === "NOT_CONSULTED" && ["claimant", "defendants", "groupPoles", "class", "subjects", "movements", "status"].includes(input.field)) {
    return { cause: "NOT_CONSULTED", causeLabel: "DataJud ainda não consultado para este processo." };
  }
  if (datajudOutcome === "NOT_CONFIGURED" && ["claimant", "defendants", "class", "movements", "status"].includes(input.field)) {
    return { cause: "NOT_CONFIGURED", causeLabel: "DataJud desligado ou sem credencial." };
  }

  const escavadorOutcome = escavador ? matrixOutcomeOf(escavador) : "NOT_CONSULTED";
  const jusbrasilOutcome = jusbrasil ? matrixOutcomeOf(jusbrasil) : "NOT_CONSULTED";
  const complementaryConsulted = ["SUCCESS", "PARTIAL", "NO_RESULTS"].includes(escavadorOutcome) ||
    ["SUCCESS", "PARTIAL", "NO_RESULTS"].includes(jusbrasilOutcome);
  const complementaryOff =
    escavadorOutcome === "NOT_CONFIGURED" ||
    jusbrasilOutcome === "NOT_CONFIGURED" ||
    (escavadorOutcome === "NOT_CONSULTED" && jusbrasilOutcome === "NOT_CONSULTED");
  if (input.field === "attorneys" || input.field === "claimValue" || input.field === "hearings") {
    return {
      cause: !complementaryConsulted && complementaryOff ? "NOT_CONFIGURED" : "FIELD_ABSENT",
      causeLabel:
        !complementaryConsulted && complementaryOff
          ? "Não disponíveis nas fontes configuradas."
          : COVERAGE_GAP_CAUSE_LABELS.FIELD_ABSENT,
    };
  }

  return { cause: "FIELD_ABSENT", causeLabel: COVERAGE_GAP_CAUSE_LABELS.FIELD_ABSENT };
}

export function coverageFieldLine(diagnosis: Pick<CoverageFieldDiagnosis, "status" | "sources" | "causeLabel">, tribunal?: string | null): string {
  if (diagnosis.status === "FOUND") {
    const labels = diagnosis.sources.map((source) => shortCoverageSourceLabel(source, tribunal));
    return labels.length ? `Confirmado · ${[...new Set(labels)].join("/")}` : "Confirmado";
  }
  if (diagnosis.status === "CONFLICT") return diagnosis.causeLabel;
  return diagnosis.causeLabel;
}

export function buildFieldDiagnoses(input: {
  fields: Record<CoverageFieldKey, CaseCoverageStatus>;
  facts: CoverageSourceFact[];
  secrecy: boolean | null;
  tribunal?: string | null;
  itemSources: Partial<Record<CoverageFieldKey, LegalExposureSource[]>>;
}): Record<CoverageFieldKey, CoverageFieldDiagnosis> {
  const diagnoses = {} as Record<CoverageFieldKey, CoverageFieldDiagnosis>;
  for (const field of FIELD_KEYS) {
    const status = input.fields[field];
    const sources = winningSourcesFor(field, status, input.itemSources[field] ?? [], input.facts);
    const { cause, causeLabel } = diagnoseCause({
      field,
      status,
      facts: input.facts,
      secrecy: input.secrecy,
      tribunal: input.tribunal,
    });
    const diagnosis: CoverageFieldDiagnosis = { status, sources, cause, causeLabel, line: "" };
    diagnosis.line = coverageFieldLine(diagnosis, input.tribunal);
    diagnoses[field] = diagnosis;
  }
  return diagnoses;
}

export function coverageMissingReasonsFromDiagnoses(
  diagnoses: Record<CoverageFieldKey, CoverageFieldDiagnosis>
): string[] {
  return FIELD_KEYS.filter((field) => diagnoses[field].status !== "FOUND").map(
    (field) => `${COVERAGE_FIELD_LABELS[field]}: ${diagnoses[field].line}`
  );
}

export { FIELD_KEYS as COVERAGE_FIELD_KEYS };
