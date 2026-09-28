-- Aceite eletrônico da Política Comercial.
-- Aditiva: não altera usuários existentes e não publica texto.
-- Sem versão PUBLISHED, nenhum SELLER fica bloqueado.

CREATE TYPE "CommercialPolicyStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'RETIRED');

CREATE TABLE IF NOT EXISTS "CommercialPolicy" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "policyType" TEXT NOT NULL,
  "audienceRole" "AppUserRole" NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CommercialPolicy_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "CommercialPolicy_policyType_key" ON "CommercialPolicy"("policyType");

CREATE TABLE IF NOT EXISTS "CommercialPolicyVersion" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "policyId" UUID NOT NULL,
  "versionNumber" INTEGER NOT NULL,
  "title" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "summaryRules" JSONB NOT NULL,
  "declarations" JSONB NOT NULL,
  "questions" JSONB NOT NULL,
  "contentHash" TEXT NOT NULL DEFAULT '',
  "status" "CommercialPolicyStatus" NOT NULL DEFAULT 'DRAFT',
  "effectiveFrom" TIMESTAMPTZ(6) NOT NULL,
  "publishedAt" TIMESTAMPTZ(6),
  "publishedByUserId" UUID,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CommercialPolicyVersion_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "CommercialPolicyVersion_policyId_versionNumber_key"
  ON "CommercialPolicyVersion"("policyId", "versionNumber");
CREATE INDEX IF NOT EXISTS "CommercialPolicyVersion_status_effectiveFrom_idx"
  ON "CommercialPolicyVersion"("status", "effectiveFrom");

CREATE TABLE IF NOT EXISTS "CommercialPolicyKnowledgeAttempt" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "policyVersionId" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "attemptNumber" INTEGER NOT NULL,
  "answers" JSONB NOT NULL,
  "passed" BOOLEAN NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CommercialPolicyKnowledgeAttempt_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "CommercialPolicyKnowledgeAttempt_userId_policyVersionId_createdAt_idx"
  ON "CommercialPolicyKnowledgeAttempt"("userId", "policyVersionId", "createdAt");

CREATE TABLE IF NOT EXISTS "CommercialPolicySignatureChallenge" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "userId" UUID NOT NULL,
  "policyVersionId" UUID NOT NULL,
  "expiresAt" TIMESTAMPTZ(6) NOT NULL,
  "usedAt" TIMESTAMPTZ(6),
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CommercialPolicySignatureChallenge_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "CommercialPolicySignatureChallenge_userId_policyVersionId_idx"
  ON "CommercialPolicySignatureChallenge"("userId", "policyVersionId");

CREATE TABLE IF NOT EXISTS "CommercialPolicyPhotoEvidence" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "userId" UUID NOT NULL,
  "policyVersionId" UUID NOT NULL,
  "challengeId" UUID NOT NULL,
  "storageKey" TEXT NOT NULL,
  "contentHash" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "byteSize" INTEGER NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CommercialPolicyPhotoEvidence_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "CommercialPolicyPhotoEvidence_userId_challengeId_idx"
  ON "CommercialPolicyPhotoEvidence"("userId", "challengeId");

CREATE TABLE IF NOT EXISTS "CommercialPolicyAcceptance" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "policyVersionId" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "userNameSnapshot" TEXT NOT NULL,
  "userEmailSnapshot" TEXT NOT NULL,
  "roleSnapshot" TEXT NOT NULL,
  "externalSellerIdSnapshot" INTEGER,
  "acceptedAt" TIMESTAMPTZ(6) NOT NULL,
  "ipAddress" TEXT,
  "userAgent" TEXT,
  "sessionId" TEXT NOT NULL,
  "challengeId" UUID NOT NULL,
  "photoEvidenceId" UUID NOT NULL,
  "questionnaireAttemptId" UUID NOT NULL,
  "declarationsAccepted" JSONB NOT NULL,
  "policyContentHash" TEXT NOT NULL,
  "photoHash" TEXT NOT NULL,
  "evidenceHash" TEXT NOT NULL,
  "appCommit" TEXT,
  "canonicalPayload" JSONB NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CommercialPolicyAcceptance_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "CommercialPolicyAcceptance_policyVersionId_userId_key"
  ON "CommercialPolicyAcceptance"("policyVersionId", "userId");
