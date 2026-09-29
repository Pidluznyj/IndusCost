-- Exposure: tabelas aditivas. Sem DROP, TRUNCATE ou DELETE.
-- Não aplicada por este trabalho.

CREATE TYPE "LegalExposureAliasType" AS ENUM ('LEGAL_NAME', 'TRADE_NAME', 'OLD_LEGAL_NAME', 'ABBREVIATION', 'OTHER');
CREATE TYPE "LegalExposureSource" AS ENUM ('DOMICILIO', 'DATAJUD', 'DJEN', 'TRT_CERTIFICATE', 'CNDT');
CREATE TYPE "LegalSourceConnectionStatus" AS ENUM ('HEALTHY', 'DEGRADED', 'DISCONNECTED', 'CONFIGURATION_ERROR', 'AUTH_ERROR', 'RATE_LIMITED', 'SOURCE_ERROR', 'STALE', 'DISABLED', 'NOT_CONFIGURED');
CREATE TYPE "LegalCasePole" AS ENUM ('ACTIVE', 'PASSIVE', 'THIRD_PARTY', 'OTHER', 'UNKNOWN');
CREATE TYPE "LegalEvidenceConfidence" AS ENUM ('CONFIRMED', 'LIKELY', 'UNCONFIRMED', 'REJECTED');
CREATE TYPE "LegalCommunicationNormalizedStatus" AS ENUM ('PENDING', 'ACKNOWLEDGED', 'EXPIRED', 'CANCELED', 'UNKNOWN');
CREATE TYPE "LegalExposureEventType" AS ENUM ('NEW_CASE', 'NEW_COMMUNICATION', 'NEW_CITATION', 'NEW_INTIMATION', 'NEW_MOVEMENT', 'CASE_POLE_CONFIRMED', 'CASE_STATUS_CHANGED', 'COMMUNICATION_ACKNOWLEDGED', 'COMMUNICATION_EXPIRED', 'COMMUNICATION_CANCELED', 'SOURCE_CONFIRMATION', 'SOURCE_FAILED', 'SOURCE_STALE', 'SOURCE_RECOVERED', 'CERTIFICATE_REGISTERED', 'CANDIDATE_REVIEW');
CREATE TYPE "LegalExposureSeverity" AS ENUM ('CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO');
CREATE TYPE "LegalExposureAlertStatus" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'RESOLVED');
CREATE TYPE "LegalCertificateType" AS ENUM ('TRT_LABOR_CASES', 'CNDT', 'OTHER');
CREATE TYPE "LegalCertificateResult" AS ENUM ('NEGATIVE', 'POSITIVE', 'POSITIVE_WITH_EFFECTS_OF_NEGATIVE', 'UNKNOWN');
CREATE TYPE "LegalExposureAuditAction" AS ENUM ('VIEW_CASE', 'VIEW_COMMUNICATION_METADATA', 'MANUAL_SYNC', 'CERTIFICATE_UPLOAD', 'CERTIFICATE_UPDATE', 'SOURCE_CONFIGURATION_CHANGE', 'ENTITY_CREATED', 'ENTITY_UPDATED', 'ENTITY_DISABLED', 'ALERT_ACKNOWLEDGED', 'ALERT_RESOLVED');

CREATE TABLE "LegalExposureEntity" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "cnpj" VARCHAR(14) NOT NULL,
  "legalName" TEXT NOT NULL,
  "tradeName" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "state" VARCHAR(2),
  "city" TEXT,
  "monitorDomicilio" BOOLEAN NOT NULL DEFAULT true,
  "monitorDatajud" BOOLEAN NOT NULL DEFAULT true,
  "monitorDjen" BOOLEAN NOT NULL DEFAULT true,
  "monitorCertificates" BOOLEAN NOT NULL DEFAULT true,
  "domicilioTenantId" TEXT,
  "lastSuccessfulSyncAt" TIMESTAMPTZ(6),
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LegalExposureEntity_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "LegalExposureEntity_cnpj_key" ON "LegalExposureEntity"("cnpj");
CREATE INDEX "LegalExposureEntity_active_idx" ON "LegalExposureEntity"("active");

CREATE TABLE "LegalExposureEntityAlias" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "entityId" UUID NOT NULL,
  "type" "LegalExposureAliasType" NOT NULL,
  "value" TEXT NOT NULL,
  "normalizedValue" TEXT NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LegalExposureEntityAlias_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "LegalExposureEntityAlias_entityId_type_normalizedValue_key" ON "LegalExposureEntityAlias"("entityId", "type", "normalizedValue");
