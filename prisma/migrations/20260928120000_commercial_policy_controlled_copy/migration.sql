-- Cópia controlada da Política Comercial. Aditiva. Sem backfill e sem publicação.

CREATE TABLE IF NOT EXISTS "CommercialPolicyControlledCopy" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "policyVersionId" UUID NOT NULL,
  "generatedByUserId" UUID NOT NULL,
  "generatedAt" TIMESTAMPTZ(6) NOT NULL,
  "documentDigest" TEXT NOT NULL,
  "copyDigest" TEXT NOT NULL,
  "recipientName" TEXT NOT NULL,
  "recipientEmail" TEXT NOT NULL,
  CONSTRAINT "CommercialPolicyControlledCopy_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "CommercialPolicyControlledCopy_policyVersionId_generatedAt_idx"
  ON "CommercialPolicyControlledCopy"("policyVersionId", "generatedAt");
CREATE INDEX IF NOT EXISTS "CommercialPolicyControlledCopy_generatedByUserId_idx"
  ON "CommercialPolicyControlledCopy"("generatedByUserId");

ALTER TABLE "CommercialPolicyControlledCopy"
  ADD CONSTRAINT "CommercialPolicyControlledCopy_policyVersionId_fkey"
  FOREIGN KEY ("policyVersionId") REFERENCES "CommercialPolicyVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CommercialPolicyControlledCopy"
  ADD CONSTRAINT "CommercialPolicyControlledCopy_generatedByUserId_fkey"
  FOREIGN KEY ("generatedByUserId") REFERENCES "AppUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