CREATE UNIQUE INDEX IF NOT EXISTS "CommercialPolicyAcceptance_challengeId_key"
  ON "CommercialPolicyAcceptance"("challengeId");
CREATE UNIQUE INDEX IF NOT EXISTS "CommercialPolicyAcceptance_photoEvidenceId_key"
  ON "CommercialPolicyAcceptance"("photoEvidenceId");
CREATE INDEX IF NOT EXISTS "CommercialPolicyAcceptance_userId_acceptedAt_idx"
  ON "CommercialPolicyAcceptance"("userId", "acceptedAt");

CREATE TABLE IF NOT EXISTS "CommercialPolicyAcceptanceInvalidation" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "acceptanceId" UUID NOT NULL,
  "actorUserId" UUID NOT NULL,
  "reason" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CommercialPolicyAcceptanceInvalidation_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "CommercialPolicyAcceptanceInvalidation_acceptanceId_idx"
  ON "CommercialPolicyAcceptanceInvalidation"("acceptanceId");

ALTER TABLE "CommercialPolicyVersion"
  ADD CONSTRAINT "CommercialPolicyVersion_policyId_fkey"
  FOREIGN KEY ("policyId") REFERENCES "CommercialPolicy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CommercialPolicyVersion"
  ADD CONSTRAINT "CommercialPolicyVersion_publishedByUserId_fkey"
  FOREIGN KEY ("publishedByUserId") REFERENCES "AppUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CommercialPolicyKnowledgeAttempt"
  ADD CONSTRAINT "CommercialPolicyKnowledgeAttempt_policyVersionId_fkey"
  FOREIGN KEY ("policyVersionId") REFERENCES "CommercialPolicyVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CommercialPolicyKnowledgeAttempt"
  ADD CONSTRAINT "CommercialPolicyKnowledgeAttempt_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "AppUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CommercialPolicySignatureChallenge"
  ADD CONSTRAINT "CommercialPolicySignatureChallenge_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "AppUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CommercialPolicySignatureChallenge"
  ADD CONSTRAINT "CommercialPolicySignatureChallenge_policyVersionId_fkey"
  FOREIGN KEY ("policyVersionId") REFERENCES "CommercialPolicyVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CommercialPolicyPhotoEvidence"
  ADD CONSTRAINT "CommercialPolicyPhotoEvidence_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "AppUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CommercialPolicyPhotoEvidence"
  ADD CONSTRAINT "CommercialPolicyPhotoEvidence_policyVersionId_fkey"
  FOREIGN KEY ("policyVersionId") REFERENCES "CommercialPolicyVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CommercialPolicyAcceptance"
  ADD CONSTRAINT "CommercialPolicyAcceptance_policyVersionId_fkey"
  FOREIGN KEY ("policyVersionId") REFERENCES "CommercialPolicyVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CommercialPolicyAcceptance"
  ADD CONSTRAINT "CommercialPolicyAcceptance_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "AppUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CommercialPolicyAcceptance"
  ADD CONSTRAINT "CommercialPolicyAcceptance_photoEvidenceId_fkey"
  FOREIGN KEY ("photoEvidenceId") REFERENCES "CommercialPolicyPhotoEvidence"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CommercialPolicyAcceptanceInvalidation"
  ADD CONSTRAINT "CommercialPolicyAcceptanceInvalidation_acceptanceId_fkey"
  FOREIGN KEY ("acceptanceId") REFERENCES "CommercialPolicyAcceptance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CommercialPolicyAcceptanceInvalidation"
  ADD CONSTRAINT "CommercialPolicyAcceptanceInvalidation_actorUserId_fkey"
  FOREIGN KEY ("actorUserId") REFERENCES "AppUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
