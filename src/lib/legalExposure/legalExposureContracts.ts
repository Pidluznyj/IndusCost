/**
 * Vocabulário interno do Exposure.
 * Nenhum serviço deve depender do JSON cru das fontes.
 * Este arquivo não importa Node/Prisma — a UI pode consumir rótulos e DTOs.
 */

export const LEGAL_EXPOSURE_SOURCES = [
  "DOMICILIO",
  "DATAJUD",
  "DJEN",
  "TRT_CERTIFICATE",
  "CNDT",
] as const;
export type LegalExposureSource = (typeof LEGAL_EXPOSURE_SOURCES)[number];

export const LEGAL_SOURCE_CONNECTION_STATUSES = [
  "HEALTHY",
  "DEGRADED",
  "DISCONNECTED",
  "CONFIGURATION_ERROR",
  "AUTH_ERROR",
  "RATE_LIMITED",
  "SOURCE_ERROR",
  "STALE",
  "DISABLED",
  "NOT_CONFIGURED",
] as const;
export type LegalSourceConnectionStatus = (typeof LEGAL_SOURCE_CONNECTION_STATUSES)[number];

export const LEGAL_QUERY_OUTCOMES = [
  "SUCCESS",
  "PARTIAL",
  "NO_RESULTS",
  "AUTH_ERROR",
  "RATE_LIMITED",
  "SOURCE_ERROR",
  "TIMEOUT",
  "INVALID_RESPONSE",
  "CONFIGURATION_ERROR",
] as const;
export type LegalQueryOutcome = (typeof LEGAL_QUERY_OUTCOMES)[number];

export const LEGAL_CASE_POLES = [
  "ACTIVE",
  "PASSIVE",
  "THIRD_PARTY",
  "OTHER",
  "UNKNOWN",
] as const;
export type LegalCasePole = (typeof LEGAL_CASE_POLES)[number];

export const LEGAL_EVIDENCE_CONFIDENCES = [
  "CONFIRMED",
  "LIKELY",
  "UNCONFIRMED",
  "REJECTED",
] as const;
export type LegalEvidenceConfidence = (typeof LEGAL_EVIDENCE_CONFIDENCES)[number];

export const LEGAL_COMMUNICATION_NORMALIZED_STATUSES = [
  "PENDING",
  "ACKNOWLEDGED",
  "EXPIRED",
  "CANCELED",
  "UNKNOWN",
] as const;
export type LegalCommunicationNormalizedStatus =
  (typeof LEGAL_COMMUNICATION_NORMALIZED_STATUSES)[number];

export const LEGAL_EXPOSURE_EVENT_TYPES = [
  "NEW_CASE",
  "NEW_COMMUNICATION",
  "NEW_CITATION",
  "NEW_INTIMATION",
  "NEW_MOVEMENT",
  "CASE_POLE_CONFIRMED",
  "CASE_STATUS_CHANGED",
  "COMMUNICATION_ACKNOWLEDGED",
  "COMMUNICATION_EXPIRED",
  "COMMUNICATION_CANCELED",
  "SOURCE_CONFIRMATION",
  "SOURCE_FAILED",
  "SOURCE_STALE",
  "SOURCE_RECOVERED",
  "CERTIFICATE_REGISTERED",
  "CANDIDATE_REVIEW",
] as const;
export type LegalExposureEventType = (typeof LEGAL_EXPOSURE_EVENT_TYPES)[number];

export const LEGAL_EXPOSURE_SEVERITIES = [
  "CRITICAL",
  "HIGH",
  "MEDIUM",
  "LOW",
  "INFO",
] as const;
export type LegalExposureSeverity = (typeof LEGAL_EXPOSURE_SEVERITIES)[number];

export const LEGAL_EXPOSURE_ALERT_STATUSES = ["OPEN", "ACKNOWLEDGED", "RESOLVED"] as const;
export type LegalExposureAlertStatus = (typeof LEGAL_EXPOSURE_ALERT_STATUSES)[number];