CREATE INDEX "LegalExposureEntityAlias_entityId_active_idx" ON "LegalExposureEntityAlias"("entityId", "active");

CREATE TABLE "LegalSourceConnection" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "entityId" UUID NOT NULL,
  "source" "LegalExposureSource" NOT NULL,
  "environment" TEXT NOT NULL DEFAULT 'production',
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "status" "LegalSourceConnectionStatus" NOT NULL DEFAULT 'NOT_CONFIGURED',
  "lastAttemptAt" TIMESTAMPTZ(6),
  "lastSuccessfulAt" TIMESTAMPTZ(6),
  "lastFullSyncAt" TIMESTAMPTZ(6),
  "lastErrorAt" TIMESTAMPTZ(6),
  "lastErrorCode" TEXT,
  "lastErrorMessageSanitized" TEXT,
  "sourceUpdatedAt" TIMESTAMPTZ(6),
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LegalSourceConnection_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "LegalSourceConnection_entityId_source_key" ON "LegalSourceConnection"("entityId", "source");
CREATE INDEX "LegalSourceConnection_source_status_idx" ON "LegalSourceConnection"("source", "status");

CREATE TABLE "LegalExposureJurisdiction" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "entityId" UUID NOT NULL,
  "tribunal" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "priority" INTEGER NOT NULL DEFAULT 100,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LegalExposureJurisdiction_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "LegalExposureJurisdiction_entityId_tribunal_key" ON "LegalExposureJurisdiction"("entityId", "tribunal");
CREATE INDEX "LegalExposureJurisdiction_enabled_priority_idx" ON "LegalExposureJurisdiction"("enabled", "priority");

CREATE TABLE "LegalCase" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "entityId" UUID NOT NULL,
  "processNumber" TEXT NOT NULL,
  "processNumberNormalized" TEXT NOT NULL,
  "tribunal" TEXT,
  "jurisdiction" TEXT,
  "degree" TEXT,
  "courtUnit" TEXT,
  "classCode" TEXT,
  "className" TEXT,
  "filedAt" TIMESTAMPTZ(6),
  "currentStatus" TEXT,
  "entityPole" "LegalCasePole" NOT NULL DEFAULT 'UNKNOWN',
  "firstSeenAt" TIMESTAMPTZ(6) NOT NULL,
  "lastSeenAt" TIMESTAMPTZ(6) NOT NULL,
  "primarySource" "LegalExposureSource" NOT NULL,
  "sourceUpdatedAt" TIMESTAMPTZ(6),
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LegalCase_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "LegalCase_entityId_processNumberNormalized_key" ON "LegalCase"("entityId", "processNumberNormalized");
CREATE INDEX "LegalCase_entityId_lastSeenAt_idx" ON "LegalCase"("entityId", "lastSeenAt");
CREATE INDEX "LegalCase_tribunal_idx" ON "LegalCase"("tribunal");
CREATE INDEX "LegalCase_entityPole_idx" ON "LegalCase"("entityPole");
CREATE INDEX "LegalCase_processNumberNormalized_idx" ON "LegalCase"("processNumberNormalized");

CREATE TABLE "LegalCaseSourceEvidence" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "caseId" UUID NOT NULL,
  "source" "LegalExposureSource" NOT NULL,
  "sourceIdentifier" TEXT NOT NULL,
  "confidence" "LegalEvidenceConfidence" NOT NULL,
  "firstSeenAt" TIMESTAMPTZ(6) NOT NULL,
  "lastSeenAt" TIMESTAMPTZ(6) NOT NULL,
  "sourceUpdatedAt" TIMESTAMPTZ(6),
  "rawMetadata" JSONB,
  "rawHash" TEXT,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LegalCaseSourceEvidence_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "LegalCaseSourceEvidence_caseId_source_sourceIdentifier_key" ON "LegalCaseSourceEvidence"("caseId", "source", "sourceIdentifier");
CREATE INDEX "LegalCaseSourceEvidence_source_confidence_idx" ON "LegalCaseSourceEvidence"("source", "confidence");

