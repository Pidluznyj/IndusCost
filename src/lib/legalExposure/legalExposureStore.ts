/**
 * Estado em memória do Exposure, usado pelo planejador puro e pelos testes.
 * O repositório Prisma traduz este formato; a UI não importa este módulo via grafo de crypto.
 */

import type {
  LegalAliasType,
  LegalCasePole,
  LegalCertificateResult,
  LegalCertificateType,
  LegalCommunicationNormalizedStatus,
  LegalEvidenceConfidence,
  LegalExposureAuditAction,
  LegalExposureEventType,
  LegalExposureSeverity,
  LegalExposureSource,
  LegalExposureAlertStatus,
  LegalSourceConnectionStatus,
} from "./legalExposureContracts.js";

export type ExposureEntityRecord = {
  id: string;
  cnpj: string;
  legalName: string;
  tradeName: string | null;
  active: boolean;
  state: string | null;
  city: string | null;
  monitorDomicilio: boolean;
  monitorDatajud: boolean;
  monitorDjen: boolean;
  monitorCertificates: boolean;
  domicilioTenantId: string | null;
  lastSuccessfulSyncAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ExposureAliasRecord = {
  id: string;
  entityId: string;
  type: LegalAliasType;
  value: string;
  normalizedValue: string;
  active: boolean;
  createdAt: string;
};

export type ExposureConnectionRecord = {
  id: string;
  entityId: string;
  source: LegalExposureSource;
  environment: string;
  enabled: boolean;
  status: LegalSourceConnectionStatus;
  lastAttemptAt: string | null;
  lastSuccessfulAt: string | null;
  lastFullSyncAt: string | null;
  lastErrorAt: string | null;
  lastErrorCode: string | null;
  lastErrorMessageSanitized: string | null;
  sourceUpdatedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ExposureJurisdictionRecord = {
  id: string;
  entityId: string;
  tribunal: string;
  enabled: boolean;
  priority: number;
  createdAt: string;
  updatedAt: string;
};

export type ExposureCaseRecord = {
  id: string;
  entityId: string;
  processNumber: string;
  processNumberNormalized: string;
  tribunal: string | null;
  jurisdiction: string | null;
  degree: string | null;
  courtUnit: string | null;
  classCode: string | null;
  className: string | null;
  filedAt: string | null;
  currentStatus: string | null;
  entityPole: LegalCasePole;
  firstSeenAt: string;
  lastSeenAt: string;
  primarySource: LegalExposureSource;
  sourceUpdatedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ExposureEvidenceRecord = {
  id: string;
  caseId: string;
  source: LegalExposureSource;
  sourceIdentifier: string;
  confidence: LegalEvidenceConfidence;
  firstSeenAt: string;
  lastSeenAt: string;
  sourceUpdatedAt: string | null;
  rawMetadata: unknown;
  rawHash: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ExposurePartyRecord = {
  id: string;
  caseId: string;
  name: string;
  normalizedName: string;
  document: string | null;
  documentNormalized: string | null;
  partyType: string | null;
  pole: LegalCasePole;
  source: LegalExposureSource;
  firstSeenAt: string;
  lastSeenAt: string;
};

export type ExposureMovementRecord = {
  id: string;
  caseId: string;
  source: LegalExposureSource;
  sourceCode: string | null;
  name: string;
  occurredAt: string | null;
  courtUnit: string | null;
  complements: unknown;
  fingerprint: string;
  firstSeenAt: string;
  rawMetadata: unknown;
  createdAt: string;
};

export type ExposureCommunicationRecord = {
  id: string;
  entityId: string;
  caseId: string | null;
  source: LegalExposureSource;
  sourceCommunicationId: string;
  idempotencyKey: string;
  processNumber: string | null;
  communicationType: string;
  subject: string | null;
  sourceStatus: string;
  normalizedStatus: LegalCommunicationNormalizedStatus;
  availableAt: string | null;
  detectedAt: string;
  scienceDeadlineAt: string | null;
  sourceScienceAt: string | null;
  officialContentOpenedAt: string | null;
  officialContentOpenedByUserId: string | null;
  tribunal: string | null;
  courtUnit: string | null;
  rawMetadata: unknown;
  rawHash: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  createdAt: string;
  updatedAt: string;
};

export type ExposureEventRecord = {
  id: string;
  eventKey: string;
  entityId: string;
  caseId: string | null;
  communicationId: string | null;
  source: LegalExposureSource | null;
  eventType: LegalExposureEventType;
  severity: LegalExposureSeverity;
  detectedAt: string;
  payload: unknown;
  payloadHash: string;
  createdAt: string;
};

export type ExposureAlertRecord = {
  id: string;
  entityId: string;
  eventId: string;
  severity: LegalExposureSeverity;
  status: LegalExposureAlertStatus;
  requiresAction: boolean;
  title: string;
  summary: string;
  createdAt: string;
  acknowledgedAt: string | null;
  acknowledgedByUserId: string | null;
  resolvedAt: string | null;
  resolvedByUserId: string | null;
};

export type ExposureCertificateRecord = {
  id: string;
  entityId: string;
  type: LegalCertificateType;
  tribunal: string | null;
  issuedAt: string | null;
  validUntil: string | null;
  result: LegalCertificateResult;
  verificationCode: string | null;
  fileStorageKey: string | null;
  originalFileName: string | null;
  notes: string | null;
  registeredByUserId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ExposureAuditRecord = {
  id: string;
  userId: string | null;
  action: LegalExposureAuditAction;
  entityId: string | null;
  caseId: string | null;
  communicationId: string | null;
  occurredAt: string;
  metadata: unknown;
  createdAt: string;
};

export type LegalExposureMemory = {
  entities: ExposureEntityRecord[];
  aliases: ExposureAliasRecord[];
  connections: ExposureConnectionRecord[];
  jurisdictions: ExposureJurisdictionRecord[];
  cases: ExposureCaseRecord[];
  evidences: ExposureEvidenceRecord[];
  parties: ExposurePartyRecord[];
  movements: ExposureMovementRecord[];
  communications: ExposureCommunicationRecord[];
  events: ExposureEventRecord[];
  alerts: ExposureAlertRecord[];
  certificates: ExposureCertificateRecord[];
  audits: ExposureAuditRecord[];
};

export function createEmptyExposureMemory(): LegalExposureMemory {
  return {
    entities: [],
    aliases: [],
    connections: [],
    jurisdictions: [],
    cases: [],
    evidences: [],
    parties: [],
    movements: [],
    communications: [],
    events: [],
    alerts: [],
    certificates: [],
    audits: [],
  };
}