export const LEGAL_CERTIFICATE_TYPES = ["TRT_LABOR_CASES", "CNDT", "OTHER"] as const;
export type LegalCertificateType = (typeof LEGAL_CERTIFICATE_TYPES)[number];

export const LEGAL_CERTIFICATE_RESULTS = [
  "NEGATIVE",
  "POSITIVE",
  "POSITIVE_WITH_EFFECTS_OF_NEGATIVE",
  "UNKNOWN",
] as const;
export type LegalCertificateResult = (typeof LEGAL_CERTIFICATE_RESULTS)[number];

export const LEGAL_ALIAS_TYPES = [
  "LEGAL_NAME",
  "TRADE_NAME",
  "OLD_LEGAL_NAME",
  "ABBREVIATION",
  "OTHER",
] as const;
export type LegalAliasType = (typeof LEGAL_ALIAS_TYPES)[number];

export const LEGAL_EXPOSURE_AUDIT_ACTIONS = [
  "VIEW_CASE",
  "VIEW_COMMUNICATION_METADATA",
  "MANUAL_SYNC",
  "CERTIFICATE_UPLOAD",
  "CERTIFICATE_UPDATE",
  "SOURCE_CONFIGURATION_CHANGE",
  "ENTITY_CREATED",
  "ENTITY_UPDATED",
  "ENTITY_DISABLED",
  "ALERT_ACKNOWLEDGED",
  "ALERT_RESOLVED",
] as const;
export type LegalExposureAuditAction = (typeof LEGAL_EXPOSURE_AUDIT_ACTIONS)[number];

export const NO_CASES_IDENTIFIED_COPY =
  "Nenhum processo identificado nas fontes consultadas.";
export const ABSENCE_IS_NOT_CLEARANCE_COPY =
  "Ausência de resultado não equivale a ausência de exposição.";
export const CNDT_DOES_NOT_MEAN_NO_CASES_COPY =
  "CNDT negativa não significa ausência de processos trabalhistas.";
export const LIKELY_REVIEW_COPY = "Possível ocorrência — revisão necessária";

export const OFFICIAL_COMMUNICATIONS_PORTAL_URL = "https://comunica.pje.jus.br/";

export const LEGAL_EXPOSURE_PAGE_SIZE_DEFAULT = 20;
export const LEGAL_EXPOSURE_PAGE_SIZE_MAX = 50;

export const SOURCE_LABELS: Record<LegalExposureSource, string> = {
  DOMICILIO: "Domicílio",
  DATAJUD: "DataJud",
  DJEN: "DJEN",
  TRT_CERTIFICATE: "Certidão TRT",
  CNDT: "CNDT",
};

export const SOURCE_STATUS_LABELS: Record<LegalSourceConnectionStatus, string> = {
  HEALTHY: "saudável",
  DEGRADED: "degradada",
  DISCONNECTED: "desconectada",
  CONFIGURATION_ERROR: "erro de configuração",
  AUTH_ERROR: "erro de autenticação",
  RATE_LIMITED: "limite de taxa",
  SOURCE_ERROR: "indisponível",
  STALE: "desatualizada",
  DISABLED: "desligada",
  NOT_CONFIGURED: "não configurada",
};

export const CASE_VERIFICATION_STATUSES = ["CONFIRMED_OFFICIAL", "REVIEW_REQUIRED"] as const;
export type CaseVerificationStatus = (typeof CASE_VERIFICATION_STATUSES)[number];

export const CASE_ENRICHMENT_STATUSES = ["DATAJUD_ENRICHED", "DJEN_ONLY", "PARTIAL"] as const;
export type CaseEnrichmentStatus = (typeof CASE_ENRICHMENT_STATUSES)[number];