CREATE TABLE "LegalCaseParty" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "caseId" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "normalizedName" TEXT NOT NULL,
  "document" TEXT,
  "documentNormalized" TEXT NOT NULL DEFAULT '',
  "partyType" TEXT,
  "pole" "LegalCasePole" NOT NULL DEFAULT 'UNKNOWN',
  "source" "LegalExposureSource" NOT NULL,
  "firstSeenAt" TIMESTAMPTZ(6) NOT NULL,
  "lastSeenAt" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "LegalCaseParty_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "LegalCaseParty_caseId_source_normalizedName_documentNormalized_key" ON "LegalCaseParty"("caseId", "source", "normalizedName", "documentNormalized");
CREATE INDEX "LegalCaseParty_documentNormalized_idx" ON "LegalCaseParty"("documentNormalized");

CREATE TABLE "LegalCaseMovement" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "caseId" UUID NOT NULL,
  "source" "LegalExposureSource" NOT NULL,
  "sourceCode" TEXT,
  "name" TEXT NOT NULL,
  "occurredAt" TIMESTAMPTZ(6),
  "courtUnit" TEXT,
  "complements" JSONB,
  "fingerprint" TEXT NOT NULL,
  "firstSeenAt" TIMESTAMPTZ(6) NOT NULL,
  "rawMetadata" JSONB,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LegalCaseMovement_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "LegalCaseMovement_fingerprint_key" ON "LegalCaseMovement"("fingerprint");
CREATE INDEX "LegalCaseMovement_caseId_occurredAt_idx" ON "LegalCaseMovement"("caseId", "occurredAt");

CREATE TABLE "LegalCommunication" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "entityId" UUID NOT NULL,
  "caseId" UUID,
  "source" "LegalExposureSource" NOT NULL,
  "sourceCommunicationId" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "processNumber" TEXT,
  "communicationType" TEXT NOT NULL,
  "subject" TEXT,
  "sourceStatus" TEXT NOT NULL,
  "normalizedStatus" "LegalCommunicationNormalizedStatus" NOT NULL DEFAULT 'UNKNOWN',
  "availableAt" TIMESTAMPTZ(6),
  "detectedAt" TIMESTAMPTZ(6) NOT NULL,
  "scienceDeadlineAt" TIMESTAMPTZ(6),
  "sourceScienceAt" TIMESTAMPTZ(6),
  "officialContentOpenedAt" TIMESTAMPTZ(6),
  "officialContentOpenedByUserId" UUID,
  "tribunal" TEXT,
  "courtUnit" TEXT,
  "rawMetadata" JSONB,
  "rawHash" TEXT,
  "firstSeenAt" TIMESTAMPTZ(6) NOT NULL,
  "lastSeenAt" TIMESTAMPTZ(6) NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LegalCommunication_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "LegalCommunication_idempotencyKey_key" ON "LegalCommunication"("idempotencyKey");
CREATE INDEX "LegalCommunication_entityId_normalizedStatus_availableAt_idx" ON "LegalCommunication"("entityId", "normalizedStatus", "availableAt");
CREATE INDEX "LegalCommunication_caseId_idx" ON "LegalCommunication"("caseId");
CREATE INDEX "LegalCommunication_source_detectedAt_idx" ON "LegalCommunication"("source", "detectedAt");

CREATE TABLE "LegalExposureEvent" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "eventKey" TEXT NOT NULL,
  "entityId" UUID NOT NULL,
  "caseId" UUID,
  "communicationId" UUID,
  "source" "LegalExposureSource",
  "eventType" "LegalExposureEventType" NOT NULL,
  "severity" "LegalExposureSeverity" NOT NULL,
  "detectedAt" TIMESTAMPTZ(6) NOT NULL,
  "payload" JSONB,
  "payloadHash" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LegalExposureEvent_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "LegalExposureEvent_eventKey_key" ON "LegalExposureEvent"("eventKey");
CREATE INDEX "LegalExposureEvent_entityId_detectedAt_idx" ON "LegalExposureEvent"("entityId", "detectedAt");
CREATE INDEX "LegalExposureEvent_eventType_detectedAt_idx" ON "LegalExposureEvent"("eventType", "detectedAt");
CREATE INDEX "LegalExposureEvent_caseId_idx" ON "LegalExposureEvent"("caseId");

CREATE TABLE "LegalExposureAlert" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "entityId" UUID NOT NULL,
  "eventId" UUID NOT NULL,
  "severity" "LegalExposureSeverity" NOT NULL,
  "status" "LegalExposureAlertStatus" NOT NULL DEFAULT 'OPEN',
  "requiresAction" BOOLEAN NOT NULL DEFAULT false,
  "title" TEXT NOT NULL,
  "summary" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "acknowledgedAt" TIMESTAMPTZ(6),
  "acknowledgedByUserId" UUID,
  "resolvedAt" TIMESTAMPTZ(6),
  "resolvedByUserId" UUID,
  CONSTRAINT "LegalExposureAlert_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "LegalExposureAlert_eventId_key" ON "LegalExposureAlert"("eventId");
