-- Exposure cockpit: aditivo. Sem DROP, TRUNCATE, DELETE ou UNIQUE global de CNJ.

ALTER TYPE "LegalExposureSource" ADD VALUE IF NOT EXISTS 'ESCAVADOR';

ALTER TABLE "LegalCase"
  ADD COLUMN IF NOT EXISTS "systemName" TEXT,
  ADD COLUMN IF NOT EXISTS "area" TEXT,
  ADD COLUMN IF NOT EXISTS "claimValue" DECIMAL(20, 2),
  ADD COLUMN IF NOT EXISTS "claimCurrency" VARCHAR(8),
  ADD COLUMN IF NOT EXISTS "archivedAt" TIMESTAMPTZ(6),
  ADD COLUMN IF NOT EXISTS "secrecy" BOOLEAN,
  ADD COLUMN IF NOT EXISTS "priority" TEXT;

ALTER TABLE "LegalCaseParty"
  ADD COLUMN IF NOT EXISTS "personType" TEXT;

CREATE TABLE IF NOT EXISTS "LegalCaseEntityLink" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "caseId" UUID NOT NULL,
  "entityId" UUID NOT NULL,
  "pole" "LegalCasePole" NOT NULL DEFAULT 'UNKNOWN',
  "confidence" "LegalEvidenceConfidence" NOT NULL DEFAULT 'CONFIRMED',
  "firstSource" "LegalExposureSource" NOT NULL,
  "lastSource" "LegalExposureSource" NOT NULL,
  "firstSeenAt" TIMESTAMPTZ(6) NOT NULL,
  "lastSeenAt" TIMESTAMPTZ(6) NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LegalCaseEntityLink_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "LegalCaseEntityLink_caseId_entityId_key" ON "LegalCaseEntityLink"("caseId", "entityId");
CREATE INDEX IF NOT EXISTS "LegalCaseEntityLink_entityId_pole_idx" ON "LegalCaseEntityLink"("entityId", "pole");

CREATE TABLE IF NOT EXISTS "LegalCaseSubject" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "caseId" UUID NOT NULL,
  "code" TEXT,
  "name" TEXT NOT NULL,
  "fullPath" TEXT,
  "isMain" BOOLEAN NOT NULL DEFAULT false,
  "source" "LegalExposureSource" NOT NULL,
  "firstSeenAt" TIMESTAMPTZ(6) NOT NULL,
  "lastSeenAt" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "LegalCaseSubject_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "LegalCaseSubject_caseId_source_name_key" ON "LegalCaseSubject"("caseId", "source", "name");
CREATE INDEX IF NOT EXISTS "LegalCaseSubject_caseId_isMain_idx" ON "LegalCaseSubject"("caseId", "isMain");

CREATE TABLE IF NOT EXISTS "LegalCaseHearing" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "caseId" UUID NOT NULL,
  "source" "LegalExposureSource" NOT NULL,
  "type" TEXT,
  "scheduledAt" TIMESTAMPTZ(6),
  "status" TEXT,
  "courtUnit" TEXT,
  "fingerprint" TEXT NOT NULL,
  "firstSeenAt" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "LegalCaseHearing_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "LegalCaseHearing_fingerprint_key" ON "LegalCaseHearing"("fingerprint");
CREATE INDEX IF NOT EXISTS "LegalCaseHearing_caseId_scheduledAt_idx" ON "LegalCaseHearing"("caseId", "scheduledAt");

CREATE TABLE IF NOT EXISTS "LegalCaseAttorney" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "caseId" UUID NOT NULL,
  "source" "LegalExposureSource" NOT NULL,
  "name" TEXT NOT NULL,
  "document" TEXT,
  "oabNumber" TEXT,
  "oabState" TEXT,
  "representedPartyName" TEXT,
  "representedPartyDocument" TEXT,
  "fingerprint" TEXT NOT NULL,
  "firstSeenAt" TIMESTAMPTZ(6) NOT NULL,
  "lastSeenAt" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "LegalCaseAttorney_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "LegalCaseAttorney_fingerprint_key" ON "LegalCaseAttorney"("fingerprint");
CREATE INDEX IF NOT EXISTS "LegalCaseAttorney_caseId_idx" ON "LegalCaseAttorney"("caseId");

ALTER TABLE "LegalCaseEntityLink"
  ADD CONSTRAINT "LegalCaseEntityLink_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "LegalCase"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
  ADD CONSTRAINT "LegalCaseEntityLink_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "LegalExposureEntity"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE "LegalCaseSubject"
  ADD CONSTRAINT "LegalCaseSubject_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "LegalCase"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE "LegalCaseHearing"
  ADD CONSTRAINT "LegalCaseHearing_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "LegalCase"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE "LegalCaseAttorney"
  ADD CONSTRAINT "LegalCaseAttorney_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "LegalCase"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