export const CASE_VERIFIED_OFFICIAL_COPY = "Confirmado em fonte oficial";
export const CASE_REVIEW_REQUIRED_COPY = "Sem confirmação oficial";
export const CASE_AWAITING_DATAJUD_COPY = "Aguardando enriquecimento DataJud";
export const CASE_DATAJUD_AVAILABLE_COPY = "Dados DataJud disponíveis";
export const CASE_POLE_PASSIVE_COPY = "Ré / polo passivo";
export const CASE_POLE_ACTIVE_COPY = "Autora / polo ativo";
export const CASE_POLE_THIRD_PARTY_COPY = "Terceira interessada";
export const CASE_POLE_OTHER_COPY = "Outro polo";
export const CASE_POLE_UNKNOWN_COPY = "Polo ainda não identificado";
export const CASE_STATUS_UNKNOWN_COPY = "Situação processual não informada";
export const CASE_FILED_AT_UNKNOWN_COPY = "Ajuizamento não informado pela fonte";
export const CASE_MOVEMENT_UNKNOWN_COPY = "Movimentação ainda não disponível";
export const CASE_CLASS_UNKNOWN_COPY = "Classe processual não informada pela fonte";
export const CASE_DETECTED_LABEL = "Detectado pelo IndusCost";
export const CASE_SOURCE_UPDATED_LABEL = "Atualização da fonte";
export const CASE_FILED_AT_LABEL = "Ajuizamento";

export type ExposureCaseListEntity = {
  id: string;
  legalName: string;
  tradeName: string | null;
  cnpj: string;
  displayCnpj: string;
};

export type ExposureCaseLatestMovement = {
  name: string;
  occurredAt: string | null;
  source: LegalExposureSource;
  courtUnit: string | null;
};

export type ExposureCaseLatestPublication = {
  type: string | null;
  availableAt: string | null;
  courtUnit: string | null;
};

export type ExposureCaseListItem = {
  id: string;
  entityId: string;
  processNumber: string;
  entity: ExposureCaseListEntity;
  tribunal: string | null;
  jurisdiction: string | null;
  degree: string | null;
  courtUnit: string | null;
  classCode: string | null;
  className: string | null;
  filedAt: string | null;
  entityPole: LegalCasePole;
  currentStatus: string | null;
  primarySource: LegalExposureSource;
  firstSeenAt: string;
  lastSeenAt: string;
  sourceUpdatedAt: string | null;
  evidenceSources: LegalExposureSource[];
  verificationStatus: CaseVerificationStatus;
  enrichmentStatus: CaseEnrichmentStatus;
  latestMovement: ExposureCaseLatestMovement | null;
  latestPublication: ExposureCaseLatestPublication | null;
};

export type CommunicationKind =
  | "CITATION"
  | "INTIMATION"
  | "HEARING"
  | "DECISION"
  | "ARCHIVAL"
  | "CANCELLATION"
  | "OTHER";

export function foldText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .trim();
}

export function classifyCommunicationKind(type: string | null | undefined): CommunicationKind {
  const folded = foldText(type ?? "");
  if (!folded) return "OTHER";
  if (folded.includes("CITAC")) return "CITATION";
  if (folded.includes("INTIM")) return "INTIMATION";
  if (folded.includes("AUDIEN")) return "HEARING";
  if (folded.includes("SENTEN") || folded.includes("DECISA")) return "DECISION";
  if (folded.includes("ARQUIV") || folded.includes("BAIXA")) return "ARCHIVAL";
  if (folded.includes("CANCEL")) return "CANCELLATION";
  return "OTHER";
}

export function normalizeCommunicationStatus(
  sourceStatus: string | null | undefined
): LegalCommunicationNormalizedStatus {
  const folded = foldText(sourceStatus ?? "").replace(/\s+/g, "_");
  if (!folded) return "UNKNOWN";
  const pending = new Set(["N", "NAO", "PENDENTE", "PENDING", "AGUARDANDO", "NAO_CIENTE", "FALSE", "0"]);
  const acknowledged = new Set(["S", "SIM", "CIENTE", "ACKNOWLEDGED", "LIDA", "TRUE", "1"]);
  const expired = new Set(["EXPIRADA", "EXPIRADO", "EXPIRED", "VENCIDA"]);
  const canceled = new Set(["CANCELADA", "CANCELADO", "CANCELED", "CANCELLED"]);
  if (pending.has(folded)) return "PENDING";
  if (acknowledged.has(folded)) return "ACKNOWLEDGED";
  if (expired.has(folded)) return "EXPIRED";
  if (canceled.has(folded)) return "CANCELED";
  return "UNKNOWN";
}