CREATE INDEX "LegalExposureAlert_entityId_status_severity_idx" ON "LegalExposureAlert"("entityId", "status", "severity");
CREATE INDEX "LegalExposureAlert_requiresAction_status_idx" ON "LegalExposureAlert"("requiresAction", "status");

CREATE TABLE "LegalCertificate" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "entityId" UUID NOT NULL,
  "type" "LegalCertificateType" NOT NULL,
  "tribunal" TEXT,
  "issuedAt" TIMESTAMPTZ(6),
  "validUntil" TIMESTAMPTZ(6),
  "result" "LegalCertificateResult" NOT NULL DEFAULT 'UNKNOWN',
  "verificationCode" TEXT,
  "fileStorageKey" TEXT,
  "originalFileName" TEXT,
  "notes" TEXT,
  "registeredByUserId" UUID,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LegalCertificate_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "LegalCertificate_entityId_type_issuedAt_idx" ON "LegalCertificate"("entityId", "type", "issuedAt");
CREATE INDEX "LegalCertificate_validUntil_idx" ON "LegalCertificate"("validUntil");

CREATE TABLE "LegalExposureAuditLog" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "userId" UUID,
  "action" "LegalExposureAuditAction" NOT NULL,
  "entityId" UUID,
  "caseId" UUID,
  "communicationId" UUID,
  "occurredAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "metadata" JSONB,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LegalExposureAuditLog_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "LegalExposureAuditLog_action_occurredAt_idx" ON "LegalExposureAuditLog"("action", "occurredAt");
CREATE INDEX "LegalExposureAuditLog_entityId_occurredAt_idx" ON "LegalExposureAuditLog"("entityId", "occurredAt");
CREATE INDEX "LegalExposureAuditLog_userId_occurredAt_idx" ON "LegalExposureAuditLog"("userId", "occurredAt");

ALTER TABLE "LegalExposureEntityAlias" ADD CONSTRAINT "LegalExposureEntityAlias_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "LegalExposureEntity"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "LegalSourceConnection" ADD CONSTRAINT "LegalSourceConnection_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "LegalExposureEntity"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "LegalExposureJurisdiction" ADD CONSTRAINT "LegalExposureJurisdiction_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "LegalExposureEntity"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "LegalCase" ADD CONSTRAINT "LegalCase_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "LegalExposureEntity"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "LegalCaseSourceEvidence" ADD CONSTRAINT "LegalCaseSourceEvidence_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "LegalCase"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "LegalCaseParty" ADD CONSTRAINT "LegalCaseParty_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "LegalCase"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "LegalCaseMovement" ADD CONSTRAINT "LegalCaseMovement_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "LegalCase"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "LegalCommunication" ADD CONSTRAINT "LegalCommunication_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "LegalExposureEntity"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "LegalCommunication" ADD CONSTRAINT "LegalCommunication_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "LegalCase"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "LegalExposureEvent" ADD CONSTRAINT "LegalExposureEvent_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "LegalExposureEntity"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "LegalExposureEvent" ADD CONSTRAINT "LegalExposureEvent_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "LegalCase"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "LegalExposureEvent" ADD CONSTRAINT "LegalExposureEvent_communicationId_fkey" FOREIGN KEY ("communicationId") REFERENCES "LegalCommunication"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "LegalExposureAlert" ADD CONSTRAINT "LegalExposureAlert_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "LegalExposureEntity"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "LegalExposureAlert" ADD CONSTRAINT "LegalExposureAlert_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "LegalExposureEvent"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "LegalCertificate" ADD CONSTRAINT "LegalCertificate_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "LegalExposureEntity"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "LegalExposureAuditLog" ADD CONSTRAINT "LegalExposureAuditLog_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "LegalExposureEntity"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "LegalExposureAuditLog" ADD CONSTRAINT "LegalExposureAuditLog_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "LegalCase"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "LegalExposureAuditLog" ADD CONSTRAINT "LegalExposureAuditLog_communicationId_fkey" FOREIGN KEY ("communicationId") REFERENCES "LegalCommunication"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
