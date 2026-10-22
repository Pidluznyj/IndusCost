-- Radar de relacionamentos. Aditiva. Não aplicada neste ambiente.
-- Não guarda CPF. Candidato não nasce confirmado.

CREATE TABLE IF NOT EXISTS "CommercialCorporateRadarProfile" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "customerId" UUID NOT NULL,
  "cnpjRoot" TEXT,
  "phoneKey" TEXT,
  "emailKey" TEXT,
  "emailDomain" TEXT,
  "addressKey" TEXT,
  "versionHash" TEXT NOT NULL,
  "evaluatedAt" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "CommercialCorporateRadarProfile_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "CommercialCorporateRadarProfile_customerId_key"
  ON "CommercialCorporateRadarProfile"("customerId");
CREATE INDEX IF NOT EXISTS "CommercialCorporateRadarProfile_cnpjRoot_idx"
  ON "CommercialCorporateRadarProfile"("cnpjRoot");
CREATE INDEX IF NOT EXISTS "CommercialCorporateRadarProfile_phoneKey_idx"
  ON "CommercialCorporateRadarProfile"("phoneKey");
CREATE INDEX IF NOT EXISTS "CommercialCorporateRadarProfile_emailKey_idx"
  ON "CommercialCorporateRadarProfile"("emailKey");
CREATE INDEX IF NOT EXISTS "CommercialCorporateRadarProfile_emailDomain_idx"
  ON "CommercialCorporateRadarProfile"("emailDomain");
CREATE INDEX IF NOT EXISTS "CommercialCorporateRadarProfile_addressKey_idx"
  ON "CommercialCorporateRadarProfile"("addressKey");

ALTER TABLE "CommercialCorporateRadarProfile"
  DROP CONSTRAINT IF EXISTS "CommercialCorporateRadarProfile_customerId_fkey";
ALTER TABLE "CommercialCorporateRadarProfile"
  ADD CONSTRAINT "CommercialCorporateRadarProfile_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

CREATE TABLE IF NOT EXISTS "CommercialCorporateRadarSignal" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "pairKey" TEXT NOT NULL,
  "customerId" UUID NOT NULL,
  "relatedCustomerId" UUID NOT NULL,
  "classification" TEXT NOT NULL,
  "patternCodes" TEXT NOT NULL,
  "evidenceFingerprint" TEXT NOT NULL,
  "evidenceSummary" TEXT NOT NULL,
  "direction" TEXT NOT NULL DEFAULT 'SYMMETRIC',
  "source" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'OPEN',
  "priorityRank" INTEGER NOT NULL DEFAULT 5,
  "detectedAt" TIMESTAMPTZ(6) NOT NULL,
  "evaluatedAt" TIMESTAMPTZ(6) NOT NULL,
  "actorUserId" TEXT,
  "justification" TEXT,
  "evidenceHistory" JSONB,
  CONSTRAINT "CommercialCorporateRadarSignal_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "CommercialCorporateRadarSignal_pairKey_key"
  ON "CommercialCorporateRadarSignal"("pairKey");
CREATE INDEX IF NOT EXISTS "CommercialCorporateRadarSignal_status_priorityRank_idx"
  ON "CommercialCorporateRadarSignal"("status", "priorityRank");
CREATE INDEX IF NOT EXISTS "CommercialCorporateRadarSignal_customerId_idx"
  ON "CommercialCorporateRadarSignal"("customerId");
CREATE INDEX IF NOT EXISTS "CommercialCorporateRadarSignal_relatedCustomerId_idx"
  ON "CommercialCorporateRadarSignal"("relatedCustomerId");

ALTER TABLE "CommercialCorporateRadarSignal"
  DROP CONSTRAINT IF EXISTS "CommercialCorporateRadarSignal_customerId_fkey";
ALTER TABLE "CommercialCorporateRadarSignal"
  ADD CONSTRAINT "CommercialCorporateRadarSignal_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "CommercialCorporateRadarSignal"
  DROP CONSTRAINT IF EXISTS "CommercialCorporateRadarSignal_relatedCustomerId_fkey";
ALTER TABLE "CommercialCorporateRadarSignal"
  ADD CONSTRAINT "CommercialCorporateRadarSignal_relatedCustomerId_fkey"
  FOREIGN KEY ("relatedCustomerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

CREATE TABLE IF NOT EXISTS "CommercialCorporateRadarRun" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "mode" TEXT NOT NULL,
  "startedAt" TIMESTAMPTZ(6) NOT NULL,
  "finishedAt" TIMESTAMPTZ(6),
  "examined" INTEGER NOT NULL DEFAULT 0,
  "created" INTEGER NOT NULL DEFAULT 0,
  "updated" INTEGER NOT NULL DEFAULT 0,
  "queued" INTEGER NOT NULL DEFAULT 0,
  "errors" INTEGER NOT NULL DEFAULT 0,
  "durationMs" INTEGER NOT NULL DEFAULT 0,
  "checkpoint" TIMESTAMPTZ(6),
  "dryRun" BOOLEAN NOT NULL DEFAULT true,
  CONSTRAINT "CommercialCorporateRadarRun_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "CommercialCorporateRadarRun_startedAt_idx"
  ON "CommercialCorporateRadarRun"("startedAt");