export function communicationIdempotencyKey(
  source: LegalExposureSource,
  tenantId: string | null | undefined,
  sourceCommunicationId: string
): string {
  const tenant = tenantId?.trim() || "-";
  return `${source}:${tenant}:${sourceCommunicationId.trim()}`;
}

export type Page<T> = {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
};

export function clampPage(page: unknown, pageSize: unknown): { page: number; pageSize: number } {
  const parsedPage = Number.parseInt(String(page ?? "1"), 10);
  const parsedSize = Number.parseInt(String(pageSize ?? LEGAL_EXPOSURE_PAGE_SIZE_DEFAULT), 10);
  return {
    page: Number.isFinite(parsedPage) && parsedPage > 0 ? parsedPage : 1,
    pageSize:
      Number.isFinite(parsedSize) && parsedSize > 0
        ? Math.min(parsedSize, LEGAL_EXPOSURE_PAGE_SIZE_MAX)
        : LEGAL_EXPOSURE_PAGE_SIZE_DEFAULT,
  };
}

export function slicePage<T>(items: T[], page: number, pageSize: number): Page<T> {
  const start = (page - 1) * pageSize;
  return {
    items: items.slice(start, start + pageSize),
    total: items.length,
    page,
    pageSize,
  };
}

export type NormalizedMovement = {
  sourceCode: string | null;
  name: string;
  occurredAt: string | null;
  courtUnit: string | null;
  complements: unknown;
};

export type NormalizedParty = {
  name: string;
  document: string | null;
  partyType: string | null;
  pole: LegalCasePole;
};

export type NormalizedCaseObservation = {
  processNumber: string;
  tribunal: string | null;
  jurisdiction: string | null;
  degree: string | null;
  courtUnit: string | null;
  classCode: string | null;
  className: string | null;
  filedAt: string | null;
  currentStatus: string | null;
  entityPole: LegalCasePole;
  sourceIdentifier: string;
  sourceUpdatedAt: string | null;
  explicitCnpj: string | null;
  candidateName: string | null;
  officialIdentifier: string | null;
  parties: NormalizedParty[];
  movements: NormalizedMovement[];
  rawMetadata: unknown;
  /** GENERIC: ABBREVIATION/OTHER sem autoassociação só pelo CNJ. */
  discoveryConfirmation?: "TRUSTED" | "GENERIC";
};

export type NormalizedCommunicationObservation = {
  sourceCommunicationId: string;
  tenantId: string | null;
  processNumber: string | null;
  communicationType: string;
  subject: string | null;
  sourceStatus: string;
  availableAt: string | null;
  scienceDeadlineAt: string | null;
  sourceScienceAt: string | null;
  tribunal: string | null;
  courtUnit: string | null;
  rawMetadata: unknown;
};

export type NormalizedCandidateObservation = {
  candidateName: string;
  processNumber: string | null;
  explicitCnpj: string | null;
  officialIdentifier: string | null;
  tribunal: string | null;
  rawMetadata: unknown;
};

export type NormalizedSourceBatch = {
  source: LegalExposureSource;
  outcome: LegalQueryOutcome;
  errorCode: string | null;
  errorMessageSanitized: string | null;
  retryAfterSeconds: number | null;
  externalCall: boolean;
  cases: NormalizedCaseObservation[];
  communications: NormalizedCommunicationObservation[];
  candidates: NormalizedCandidateObservation[];
};

export type SourcePublicStatus = {
  source: LegalExposureSource;
  label: string;
  status: LegalSourceConnectionStatus;
  statusLabel: string;
  configured: boolean;
  enabled: boolean;
  lastSuccessfulAt: string | null;
  lastAttemptAt: string | null;
  healthy: boolean;
};

export function isHealthyStatus(status: LegalSourceConnectionStatus): boolean {
  return status === "HEALTHY";
}
